// Puente OPC UA -> WebSocket (patrón edge gateway).
//
// Se conecta como CLIENTE OPC UA al servidor de la fundición, se suscribe a
// todas las variables (monitored items) y difunde cada segundo un snapshot
// JSON por WebSocket para que el dashboard (el navegador no habla OPC UA)
// muestre los mismos datos que vería cualquier cliente OPC UA.
//
//   Uso:      npm run opcua:bridge    (el servidor OPC UA debe estar activo;
//                                      si no lo está, reintenta con backoff)
//   WS:       ws://localhost:8081
//   Mensaje:  { type:"snapshot", ts, opcua, kpis:{n:{v,u}}, assets:{IF-01:{Var:{v,u}}}, tags:{IF-01:{Símbolo:{v,u:dirección}}} }
import { OPCUAClient, AttributeIds, TimestampsToReturn } from "node-opcua";
import { WebSocketServer } from "ws";
import { assets, kpis, loteActivo } from "./plant-model.mjs";

const ENDPOINT = process.env.OPCUA_ENDPOINT ?? "opc.tcp://localhost:4840/UA/Fundicion";
const WS_PORT = Number(process.env.WS_PORT ?? 8081);

/* ---- estado compartido que se difunde ---- */
const snapshot = {
  type: "snapshot",
  ts: 0,
  opcua: false, // true cuando la sesión OPC UA está viva
  kpis: {},
  assets: Object.fromEntries(assets.map(a => [a.short, {}])),
  tags: Object.fromEntries(assets.map(a => [a.short, {}])),
};

/* ---- servidor WebSocket ---- */
const wss = new WebSocketServer({ port: WS_PORT });
wss.on("connection", ws => ws.send(JSON.stringify(snapshot)));
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
const session = await client.createSession();
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
for (const k of kpis) items.push({ nodeId: `ns=1;s=KPIs.${k.n}`, set: v => { snapshot.kpis[k.n] = { v, u: k.unit }; } });
items.push({ nodeId: `ns=1;s=KPIs.${loteActivo.n}`, set: v => { snapshot.kpis[loteActivo.n] = { v, u: "" }; } });
for (const a of assets) {
  items.push({ nodeId: `ns=1;s=${a.short}.Estado`, set: v => { snapshot.assets[a.short].Estado = { v, u: "" }; } });
  for (const s of a.vars) items.push({ nodeId: `ns=1;s=${a.short}.${s.n}`, set: v => { snapshot.assets[a.short][s.n] = { v, u: s.unit ?? "" }; } });
  for (const fl of a.flags ?? []) items.push({ nodeId: `ns=1;s=${a.short}.${fl.n}`, set: v => { snapshot.assets[a.short][fl.n] = { v, u: "" }; } });
  for (const [symbol, address] of a.tags) items.push({ nodeId: `ns=1;s=${a.short}.TagsS7.${symbol}`, set: v => { snapshot.tags[a.short][symbol] = { v, u: address }; } });
}

await Promise.all(items.map(async it => {
  const mi = await subscription.monitor(
    { nodeId: it.nodeId, attributeId: AttributeIds.Value },
    { samplingInterval: 500, discardOldest: true, queueSize: 1 },
    TimestampsToReturn.Neither,
  );
  mi.on("changed", dv => it.set(dv.value.value));
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
