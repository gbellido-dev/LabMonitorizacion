// Servidor OPC UA de la fundición simulada.
//
//   Endpoint:  opc.tcp://localhost:4840/UA/Fundicion
//   Arranque:  npm run opcua   (u  opcua.bat)
//
// Publica el espacio de direcciones Objects/PlantaNorte con una carpeta por
// zona, un objeto por máquina/robot y variables de telemetría que se
// actualizan cada segundo (paseo aleatorio alrededor del nominal). Cada
// activo expone además su mapa de tags S7 bajo el subobjeto TagsS7.
//
// NodeIds estables:  ns=1;s=<ACTIVO>.<Variable>   p. ej.  ns=1;s=IF-01.TemperaturaMetal
//
// Seguridad: pensado para simulación. Acepta conexiones anónimas y sin
// cifrado (SecurityPolicy None) además de las políticas seguras por defecto.
import { OPCUAServer, Variant, DataType } from "node-opcua";
import { assets, kpis, loteActivo, zones } from "./plant-model.mjs";

const PORT = Number(process.env.OPCUA_PORT ?? 4840);
// En Docker el hostname del contenedor no es alcanzable desde fuera; con
// OPCUA_ALTERNATE_HOSTNAME=localhost el endpoint anunciado es válido para
// clientes del host (p. ej. UaExpert).
const ALT_HOSTNAME = process.env.OPCUA_ALTERNATE_HOSTNAME;

const server = new OPCUAServer({
  port: PORT,
  ...(ALT_HOSTNAME ? { alternateHostname: [ALT_HOSTNAME] } : {}),
  resourcePath: "/UA/Fundicion",
  buildInfo: {
    productName: "Ferrovia Digital Foundry OPC UA",
    productUri: "urn:ferrovia:digital-foundry",
    manufacturerName: "Ferrovia",
    softwareVersion: "1.0.0",
  },
  serverInfo: {
    applicationName: { text: "Ferrovia Digital Foundry", locale: "es" },
    applicationUri: "urn:ferrovia:digital-foundry:server",
  },
});

await server.initialize();

const addressSpace = server.engine.addressSpace;
const ns = addressSpace.getOwnNamespace();
const objects = addressSpace.rootFolder.objects;

// simVars: variables con dinámica -> se actualizan en el bucle de 1 s
// state.value evoluciona; node es la variable OPC UA
const simVars = [];
// índices para la lógica de proceso (variables gestionadas, flags y estados)
const varIndex = new Map();   // "IF-01.TemperaturaMetal" -> entrada de simVars
const flagNodes = new Map();  // "IF-01.Fase" -> { node, dt }
const estadoNodes = new Map(); // "DES-01" -> variable Estado

function addStaticString(parent, browseName, value, nodeIdSuffix) {
  const v = ns.addVariable({
    componentOf: parent,
    browseName,
    nodeId: `s=${nodeIdSuffix}`,
    dataType: "String",
    accessLevel: "CurrentRead",
  });
  v.setValueFromSource(new Variant({ dataType: DataType.String, value }));
  return v;
}

function addSimVariable(parent, spec, nodeIdSuffix) {
  const node = ns.addVariable({
    componentOf: parent,
    browseName: spec.n,
    nodeId: `s=${nodeIdSuffix}`,
    dataType: "Double",
    description: spec.unit ? `${spec.n} [${spec.unit}]` : spec.n,
    accessLevel: "CurrentRead",
    minimumSamplingInterval: 250,
  });
  node.setValueFromSource(new Variant({ dataType: DataType.Double, value: spec.v }));
  const entry = { node, spec, value: spec.v };
  simVars.push(entry);
  varIndex.set(nodeIdSuffix, entry);
  if (spec.unit) addStaticString(node, "Unidad", spec.unit, `${nodeIdSuffix}.Unidad`);
  return node;
}

// Tipo de dato de un tag S7 según su dirección: DBX -> Boolean, DBW -> UInt16, resto -> Double
function tagInitial(address) {
  if (address.includes("DBX")) return { dataType: DataType.Boolean, value: Math.random() > 0.3, kind: "bool" };
  if (address.includes("DBW")) return { dataType: DataType.UInt16, value: Math.floor(Math.random() * 8), kind: "word" };
  return { dataType: DataType.Double, value: Math.round(Math.random() * 1000) / 10, kind: "walk", w: 2, dp: 1 };
}

/* ---- árbol de la planta ---- */
const plant = ns.addFolder(objects, { browseName: "PlantaNorte", nodeId: "s=PlantaNorte" });

