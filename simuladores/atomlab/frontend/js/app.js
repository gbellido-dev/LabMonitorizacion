// Sala de control web de AtomLab: recibe el estado por WebSocket y manda órdenes por REST.
const $ = (s) => document.querySelector(s);
const API = "/api/v1";
let estado = null;
let central = null;
const serie = [];                       // tendencias locales (t, potencia, rho, vacío)

// ------------------------------------------------------------------ 3D (se carga aparte: si falla WebGL, la sala de control sigue)
import("./escena.js").then(({ Central3D }) => {
  const calidad = new URLSearchParams(location.search).get("calidad") || (matchMedia("(max-width: 1000px)").matches ? "media" : "alta");
  central = new Central3D($("#visor"), { calidad });
  window.atomlab3d = central;
  $("#cargando").remove();
  if (estado) central.actualizar(estado);
}).catch((e) => { $("#cargando").textContent = `No se pudo iniciar la vista 3D (WebGL): ${e.message}`; console.error(e); });

$("#vistas").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("#vistas button").forEach((x) => x.classList.toggle("sel", x === b));
  central?.vista(b.dataset.vista);
});
$("#ver-corte").addEventListener("change", (e) => central?.ponerCorte(e.target.checked));
$("#ver-radiacion").addEventListener("change", (e) => central?.ponerRadiacion(e.target.checked));

// ------------------------------------------------------------------ órdenes
function avisar(texto, error = false) {
  const a = $("#aviso"); a.textContent = texto; a.className = `aviso-flotante${error ? " error" : ""}`; a.style.display = "block";
  clearTimeout(avisar.t); avisar.t = setTimeout(() => (a.style.display = "none"), 3500);
}
async function orden(metodo, ruta, cuerpo) {
  try {
    const r = await fetch(API + ruta, { method: metodo, headers: { "Content-Type": "application/json" }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail ?? j));
    return j;
  } catch (e) { avisar(e.message, true); return null; }
}

const GRUPOS = { RR: "151 manuales", AR: "12 automáticas", USP: "24 cortas (abajo)", AZ: "24 emergencia" };
$("#barras").innerHTML = Object.entries(GRUPOS).map(([g, d]) => `
  <div class="barra-grupo" id="g-${g}"><b>${g}<small>${d}</small></b>
    <div class="pista"><input type="range" min="0" max="100" step="1" ${g === "AZ" ? "disabled" : ""}><span class="real"></span></div>
    <output>—</output>${g === "AZ" ? "<span></span>" : `<button class="boton" data-grupo="${g}">Mover</button>`}
  </div>`).join("");
const tocando = new Set();
document.querySelectorAll(".barra-grupo input, #r-potencia").forEach((i) => {
  i.addEventListener("pointerdown", () => tocando.add(i)); i.addEventListener("input", () => tocando.add(i));
  i.addEventListener("change", () => setTimeout(() => tocando.delete(i), 8000));
});
$("#barras").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-grupo]"); if (!b) return;
  const input = b.parentElement.querySelector("input");
  tocando.delete(input);
  if (await orden("PUT", `/mandos/barras/${b.dataset.grupo}`, { insercion_pct: Number(input.value) })) avisar(`${b.dataset.grupo} → ${input.value} %`);
});
$("#r-potencia").addEventListener("input", (e) => ($("#o-potencia").textContent = `${e.target.value} MWt`));
$('[data-enviar="potencia"]').addEventListener("click", async () => {
  tocando.delete($("#r-potencia"));
  if (await orden("PUT", "/mandos/potencia", { mwt: Number($("#r-potencia").value) })) avisar(`Consigna ${$("#r-potencia").value} MWt`);
});
$("#regulador").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) orden("PUT", "/mandos/regulador", { auto: b.dataset.v === "1" }); });
$("#bombas-mas").addEventListener("click", () => estado && orden("PUT", "/mandos/bombas", { en_marcha: Math.min(8, estado.circuito.bombas_en_marcha + 1) }));
$("#bombas-menos").addEventListener("click", () => estado && orden("PUT", "/mandos/bombas", { en_marcha: Math.max(0, estado.circuito.bombas_en_marcha - 1) }));
$("#turbina-disparo").addEventListener("click", () => orden("POST", "/mandos/turbina/disparo"));
$("#turbina-rearme").addEventListener("click", () => orden("POST", "/mandos/turbina/rearme"));
$("#turbina-prueba").addEventListener("click", () => orden("POST", "/mandos/turbina/prueba"));
$("#protecciones").addEventListener("change", (e) => orden("PUT", "/mandos/protecciones", { activas: e.target.checked }));
$("#az5").addEventListener("click", () => orden("POST", "/mandos/az5"));
$("#rearmar").addEventListener("click", () => orden("POST", "/mandos/rearmar"));
document.querySelectorAll("[data-escenario]").forEach((b) => b.addEventListener("click", async () => {
  if (await orden("POST", "/mandos/escenario", { nombre: b.dataset.escenario })) { serie.length = 0; avisar(`Escenario: ${b.textContent}`); }
}));
$("#escala").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) orden("PUT", "/mandos/escala", { valor: Number(b.dataset.v) }); });

