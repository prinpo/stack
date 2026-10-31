function escapeScript(json: string) {
  return json
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** Initialize metadata before dependencies evaluate, then hydrate HTML-safe JSON data. */
export function clientEnvScript(values: object, keys: readonly string[]) {
  const json = escapeScript(JSON.stringify(JSON.stringify(values)));
  const metadata = escapeScript(JSON.stringify(keys));
  return `globalThis.__varlockPublicDynamicKeys = ${metadata};\nglobalThis.__varlockThrowOnMissingKeys = true;\nglobalThis.__varlockPublicDynamicEnv = JSON.parse(${json});`;
}

/** Prepare the production document from its independently resolved client snapshot. */
export function injectClientEnv(html: string, values: object, keys: readonly string[]) {
  const script = clientEnvScript(values, keys);
  let inserted = false;
  const result = new HTMLRewriter()
    .on("head", {
      element(head) {
        if (inserted) return;
        head.prepend(`<script>${script}</script>`, { html: true });
        inserted = true;
      },
    })
    .transform(html);
  if (!inserted) throw new Error("Client environment injection requires an HTML head element");
  return result;
}
