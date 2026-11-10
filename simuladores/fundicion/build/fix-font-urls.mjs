// Workaround para vinext 0.0.50 en Windows: _rewriteCachedFontCssToServedUrls()
// compara la ruta de caché con "\" contra CSS que la contiene con "/", por lo
// que las @font-face del bundle de servidor conservan rutas absolutas locales
// (file:///C:/...). Los .woff2 sí se copian a dist/client/assets/_vinext_fonts,
// así que basta con reescribir el prefijo en los bundles de servidor.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const cacheDir = path.join(root, ".vinext", "fonts");
const variants = [...new Set([cacheDir, cacheDir.replaceAll("\\", "/")])];
const serverDir = path.join(root, "dist", "server");

const targets = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|css|json)$/.test(entry.name)) targets.push(p);
  }
})(serverDir);

let patched = 0;
for (const file of targets) {
  let text = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const variant of variants) {
    if (text.includes(variant)) {
      text = text.split(variant).join("/assets/_vinext_fonts");
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, text);
    patched++;
  }
}
console.log(`[fix-font-urls] ${patched} archivo(s) de dist/server corregidos`);