// KPIs de planta
const kpiFolder = ns.addObject({ organizedBy: plant, browseName: "KPIs", nodeId: "s=KPIs" });
for (const kpi of kpis) addSimVariable(kpiFolder, kpi, `KPIs.${kpi.n}`);
addStaticString(kpiFolder, loteActivo.n, loteActivo.value, `KPIs.${loteActivo.n}`);

// Zonas y activos
const zoneFolders = new Map();
for (const zone of zones) {
  zoneFolders.set(zone, ns.addFolder(plant, { browseName: zone, nodeId: `s=Zona.${zone}` }));
}

for (const asset of assets) {
  const device = ns.addObject({
    organizedBy: zoneFolders.get(asset.zone),
    browseName: asset.short,
    displayName: `${asset.short} · ${asset.name}`,
    description: asset.name,
    nodeId: `s=${asset.short}`,
  });
  addStaticString(device, "Nombre", asset.name, `${asset.short}.Nombre`);
  estadoNodes.set(asset.short, addStaticString(device, "Estado", asset.status, `${asset.short}.Estado`));
  addStaticString(device, "PLC", asset.plc, `${asset.short}.PLC`);
  addStaticString(device, "Zona", asset.zone, `${asset.short}.Zona`);
  for (const spec of asset.vars) addSimVariable(device, spec, `${asset.short}.${spec.n}`);
  for (const fl of asset.flags ?? []) {
    const dt = fl.type === "bool" ? DataType.Boolean : DataType.String;
    const flagVar = ns.addVariable({
      componentOf: device,
      browseName: fl.n,
      nodeId: `s=${asset.short}.${fl.n}`,
      dataType: fl.type === "bool" ? "Boolean" : "String",
      accessLevel: "CurrentRead",
    });
    flagVar.setValueFromSource(new Variant({ dataType: dt, value: fl.v }));
    flagNodes.set(`${asset.short}.${fl.n}`, { node: flagVar, dt });
  }

  // Mapa de señales S7 del activo, con su dirección como propiedad
  const tagsFolder = ns.addObject({ componentOf: device, browseName: "TagsS7", nodeId: `s=${asset.short}.TagsS7` });
  for (const [symbol, address] of asset.tags) {
    const init = tagInitial(address);
    const tagNode = ns.addVariable({
      componentOf: tagsFolder,
      browseName: symbol,
      nodeId: `s=${asset.short}.TagsS7.${symbol}`,
      dataType: DataType[init.dataType] ?? "Double",
      description: `Señal S7 en ${address}`,
      accessLevel: "CurrentRead",
    });
    tagNode.setValueFromSource(new Variant({ dataType: init.dataType, value: init.value }));
    addStaticString(tagNode, "DireccionS7", address, `${asset.short}.TagsS7.${symbol}.Direccion`);
    simVars.push({ node: tagNode, spec: { kind: init.kind, w: init.w ?? 0, dp: init.dp ?? 0, v: init.value }, value: init.value, dataType: init.dataType });
  }
}

/* ---- lógica de proceso: fases y correlaciones ----
 * Las variables "managed" no siguen el paseo aleatorio genérico sino ciclos
 * de proceso coherentes: fase del horno <-> temperatura/potencia, colada
 * ON/OFF <-> caudal y balance de masa de la cuchara, desmoldeo marcha/paro
 * <-> vibración/frecuencia/potencia. */
const setNum = (key, target, rate, noise) => {
  const e = varIndex.get(key);
  e.value += (target - e.value) * rate + (Math.random() - 0.5) * noise;
  e.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Number(e.value.toFixed(e.spec.dp ?? 1)) }));
};
const setFlag = (key, value) => {
  const f = flagNodes.get(key);
  f.node.setValueFromSource(new Variant({ dataType: f.dt, value }));
};
const setEstado = (short, value) =>
  estadoNodes.get(short).setValueFromSource(new Variant({ dataType: DataType.String, value }));

const FURNACE_PHASES = [["CARGA", 25], ["FUSION", 75], ["AFINO", 35], ["LISTO", 30]];
const furnaces = [
  { short: "IF-01", nomT: 1487, nomP: 1840, i: 1, t: 20 },
  { short: "IF-02", nomT: 1362, nomP: 1460, i: 0, t: 5 },
];
const pourSt = { colando: true, t: 0 };
const shakeSt = { marcha: false, t: 0 };

