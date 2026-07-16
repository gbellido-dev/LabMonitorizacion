// Cliente OPC UA de ejemplo/prueba: se conecta al servidor de la fundición,
// recorre el árbol PlantaNorte y lee telemetría dos veces para comprobar que
// los valores cambian. Uso:  node opcua/client-test.mjs
import { OPCUAClient, AttributeIds } from "node-opcua";

const ENDPOINT = process.env.OPCUA_ENDPOINT ?? "opc.tcp://localhost:4840/UA/Fundicion";

const client = OPCUAClient.create({ endpointMustExist: false });
await client.connect(ENDPOINT);
const session = await client.createSession();
console.log(`Conectado a ${ENDPOINT}\n`);

// ---- browse del árbol (2 niveles bajo PlantaNorte) ----
async function children(nodeId) {
  const r = await session.browse(nodeId);
  return (r.references ?? []).filter(ref => !ref.browseName.name.startsWith("Server"));
}
console.log("PlantaNorte/");
for (const zone of await children("ns=1;s=PlantaNorte")) {
  console.log(`  ${zone.browseName.name}/`);
  for (const dev of await children(zone.nodeId)) {
    const vars = await children(dev.nodeId);
    console.log(`    ${dev.browseName.name}  (${vars.length} nodos)`);
  }
}

// ---- lectura de muestra, dos pasadas separadas 2 s ----
const sampleIds = [
  "ns=1;s=IF-01.TemperaturaMetal",
  "ns=1;s=IF-02.Vibracion",
  "ns=1;s=COL-01.PesoCuchara",
  "ns=1;s=ROB-02.PiezasManipuladas",
  "ns=1;s=QC-01.DesviacionEscaneo",
  "ns=1;s=IF-01.TagsS7.ReadyToPour",
  "ns=1;s=KPIs.OEEPlanta",
  "ns=1;s=KPIs.LoteActivo",
];
async function readAll(label) {
  console.log(`\nLectura ${label}:`);
  const results = await session.read(sampleIds.map(nodeId => ({ nodeId, attributeId: AttributeIds.Value })));
  results.forEach((r, i) => console.log(`  ${sampleIds[i].padEnd(42)} = ${r.value.value}   [${r.statusCode.name}]`));
  return results.map(r => r.value.value);
}
const first = await readAll("1/2");
await new Promise(res => setTimeout(res, 2100));
const second = await readAll("2/2");

const changed = first.filter((v, i) => typeof v === "number" && v !== second[i]).length;
console.log(`\nVariables numéricas que han cambiado entre lecturas: ${changed}`);

await session.close();
await client.disconnect();
console.log("Desconectado.");
