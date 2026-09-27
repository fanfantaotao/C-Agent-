/**
 * wb-bridge inspector client (dev only).
 *
 * Gives the prototype two things it did not have:
 *   1. a stable, machine-readable link between every DOM element and the source line
 *      that produced it (`data-wb-src` injected by the babel plugin);
 *   2. a two-way channel with the dev server, so an AI can both read the page and
 *      receive "click element -> instruction" requests from the human.
 *
 * Selection is a CART, not a single slot: click as many elements as you like, each
 * one keeps its own requirement, then submit them all in one batch.
 *
 * Everything lives in a shadow root and is marked data-wb-ignore, so it never
 * pollutes the page it is inspecting.
 *
 * Plain JS on purpose: it is served straight from disk by the vite plugin, no build step.
 */
(function () {
  if (window.__WB__ && window.__WB__.installed) return;

  var API = "/__wb__/api";
  var HOST_ID = "wb-bridge-host";
  var POLL_MS = 1500;

  var state = {
    mode: "idle", // idle | pick
    items: [], // { key, d, instruction, reqId, status, note, el:{box,pill} }
    hovered: null,
    cursor: 0,
    online: true,
    stats: { polls: 0, commands: 0, sent: 0 },
  };

  /* ------------------------------------------------------------------ helpers */

  function attrClass(el) {
    // SVG elements expose className as an SVGAnimatedString, so read the attribute
    return el && el.getAttribute ? el.getAttribute("class") || "" : "";
  }

  function getFiber(el) {
    if (!el) return null;
    var keys = Object.keys(el);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
        return el[k];
      }
    }
    return null;
  }

  function componentChain(el) {
    var chain = [];
    var props = null;
    var f = getFiber(el);
    while (f) {
      var type = f.type;
      var name = "";
      if (typeof type === "function") name = type.displayName || type.name || "";
      else if (type && typeof type === "object" && type.$$typeof) {
        name = type.displayName || type.name || "";
      }
      if (name && name !== "Anonymous" && /^[A-Z]/.test(name)) {
        chain.push(name);
        if (!props && f.memoizedProps) props = Object.keys(f.memoizedProps);
      }
      f = f.return;
      if (chain.length > 14) break;
    }
    return { chain: chain, props: props || [] };
  }

  function srcChain(el) {
    var out = [];
    var cur = el;
    var exact = null;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 40) {
      var v = cur.getAttribute && cur.getAttribute("data-wb-src");
      if (v) {
        if (!exact) exact = { src: v, tag: cur.tagName.toLowerCase(), cls: attrClass(cur) };
        out.push({ src: v, tag: cur.tagName.toLowerCase(), cls: attrClass(cur).slice(0, 80) });
      }
      cur = cur.parentElement;
      depth++;
    }
    return { entries: out, exact: exact };
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id) {
      try {
        if (document.querySelectorAll("#" + CSS.escape(el.id)).length === 1) {
          return "#" + CSS.escape(el.id);
        }
      } catch (e) {}
    }
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 9) {
      if (cur.id) {
        try {
          if (document.querySelectorAll("#" + CSS.escape(cur.id)).length === 1) {
            parts.unshift("#" + CSS.escape(cur.id));
            break;
          }
        } catch (e) {}
      }
      var sel = cur.tagName.toLowerCase();
      var cls = [];
      var myCls = attrClass(cur);
      for (var i = 0; i < cur.classList.length && cls.length < 3; i++) {
        var c = cur.classList[i];
        if (c.indexOf("wb-") !== 0) cls.push("." + CSS.escape(c));
      }
      sel += cls.join("");
      var parent = cur.parentElement;
      if (parent) {
        var same = [];
        for (var j = 0; j < parent.children.length; j++) {
          var ch = parent.children[j];
          if (ch.tagName === cur.tagName && attrClass(ch) === myCls) same.push(ch);
        }
        if (same.length > 1) sel += ":nth-child(" + (Array.prototype.indexOf.call(parent.children, cur) + 1) + ")";
      }
      parts.unshift(sel);
      cur = parent;
      if (cur === document.body || cur === document.documentElement) {
        parts.unshift(cur === document.body ? "body" : "html");
        break;
      }
    }
    return parts.join(" > ");
  }

  function styleSummary(el) {
    var cs = getComputedStyle(el);
    var keys = [
      "display", "position", "width", "height", "margin", "padding",
      "fontSize", "fontWeight", "lineHeight", "color", "backgroundColor",
      "borderRadius", "border", "gap", "flexDirection", "justifyContent",
      "alignItems", "gridTemplateColumns", "boxShadow", "zIndex", "overflow",
    ];
    var out = {};
    keys.forEach(function (k) {
      var v = cs[k];
      if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px") out[k] = v;
    });
    return out;
  }

  function attrsOf(el) {
    var out = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name === "data-wb-src" || a.name === "style" || a.name === "class") continue;
      out[a.name] = String(a.value).slice(0, 160);
    }
    return out;
  }

  function describe(el) {
    if (!el || el.nodeType !== 1) return null;
    var rect = el.getBoundingClientRect();
    var sc = srcChain(el);
    var comp = componentChain(el);
    return {
      at: new Date().toISOString(),
      url: location.href,
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || "",
      classes: Array.prototype.slice.call(el.classList).filter(function (c) {
        return c.indexOf("wb-") !== 0;
      }),
      text: String(el.innerText || "").trim().slice(0, 400),
      attrs: attrsOf(el),
      outerHTML: el.outerHTML.slice(0, 1200),
      components: comp.chain,
      component: comp.chain[0] || "(host)",
      componentProps: comp.props,
      src: sc.exact ? sc.exact.src : null,
      srcExact: !!sc.exact,
      srcChain: sc.entries.slice(0, 6),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        w: Math.round(rect.width), h: Math.round(rect.height),
      },
      styles: styleSummary(el),
    };
  }

  function outline(maxDepth) {
    maxDepth = maxDepth || 7;
    var lines = [];
    function walk(el, depth) {
      if (depth > maxDepth) return;
      for (var i = 0; i < el.children.length; i++) {
        var c = el.children[i];
        if (c.id === HOST_ID || c.hasAttribute("data-wb-ignore")) continue;
        var src = c.getAttribute("data-wb-src") || "";
        var txt = "";
        for (var j = 0; j < c.childNodes.length; j++) {
          if (c.childNodes[j].nodeType === 3) txt += c.childNodes[j].nodeValue.trim() + " ";
        }
        txt = txt.replace(/\s+/g, " ").trim().slice(0, 60);
        var cls = attrClass(c).split(/\s+/).filter(Boolean).slice(0, 3).join(".");
        lines.push("  ".repeat(depth) + "<" + c.tagName.toLowerCase() + (cls ? "." + cls : "") + ">" +
          (txt ? " " + JSON.stringify(txt) : "") + (src ? "   [" + src + "]" : ""));
        if (lines.length > 900) return;
        walk(c, depth + 1);
      }
    }
    walk(document.body, 0);
    return lines.join("\n");
  }

  function toast(text, ms) {
    var t = document.createElement("div");
    t.className = "wb-toast";
    t.textContent = text;
    shadow.appendChild(t);
    setTimeout(function () { t.classList.add("wb-out"); }, ms || 2200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, (ms || 2200) + 400);
  }

  function call(method, path, body) {
    var opt = { method: method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    return fetch(API + path, opt).then(function (r) {
      if (!r.ok) throw new Error(method + " " + path + " -> " + r.status);
      state.online = true;
      return r.json();
    }).catch(function (e) {
      state.online = false;
      throw e;
    });
  }

  /* -------------------------------------------------------------------- cart */

  function keyOf(d) {
    return (d.src || "?") + "|" + d.selector;
  }

  function addItem(el) {
    var d = describe(el);
    if (!d) return null;
    var k = keyOf(d);
    var existing = indexOfKey(k);
    if (existing >= 0) {
      removeItem(existing, true);
      return null;
    }
    var item = { key: k, d: d, instruction: "", reqId: null, status: "draft", note: "", el: null };
    state.items.push(item);
    return item;
  }

  function indexOfKey(k) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].key === k) return i;
    return -1;
  }

  function removeItem(idx, silent) {
    var it = state.items[idx];
    if (!it) return;
    if (it.el) {
      if (it.el.box && it.el.box.parentNode) it.el.box.parentNode.removeChild(it.el.box);
      if (it.el.pill && it.el.pill.parentNode) it.el.pill.parentNode.removeChild(it.el.pill);
    }
    state.items.splice(idx, 1);
    if (!silent) toast("已移除，剩余 " + state.items.length + " 项");
    renderMarkers();
    renderPanel();
    updateFab();
  }

  function clearItems() {
    state.items.slice().forEach(function (it) {
      if (it.el) {
        if (it.el.box && it.el.box.parentNode) it.el.box.parentNode.removeChild(it.el.box);
        if (it.el.pill && it.el.pill.parentNode) it.el.pill.parentNode.removeChild(it.el.pill);
      }
    });
    state.items = [];
    renderMarkers();
    renderPanel();
    updateFab();
  }

  /* ----------------------------------------------------------- the chrome/UI */

  var host, shadow, overlay, chip, markers, panel, fab;

  function buildChrome() {
    host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("data-wb-ignore", "1");
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '*{box-sizing:border-box;font-family:"Noto Sans SC",-apple-system,"Segoe UI",system-ui,sans-serif}' +
      '.wb-overlay{position:fixed;pointer-events:none;z-index:2147483000;border:1.5px solid #2563eb;' +
      'background:rgba(37,99,235,.10);border-radius:3px;display:none}' +
      '.wb-mark-box{position:fixed;pointer-events:none;z-index:2147482999;border:1.5px dashed #7c3aed;' +
      'background:rgba(124,58,237,.07);border-radius:3px;display:none}' +
      '.wb-mark-pill{position:fixed;pointer-events:none;z-index:2147483000;background:#7c3aed;color:#fff;' +
      'font:600 10px/1 ui-monospace,Consolas,monospace;min-width:16px;height:16px;border-radius:8px;' +
      'display:flex;align-items:center;justify-content:center;padding:0 4px;display:none}' +
      '.wb-chip{position:fixed;pointer-events:none;z-index:2147483001;background:#1e293b;color:#fff;' +
      'font-size:11px;padding:3px 7px;border-radius:4px;white-space:nowrap;display:none;' +
      'font-family:ui-monospace,Consolas,monospace;max-width:80vw;overflow:hidden;text-overflow:ellipsis}' +
      '.wb-fab{position:fixed;right:18px;bottom:18px;z-index:2147483002;display:flex;gap:6px;align-items:center}' +
      '.wb-fab button{border:0;border-radius:999px;padding:9px 14px;font-size:12px;cursor:pointer;' +
      'background:#1e293b;color:#fff;box-shadow:0 6px 20px rgba(15,23,42,.28);font-weight:500}' +
      '.wb-fab button.on{background:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.25),0 6px 20px rgba(37,99,235,.35)}' +
      '.wb-fab button.cart{background:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,.22),0 6px 20px rgba(124,58,237,.32)}' +
      '.wb-panel{position:fixed;right:18px;bottom:66px;width:412px;max-height:76vh;overflow:auto;' +
      'background:#fff;border:1px solid #e2e8f0;border-radius:12px;z-index:2147483003;' +
      'box-shadow:0 18px 48px rgba(15,23,42,.20);display:none;color:#0f172a}' +
      '.wb-panel.show{display:block}' +
      '.wb-hd{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:11px 13px;' +
      'border-bottom:1px solid #eef2f7;position:sticky;top:0;background:#fff;border-radius:12px 12px 0 0;z-index:2}' +
      '.wb-hd b{font-size:13px;font-weight:600}' +
      '.wb-hd .wb-cnt{font-size:11px;color:#7c3aed;background:#f5f3ff;border-radius:999px;padding:2px 8px;font-weight:600}' +
      '.wb-hd .wb-x{border:0;background:#f1f5f9;border-radius:6px;width:24px;height:24px;cursor:pointer;color:#475569;font-size:14px;line-height:1}' +
      '.wb-bd{padding:10px 12px 13px}' +
      '.wb-empty{font-size:12px;color:#64748b;text-align:center;padding:20px 8px;line-height:1.7}' +
      '.wb-item{border:1px solid #e8ecf3;border-radius:9px;padding:9px 10px;margin-bottom:9px;background:#fcfdff}' +
      '.wb-item.done{background:#f6fdf8;border-color:#d6f0de}' +
      '.wb-item-hd{display:flex;align-items:center;gap:7px;margin-bottom:5px}' +
      '.wb-badge{flex:none;background:#7c3aed;color:#fff;font:600 10px/1 ui-monospace,monospace;' +
      'min-width:17px;height:17px;border-radius:9px;display:flex;align-items:center;justify-content:center;padding:0 4px}' +
      '.wb-item.done .wb-badge{background:#16a34a}' +
      '.wb-item-hd code{flex:1;min-width:0;background:#0f172a;color:#7dd3fc;border-radius:4px;padding:2px 6px;' +
      'font:11px/1.5 ui-monospace,Consolas,monospace;cursor:copy;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.wb-del{flex:none;border:0;background:transparent;color:#94a3b8;cursor:pointer;font-size:14px;line-height:1;padding:0 2px}' +
      '.wb-del:hover{color:#dc2626}' +
      '.wb-meta{font-size:11px;color:#64748b;line-height:1.6;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.wb-meta em{color:#0f172a;font-style:normal;background:#f1f5f9;border-radius:3px;padding:0 4px}' +
      '.wb-ta{width:100%;min-height:34px;border:1px solid #cbd5e1;border-radius:7px;padding:7px 8px;' +
      'font-size:12.5px;resize:vertical;font-family:inherit;color:#0f172a;background:#fff;line-height:1.5}' +
      '.wb-ta:focus{outline:2px solid rgba(37,99,235,.35);border-color:#2563eb}' +
      '.wb-item-st{font-size:11px;color:#94a3b8;margin-top:5px}' +
      '.wb-item-st.wait{color:#d97706}.wb-item-st.ok{color:#16a34a}.wb-item-st.err{color:#dc2626}' +
      '.wb-bulk{border-top:1px dashed #e2e8f0;margin-top:4px;padding-top:10px}' +
      '.wb-bulk label{display:block;font-size:11.5px;color:#475569;margin-bottom:5px;font-weight:500}' +
      '.wb-acts{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap}' +
      '.wb-acts button{border-radius:8px;padding:7px 11px;font-size:12px;cursor:pointer;border:1px solid #cbd5e1;' +
      'background:#fff;color:#334155;font-weight:500}' +
      '.wb-acts button.pri{background:#7c3aed;border-color:#7c3aed;color:#fff}' +
      '.wb-acts button:disabled{opacity:.5;cursor:default}' +
      '.wb-st{margin-top:9px;font-size:11.5px;color:#64748b;min-height:15px}' +
      '.wb-st.ok{color:#16a34a}.wb-st.wait{color:#d97706}.wb-st.err{color:#dc2626}' +
      '.wb-toast{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483004;' +
      'background:#0f172a;color:#fff;font-size:12.5px;padding:9px 15px;border-radius:999px;' +
      'box-shadow:0 10px 30px rgba(15,23,42,.3);opacity:1;transition:opacity .3s}' +
      '.wb-toast.wb-out{opacity:0}' +
      '.wb-hide .wb-fab{opacity:.28}' +
      '</style>' +
      '<div class="wb-markers"></div>' +
      '<div class="wb-overlay"></div><div class="wb-chip"></div>' +
      '<div class="wb-fab">' +
      '  <button class="wb-pick" title="Ctrl+Shift+E / Esc">⌖ 选择元素</button>' +
      '  <button class="wb-cart" style="display:none">清单 (0)</button>' +
      '</div>' +
      '<div class="wb-panel">' +
      '  <div class="wb-hd"><span style="display:flex;align-items:center;gap:8px"><b>元素 → AI 修改</b>' +
      '    <span class="wb-cnt">0 项</span></span>' +
      '    <button class="wb-x" title="关闭">×</button></div>' +
      '  <div class="wb-bd">' +
      '    <div class="wb-list"></div>' +
      '    <div class="wb-bulk">' +
      '      <label>统一要求（可选 · 应用到以上全部；每项自己的要求优先）</label>' +
      '      <textarea class="wb-ta wb-bulk-ta" placeholder="例如：这些元素的字号统一调小一档，留白收紧到 8px"></textarea>' +
      '    </div>' +
      '    <div class="wb-acts">' +
      '      <button class="pri wb-send">全部发送</button>' +
      '      <button class="wb-repick">继续选元素</button>' +
      '      <button class="wb-copy">复制全部</button>' +
      '      <button class="wb-clear">清空</button>' +
      '    </div>' +
      '    <div class="wb-st"></div>' +
      '  </div>' +
      '</div>';

    document.body.appendChild(host);

    overlay = shadow.querySelector(".wb-overlay");
    chip = shadow.querySelector(".wb-chip");
    markers = shadow.querySelector(".wb-markers");
    panel = shadow.querySelector(".wb-panel");
    fab = shadow.querySelector(".wb-cart");

    shadow.querySelector(".wb-pick").addEventListener("click", function () { toggle(); });
    shadow.querySelector(".wb-cart").addEventListener("click", function () {
      if (state.mode === "pick") stopPick();
      showPanel();
    });
    shadow.querySelector(".wb-x").addEventListener("click", hidePanel);
    shadow.querySelector(".wb-repick").addEventListener("click", function () { hidePanel(); startPick(); });
    shadow.querySelector(".wb-copy").addEventListener("click", copyAll);
    shadow.querySelector(".wb-clear").addEventListener("click", function () {
      clearItems();
      setStatus("已清空", "");
    });
    shadow.querySelector(".wb-send").addEventListener("click", send);

    // per-item instruction edits + removal, by delegation
    shadow.querySelector(".wb-list").addEventListener("input", function (e) {
      var ta = e.target.closest(".wb-item-ta");
      if (!ta) return;
      var idx = Number(ta.getAttribute("data-idx"));
      if (state.items[idx]) state.items[idx].instruction = ta.value;
    });
    shadow.querySelector(".wb-list").addEventListener("click", function (e) {
      var del = e.target.closest(".wb-del");
      if (del) {
        removeItem(Number(del.getAttribute("data-idx")));
        return;
      }
      var code = e.target.closest("code");
      if (code) {
        navigator.clipboard.writeText(code.textContent || "").then(function () { toast("已复制源码位置"); });
      }
    });
  }

  function updateFab() {
    fab.style.display = state.items.length ? "" : "none";
    var pending = state.items.filter(function (i) { return !i.reqId; }).length;
    fab.textContent = "清单 (" + state.items.length + ")" + (pending < state.items.length ? " · 已发送" : "");
    fab.classList.toggle("cart", state.items.length > 0);
  }

  function statOf(it) {
    if (!it.reqId) return { text: "待发送", cls: "" };
    if (it.status === "done") return { text: "✓ 已改完" + (it.note ? " · " + it.note : ""), cls: "ok" };
    if (it.status === "rejected") return { text: "✕ 未采纳" + (it.note ? " · " + it.note : ""), cls: "err" };
    if (it.status === "working") return { text: "AI 正在改…", cls: "wait" };
    return { text: "已提交 #" + it.reqId + "，等待 AI…", cls: "wait" };
  }

  function renderPanel() {
    var list = shadow.querySelector(".wb-list");
    list.innerHTML = "";
    shadow.querySelector(".wb-cnt").textContent = state.items.length + " 项";

    if (!state.items.length) {
      var empty = document.createElement("div");
      empty.className = "wb-empty";
      empty.textContent = "还没有选择元素。点「继续选元素」，连续点多个元素累积成清单，再一次性发送。";
      list.appendChild(empty);
    } else {
      state.items.forEach(function (it, idx) {
        var d = it.d;
        var row = document.createElement("div");
        row.className = "wb-item" + (it.status === "done" ? " done" : "");
        var st = statOf(it);
        row.innerHTML =
          '<div class="wb-item-hd"><i class="wb-badge">' + (idx + 1) + "</i>" +
          "<code>" + (d.src || "未标注（结构性节点）") + "</code>" +
          '<button class="wb-del" data-idx="' + idx + '" title="移除">×</button></div>' +
          '<div class="wb-meta" title="' + escapeHtml(d.selector + (d.text ? " · " + d.text.slice(0, 120) : "")) + '"><em>' + d.tag + "</em> " + escapeHtml(d.selector) +
          (d.text ? " · " + escapeHtml(d.text.replace(/\n/g, " / ").slice(0, 46)) : "") + "</div>";
        var ta = document.createElement("textarea");
        ta.className = "wb-ta wb-item-ta";
        ta.setAttribute("data-idx", String(idx));
        ta.placeholder = "这一项要改什么（可留空，用下面的统一要求）";
        ta.value = it.instruction || "";
        row.appendChild(ta);
        var s = document.createElement("div");
        s.className = "wb-item-st " + st.cls;
        s.textContent = st.text;
        row.appendChild(s);
        list.appendChild(row);
      });
    }

    var allSent = state.items.length > 0 && state.items.every(function (i) { return !!i.reqId; });
    var btn = shadow.querySelector(".wb-send");
    btn.textContent = "全部发送 (" + state.items.length + ")";
    btn.disabled = !state.items.length || allSent;
    shadow.querySelector(".wb-repick").textContent = state.items.length ? "继续选元素" : "开始选择";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function setStatus(text, cls) {
    var el = shadow.querySelector(".wb-st");
    el.textContent = text || "";
    el.className = "wb-st " + (cls || "");
  }

  function showPanel() {
    renderPanel();
    updateFab();
    panel.classList.add("show");
  }

  function hidePanel() {
    panel.classList.remove("show");
    if (state.mode !== "pick") showOverlay(null);
  }

  /* --------------------------------------------------------------- picking UI */

  function showOverlay(el) {
    if (!el) { overlay.style.display = "none"; chip.style.display = "none"; return; }
    var r = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";
    var sc = srcChain(el);
    var cp = componentChain(el);
    // cheap "is it already queued" check — never run styleSummary() on mousemove
    var already = indexOfKey((sc.exact ? sc.exact.src : "?") + "|" + cssPath(el)) >= 0;
    chip.textContent = el.tagName.toLowerCase() +
      (cp.chain[0] ? " · " + cp.chain[0] : "") +
      (sc.exact ? " · " + sc.exact.src : " · (无 source 标注)") +
      (already ? " · 再点一次可移除" : " · 点击加入清单");
    chip.style.display = "block";
    chip.style.left = Math.max(6, Math.min(r.left, innerWidth - 340)) + "px";
    chip.style.top = (r.top > 26 ? r.top - 24 : r.bottom + 5) + "px";
  }

  var hoverRaf = 0;
  function queueHover(el) {
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(function () {
      hoverRaf = 0;
      if (state.mode === "pick") showOverlay(state.hovered);
    });
  }

  function renderMarkers() {
    var active = {};
    state.items.forEach(function (it) {
      if (!it.el) it.el = {};
      if (!it.el.box) {
        it.el.box = document.createElement("div");
        it.el.box.className = "wb-mark-box";
        markers.appendChild(it.el.box);
      }
      if (!it.el.pill) {
        it.el.pill = document.createElement("div");
        it.el.pill.className = "wb-mark-pill";
        markers.appendChild(it.el.pill);
      }
      active[it.key] = it;
    });
    var idx = 0;
    state.items.forEach(function (it) {
      idx++;
      var el = document.querySelector(it.d.selector);
      if (!el) {
        it.el.box.style.display = "none";
        it.el.pill.style.display = "none";
        return;
      }
      var r = el.getBoundingClientRect();
      var off = r.width < 12 || r.height < 12;
      it.el.box.style.display = off ? "none" : "block";
      it.el.box.style.left = r.left + "px";
      it.el.box.style.top = r.top + "px";
      it.el.box.style.width = r.width + "px";
      it.el.box.style.height = r.height + "px";
      it.el.pill.style.display = "flex";
      it.el.pill.textContent = String(idx);
      it.el.pill.style.left = Math.max(2, r.left - 8) + "px";
      it.el.pill.style.top = Math.max(2, r.top - 8) + "px";
    });
  }

  function startPick() {
    state.mode = "pick";
    document.documentElement.style.cursor = "crosshair";
    shadow.querySelector(".wb-pick").classList.add("on");
    shadow.querySelector(".wb-pick").textContent = "⌖ 选择中…";
    panel.classList.remove("show");
    renderMarkers();
    toast("连续点选多个元素，每个都会进清单 · Esc 结束", 2600);
  }

  function stopPick() {
    state.mode = "idle";
    document.documentElement.style.cursor = "";
    var b = shadow.querySelector(".wb-pick");
    b.classList.remove("on");
    b.textContent = "⌖ 选择元素";
    showOverlay(null);
  }

  function toggle() {
    if (state.mode === "pick") {
      stopPick();
      showPanel();
    } else {
      startPick();
    }
  }

  /* ---------------------------------------------------------- sending a batch */

  function buildContext(it, bulk) {
    var d = it.d;
    var lines = [];
    lines.push("页面：" + d.url);
    lines.push("源码位置：" + (d.src || "(未标注)"));
    lines.push("组件链：" + (d.components.join(" < ") || "(host)"));
    lines.push("选择器：" + d.selector);
    lines.push("元素：<" + d.tag + "> " + d.classes.map(function (c) { return "." + c; }).join(""));
    lines.push("尺寸位置：" + d.rect.w + "×" + d.rect.h + " @ (" + d.rect.x + "," + d.rect.y + ")");
    if (d.text) lines.push("文案：" + d.text.replace(/\n/g, " / ").slice(0, 200));
    var st = Object.keys(d.styles).slice(0, 14).map(function (k) { return k + ":" + d.styles[k]; }).join("; ");
    if (st) lines.push("关键样式：" + st);
    if (d.outerHTML) lines.push("HTML：" + d.outerHTML.slice(0, 400));
    lines.push("----");
    if (it.instruction) lines.push("本项要求：" + it.instruction);
    if (bulk) lines.push("整批统一要求：" + bulk);
    if (!it.instruction && !bulk) lines.push("修改要求：（用户未填写）");
    return lines.join("\n");
  }

  function copyAll() {
    if (!state.items.length) return;
    var bulk = shadow.querySelector(".wb-bulk-ta").value.trim();
    var md = state.items.map(function (it, i) {
      return (i + 1) + ". " + (it.d.src || "(未标注)") + "\n   " + it.d.selector +
        (it.d.text ? "\n   文案：" + it.d.text.replace(/\n/g, " / ").slice(0, 60) : "") +
        "\n   要求：" + (it.instruction || bulk || "（未填写）");
    }).join("\n");
    navigator.clipboard.writeText("共 " + state.items.length + " 项修改：\n" + md).then(
      function () { toast("已复制 " + state.items.length + " 项到剪贴板"); },
      function () { toast("复制失败"); },
    );
  }

  function send() {
    if (!state.items.length) return;
    var bulk = shadow.querySelector(".wb-bulk-ta").value.trim();
    var missing = state.items.filter(function (it) { return !it.instruction.trim(); }).length;
    if (!bulk && missing === state.items.length) {
      setStatus("请至少给一项写要求，或填一个统一要求", "err");
      shadow.querySelector(".wb-bulk-ta").focus();
      return;
    }
    var btn = shadow.querySelector(".wb-send");
    btn.disabled = true;
    setStatus("提交 " + state.items.length + " 项…", "wait");

    call("POST", "/requests", {
      page: { url: location.href, outline: outline(5) },
      instruction: bulk,
      items: state.items.map(function (it) {
        return {
          element: it.d,
          instruction: it.instruction,
          context: buildContext(it, bulk),
        };
      }),
    }).then(function (res) {
      state.stats.sent += res.count || state.items.length;
      (res.ids || []).forEach(function (id, i) {
        if (state.items[i]) {
          state.items[i].reqId = id;
          state.items[i].status = "pending";
        }
      });
      renderPanel();
      updateFab();
      setStatus("已提交 " + (res.count || 0) + " 项（批次 #" + res.batchId + "），等待 AI 修改…", "wait");
      toast("已提交 " + (res.count || 0) + " 项给 AI");
      poll();
    }).catch(function () {
      btn.disabled = false;
      copyAll();
      setStatus("服务不可用，已把清单复制到剪贴板（直接粘贴给我即可）", "err");
    });
  }

  /* --------------------------------------------------------- event capturing */

  function installed(el) {
    return !!(el && el.closest && el.closest("#" + HOST_ID));
  }

  window.addEventListener("pointerdown", function (e) {
    if (state.mode !== "pick" || installed(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var added = addItem(e.target);
    if (added) {
      renderMarkers();
      updateFab();
      toast("已加入 ①".replace("①", String(state.items.length)) + " · 继续点选，Esc 结束", 1500);
    }
  }, true);

  window.addEventListener("mousemove", function (e) {
    if (state.mode !== "pick" || installed(e.target)) return;
    state.hovered = e.target;
    queueHover(e.target);
  }, true);

  window.addEventListener("click", function (e) {
    if (state.mode === "pick" && !installed(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);

  window.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (state.mode === "pick") { stopPick(); showPanel(); }
      else if (panel.classList.contains("show")) hidePanel();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "E" || e.key === "e")) {
      e.preventDefault();
      toggle();
    }
  }, true);

  window.addEventListener("scroll", function () {
    if (state.items.length) renderMarkers();
  }, true);
  window.addEventListener("resize", function () {
    if (state.items.length) renderMarkers();
  });

  /* --------------------------------------------------------------- transport */

  function runCommand(cmd) {
    if (cmd.delay) {
      setTimeout(function () { execCommand(cmd); }, Number(cmd.delay) || 0);
      return true;
    }
    return execCommand(cmd);
  }

  function execCommand(cmd) {
    try {
      var el = cmd.selector ? document.querySelector(cmd.selector) : null;
      if (cmd.type === "highlight" && el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        showOverlay(el);
        setTimeout(function () { showOverlay(null); }, cmd.ms || 2600);
      } else if (cmd.type === "click" && el) {
        el.scrollIntoView({ block: "center" });
        showOverlay(el);
        setTimeout(function () { showOverlay(null); }, 2200);
      } else if (cmd.type === "add" && el) {
        addItem(el);
        renderMarkers();
        renderPanel();
        updateFab();
        toast("AI 已把该元素加入清单");
      } else if (cmd.type === "toast") {
        toast(cmd.text || "");
      } else if (cmd.type === "reload") {
        location.reload();
      } else if (cmd.type === "pick") {
        startPick();
      } else if (cmd.type === "snapshot") {
        window.__WB__.snapshot();
      } else if (cmd.type === "eval") {
        // dev-only remote control: run code in the page and report the result back
        function report(v) {
          var text;
          try { text = typeof v === "string" ? v : JSON.stringify(v); } catch (e) { text = String(v); }
          call("POST", "/result", { label: cmd.label || "", value: text == null ? "" : text }).catch(function () {});
        }
        var out;
        try {
          out = (0, eval)(cmd.code);
        } catch (err) {
          out = { error: String(err && err.message ? err.message : err) };
        }
        // report synchronously when possible: a promise callback can outlive the
        // page under headless --virtual-time-budget and the fetch never leaves
        if (out && typeof out.then === "function") out.then(report);
        else report(out);
      }
      state.stats.commands++;
      return true;
    } catch (e) {
      return false;
    }
  }

  var polling = false;
  function poll() {
    if (polling) return;
    polling = true;
    state.stats.polls++;
    var ids = state.items
      .filter(function (i) { return i.reqId; })
      .map(function (i) { return i.reqId; })
      .join(",");
    call("GET", "/poll?cursor=" + state.cursor + "&ids=" + encodeURIComponent(ids))
      .then(function (res) {
        state.cursor = res.cursor;
        var byId = {};
        (res.requests || []).forEach(function (r) { byId[String(r.id)] = r; });
        var changed = false;
        state.items.forEach(function (it) {
          var r = byId[String(it.reqId)];
          if (!r) return;
          it.status = r.status;
          it.note = r.note || "";
          changed = true;
        });
        if (changed) {
          renderPanel();
          var all = state.items.filter(function (i) { return i.reqId; });
          if (all.length && all.every(function (i) { return i.status === "done"; })) {
            setStatus("AI 已改完 " + all.length + " 项（页面已热更新）", "ok");
          }
        }
        (res.commands || []).forEach(runCommand);
      })
      .catch(function () { state.online = false; })
      .then(function () { polling = false; });
  }

  /* ------------------------------------------------------------------ public */

  window.__WB__ = {
    installed: true,
    version: 2,
    get mode() { return state.mode; },
    api: API,
    on: startPick,
    off: stopPick,
    toggle: toggle,
    open: function () { showPanel(); return true; },
    /** add element(s) to the cart without picking: selector string or array of them */
    add: function (selector) {
      var sels = Array.isArray(selector) ? selector : [selector];
      var n = 0;
      sels.forEach(function (s) {
        var el = document.querySelector(s);
        if (el && addItem(el)) n++;
      });
      renderMarkers();
      renderPanel();
      updateFab();
      return n;
    },
    cart: function () {
      return state.items.map(function (it, i) {
        return {
          n: i + 1, src: it.d.src, selector: it.d.selector, tag: it.d.tag,
          text: it.d.text.slice(0, 60), instruction: it.instruction,
          reqId: it.reqId, status: it.status, note: it.note,
        };
      });
    },
    setInstruction: function (n, text) {
      var it = state.items[n - 1];
      if (!it) return false;
      it.instruction = text;
      renderPanel();
      return true;
    },
    /** fill the bulk field + submit the whole cart */
    send: function (bulk) {
      if (bulk !== undefined) shadow.querySelector(".wb-bulk-ta").value = bulk;
      send();
      return state.items.length;
    },
    clear: clearItems,
    describe: function (selector) {
      var el = typeof selector === "string" ? document.querySelector(selector) : selector;
      return describe(el || document.body);
    },
    annotated: function () {
      return Array.prototype.slice.call(document.querySelectorAll("[data-wb-src]")).map(function (el) {
        var r = el.getBoundingClientRect();
        return {
          src: el.getAttribute("data-wb-src"),
          selector: cssPath(el),
          tag: el.tagName.toLowerCase(),
          text: String(el.innerText || "").trim().slice(0, 80),
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        };
      });
    },
    outline: outline,
    click: function (selector) {
      var el = document.querySelector(selector);
      if (!el) return false;
      el.scrollIntoView({ block: "center" });
      var r = el.getBoundingClientRect();
      var opt = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      el.dispatchEvent(new PointerEvent("pointerdown", opt));
      el.dispatchEvent(new MouseEvent("mousedown", opt));
      el.dispatchEvent(new PointerEvent("pointerup", opt));
      el.dispatchEvent(new MouseEvent("mouseup", opt));
      el.dispatchEvent(new MouseEvent("click", opt));
      return true;
    },
    type: function (selector, value) {
      var el = document.querySelector(selector);
      if (!el) return false;
      var setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value");
      if (setter && setter.set) setter.set.call(el, value); else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    },
    highlight: function (selector, ms) {
      var el = document.querySelector(selector);
      if (el) { showOverlay(el); setTimeout(function () { showOverlay(null); }, ms || 2000); }
      return !!el;
    },
    storage: function () {
      var out = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return out;
    },
    clearStorage: function () {
      var n = 0;
      Object.keys(this.storage()).forEach(function (k) {
        if (k.indexOf("mushsci") === 0) { localStorage.removeItem(k); n++; }
      });
      return n;
    },
    snapshot: function () {
      return call("POST", "/page", {
        url: location.href,
        title: document.title,
        outline: outline(7),
        annotated: this.annotated().length,
        storage: this.storage(),
        viewport: [innerWidth, innerHeight],
      });
    },
    queue: function () { return call("GET", "/requests"); },
    stats: function () {
      return {
        polls: state.stats.polls, commands: state.stats.commands, sent: state.stats.sent,
        cursor: state.cursor, online: state.online, mode: state.mode, cart: state.items.length,
      };
    },
    toast: toast,
    hideChrome: function () { host.classList.add("wb-hide"); },
  };

  /**
   * Dev probe: ?wb-probe=<selector>[|<selector>...] selects those elements into the
   * cart; &wb-probe-send=<bulk text> submits them; &wb-probe-item=<n>:<text> (repeatable)
   * sets a per-item requirement. Renders a JSON summary into #wb-probe-result so a
   * headless run can be asserted from the command line (shadow DOM is not serialized).
   */
  function probe() {
    var q = new URLSearchParams(location.search);
    var sel = q.get("wb-probe");
    if (!sel) return;
    var delay = Number(q.get("wb-probe-delay") || 1600);
    setTimeout(function () {
      sel.split("|").forEach(function (s) {
        var el = document.querySelector(s);
        if (el) addItem(el);
      });
      q.getAll("wb-probe-item").forEach(function (pair) {
        var i = pair.indexOf(":");
        var n = Number(pair.slice(0, i));
        var it = state.items[n - 1];
        if (it) it.instruction = pair.slice(i + 1);
      });
      renderMarkers();
      renderPanel();
      updateFab();
      showPanel();
      var bulk = q.get("wb-probe-send");
      if (bulk) {
        // go through the real field so the probe exercises the real submit path
        shadow.querySelector(".wb-bulk-ta").value = bulk;
        send();
      }
      setTimeout(function () {
        var out = document.createElement("pre");
        out.id = "wb-probe-result";
        out.setAttribute("data-wb-ignore", "1");
        out.style.cssText = "position:fixed;left:0;bottom:0;z-index:99999;font-size:11px;background:#fff;border:1px solid #ccc;padding:6px;max-width:100vw;white-space:pre-wrap";
        out.textContent = JSON.stringify({
          ok: state.items.length > 0,
          cart: window.__WB__.cart(),
          stats: window.__WB__.stats(),
        }, null, 1);
        document.body.appendChild(out);
      }, 1400);
    }, delay);
  }

  function boot() {
    buildChrome();
    poll();
    setInterval(poll, POLL_MS);
    setTimeout(function () {
      try { window.__WB__.snapshot(); } catch (e) {}
    }, 1800);
    window.addEventListener("popstate", function () {
      setTimeout(function () { try { window.__WB__.snapshot(); } catch (e) {} }, 800);
    });
    probe();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