// ------------------------------------------------------------------ pintar
const f = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
// tasa de dosis con la unidad adecuada (µSv/h, mSv/h o Sv/h)
function fDosis(v) { return v >= 1000 ? `${f(v / 1000, 1)} Sv/h` : v >= 1 ? `${f(v, 1)} mSv/h` : `${f(v * 1000, v < 0.01 ? 1 : 0)} µSv/h`; }

function pintar(s) {
  const r = s.reactor;
  const k = $("#k-estado"); k.textContent = s.estado; k.className = `pildora ${s.estado}`;
  $("#k-mwt").textContent = f(r.potencia_mwt, 0);
  $("#k-mwe").textContent = f(s.generador.potencia_mwe, 0);
  $("#k-rho").textContent = f(r.reactividad_beta, 2);
  $("#k-orm").textContent = f(r.orm_barras, 0);
  const dc = s.radiacion.sala_central_msvh;
  $("#k-dosis").textContent = fDosis(dc);
  $(".dosimetro").className = `dosimetro${dc > 1000 ? " letal" : dc > 1 ? " alto" : ""}`;
  $("#banda-accidente").hidden = !s.proteccion.danado;

  // mandos
  document.querySelectorAll("#regulador button").forEach((b) => b.classList.toggle("sel", (b.dataset.v === "1") === r.regulador_auto));
  $("#regulador-txt").textContent = r.regulador_auto ? `consigna ${f(r.consigna_mwt, 0)} MWt` : "barras en manual";
  if (!tocando.has($("#r-potencia"))) { $("#r-potencia").value = r.consigna_mwt; $("#o-potencia").textContent = `${f(r.consigna_mwt, 0)} MWt`; }
  $("#m-potencia").classList.toggle("bloqueado", !r.regulador_auto);
  for (const [g, d] of Object.entries(r.barras)) {
    const fila = $(`#g-${g}`), input = fila.querySelector("input");
    if (!tocando.has(input)) input.value = d.objetivo_pct ?? d.insercion_pct;
    fila.querySelector(".real").style.width = `${d.insercion_pct}%`;
    fila.querySelector("output").textContent = `${f(d.insercion_pct, 1)} %`;
    fila.classList.toggle("bloqueado", g === "AZ" || (g === "AR" && r.regulador_auto) || s.proteccion.scram);
  }
  $("#bombas-n").textContent = s.circuito.bombas_en_marcha;
  $("#protecciones").checked = s.proteccion.protecciones_activas;
  $("#protecciones-txt").textContent = s.proteccion.protecciones_activas ? "Activas" : "ANULADAS";
  $("#protecciones").parentElement.classList.toggle("anuladas", !s.proteccion.protecciones_activas);
  $("#az5").classList.toggle("activo", s.proteccion.scram);
  $("#motivo").textContent = s.proteccion.motivo ? `Disparo: ${s.proteccion.motivo}` : "";
  document.querySelectorAll("#escala button").forEach((b) => b.classList.toggle("sel", Number(b.dataset.v) === s.escala));

  // sistemas
  const c = s.circuito, t = s.turbina;
  const bloque = (titulo, filas) => `<div class="sistema"><h4>${titulo}</h4>${filas.map(([n, v, u = "", cl = ""]) => `<div><span>${n}</span><b class="${cl}">${v} ${u}</b></div>`).join("")}</div>`;
  $("#sistemas").innerHTML = [
    bloque("Núcleo", [["Periodo", r.periodo_s >= 9999 ? "∞" : f(r.periodo_s, 1), "s", r.periodo_s > 0 && r.periodo_s < 60 ? "mal" : ""],
      ["Coef. vacío", f(r.coef_vacio_pcm_pct, 1), "pcm/%"], ["T UO₂", f(r.t_combustible_c, 0), "°C", r.t_combustible_c > 2000 ? "mal" : ""],
      ["T grafito", f(r.t_grafito_c, 0), "°C"], ["Xe-135", f(r.xenon_rel, 2), "×"], ["Calor residual", f(r.calor_residual_mwt, 0), "MWt"]]),
    bloque("Circuito", [["Caudal", f(c.caudal_kgs / 1000, 2), "t/s", c.caudal_pct < 70 ? "mal" : ""], ["Subenfriam.", f(c.subenfriamiento_c, 1), "°C", c.subenfriamiento_c < 2 ? "aviso" : ""],
      ["Vacío", f(r.vacio_pct, 1), "%"], ["Presión", f(c.presion_mpa, 2), "MPa", c.presion_mpa > 7.5 ? "mal" : ""],
      ["Nivel sep.", f(c.nivel_separadores_pct, 0), "%", c.nivel_separadores_pct < 30 ? "mal" : ""], ["Vapor", f(c.vapor_kgs, 0), "kg/s"]]),
    bloque("Turbogenerador", [["Admisión", f(t.valvula_admision_pct, 0), "%"], ["Bypass", f(t.bypass_condensador_pct, 0), "%"], ["Velocidad", f(t.velocidad_rpm, 0), "rpm"],
      ["Potencia", f(s.generador.potencia_mwe, 0), "MWe"], ["Frecuencia", f(s.generador.frecuencia_hz, 2), "Hz"], ["Rendimiento", f(s.generador.rendimiento_pct, 1), "%"]]),
    bloque("Radiación", Object.entries({ "Sala control": "sala_control", "Sala central": "sala_central", "Turbinas": "sala_turbinas", "Vallado": "exterior" })
      .map(([n, kk]) => { const v = s.radiacion[`${kk}_msvh`]; return [n, fDosis(v), "", v > 100 ? "mal" : v > 0.1 ? "aviso" : ""]; })
      .concat([["Combustible fundido", f(s.proteccion.combustible_fundido_pct, 0), "%", s.proteccion.combustible_fundido_pct > 0 ? "mal" : ""],
               ["Condensador", f(s.condensador.presion_kpa, 1), "kPa"]])),
  ].join("");

  // tendencias
  serie.push([performance.now() / 1000, r.potencia_mwt, r.reactividad_beta, r.vacio_pct]);
  while (serie.length && serie[serie.length - 1][0] - serie[0][0] > 120) serie.shift();
  dibujar();
}

