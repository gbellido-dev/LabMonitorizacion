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
import { OPCUAServer, Variant, DataType, StatusCodes } from "node-opcua";
import { assets, kpis, loteActivo, zones } from "./plant-model.mjs";

const PORT = Number(process.env.OPCUA_PORT ?? 4840);
// En Docker el hostname del contenedor no es alcanzable desde fuera; con
// OPCUA_ALTERNATE_HOSTNAME=localhost el endpoint anunciado es válido para
// clientes del host (p. ej. UaExpert).
const ALT_HOSTNAME = process.env.OPCUA_ALTERNATE_HOSTNAME;

const server = new OPCUAServer({
  port: PORT,
  // admite varios nombres separados por comas (p. ej. "localhost,fundicion-opcua")
  ...(ALT_HOSTNAME ? { alternateHostname: ALT_HOSTNAME.split(",").map(h => h.trim()).filter(Boolean) } : {}),
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
  const entry = { node, spec, value: spec.v, key: nodeIdSuffix };
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
// Línea de moldes sincronizada con la colada. La geometría replica la escena
// 3D: bucle de 34 unidades, 8 moldes cada 4,25, cuchara en x = POUR_X.
// Estados: MOVING (avanza) -> WAIT_METAL (molde en posición, cuchara baja)
//          -> FILLING (colando, nivel 0..100%) -> PAUSE -> MOVING
// POUR_X: posición del centro del molde cuando su bebedero (x molde + 0.4)
// queda bajo la vertical del chorro de la cuchara (x mundo = 2.72)
const LINE = { LOOP: 34, SPACING: 4.25, N: 8, POUR_X: 2.32, SPEED: 0.5 };
const MOULD_MASS = 110; // kg de hierro por molde
const lineSt = { off: 0, state: "MOVING", nivel: 0, pause: 0 };
const mouldX = k => -12 + ((k * LINE.SPACING + lineSt.off) % LINE.LOOP);
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

  // Línea + colada con interlock: solo se cuela con un molde parado debajo,
  // y el molde espera hasta llenarse antes de que la línea se reanude.
  const peso = varIndex.get("COL-01.PesoCuchara");
  const caudal = varIndex.get("COL-01.CaudalColada");
  if (lineSt.state === "MOVING") {
    let dmin = Infinity;
    for (let k = 0; k < LINE.N; k++) {
      const d = (LINE.POUR_X - mouldX(k) + LINE.LOOP * 2) % LINE.LOOP;
      if (d > 0.1 && d < dmin) dmin = d; // ignora el molde recién llenado (d≈0)
    }
    if (dmin <= LINE.SPEED) { // el molde alcanza la cuchara en este tick: parada exacta
      lineSt.off = (lineSt.off + dmin) % LINE.LOOP;
      lineSt.state = "WAIT_METAL";
      lineSt.nivel = 0;
      setFlag("COL-01.MoldeEnPosicion", true);
    } else {
      lineSt.off = (lineSt.off + LINE.SPEED) % LINE.LOOP;
    }
  }
  if (lineSt.state === "WAIT_METAL" && peso.value >= MOULD_MASS * 1.3) {
    lineSt.state = "FILLING";
    setFlag("COL-01.Colando", true);
  }
  setNum("COL-01.CaudalColada", lineSt.state === "FILLING" ? 8.2 : 0, 0.5, lineSt.state === "FILLING" ? 0.4 : 0.02);
  if (lineSt.state === "FILLING") {
    lineSt.nivel = Math.min(100, lineSt.nivel + (caudal.value / MOULD_MASS) * 100);
    peso.value = Math.max(80, peso.value - caudal.value);
    if (lineSt.nivel >= 100) { lineSt.state = "PAUSE"; lineSt.pause = 0; setFlag("COL-01.Colando", false); }
  }
  if (lineSt.state === "PAUSE" && ++lineSt.pause >= 2) {
    lineSt.state = "MOVING";
    setFlag("COL-01.MoldeEnPosicion", false);
  }
  // la grúa repone la cuchara por lotes cuando baja de 400 kg (y no se cuela)
  if (lineSt.state !== "FILLING" && peso.value < 400 && fault.code !== 3) peso.value = Math.min(1450, peso.value + 130);
  peso.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Math.round(peso.value) }));
  const nivelVar = varIndex.get("COL-01.NivelLlenado");
  nivelVar.value = lineSt.nivel;
  nivelVar.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Math.round(lineSt.nivel) }));
  // la velocidad cae a 0 en el mismo tick de la parada (interlock limpio)
  setNum("KPIs.VelocidadLinea", lineSt.state === "MOVING" ? 1.5 : 0, lineSt.state === "MOVING" ? 0.5 : 1, lineSt.state === "MOVING" ? 0.04 : 0);
  const posVar = varIndex.get("KPIs.PosicionLinea");
  posVar.value = lineSt.off;
  posVar.node.setValueFromSource(new Variant({ dataType: DataType.Double, value: Number(lineSt.off.toFixed(2)) }));

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

