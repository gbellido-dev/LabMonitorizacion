// Servidor OPC UA de la fundición simulada (Planta Norte).
//
//   Endpoint:  opc.tcp://localhost:4840/UA/Fundicion   (en el compose, puerto 4841)
//   Arranque:  npm run opcua
//
// Los valores los calcula el motor de proceso (motor.mjs): hornos con balance de
// energía, cuchara que se enfría, moldes trazables, túnel, desmoldeo con desgaste y
// calidad por causas. Este fichero solo publica ese estado en OPC UA.
//
// Espacio de direcciones (NodeIds estables  ns=1;s=<ACTIVO>.<Variable>):
//   Objects/PlantaNorte/KPIs                OEE, producción, energía, CO2, línea, lote
//   Objects/PlantaNorte/<Zona>/<ACTIVO>     variables de proceso, señales, Estado, TagsS7
//   Objects/Trazabilidad/UltimaPieza        la última pieza inspeccionada (molde, colada, causas, resultado)
//   Objects/Mantenimiento                   Averia (escribible) y AveriaNombre
//   Objects/Simulacion                      Velocidad (escribible) y la «verdad» de la simulación
//
// Además: alarmas y condiciones OPC UA (ExclusiveLimitAlarm) sobre variables clave, métodos
// (InyectarAveria, Reparar, ConsultarPieza, PiezasDelLote) e histórico (HistoryRead) de 2 h.
//
// Seguridad: pensado para simulación. Acepta conexiones anónimas y sin
// cifrado (SecurityPolicy None) además de las políticas seguras por defecto.
import { OPCUAServer, Variant, DataType, StatusCodes, VariantArrayType } from "node-opcua";
import { assets, kpis, loteActivo, zones } from "./plant-model.mjs";
import { Planta, AVERIAS } from "./motor.mjs";

const PORT = Number(process.env.OPCUA_PORT ?? 4840);
// En Docker el hostname del contenedor no es alcanzable desde fuera; con
// OPCUA_ALTERNATE_HOSTNAME=localhost el endpoint anunciado es válido para
// clientes del host (p. ej. UaExpert). Admite varios nombres separados por comas.
const ALT_HOSTNAME = process.env.OPCUA_ALTERNATE_HOSTNAME;
const planta = new Planta({ semilla: Number(process.env.SIM_SEMILLA ?? Date.now() % 100000) });
const sim = { velocidad: Math.min(20, Math.max(1, Number(process.env.SIM_VELOCIDAD ?? 1))) };