function dibujar() {
  const cv = $("#grafica"), dpr = devicePixelRatio || 1, w = cv.clientWidth, h = 170;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const x = cv.getContext("2d"); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  if (serie.length < 2) return;
  const t1 = serie[serie.length - 1][0], t0 = t1 - 120, X = (t) => ((t - t0) / 120) * (w - 40) + 34;
  x.font = "10px system-ui"; x.fillStyle = "#64748b"; x.strokeStyle = "#1e2b38";
  const logP = (p) => h - 14 - ((Math.log10(Math.max(10, p)) - 1) / 4) * (h - 24);     // 10 MW .. 100 GW
  for (const p of [10, 100, 1000, 10000, 100000]) { const y = logP(p); x.beginPath(); x.moveTo(34, y); x.lineTo(w, y); x.stroke(); x.fillText(p >= 1000 ? `${p / 1000} GW` : `${p} MW`, 0, y + 3); }
  const linea = (i, Y, color) => { x.strokeStyle = color; x.lineWidth = 1.6; x.beginPath(); serie.forEach((p, k) => (k ? x.lineTo(X(p[0]), Y(p[i])) : x.moveTo(X(p[0]), Y(p[i])))); x.stroke(); };
  linea(1, logP, "#f97316");
  const yRho = (b) => h / 2 - b * (h / 2 - 12) / 2;                                    // ±2 β
  x.strokeStyle = "#38bdf833"; x.setLineDash([4, 4]); x.beginPath(); x.moveTo(34, yRho(1)); x.lineTo(w, yRho(1)); x.stroke(); x.setLineDash([]);
  x.fillStyle = "#38bdf8"; x.fillText("1 β", w - 22, yRho(1) - 3);
  linea(2, (b) => yRho(Math.max(-2, Math.min(2, b))), "#38bdf8");
  linea(3, (v) => h - 14 - (v / 60) * (h - 24), "#a3e635");
}

