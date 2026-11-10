// Puente OPC UA → WebSocket (patrón edge gateway).
//
// Se conecta como CLIENTE OPC UA al servidor de la fundición, se suscribe a las
// variables del modelo (monitored items) y difunde cada segundo un snapshot JSON por
// WebSocket para el gemelo digital (el navegador no habla OPC UA).
//
//   Uso:      npm run opcua:bridge    (si el servidor OPC UA no está, reintenta)
//   WS:       ws://localhost:8081
//   Mensaje:  { type:"snapshot", ts, opcua, kpis:{n:{v,u}}, assets:{IF-01:{Var:{v,u}}},
//               tags:{IF-01:{Símbolo:{v,u:dirección}}}, traz:{Campo:v}, sim:{Campo:v} }
//
// Órdenes desde el navegador (lista cerrada, como haría un gateway real):
//   { type:"escribir", nodo:"Simulacion.Velocidad", valor:10 }
//   { type:"escribir", nodo:"Mantenimiento.Averia", valor:3 }
//   → { type:"respuesta", nodo, ok, estado }
import { OPCUAClient, AttributeIds, TimestampsToReturn, DataType } from "node-opcua";
import { WebSocketServer } from "ws";
import { assets, kpis, loteActivo } from "./plant-model.mjs";

const ENDPOINT = process.env.OPCUA_ENDPOINT ?? "opc.tcp://localhost:4840/UA/Fundicion";
const WS_PORT = Number(process.env.WS_PORT ?? 8081);
const ESCRIBIBLES = { "Simulacion.Velocidad": DataType.Double, "Mantenimiento.Averia": DataType.Int32 };

/* ---- estado compartido que se difunde ---- */
const snapshot = {
  type: "snapshot",
  ts: 0,
  opcua: false, // true cuando la sesión OPC UA está viva
  kpis: {},
  assets: Object.fromEntries(assets.map((a) => [a.short, {}])),
  tags: Object.fromEntries(assets.map((a) => [a.short, {}])),
  traz: {},
  sim: {},
};

let session = null;

/* ---- servidor WebSocket ---- */
const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", (ws) => {
  ws.send(JSON.stringify(snapshot));
  ws.on("message", async (raw) => {
    let m;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m?.type !== "escribir") return;
    const tipo = ESCRIBIBLES[m.nodo];
    let ok = false, estado = "BadNotWritable";
    if (tipo !== undefined && session) {
      try {
        const sc = await session.write({ nodeId: `ns=1;s=${m.nodo}`, attributeId: AttributeIds.Value,
          value: { value: { dataType: tipo, value: Number(m.valor) } } });
        ok = sc.isGood(); estado = sc.name;
      } catch (e) { estado = String(e.message ?? e); }
    }
    ws.send(JSON.stringify({ type: "respuesta", nodo: m.nodo, valor: m.valor, ok, estado }));
  });
});
setInterval(() => {
  snapshot.ts = Date.now();
  const msg = JSON.stringify(snapshot);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
}, 1000);
console.log(`WebSocket escuchando en ws://0.0.0.0:${WS_PORT}`);

/* ---- cliente OPC UA con reconexión infinita ---- */
const client = OPCUAClient.create({
  endpointMustExist: false,
  keepSessionAlive: true,
  connectionStrategy: { maxRetry: -1, initialDelay: 1500, maxDelay: 10000 },
});
client.on("backoff", (retry, delay) => console.log(`OPC UA no disponible, reintento ${retry + 1} en ${delay} ms (${ENDPOINT})`));
client.on("connection_lost", () => { snapshot.opcua = false; console.log("Conexión OPC UA perdida, reintentando..."); });
client.on("connection_reestablished", () => { snapshot.opcua = true; console.log("Conexión OPC UA restablecida"); });

await client.connect(ENDPOINT);
session = await client.createSession();
snapshot.opcua = true;
console.log(`Conectado a ${ENDPOINT}`);

const subscription = await session.createSubscription2({
  requestedPublishingInterval: 500,
  requestedLifetimeCount: 1000,
  requestedMaxKeepAliveCount: 20,
  maxNotificationsPerPublish: 2000,
  publishingEnabled: true,
  priority: 0,
});

/* ---- monitored items para todo el modelo ---- */
const items = [];
for (const k of kpis) items.push({ nodeId: `ns=1;s=KPIs.${k.n}`, set: (v) => { snapshot.kpis[k.n] = { v, u: k.unit }; } });
items.push({ nodeId: `ns=1;s=KPIs.${loteActivo.n}`, set: (v) => { snapshot.kpis[loteActivo.n] = { v, u: "" }; } });
for (const a of assets) {
  items.push({ nodeId: `ns=1;s=${a.short}.Estado`, set: (v) => { snapshot.assets[a.short].Estado = { v, u: "" }; } });
  for (const s of a.vars) items.push({ nodeId: `ns=1;s=${a.short}.${s.n}`, set: (v) => { snapshot.assets[a.short][s.n] = { v, u: s.unit ?? "" }; } });
  for (const fl of a.flags ?? []) items.push({ nodeId: `ns=1;s=${a.short}.${fl.n}`, set: (v) => { snapshot.assets[a.short][fl.n] = { v, u: "" }; } });
  for (const [symbol, address] of a.tags) items.push({ nodeId: `ns=1;s=${a.short}.TagsS7.${symbol}`, set: (v) => { snapshot.tags[a.short][symbol] = { v, u: address }; } });
}
for (const c of ["Id", "Molde", "Prensa", "Lote", "TemperaturaColada", "HumedadArena", "Inoculada", "TiempoEnfriamiento",
  "TemperaturaDesmoldeo", "Desviacion", "Resultado", "Defecto"]) {
  items.push({ nodeId: `ns=1;s=Trazabilidad.UltimaPieza.${c}`, set: (v) => { snapshot.traz[c] = v; } });
}
for (const c of ["PiezasInspeccionadas", "PiezasRechazadas"]) items.push({ nodeId: `ns=1;s=Trazabilidad.${c}`, set: (v) => { snapshot.traz[c] = v; } });
for (const c of ["Velocidad", "TiempoSimulado"]) items.push({ nodeId: `ns=1;s=Simulacion.${c}`, set: (v) => { snapshot.sim[c] = v; } });
for (const c of ["Averia", "AveriaNombre"]) items.push({ nodeId: `ns=1;s=Mantenimiento.${c}`, set: (v) => { snapshot.sim[c] = v; } });

await Promise.all(items.map(async (it) => {
  const mi = await subscription.monitor(
    { nodeId: it.nodeId, attributeId: AttributeIds.Value },
    { samplingInterval: 500, discardOldest: true, queueSize: 1 },
    TimestampsToReturn.Neither,
  );
  mi.on("changed", (dv) => it.set(dv.value.value));
}));

console.log(`Suscrito a ${items.length} variables OPC UA · snapshot cada 1 s a ${wss.clients.size} cliente(s)`);

let closing = false;
process.on("SIGINT", async () => {
  if (closing) return;
  closing = true;
  console.log("\nCerrando puente...");
  wss.close();
  try { await session.close(); await client.disconnect(); } catch { /* ya desconectado */ }
  process.exit(0);
});
process.on("SIGTERM", () => process.emit("SIGINT"));