/* ---- mantenimiento: inyección de averías (para las prácticas) ----
 * ns=1;s=Mantenimiento.Averia (Int32, escribible) y ns=1;s=Mantenimiento.AveriaNombre (String).
 *   0 sin avería
 *   1 rodamiento del desmoldeo DES-01: la vibración crece poco a poco y sube la temperatura
 *   2 extracción de humos del horno IF-02: la presión del recinto pasa de depresión a sobrepresión
 *   3 retraso de la grúa: la cuchara no se repone, la línea espera metal y la producción se para
 *   4 deriva del escáner 3D QC-01: crece la desviación y bajan las piezas conformes */
const AVERIAS = ["Sin avería", "Rodamiento del desmoldeo DES-01", "Extracción de humos IF-02",
                 "Retraso de la grúa de cuchara", "Deriva del escáner 3D QC-01"];
const fault = { code: 0, t: 0 };
const maint = ns.addObject({ organizedBy: objects, browseName: "Mantenimiento", nodeId: "s=Mantenimiento" });
const faultName = ns.addVariable({
  componentOf: maint, browseName: "AveriaNombre", nodeId: "s=Mantenimiento.AveriaNombre", dataType: "String",
  accessLevel: "CurrentRead", value: { dataType: DataType.String, value: AVERIAS[0] },
});
ns.addVariable({
  componentOf: maint, browseName: "Averia", nodeId: "s=Mantenimiento.Averia", dataType: "Int32",
  accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite",
  description: "Código de avería inyectada (0-4)", minimumSamplingInterval: 500,
  value: {
    get: () => new Variant({ dataType: DataType.Int32, value: fault.code }),
    set: (variant) => {
      const v = Number(variant.value);
      if (!Number.isInteger(v) || v < 0 || v >= AVERIAS.length) return StatusCodes.BadOutOfRange;
      if (v !== fault.code) { fault.code = v; fault.t = 0; console.log(`Avería inyectada: ${v} · ${AVERIAS[v]}`); }
      faultName.setValueFromSource(new Variant({ dataType: DataType.String, value: AVERIAS[v] }));
      return StatusCodes.Good;
    },
  },
});
// variables que la avería gobierna (el paseo aleatorio no las toca mientras dure)
const FAULT_VARS = {
  1: ["DES-01.Temperatura"], 2: ["IF-02.Presion"], 3: ["KPIs.OEEPlanta"],
  4: ["QC-01.DesviacionEscaneo", "QC-01.PiezasConformes", "KPIs.PiezasConformes"],
};
const overridden = () => new Set(FAULT_VARS[fault.code] ?? []);

function faultTick() {
  fault.t += 1;
  const T = fault.t;
  // estados de los activos afectados (se restablecen al quitar la avería)
  setEstado("IF-02", fault.code === 2 ? "ALARM" : "WARN");
  setEstado("QC-01", fault.code === 4 && T > 60 ? "WARN" : "RUN");
  if (fault.code === 1) {
    const extra = Math.min(9, T * 0.03);                     // +0,03 mm/s cada segundo, hasta +9
    setNum("DES-01.Vibracion", (shakeSt.marcha ? 8.6 : 0.5) + extra * (shakeSt.marcha ? 1 : 0.4), 0.4, 0.4);
    setNum("DES-01.Temperatura", 88 + Math.min(40, T * 0.12), 0.1, 0.8);
    if (extra > 4 && shakeSt.marcha) setEstado("DES-01", "WARN");
  }
  if (fault.code === 2) setNum("IF-02.Presion", 6, 0.08, 1.2);
  if (fault.code === 3) setNum("KPIs.OEEPlanta", 61, 0.03, 0.4);
  if (fault.code === 4) {
    setNum("QC-01.DesviacionEscaneo", 0.08 + Math.min(0.5, T * 0.002), 0.2, 0.01);
    setNum("QC-01.PiezasConformes", 98.4 - Math.min(14, T * 0.05), 0.2, 0.2);
    setNum("KPIs.PiezasConformes", 98.4 - Math.min(14, T * 0.05), 0.2, 0.15);
  }
}

/* ---- dinámica de la simulación (1 s) ---- */
const timer = setInterval(() => {
  processTick();
  faultTick();
  const gobernadas = overridden();
  for (const sv of simVars) {
    const { spec } = sv;
    if (spec.kind === "managed") continue; // la fija processTick()
    if (gobernadas.has(sv.key)) continue;  // la fija faultTick()
    if (fault.code === 3 && sv.key === "KPIs.ProduccionTurno" && lineSt.state === "WAIT_METAL") continue;
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