function pintarAlarmas(a, ev) {
  $("#n-alarmas").textContent = `${a.activas.length} activas`;
  $("#alarmas").innerHTML = a.activas.length ? a.activas.map((x) => `<li class="${x.severidad}"><span>${x.texto}</span><small>${x.codigo}</small></li>`).join("") : '<li class="vacio">Sin alarmas</li>';
  $("#eventos").innerHTML = ev.eventos.slice(0, 40).map((e) => {
    const d = e.datos || {};
    const txt = d.texto || d.motivo || Object.entries(d).map(([k, v]) => `${k}=${v}`).join(" ");
    return `<li><span><b>${e.tipo}</b> ${txt}</span><small>t=${e.t_s.toFixed(1)} s</small></li>`;
  }).join("");
}

async function refrescoLento() {
  const [a, ev, op] = await Promise.all(["/alarmas", "/eventos?limite=40", "/opcua"].map((r) => fetch(API + r).then((x) => x.json()).catch(() => null)));
  if (a && ev) pintarAlarmas(a, ev);
  if (op) {
    $("#opcua-endpoint").textContent = op.endpoint; $("#opcua-url").textContent = op.endpoint;
    const e = $("#opcua-estado"); e.textContent = op.en_marcha ? "en marcha" : "parado"; e.className = `pildora ${op.en_marcha ? "ok" : "mal"}`;
    if (!$("#nodos").children.length) $("#nodos").innerHTML = op.nodos.map((n) => `<tr title="${n.descripcion}"><td>${n.node_id}</td><td>${n.tipo}</td><td>${n.unidad}</td><td>${n.acceso}</td></tr>`).join("");
    $("#opcua-registro").innerHTML = op.registro.length ? op.registro.map((r) => `<li><span><b>${r.tipo}</b> ${r.nodo} ${r.valor}</span><small>${r.timestamp.slice(11, 19)}</small></li>`).join("") : '<li class="vacio">Ningún cliente ha escrito todavía</li>';
  }
}
setInterval(refrescoLento, 1500); refrescoLento();

// ------------------------------------------------------------------ WebSocket (con reconexión)
function conectar() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?intervalo=0.2`);
  ws.onmessage = (m) => { estado = JSON.parse(m.data); central?.actualizar(estado); pintar(estado); };
  ws.onclose = () => setTimeout(conectar, 1500);
}
conectar();
