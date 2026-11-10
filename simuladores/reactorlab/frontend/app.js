// ReactorLab · interfaz web. Usa la misma API pública que los alumnos.
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v)) ? "—" : Number(v).toFixed(d);
let clave = "reactorlab";
try { clave = localStorage.getItem("reactorlab-clave") || clave; } catch {}
let ultimo = null;

function aviso(texto, error = false) {
  const a = $("aviso");
  a.textContent = texto; a.className = "aviso" + (error ? " error" : ""); a.style.display = "block";
  clearTimeout(aviso.t); aviso.t = setTimeout(() => (a.style.display = "none"), 4000);
}

async function api(metodo, ruta, cuerpo) {
  const opciones = { method: metodo, headers: { "X-API-Key": clave, "X-ReactorLab-UI": "1" } };
  if (cuerpo !== undefined) { opciones.headers["Content-Type"] = "application/json"; opciones.body = JSON.stringify(cuerpo); }
  const r = await fetch(ruta, opciones);
  if (!r.ok) {
    let detalle = r.statusText;
    try { const j = await r.json(); detalle = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail); } catch {}
    throw new Error(`${r.status} · ${detalle}`);
  }
  return r.status === 204 ? null : r.json();
}
const orden = (metodo, ruta, cuerpo, ok) => api(metodo, ruta, cuerpo).then((r) => { if (ok) aviso(ok); return r; }).catch((e) => aviso(e.message, true));

// ------------------------------------------------------------------ sinóptico
function pintar(s) {
  ultimo = s;
  const m = s.medidas, q = m.caudal_kmolh, c = m.composicion_purga_pct, v = s.valvulas, e = s.estado;
  $("v-presion").textContent = fmt(m.presion_kpa, 0);
  $("v-nivel").textContent = fmt(m.nivel_pct, 1);
  $("v-a").textContent = fmt(c.A, 1); $("v-b").textContent = fmt(c.B, 1); $("v-c").textContent = fmt(c.C, 1);
  for (const n of ["f1", "f2", "purga", "producto"]) {
    $("q-" + n).textContent = fmt(q[n], n === "f1" || n === "producto" ? 1 : 2);
    $("x-" + n).textContent = fmt(v[n].posicion_pct, 1);
    $("tubo-" + n).classList.toggle("activo", q[n] > 0.05);
    const pos = Math.max(0, Math.min(100, v[n].posicion_pct)) / 100;
    $("valv-" + n).querySelector("path").style.fill = `rgba(56,189,248,${0.12 + pos * 0.75})`;
  }
  const alto = 250 * Math.max(0, Math.min(100, m.nivel_pct)) / 100;
  const liq = $("liquido"); liq.setAttribute("y", 340 - alto); liq.setAttribute("height", alto);
  $("k-prod").textContent = fmt(q.producto, 1); $("k-pres").textContent = fmt(m.presion_kpa, 0);
  $("k-niv").textContent = fmt(m.nivel_pct, 1); $("k-a").textContent = fmt(c.A, 1); $("k-coste").textContent = fmt(m.coste_relativo, 3);
  $("t-proceso").textContent = fmt(s.tiempo_proceso_h, 2);
  pildora("p-modo", e.modo === "auto" ? "Automático" : "Manual", e.modo === "auto" ? "ok" : "aviso");
  pildora("p-marcha", e.paro_emergencia ? "PARO DE EMERGENCIA" : e.en_marcha ? "En marcha" : "Parada", e.paro_emergencia ? "mal" : e.en_marcha ? "ok" : "aviso");
  pildora("p-alarmas", e.alarmas_activas ? `${e.alarmas_activas} alarma(s)` : "Sin alarmas", e.alarmas_activas ? "mal" : "ok");
  document.querySelectorAll("[data-modo]").forEach((b) => b.classList.toggle("sel", b.dataset.modo === e.modo));
  $("b-marcha").textContent = e.en_marcha ? "Parar planta" : "Arrancar planta";
  $("b-paro").classList.toggle("activo", e.paro_emergencia);
  $("b-paro").textContent = e.paro_emergencia ? "REARMAR PARO" : "PARO DE EMERGENCIA";
  $("consignas").classList.toggle("deshabilitado", e.modo !== "auto");
  $("manual").classList.toggle("deshabilitado", e.modo !== "manual");
  for (const [k, val] of Object.entries(s.consignas)) actualizarMando("sp-" + k, val);
  for (const n of Object.keys(v)) actualizarMando("mv-" + n, v[n].consigna_pct);
  anotarTendencia(s);
}
function pildora(id, texto, clase) { const p = $(id); p.textContent = texto; p.className = "pildora " + clase; }

