// A Turbopack loader (next.config.ts): a legal text becomes a module whose default export is the
// file's text, so the texts are bundled at build time and never read with fs (spec 0017).
// Turbopack's own `raw` module type exports nothing a JavaScript import can read.
module.exports = function rawTextLoader(source) {
  return `export default ${JSON.stringify(source)};`;
};