const server = new OPCUAServer({
  port: PORT,
  ...(ALT_HOSTNAME ? { alternateHostname: ALT_HOSTNAME.split(",").map((h) => h.trim()).filter(Boolean) } : {}),
  resourcePath: "/UA/Fundicion",
  // node-opcua admite 10 conexiones por defecto; cada nodo cliente de Node-RED abre la suya
  // (más el puente, el PLC S7 y UaExpert), así que en un aula se agotan enseguida
  maxConnectionsPerEndpoint: 100,
  maxAllowedSessionNumber: 100,
  buildInfo: {
    productName: "Ferrovia Digital Foundry OPC UA",
    productUri: "urn:ferrovia:digital-foundry",
    manufacturerName: "Ferrovia",
    softwareVersion: "2.0.0",
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
addressSpace.installAlarmsAndConditionsService();
const nodos = new Map();   // "IF-01.TemperaturaMetal" → UAVariable (para alarmas e histórico)
const activosObj = new Map();

// Cada variable publicada: { node, dataType, leer: () => valor, ultimo }
const publicadas = [];

function variable(parent, browseName, nodeId, dataType, leer, extra = {}) {
  const node = ns.addVariable({
    componentOf: parent, browseName, nodeId: `s=${nodeId}`,
    dataType: DataType[dataType], accessLevel: "CurrentRead", minimumSamplingInterval: 250, ...extra,
  });
  nodos.set(nodeId, node);
  const entrada = { node, dataType: DataType[dataType], leer, ultimo: undefined };
  publicadas.push(entrada);
  escribir(entrada);
  return node;
}

function constante(parent, browseName, nodeId, value) {
  const v = ns.addVariable({ componentOf: parent, browseName, nodeId: `s=${nodeId}`, dataType: "String", accessLevel: "CurrentRead" });
  v.setValueFromSource(new Variant({ dataType: DataType.String, value }));
  return v;
}

function escribir(e) {
  let valor = e.leer();
  if (valor === undefined || valor === null) valor = e.dataType === DataType.String ? "" : e.dataType === DataType.Boolean ? false : 0;
  if (valor === e.ultimo) return;
  e.ultimo = valor;
  e.node.setValueFromSource(new Variant({ dataType: e.dataType, value: valor }));
}

// Tipo de dato de un tag S7 según su dirección: DBX → Boolean, DBW → UInt16, resto → Double
const tipoTag = (dir) => (dir.includes("DBX") ? "Boolean" : dir.includes("DBW") ? "UInt16" : "Double");

/* ──────────────── PlantaNorte ──────────────── */
const plant = ns.addFolder(objects, { browseName: "PlantaNorte", nodeId: "s=PlantaNorte" });
// Los activos son fuentes de eventos del objeto Server (i=2253): un cliente que se suscribe a eventos en
// Server recibe las alarmas de toda la planta. (Se cuelgan del Server y no de la carpeta de la planta para
// que un BROWSE de PlantaNorte siga devolviendo cada zona y cada activo una sola vez.)
const servidorObj = addressSpace.rootFolder.objects.server;

const kpiFolder = ns.addObject({ organizedBy: plant, browseName: "KPIs", nodeId: "s=KPIs", eventSourceOf: servidorObj, eventNotifier: 1 });
activosObj.set("KPIs", kpiFolder);
for (const k of kpis) {
  const n = variable(kpiFolder, k.n, `KPIs.${k.n}`, "Double", () => planta.v[`KPIs.${k.n}`], { description: `${k.n} [${k.unit}]` });
  if (k.unit) constante(n, "Unidad", `KPIs.${k.n}.Unidad`, k.unit);
}
variable(kpiFolder, loteActivo.n, `KPIs.${loteActivo.n}`, "String", () => planta.flags["KPIs.LoteActivo"]);

const zoneFolders = new Map(zones.map((z) => [z, ns.addFolder(plant, { browseName: z, nodeId: `s=Zona.${z}` })]));

for (const a of assets) {
  const device = ns.addObject({
    organizedBy: zoneFolders.get(a.zone), browseName: a.short, displayName: `${a.short} · ${a.name}`,
    description: a.name, nodeId: `s=${a.short}`, eventSourceOf: servidorObj, eventNotifier: 1,
  });
  activosObj.set(a.short, device);
  constante(device, "Nombre", `${a.short}.Nombre`, a.name);
  variable(device, "Estado", `${a.short}.Estado`, "String", () => planta.estados[a.short]);
  constante(device, "PLC", `${a.short}.PLC`, a.plc);
  constante(device, "Zona", `${a.short}.Zona`, a.zone);
  for (const s of a.vars) {
    const n = variable(device, s.n, `${a.short}.${s.n}`, "Double", () => planta.v[`${a.short}.${s.n}`],
      { description: s.unit ? `${s.n} [${s.unit}]` : s.n });
    if (s.unit) constante(n, "Unidad", `${a.short}.${s.n}.Unidad`, s.unit);
  }
  for (const f of a.flags ?? []) {
    variable(device, f.n, `${a.short}.${f.n}`, f.type === "bool" ? "Boolean" : "String", () => planta.flags[`${a.short}.${f.n}`]);
  }
  // Señales del PLC S7 del activo: el mismo dato que leería un cliente S7 en esa dirección
  const tags = ns.addObject({ componentOf: device, browseName: "TagsS7", nodeId: `s=${a.short}.TagsS7` });
  for (const [simbolo, dir] of a.tags) {
    const tipo = tipoTag(dir);
    const n = variable(tags, simbolo, `${a.short}.TagsS7.${simbolo}`, tipo, () => {
      const x = planta.tagS7(a.short, simbolo);
      return tipo === "Boolean" ? !!x : tipo === "UInt16" ? Math.max(0, Math.round(Number(x) || 0)) : Number(x) || 0;
    }, { description: `Señal S7 en ${dir}` });
    constante(n, "DireccionS7", `${a.short}.TagsS7.${simbolo}.Direccion`, dir);
  }
}

/* ──────────────── Trazabilidad ──────────────── */
const traz = ns.addObject({ organizedBy: objects, browseName: "Trazabilidad", nodeId: "s=Trazabilidad" });
const ult = ns.addObject({ componentOf: traz, browseName: "UltimaPieza", nodeId: "s=Trazabilidad.UltimaPieza",
  description: "Última pieza inspeccionada por QC-01, con su historia" });
const P = () => planta.ultimaPieza ?? {};
const CAMPOS = [
  ["Id", "String", () => P().id, "Número de serie de la pieza"],
  ["Molde", "String", () => P().molde, "Molde en el que se coló"],
  ["Prensa", "String", () => P().prensa, "Prensa que hizo el molde"],
  ["Lote", "String", () => P().lote, "Colada (lote de metal)"],
  ["TemperaturaColada", "Double", () => P().tColada, "Temperatura del metal al colar [°C]"],
  ["HumedadArena", "Double", () => P().humedad, "Humedad de la arena del molde [%]"],
  ["Inoculada", "Boolean", () => P().inoculada, "ROB-01 inoculó el metal"],
  ["TiempoEnfriamiento", "Double", () => P().enfriamientoMin, "Tiempo en el túnel [min]"],
  ["TemperaturaDesmoldeo", "Double", () => P().tDesmoldeo, "Temperatura del molde al desmoldear [°C]"],
  ["Desviacion", "Double", () => P().desviacion, "Desviación medida por el escáner [mm]"],
  ["Resultado", "String", () => P().resultado, "OK / RECHAZO"],
  ["Defecto", "String", () => P().defecto, "Defecto que ve el escáner"],
];
for (const [n, t, f, d] of CAMPOS) variable(ult, n, `Trazabilidad.UltimaPieza.${n}`, t, f, { description: d });
variable(traz, "PiezasInspeccionadas", "Trazabilidad.PiezasInspeccionadas", "UInt32", () => planta.contador.inspeccionadas);
variable(traz, "PiezasRechazadas", "Trazabilidad.PiezasRechazadas", "UInt32",
  () => planta.contador.inspeccionadas - planta.contador.conformes);

/* ──────────────── Mantenimiento: averías (para las prácticas) ──────────────── */
const maint = ns.addObject({ organizedBy: objects, browseName: "Mantenimiento", nodeId: "s=Mantenimiento" });
variable(maint, "AveriaNombre", "Mantenimiento.AveriaNombre", "String", () => AVERIAS[planta.averia.codigo]);
ns.addVariable({
  componentOf: maint, browseName: "Averia", nodeId: "s=Mantenimiento.Averia", dataType: "Int32",
  accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite",
  description: `Avería inyectada: ${AVERIAS.map((n, i) => `${i} ${n}`).join(" · ")}`, minimumSamplingInterval: 500,
  value: {
    get: () => new Variant({ dataType: DataType.Int32, value: planta.averia.codigo }),
    set: (variant) => {
      const v = Number(variant.value);
      if (!planta.setAveria(v)) return StatusCodes.BadOutOfRange;
      console.log(`Avería: ${v} · ${AVERIAS[v]}`);
      return StatusCodes.Good;
    },
  },
});

/* ──────────────── Simulación: velocidad y «verdad» (profesorado e IA) ──────────────── */
const simObj = ns.addObject({ organizedBy: objects, browseName: "Simulacion", nodeId: "s=Simulacion",
  description: "Control de la simulación y datos que una planta real no tendría (la verdad)" });
ns.addVariable({
  componentOf: simObj, browseName: "Velocidad", nodeId: "s=Simulacion.Velocidad", dataType: "Double",
  accessLevel: "CurrentRead | CurrentWrite", userAccessLevel: "CurrentRead | CurrentWrite",
  description: "Segundos simulados por segundo real (1-20)", minimumSamplingInterval: 1000,
  value: {
    get: () => new Variant({ dataType: DataType.Double, value: sim.velocidad }),
    set: (variant) => {
      const v = Number(variant.value);
      if (!Number.isFinite(v) || v < 1 || v > 20) return StatusCodes.BadOutOfRange;
      sim.velocidad = v;
      console.log(`Velocidad de simulación: ×${v}`);
      return StatusCodes.Good;
    },
  },
});
variable(simObj, "TiempoSimulado", "Simulacion.TiempoSimulado", "Double", () => planta.t, { description: "Segundos simulados desde el arranque" });
variable(simObj, "DesgasteRodamiento", "Simulacion.DesgasteRodamiento", "Double", () => planta.v["Simulacion.DesgasteRodamiento"],
  { description: "Desgaste real del rodamiento de DES-01 (0 nuevo, ≥ 0,64 disparo)" });
variable(simObj, "DerivaEscaner", "Simulacion.DerivaEscaner", "Double", () => planta.v["Simulacion.DerivaEscaner"],
  { description: "Error real del escáner QC-01 [mm]" });
variable(simObj, "TemperaturaRealIF01", "Simulacion.TemperaturaRealIF01", "Double", () => planta.v["Simulacion.TemperaturaRealIF01"],
  { description: "Temperatura real del metal en IF-01 (el termopar puede mentir) [°C]" });
variable(simObj, "DefectoRealUltimaPieza", "Simulacion.DefectoRealUltimaPieza", "String", () => P().defectoReal,
  { description: "Defecto real de la última pieza (aunque el escáner no lo vea, o vea uno que no hay)" });

/* ──────────────── Alarmas y condiciones (OPC UA A&C) ──────────────── */
// ExclusiveLimitAlarm: el propio servidor vigila la variable y activa la alarma en el nivel que toque
// (LowLow, Low, High, HighHigh). Cada cambio de estado es un evento que reciben los clientes suscritos.
const ALARMAS = [
  ["IF-01", "TemperaturaMetal", "AlarmaTemperatura", { lowLimit: 1100, highLimit: 1530, highHighLimit: 1550 }],
  ["IF-02", "Presion", "AlarmaSobrepresion", { lowLimit: -40, highLimit: 0, highHighLimit: 4 }],
  ["COL-01", "TemperaturaColada", "AlarmaColadaFria", { lowLowLimit: 1390, lowLimit: 1405, highLimit: 1530 }],
  ["DES-01", "Vibracion", "AlarmaVibracion", { lowLimit: -1, highLimit: 12, highHighLimit: 18 }],
  ["QC-01", "DesviacionEscaneo", "AlarmaDesviacion", { lowLimit: -1, highLimit: 0.2, highHighLimit: 0.3 }],
  ["KPIs", "OEEPlanta", "AlarmaOEE", { lowLowLimit: 60, lowLimit: 75, highLimit: 101 }],
];
for (const [activo, variableN, nombre, limites] of ALARMAS) {
  const fuente = activosObj.get(activo);
  const entrada = nodos.get(`${activo}.${variableN}`);
  ns.instantiateExclusiveLimitAlarm("ExclusiveLimitAlarmType", {
    browseName: nombre, nodeId: `s=${activo}.${nombre}`, componentOf: fuente, conditionSource: fuente,
    conditionName: nombre, inputNode: entrada, optionals: ["ConfirmedState", "Confirm"], ...limites,
  });
}

/* ──────────────── Métodos ──────────────── */
const metodo = (padre, browseName, nodeId, entradas, salidas, fn, descripcion) => {
  const m = ns.addMethod(padre, { browseName, nodeId: `s=${nodeId}`, description: descripcion,
    inputArguments: entradas, outputArguments: salidas });
  m.bindMethod(async (args, _contexto) => {   // dos parámetros: estilo «promesa» de node-opcua
    try { return await fn(args.map((a) => a.value)); }
    catch (e) { return { statusCode: StatusCodes.BadInvalidArgument }; }
  });
};
metodo(maint, "InyectarAveria", "Mantenimiento.InyectarAveria",
  [{ name: "Codigo", dataType: DataType.Int32, description: `0-${AVERIAS.length - 1}` }],
  [{ name: "Nombre", dataType: DataType.String }],
  ([codigo]) => planta.setAveria(Number(codigo))
    ? { statusCode: StatusCodes.Good, outputArguments: [{ dataType: DataType.String, value: AVERIAS[codigo] }] }
    : { statusCode: StatusCodes.BadOutOfRange },
  "Inyecta una avería (igual que escribir Mantenimiento.Averia)");
metodo(maint, "Reparar", "Mantenimiento.Reparar", [], [],
  () => { planta.setAveria(0); return { statusCode: StatusCodes.Good }; }, "Quita la avería (y cambia el rodamiento si estaba dañado)");
metodo(traz, "ConsultarPieza", "Trazabilidad.ConsultarPieza",
  [{ name: "Id", dataType: DataType.String, description: "Número de serie, p. ej. P-004120" }],
  [{ name: "Historia", dataType: DataType.String, description: "JSON con molde, colada, condiciones y resultado" }],
  ([id]) => {
    const pz = planta.piezas.find((x) => x.id === id);
    if (!pz) return { statusCode: StatusCodes.BadNotFound };
    const { defectoReal, ts, ...visible } = pz;      // la verdad de la simulación no se publica aquí
    return { statusCode: StatusCodes.Good, outputArguments: [{ dataType: DataType.String, value: JSON.stringify(visible) }] };
  }, "Historia de una de las últimas 500 piezas");
metodo(traz, "PiezasDelLote", "Trazabilidad.PiezasDelLote",
  [{ name: "Lote", dataType: DataType.String, description: "Colada, p. ej. FE-261110-085" }],
  [{ name: "Piezas", dataType: DataType.String, valueRank: 1, arrayDimensions: [0] }, { name: "Rechazadas", dataType: DataType.UInt32 }],
  ([lote]) => {
    const pz = planta.piezas.filter((x) => x.lote === lote);
    return { statusCode: StatusCodes.Good, outputArguments: [
      { dataType: DataType.String, arrayType: VariantArrayType.Array, value: pz.map((x) => x.id) },
      { dataType: DataType.UInt32, value: pz.filter((x) => x.resultado !== "OK").length }] };
  }, "Piezas inspeccionadas de una colada (para retirar un lote)");

/* ──────────────── Histórico (HistoryRead) ──────────────── */
const HISTORICO = ["KPIs.OEEPlanta", "KPIs.EnergiaEspecifica", "IF-01.TemperaturaMetal", "COL-01.TemperaturaColada",
  "DES-01.Vibracion", "QC-01.DesviacionEscaneo"];
for (const id of HISTORICO) addressSpace.installHistoricalDataNode(nodos.get(id), { maxOnlineValues: 7200 });

/* ──────────────── bucle: 1 s real = «velocidad» segundos simulados ──────────────── */
const timer = setInterval(() => {
  for (let i = 0; i < sim.velocidad; i++) planta.paso();
  for (const e of publicadas) escribir(e);
}, 1000);

await server.start();

console.log("──────────────────────────────────────────────────────");
console.log("  Servidor OPC UA de la fundición en marcha");
console.log(`  Endpoint : ${server.getEndpointUrl()}`);
console.log(`  Espacio  : Objects/PlantaNorte  (${assets.length} activos, ${publicadas.length} variables)`);
console.log("  NodeIds  : ns=1;s=<ACTIVO>.<Variable>  ej. ns=1;s=IF-01.TemperaturaMetal");
console.log(`  Velocidad: ×${sim.velocidad} (ns=1;s=Simulacion.Velocidad)`);
console.log("──────────────────────────────────────────────────────");

let closing = false;
process.on("SIGINT", async () => {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await server.shutdown(500);
  process.exit(0);
});
process.on("SIGTERM", () => process.emit("SIGINT"));