// ------------------------------------------------------------------ mandos
const CONSIGNAS = [
  ["caudal_producto_kmolh", "Producción", 60, 110, 1, "kmol/h"],
  ["presion_kpa", "Presión", 2500, 2950, 10, "kPa"],
  ["a_purga_pct", "% A en purga", 40, 55, 0.5, "%"],
  ["nivel_pct", "Nivel", 20, 75, 1, "%"],
];
function crearMando(contenedor, id, etiqueta, min, max, paso, unidad, aplicar) {
  const fila = document.createElement("div");
  fila.className = "consigna";
  fila.innerHTML = `<span>${etiqueta}</span><input type="range" min="${min}" max="${max}" step="${paso}" id="${id}"><output>—</output><button class="boton">Enviar</button>`;
  const r = fila.querySelector("input"), o = fila.querySelector("output");
  r.oninput = () => { r.dataset.tocado = "1"; o.textContent = `${r.value} ${unidad}`; };
  fila.querySelector("button").onclick = async () => { await aplicar(Number(r.value)); delete r.dataset.tocado; };
  r.dataset.unidad = unidad;
  $(contenedor).append(fila);
}
function actualizarMando(id, valor) {
  const r = $(id); if (!r || r.dataset.tocado) return;
  r.value = valor; r.nextElementSibling.textContent = `${fmt(valor, Number(r.step) < 1 ? 1 : 0)} ${r.dataset.unidad}`;
}
for (const [k, et, min, max, paso, u] of CONSIGNAS)
  crearMando("consignas", "sp-" + k, et, min, max, paso, u, (v) => orden("PUT", "/api/v1/consignas", { [k]: v }, `${et}: consigna ${v} ${u}`));
for (const n of ["f1", "f2", "purga", "producto"])
  crearMando("manual", "mv-" + n, "Válvula " + n.toUpperCase(), 0, 100, 0.5, "%", (v) => orden("PUT", "/api/v1/valvulas", { [n]: v }, `Válvula ${n}: ${v} %`));
document.querySelectorAll("[data-modo]").forEach((b) => b.onclick = () => orden("PUT", "/api/v1/modo", { modo: b.dataset.modo }));
$("b-marcha").onclick = () => orden("POST", "/api/v1/marcha", { en_marcha: !(ultimo?.estado.en_marcha) });
$("b-paro").onclick = () => orden("POST", "/api/v1/paro-emergencia", { activo: !(ultimo?.estado.paro_emergencia) });

// ------------------------------------------------------------------ averías
const OBJETIVOS = {
  valvula: ["f1", "f2", "purga", "producto"],
  sensor: ["presion", "nivel", "caudal_f1", "caudal_f2", "caudal_purga", "caudal_producto", "analizador"],
};
const AYUDA = {
  valvula_sucia: ["Fracción del Cv que conserva (0-1). Prueba 0.6 en «producto».", 0.6],
  valvula_atascada: ["La válvula se queda donde está y no obedece al control.", ""],
  valvula_lenta: ["Velocidad máxima de la válvula en %/h. Prueba 20.", 20],
  sensor: ["Deriva: unidades/h (presión: 50) · Ruido: amplitud · Pérdida: fracción del tiempo sin señal (0-1).", 50],
};
function prepararAveria() {
  const t = $("a-tipo").value;
  const lista = t === "sensor" ? OBJETIVOS.sensor : OBJETIVOS.valvula;
  $("a-objetivo").innerHTML = lista.map((o) => `<option>${o}</option>`).join("");
  if (t === "valvula_sucia") $("a-objetivo").value = "producto";
  $("l-modo").hidden = t !== "sensor";
  $("a-ayuda").textContent = AYUDA[t][0]; $("a-valor").value = AYUDA[t][1];
}
$("a-tipo").onchange = prepararAveria; prepararAveria();
$("b-averia").onclick = () => {
  const t = $("a-tipo").value, cuerpo = { tipo: t, objetivo: $("a-objetivo").value };
  if ($("a-valor").value !== "") cuerpo.valor = Number($("a-valor").value);
  if (t === "sensor") cuerpo.modo = $("a-modo").value;
  orden("POST", "/api/v1/averias", cuerpo, "Avería inyectada").then(refrescarListas);
};
$("b-quitar").onclick = () => orden("DELETE", "/api/v1/averias", undefined, "Averías retiradas").then(refrescarListas);
$("b-escala").onclick = () => orden("PUT", "/api/v1/interno/escala", { escala: Number($("i-escala").value) }, "Escala de tiempo cambiada").then(cargarInfo);
$("b-reiniciar").onclick = () => { if (confirm("¿Reiniciar la planta al estado estacionario?")) orden("POST", "/api/v1/interno/reiniciar", undefined, "Planta reiniciada"); };