function processTick() {
  for (const f of furnaces) {
    f.t += 1;
    if (f.t >= FURNACE_PHASES[f.i][1]) { f.t = 0; f.i = (f.i + 1) % FURNACE_PHASES.length; setFlag(`${f.short}.Fase`, FURNACE_PHASES[f.i][0]); }
    const fase = FURNACE_PHASES[f.i][0];
    const tTarget = fase === "CARGA" ? f.nomT - 150 : fase === "FUSION" ? f.nomT + 6 : fase === "AFINO" ? f.nomT : f.nomT - 8;
    const pTarget = f.nomP * (fase === "CARGA" ? 0.25 : fase === "FUSION" ? 1.02 : fase === "AFINO" ? 0.55 : 0.12);
    setNum(`${f.short}.TemperaturaMetal`, tTarget, 0.05, 2.5);
    setNum(`${f.short}.PotenciaBobina`, pTarget, 0.2, 12);
  }

  // Colada: ciclos ON/OFF; la cuchara se vacía colando y se rellena en paro
  const peso = varIndex.get("COL-01.PesoCuchara");
  const caudal = varIndex.get("COL-01.CaudalColada");
  pourSt.t += 1;
  if (pourSt.colando && pourSt.t >= 14) { pourSt.colando = false; pourSt.t = 0; setFlag("COL-01.Colando", false); }
  else if (!pourSt.colando && pourSt.t >= 10 && peso.value > 1250) { pourSt.colando = true; pourSt.t = 0; setFlag("COL-01.Colando", true); }
  setNum("COL-01.CaudalColada", pourSt.colando ? 8.2 : 0, 0.5, pourSt.colando ? 0.4 : 0.02);
  if (pourSt.colando) peso.value = Math.max(120, peso.value - caudal.value);
  else if (peso.value < 1400) peso.value = Math.min(1450, peso.value + 130); // la grúa repone metal
  peso.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Math.round(peso.value) }));

  // Desmoldeo: alterna MARCHA (35 s) / PARO (25 s)
  shakeSt.t += 1;
  if (shakeSt.t >= (shakeSt.marcha ? 35 : 25)) {
    shakeSt.marcha = !shakeSt.marcha; shakeSt.t = 0;
    setFlag("DES-01.Marcha", shakeSt.marcha);
    setEstado("DES-01", shakeSt.marcha ? "RUN" : "IDLE");
  }
  setNum("DES-01.Vibracion", shakeSt.marcha ? 8.6 : 0.5, 0.4, shakeSt.marcha ? 0.5 : 0.05);
  setNum("DES-01.FrecuenciaVibracion", shakeSt.marcha ? 24 : 0, 0.5, shakeSt.marcha ? 0.4 : 0);
  setNum("DES-01.Potencia", shakeSt.marcha ? 110 : 12, 0.3, shakeSt.marcha ? 5 : 1);
}

/* ---- dinámica de la simulación (1 s) ---- */
const timer = setInterval(() => {
  processTick();
  for (const sv of simVars) {
    const { spec } = sv;
    if (spec.kind === "managed") continue; // la fija processTick()
    if (spec.kind === "counter") {
      sv.value += spec.rate ?? 1;
      sv.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Number(sv.value.toFixed(spec.dp ?? 0)) }));
    } else if (spec.kind === "bool") {
      if (Math.random() < 0.05) sv.value = !sv.value;
      sv.node.setValueFromSource(new Variant({ dataType: DataType.Boolean, value: sv.value }));
    } else if (spec.kind === "word") {
      if (Math.random() < 0.1) sv.value = Math.floor(Math.random() * 8);
      sv.node.setValueFromSource(new Variant({ dataType: DataType.UInt16, value: sv.value }));
    } else {
      // paseo aleatorio con retorno al nominal
      sv.value += (spec.v - sv.value) * 0.08 + (Math.random() - 0.5) * (spec.w ?? 0);
      sv.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Number(sv.value.toFixed(spec.dp ?? 2)) }));
    }
  }
}, 1000);

await server.start();

const endpoint = server.getEndpointUrl();
console.log("──────────────────────────────────────────────────────");
console.log("  Servidor OPC UA de la fundición en marcha");
console.log(`  Endpoint : ${endpoint}`);
console.log(`  Espacio  : Objects/PlantaNorte  (${assets.length} activos, ${simVars.length} variables dinámicas)`);
console.log("  NodeIds  : ns=1;s=<ACTIVO>.<Variable>  ej. ns=1;s=IF-01.TemperaturaMetal");
console.log("  Detener  : Ctrl+C");
console.log("──────────────────────────────────────────────────────");

let closing = false;
process.on("SIGINT", async () => {
  if (closing) return;
  closing = true;
  console.log("\nDeteniendo servidor OPC UA...");
  clearInterval(timer);
  await server.shutdown(500);
  process.exit(0);
});
