/**
 * Babel plugin: annotate host JSX elements with their source location.
 *
 *   <div className="card">   ->   <div data-wb-src="src/Workspace.jsx:182:7" className="card">
 *
 * Only lowercase (host) elements are annotated; custom components are skipped so we
 * never leak an unknown prop into a React component. This is the foundation of the
 * click-to-edit bridge: any DOM node can be mapped back to the exact line of source
 * that produced it, which is what lets an AI edit the right place without guessing.
 *
 * React 19 removed `fiber._debugSource`, so this cannot be recovered at runtime -
 * it has to be injected at compile time.
 */

export default function wbJsxSourcePlugin(api, options = {}) {
  // Must be registered as a FACTORY: `plugins: [wbJsxSourcePlugin]`, never
  // `plugins: [wbJsxSourcePlugin({...})]` — calling it yourself hands babel a
  // finished plugin object and `api` ends up being your options bag.
  const t = api && api.types;
  if (!t) {
    throw new Error(
      "[wb-bridge] jsx-source-plugin must be passed as a factory, e.g. " +
        "`plugins: [[wbJsxSourcePlugin, { attr: 'data-wb-src' }]]`, not called.",
    );
  }
  const attr = options.attr || "data-wb-src";
  const ignore = new Set(options.ignoreTags || ["Fragment"]);

  return {
    name: "wb-jsx-source",
    visitor: {
      JSXOpeningElement(nodePath, state) {
        const nameNode = nodePath.node.name;

        // <div>, <span>, ... keep; <Card>, <Foo.Bar>, <> drop
        if (!nameNode || nameNode.type !== "JSXIdentifier") return;
        const tag = nameNode.name;
        if (!/^[a-z]/.test(tag) || ignore.has(tag)) return;

        // idempotent
        const already = nodePath.node.attributes.some(
          (a) => a.type === "JSXAttribute" && a.name && a.name.name === attr,
        );
        if (already) return;

        const loc = nodePath.node.loc;
        if (!loc) return;

        const filename = state.file.opts.filename || "";
        const root = state.file.opts.root || process.cwd();
        let rel = filename.replace(/\\/g, "/");
        const normRoot = String(root).replace(/\\/g, "/").replace(/\/$/, "");
        if (normRoot && rel.startsWith(normRoot + "/")) rel = rel.slice(normRoot.length + 1);
        if (!rel) return;

        const value = `${rel}:${loc.start.line}:${loc.start.column + 1}`;

        nodePath.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier(attr), t.stringLiteral(value)),
        );
      },
    },
  };
}