// ------------------------------------------------------------------ listas
const hora = (iso) => new Date(iso).toLocaleTimeString("es-ES");
const DESCRIPCION = {
  "alarma.activada": (e) => `⚠ ${e.alarma.texto} (${fmt(e.alarma.valor)})`,
  "alarma.borrada": (e) => `✓ Fin: ${e.alarma.texto}`,
  "consigna.cambiada": (e) => `Consigna: ${Object.entries(e.consignas).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  "estado.modo": (e) => `Modo ${e.modo}`,
  "estado.marcha": (e) => (e.en_marcha ? "Planta en marcha" : "Planta parada"),
  "estado.paro_emergencia": (e) => (e.activo ? "PARO DE EMERGENCIA" : "Paro de emergencia rearmado"),
  "averia.inyectada": (e) => `Avería: ${e.averia.tipo} en ${e.averia.objetivo}`,
  "averia.retirada": () => "Averías retiradas",
  "planta.reiniciada": () => "Planta reiniciada",
};
async function refrescarListas() {
  try {
    const [alarmas, eventos, averias] = await Promise.all([api("GET", "/api/v1/alarmas"), api("GET", "/api/v1/eventos?limite=30"), api("GET", "/api/v1/averias")]);
    $("lista-alarmas").innerHTML = alarmas.length ? alarmas.map((a) => `<li class="${a.severidad}"><span><b>${a.texto}</b> · ${fmt(a.valor)} (límite ${a.limite})</span><small>${a.severidad} · ${hora(a.desde)}</small></li>`).join("")
      : `<li class="vacio" style="border:0;background:none">Sin alarmas activas</li>`;
    $("lista-eventos").innerHTML = eventos.map((e) => `<li><span>${(DESCRIPCION[e.evento] || (() => e.evento))(e)}</span><small>${e.evento} · ${hora(e.timestamp)}</small></li>`).join("");
    $("lista-averias").innerHTML = averias.map((a) => `<li class="MAJOR"><span>${a.tipo} → <b>${a.objetivo}</b>${a.modo ? " · " + a.modo : ""}${a.valor !== null ? " · " + a.valor : ""}</span><small>${hora(a.desde)}</small></li>`).join("");
  } catch {}
}

async function refrescarTrafico() {
  try {
    const t = await api("GET", "/api/v1/interno/trafico");
    $("n-ws").textContent = t.websockets; $("n-sse").textContent = t.sse; $("n-wh").textContent = t.webhooks.length;
    $("trafico").innerHTML = t.trafico.slice(0, 60).map((x) => {
      const e = String(x.estado), clase = e.startsWith("error") ? "eerr" : "e" + e[0];
      return `<tr><td>${hora(x.t)}</td><td class="t-${x.tipo}">${x.tipo}</td><td>${x.metodo}</td><td class="ruta" title="${x.ruta}">${x.ruta}</td><td class="${clase}">${e}</td><td>${x.cliente}</td><td>${x.ms || ""}</td></tr>`;
    }).join("");
  } catch {}
}

async function cargarInfo() {
  const i = await api("GET", "/api/v1/info");
  $("escala").textContent = i.escala_tiempo; $("i-escala").value = i.escala_tiempo;
  const p = i.protocolos;
  $("protos").innerHTML = `
    <div class="proto"><b>REST · consulta</b>GET <code>${p.rest}</code><br>GET <code>/api/v1/medidas</code> · <code>/historico</code></div>
    <div class="proto"><b>REST · órdenes</b>PUT <code>/api/v1/consignas</code><br>cabecera <code>X-API-Key</code></div>
    <div class="proto"><b>WebSocket</b><code>${p.websocket}</code><br>estado cada 1 s (<code>?intervalo=2</code>)</div>
    <div class="proto"><b>Server-Sent Events</b><code>${p.sse}</code><br>alarmas y cambios</div>
    <div class="proto"><b>Webhooks</b>POST <code>/api/v1/webhooks</code><br>ReactorLab llama a tu URL</div>
    <div class="proto"><b>OpenAPI</b><a href="/docs" target="_blank"><code>${p.openapi}</code></a><br>documentación y pruebas</div>`;
}

// ------------------------------------------------------------------ tendencia
const SERIES = [
  ["presion_kpa", "Presión (kPa)", "#38bdf8", 2400, 3000],
  ["nivel_pct", "Nivel (%)", "#22c55e", 0, 100],
  ["caudal_producto_kmolh", "Producción (kmol/h)", "#f59e0b", 0, 140],
];
let puntos = [];
async function cargarHistorico() {
  try {
    const h = await api("GET", `/api/v1/historico?variables=${SERIES.map((s) => s[0]).join(",")}&minutos=10`);
    const n = h.variables[SERIES[0][0]].length;
    puntos = Array.from({ length: n }, (_, i) => Object.fromEntries([["ts", h.variables[SERIES[0][0]][i].ts], ...SERIES.map((s) => [s[0], h.variables[s[0]][i].valor])]));
  } catch {}
}
function anotarTendencia(s) {
  const ts = Date.parse(s.timestamp);
  if (puntos.length && ts - puntos[puntos.length - 1].ts < 900) return;
  puntos.push({ ts, presion_kpa: s.medidas.presion_kpa, nivel_pct: s.medidas.nivel_pct, caudal_producto_kmolh: s.medidas.caudal_kmolh.producto });
  const limite = ts - 10 * 60 * 1000;
  while (puntos.length && puntos[0].ts < limite) puntos.shift();
  dibujar();
}
function dibujar() {
  const c = $("grafica"), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = 220;
  c.width = w * dpr; c.height = h * dpr; const g = c.getContext("2d"); g.scale(dpr, dpr);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#1c2939"; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) { const y = 10 + i * (h - 30) / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  if (puntos.length < 2) return;
  const t1 = puntos[puntos.length - 1].ts, t0 = t1 - 10 * 60 * 1000;
  for (const [k, , color, lo, hi] of SERIES) {
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath();
    puntos.forEach((p, i) => {
      const x = (p.ts - t0) / (t1 - t0) * w, y = 10 + (1 - (p[k] - lo) / (hi - lo)) * (h - 30);
      i ? g.lineTo(x, Math.max(2, Math.min(h - 18, y))) : g.moveTo(x, y);
    });
    g.stroke();
  }
  g.fillStyle = "#8ea1b8"; g.font = "11px system-ui";
  g.fillText("−10 min", 2, h - 4); g.fillText("ahora", w - 34, h - 4);
}
$("leyenda").innerHTML = SERIES.map(([, n, c, lo, hi]) => `<span><i style="background:${c}"></i>${n} <small>[${lo}–${hi}]</small></span>`).join("");
window.addEventListener("resize", dibujar);

// ------------------------------------------------------------------ WebSocket
function conectar() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => pildora("p-conexion", "WebSocket conectado", "ok");
  ws.onmessage = (m) => pintar(JSON.parse(m.data));
  ws.onclose = () => { pildora("p-conexion", "Reconectando…", "aviso"); setTimeout(conectar, 2000); };
}

$("i-clave").value = clave;
$("i-clave").onchange = () => { clave = $("i-clave").value.trim(); try { localStorage.setItem("reactorlab-clave", clave); } catch {} };
cargarInfo().catch(() => {});
cargarHistorico().then(dibujar);
conectar();
refrescarListas(); setInterval(refrescarListas, 3000);
refrescarTrafico(); setInterval(refrescarTrafico, 2000);
