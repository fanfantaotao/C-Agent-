/**
 * wb-bridge vite plugin (dev only).
 *
 * Two jobs:
 *   1. inject the inspector client into the dev page;
 *   2. expose a tiny JSON API on the dev server so an AI agent can read the human's
 *      click-to-edit requests and drive the page back.
 *
 * Nothing here exists in `vite build`, so the exported single-file prototype stays clean.
 *
 * Endpoints (all under /__wb__/api):
 *   GET  /health                      -> { ok, root, counts }
 *   GET  /poll?cursor=N&ids=1,2       -> { cursor, requests:[{id,status,note}], commands:[...] }
 *                                        (commands are consumed on read)
 *   POST /requests                    -> { batchId, ids:[...] }
 *                                        accepts a batch: { items:[{element,instruction,context}], instruction }
 *                                        (a bare { element, instruction } still works as a batch of one)
 *   GET  /requests[?status=pending]   -> [ ...all requests, newest first ]
 *   GET  /requests/:id                -> single request
 *   POST /requests/status             -> { ids:[...], status, note }  bulk status update
 *   POST /requests/:id/status         -> single status update
 *   POST /page                        -> page snapshot (outline + storage)
 *   GET  /page                        -> last snapshot
 *   POST /commands                    -> { type:'highlight'|'click'|'add'|'toast'|'reload'|'pick'|'snapshot'|'eval', selector, text, code, delay }
 *                                        queue a command for the page to run on next poll
 *   POST /result                      -> { label, value }   page reports an eval result back
 *   GET  /result                      -> last 20 results
 *
 * Everything is mirrored to <root>/.wb-bridge/session.json so the agent can also just
 * read the file instead of calling HTTP.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default function wbBridge(options = {}) {
  let root = process.cwd();
  let storeFile = null;
  let clientFile = path.join(__dirname, "inspector-client.js");
  let clientCode = null;

  const store = {
    seq: 0,
    batchSeq: 0,
    cursor: 0,
    requests: [],
    commands: [],
    results: [],
    page: null,
    log: [],
  };

  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(storeFile, "utf8"));
      Object.assign(store, {
        seq: raw.seq || 0,
        batchSeq: raw.batchSeq || 0,
        cursor: raw.cursor || 0,
        requests: Array.isArray(raw.requests) ? raw.requests : [],
        results: Array.isArray(raw.results) ? raw.results : [],
        page: raw.page || null,
        log: Array.isArray(raw.log) ? raw.log : [],
      });
    } catch (e) {
      /* fresh session */
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      fs.writeFileSync(
        storeFile,
        JSON.stringify(
          {
            seq: store.seq,
            batchSeq: store.batchSeq,
            cursor: store.cursor,
            requests: store.requests,
            results: store.results,
            page: store.page,
            log: store.log.slice(-40),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      /* non fatal */
    }
  }

  function nextId() {
    store.seq += 1;
    return store.seq;
  }

  function send(res, code, body) {
    const text = JSON.stringify(body);
    res.statusCode = code;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end(text);
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        if (raw.length > 4e6) req.destroy();
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (e) {
          resolve({});
        }
      });
      req.on("error", () => resolve({}));
    });
  }

  const STATUS = new Set(["pending", "working", "done", "rejected"]);

  return {
    name: "wb-bridge",
    apply: "serve",
    enforce: "pre",

    configResolved(config) {
      root = config.root;
      storeFile = path.join(root, ".wb-bridge", "session.json");
      load();
    },

    configureServer(server) {
      server.middlewares.use("/__wb__", async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        const route = url.pathname;
        const method = (req.method || "GET").toUpperCase();

        if (method === "OPTIONS") {
          res.statusCode = 204;
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");
          return res.end();
        }

        try {
          // ---------------------------------------------------------- inspector.js
          if (route === "/inspector.js") {
            // read every time: editing the client should not need a server restart
            clientCode = fs.readFileSync(clientFile, "utf8");
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
            return res.end(clientCode);
          }

          // -------------------------------------------------------------- health
          if (route === "/api/health") {
            return send(res, 200, {
              ok: true,
              root,
              storeFile,
              counts: {
                requests: store.requests.length,
                pending: store.requests.filter((r) => r.status === "pending").length,
                batches: [...new Set(store.requests.map((r) => r.batchId))].length,
              },
            });
          }

          // ---------------------------------------------------------------- poll
          if (route === "/api/poll") {
            const cursor = Number(url.searchParams.get("cursor") || 0);
            const ids = String(url.searchParams.get("ids") || "")
              .split(",")
              .map((s) => Number(s))
              .filter(Boolean);
            const fresh = cursor === 0 ? [] : store.requests.filter((r) => Number(r.updatedSeq) > cursor);
            const tracked = ids.length
              ? store.requests.filter((r) => ids.indexOf(Number(r.id)) >= 0)
              : fresh;
            const commands = store.commands.slice();
            store.commands = [];
            store.cursor = store.seq;
            save();
            return send(res, 200, {
              cursor: store.seq,
              requests: tracked.map((r) => ({ id: r.id, status: r.status, note: r.note || "" })),
              commands,
            });
          }

          // ------------------------------------------------------------ requests
          if (route === "/api/requests" && method === "POST") {
            const body = await readBody(req);
            // a batch arrives as { items:[...] }; a single edit is a batch of one
            const items = Array.isArray(body.items) && body.items.length
              ? body.items
              : [{ element: body.element, instruction: body.instruction, context: body.context }];
            const batchId = ++store.batchSeq;
            const now = new Date().toISOString();
            const pageUrl = (body.page && body.page.url) || "";
            const pageOutline = (body.page && body.page.outline) || "";
            const created = items.map((it) => {
              const rec = {
                id: nextId(),
                batchId,
                batchSize: items.length,
                status: "pending",
                note: "",
                instruction: String(it.instruction || "").slice(0, 4000),
                batchInstruction: String(body.instruction || "").slice(0, 4000),
                context: String(it.context || "").slice(0, 8000),
                element: it.element || null,
                pageUrl,
                pageOutline,
                createdAt: now,
                updatedSeq: store.seq,
              };
              store.requests.unshift(rec);
              return rec;
            });
            if (store.requests.length > 400) store.requests.length = 400;
            save();
            server.config.logger.info(
              `[wb-bridge] batch #${batchId} ← ${created.length} 项 ` +
                created.map((r) => (r.element ? r.element.selector : "?")).join(" | "),
            );
            return send(res, 201, { batchId, ids: created.map((r) => r.id), count: created.length });
          }

          if (route === "/api/requests" && method === "GET") {
            const want = url.searchParams.get("status");
            const list = want ? store.requests.filter((r) => r.status === want) : store.requests;
            return send(res, 200, {
              requests: list,
              pending: store.requests.filter((r) => r.status === "pending").length,
              batches: [...new Set(store.requests.map((r) => r.batchId))].length,
            });
          }

          const mReq = route.match(/^\/api\/requests\/(\d+)$/);
          if (mReq && method === "GET") {
            const rec = store.requests.find((r) => Number(r.id) === Number(mReq[1]));
            return rec ? send(res, 200, rec) : send(res, 404, { error: "not found" });
          }

          // bulk status: { ids:[...], status, note }
          if (route === "/api/requests/status" && method === "POST") {
            const body = await readBody(req);
            const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number);
            const touched = [];
            store.requests.forEach((r) => {
              if (ids.indexOf(Number(r.id)) < 0) return;
              if (body.status && STATUS.has(body.status)) r.status = body.status;
              if (body.note !== undefined) r.note = String(body.note).slice(0, 500);
              r.updatedSeq = ++store.seq;
              r.updatedAt = new Date().toISOString();
              touched.push({ id: r.id, status: r.status });
            });
            save();
            return send(res, touched.length ? 200 : 404, { updated: touched.length, ids: touched });
          }

          const mStatus = route.match(/^\/api\/requests\/(\d+)\/status$/);
          if (mStatus && method === "POST") {
            const body = await readBody(req);
            const rec = store.requests.find((r) => Number(r.id) === Number(mStatus[1]));
            if (!rec) return send(res, 404, { error: "not found" });
            if (body.status && STATUS.has(body.status)) rec.status = body.status;
            if (body.note !== undefined) rec.note = String(body.note).slice(0, 500);
            rec.updatedSeq = ++store.seq;
            rec.updatedAt = new Date().toISOString();
            save();
            return send(res, 200, { id: rec.id, status: rec.status, note: rec.note });
          }

          // ---------------------------------------------------------------- page
          if (route === "/api/page" && method === "POST") {
            const body = await readBody(req);
            store.page = {
              ...body,
              receivedAt: new Date().toISOString(),
            };
            save();
            return send(res, 200, { ok: true, outlineLines: String(store.page.outline || "").split("\n").length });
          }
          if (route === "/api/page" && method === "GET") {
            return send(res, 200, store.page || { error: "no snapshot yet" });
          }

          // ------------------------------------------------------------ commands
          if (route === "/api/commands" && method === "POST") {
            const body = await readBody(req);
            const cmds = Array.isArray(body) ? body : [body];
            cmds.forEach((c) => store.commands.push({ ...c, id: nextId(), queuedAt: new Date().toISOString() }));
            save();
            return send(res, 200, { queued: cmds.length, queueLength: store.commands.length });
          }
          if (route === "/api/commands" && method === "GET") {
            return send(res, 200, { pending: store.commands });
          }

          // ------------------------------------------------------------- session
          if (route === "/api/reset" && method === "POST") {
            store.seq = 0;
            store.batchSeq = 0;
            store.cursor = 0;
            store.requests = [];
            store.commands = [];
            store.results = [];
            store.page = null;
            save();
            return send(res, 200, { ok: true });
          }

          // results reported back by the page (eval output etc.)
          if (route === "/api/result" && method === "POST") {
            const body = await readBody(req);
            store.results.push({
              label: String(body.label || "").slice(0, 80),
              value: String(body.value === undefined ? "" : body.value).slice(0, 40000),
              at: new Date().toISOString(),
            });
            if (store.results.length > 20) store.results.shift();
            save();
            return send(res, 200, { ok: true, count: store.results.length });
          }
          if (route === "/api/result" && method === "GET") {
            return send(res, 200, { results: store.results });
          }

          if (route === "/api/log" && method === "POST") {
            const body = await readBody(req);
            store.log.push({ ...body, at: new Date().toISOString() });
            save();
            return send(res, 200, { ok: true });
          }

          return next();
        } catch (err) {
          server.config.logger.error(`[wb-bridge] ${err && err.stack ? err.stack : err}`);
          return send(res, 500, { error: String(err) });
        }
      });
    },

    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module", src: "/__wb__/inspector.js" },
          injectTo: "body",
        },
      ];
    },
  };
}
