// Genera las presentaciones en docs/presentaciones:  npm install && node generar.js [opcua modbus ...]
const path = require("path");
const { construir } = require("./comun.js");
const TODAS = ["panorama", "opcua", "modbus", "mqtt", "web", "s7", "opcua_avanzado", "ia"];
(async () => {
  for (const nombre of process.argv.slice(2).length ? process.argv.slice(2) : TODAS) {
    const { meta, diapositivas } = require(`./${nombre}.js`);
    const salida = path.join(__dirname, "..", meta.archivo);
    await construir(meta, diapositivas, salida);
    console.log("ok", salida, diapositivas.length, "diapositivas");
  }
})().catch((e) => { console.error(e); process.exit(1); });
