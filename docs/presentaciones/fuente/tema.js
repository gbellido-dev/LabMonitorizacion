// Escribe los colores del tema en ppt/theme/theme1.xml (pptxgenjs deja la paleta de Office).
const fs = require("fs");
const JSZip = require(require.resolve("jszip", { paths: [require.resolve("pptxgenjs")] }));
const HUECOS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

async function applyTheme(ruta, tema) {
  const zip = await JSZip.loadAsync(fs.readFileSync(ruta));
  const parte = "ppt/theme/theme1.xml";
  const esquema = `<a:clrScheme name="${tema.name}">` +
    HUECOS.map((k) => `<a:${k}><a:srgbClr val="${tema.colors[k]}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const xml = (await zip.file(parte).async("string"))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => esquema)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, a) => `${a}${tema.name}"`);
  zip.file(parte, xml);
  // pptxgenjs escribe un <a:pPr> por cada trozo de texto de un párrafo: se deja solo el primero
  // (si no, una viñeta con una palabra en negrita pierde la viñeta en algunos visores).
  for (const nombre of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const x = await zip.file(nombre).async("string");
    const limpio = x.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (todo, dentro) => {
      let primero = true;
      return "<a:p>" + dentro.replace(/<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g, (pp) => {
        if (primero) { primero = false; return pp; }
        return "";
      }) + "</a:p>";
    });
    zip.file(nombre, limpio);
  }
  for (const nombre of Object.keys(zip.files)) {
    if (!nombre.endsWith(".xml")) continue;
    const x = await zip.file(nombre).async("string");
    const malo = x.match(/<a:srgbClr val="((?![0-9A-Fa-f]{6}")[^"]*)"/);
    if (malo) throw new Error(`${nombre}: color no hexadecimal ${malo[1]} (un color del esquema en una opción que solo admite hex)`);
  }
  for (const [n, f] of Object.entries(zip.files)) if (f.dir) delete zip.files[n];   // sin entradas de carpeta (remove() borraría también su contenido)
  fs.writeFileSync(ruta, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
module.exports = { applyTheme };
