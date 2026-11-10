"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFoundryScene } from "./foundry-scene";
import { useOpcUaLive, fmt, type LiveSnapshot, type LiveValue, type Punto, type Traz } from "./use-opcua-live";

/* ─────────────────────────── catálogo (los valores vienen de OPC UA) ─────────────────────────── */
type AssetStatus = "RUN" | "WARN" | "IDLE" | "ALARM";
type Asset = { id: string; short: string; name: string; zone: string; plc: string; tags: [string, string][] };

const assets: Asset[] = [
  { id: "if-01", short: "IF-01", name: "Horno de inducción 01", zone: "Fusión", plc: "PLC-FUS-01 · S7-1515", tags: [["Metal.Temp", "DB10.DBD0"], ["Coil.Power", "DB10.DBD8"], ["Tilt.Angle", "DB11.DBD4"], ["ReadyToPour", "DB11.DBX12.0"]] },
  { id: "if-02", short: "IF-02", name: "Horno de inducción 02", zone: "Fusión", plc: "PLC-FUS-01 · S7-1515", tags: [["Metal.Temp", "DB10.DBD20"], ["Coil.Power", "DB10.DBD28"], ["Cooling.Flow", "DB12.DBD0"], ["Alarm.Word", "DB90.DBW4"]] },
  { id: "mp-01", short: "MP-01", name: "Prensa de moldeo superior", zone: "Moldeo", plc: "PLC-MOL-01 · S7-1512", tags: [["Cycle.Time", "DB20.DBD0"], ["Press.Force", "DB20.DBD8"], ["Sand.Moisture", "DB21.DBD4"], ["Mould.OK", "DB22.DBX0.2"]] },
  { id: "mp-02", short: "MP-02", name: "Prensa de moldeo inferior", zone: "Moldeo", plc: "PLC-MOL-01 · S7-1512", tags: [["Cycle.Time", "DB20.DBD20"], ["Press.Force", "DB20.DBD28"], ["Sand.Density", "DB21.DBD16"], ["Mould.OK", "DB22.DBX0.3"]] },
  { id: "rob-03", short: "ROB-03", name: "Robot posicionador de machos", zone: "Moldeo", plc: "PLC-MOL-01 · S7-1512", tags: [["Axis.J1..J6", "DB25.DBD0"], ["Grip.Closed", "DB25.DBX28.0"], ["Core.Present", "DB25.DBX28.1"], ["Cell.Safe", "DB26.DBX0.0"]] },
  { id: "pour-01", short: "COL-01", name: "Estación de colada automática", zone: "Colada", plc: "PLC-COL-01 · S7-1516F", tags: [["Ladle.Weight", "DB30.DBD0"], ["Pour.Temp", "DB30.DBD8"], ["Flow.Rate", "DB31.DBD0"], ["Safety.Zone", "DB32.DBX1.0"]] },
  { id: "rob-01", short: "ROB-01", name: "Robot de inoculación y escoriado", zone: "Colada", plc: "PLC-COL-01 · S7-1516F", tags: [["Axis.J1..J6", "DB35.DBD0"], ["TCP.Speed", "DB35.DBD24"], ["Program.No", "DB35.DBW30"], ["Cell.Safe", "DB36.DBX0.0"]] },
  { id: "cool-01", short: "ENF-01", name: "Túnel de enfriamiento", zone: "Enfriamiento", plc: "PLC-LIN-01 · ET200SP", tags: [["Mould.Temp", "DB40.DBD0"], ["Residence.Time", "DB40.DBD8"], ["Fan.Speed", "DB41.DBD0"], ["Exit.Ready", "DB42.DBX0.0"]] },
  { id: "shake-01", short: "DES-01", name: "Desmoldeo vibratorio", zone: "Acabado", plc: "PLC-ACA-01 · S7-1512", tags: [["Vib.Frequency", "DB50.DBD0"], ["Motor.Current", "DB50.DBD8"], ["Dust.FilterDP", "DB51.DBD4"], ["Part.Present", "DB52.DBX0.0"]] },
  { id: "rob-02", short: "ROB-02", name: "Robot de manipulación de piezas", zone: "Acabado", plc: "PLC-ACA-01 · S7-1512", tags: [["Axis.J1..J6", "DB55.DBD0"], ["Payload.Kg", "DB55.DBD24"], ["Pick.Count", "DB55.DBD28"], ["Cell.Safe", "DB56.DBX0.0"]] },
  { id: "qc-01", short: "QC-01", name: "Célula de calidad 3D", zone: "Calidad", plc: "PLC-QA-01 · S7-1500", tags: [["Scan.Deviation", "DB60.DBD0"], ["Part.Weight", "DB60.DBD8"], ["Defect.Class", "DB61.DBW0"], ["Part.Accepted", "DB62.DBX0.0"]] },
];
const byShort = Object.fromEntries(assets.map((a) => [a.short, a]));
const AVERIAS = ["Sin avería", "Rodamiento del desmoldeo DES-01", "Extracción de humos IF-02", "Retraso de la grúa de cuchara",
  "Deriva del escáner 3D QC-01", "Humedad de arena alta", "Inoculación intermitente (ROB-01)", "Termopar de IF-01 descalibrado"];
const ESTADO_TXT: Record<string, string> = { RUN: "en marcha", IDLE: "en espera", WARN: "aviso", ALARM: "alarma" };

/* ─────────────────────────── utilidades ─────────────────────────── */
type Snap = LiveSnapshot | null | undefined;
const val = (s: Snap, a: string, v: string) => s?.assets?.[a]?.[v]?.v;
const num = (s: Snap, a: string, v: string) => { const x = val(s, a, v); return typeof x === "number" ? x : undefined; };
const kpi = (s: Snap, n: string) => { const x = s?.kpis?.[n]?.v; return typeof x === "number" ? x : undefined; };
const estado = (s: Snap, a: string) => (val(s, a, "Estado") as AssetStatus | undefined);
const horaSim = (t?: number) => {
  if (t == null) return "—";
  const d = new Date(2000, 0, 1, 6, 0, 0); d.setSeconds(d.getSeconds() + t);            // el turno empieza a las 06:00
  return d.toLocaleTimeString("es-ES");
};
const colorT = (t?: number) => t == null ? "#57656b" : t < 1250 ? "#a52a12" : t < 1400 ? "#ff5418" : t < 1480 ? "#ff8a28" : "#ffc160";

function Sparkline({ color = "#34d6a0", points }: { color?: string; points: number[] }) {
  const p = points.filter(Number.isFinite);
  if (p.length < 2) return <svg className="sparkline" viewBox="0 0 100 36" aria-hidden="true" />;
  const max = Math.max(...p), min = Math.min(...p);
  const d = p.map((v, i) => `${i === 0 ? "M" : "L"} ${(i * 100) / (p.length - 1)} ${34 - ((v - min) / (max - min || 1)) * 28}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /><path d={`${d} L 100 36 L 0 36 Z`} fill={color} opacity=".08" /></svg>;
}

function Metric({ label, value, delta, tone, points }: { label: string; value: string; delta: string; tone?: string; points: number[] }) {
  return <div className="metric"><div className="metric-label">{label}</div><div className="metric-row"><strong>{value}</strong><span className={tone || "good"}>{delta}</span></div><Sparkline color={tone === "warn" ? "#ffb84d" : "#32d59b"} points={points} /></div>;
}

/* Variación en los últimos ~10 min (300 muestras de 2 s) */
function tendencia(larga: Punto[], k: keyof Punto, dp = 1, u = "") {
  if (larga.length < 30) return { txt: "—", sube: true };
  const a = larga[Math.max(0, larga.length - 300)][k] as number, b = larga[larga.length - 1][k] as number;
  const d = b - a;
  return { txt: `${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d), dp)}${u}`, sube: d >= 0 };
}

/* Salud estimada de un activo a partir de lo que se mide (no de la «verdad» de la simulación) */
function salud(s: Snap, short: string) {
  const st = estado(s, short);
  let base = st === "ALARM" ? 35 : st === "WARN" ? 68 : 96;
  const filas: [string, string][] = [];
  if (short === "DES-01") {
    const v = num(s, "DES-01", "Vibracion") ?? 0, marcha = val(s, "DES-01", "Marcha") === true;
    const exceso = Math.max(0, (marcha ? v - 8.6 : (v - 0.5) / 0.35) / 12);
    base = Math.min(base, Math.round(100 - exceso * 70));
    filas.push(["Rodamiento (vibración)", `${fmt(v, 1)} mm/s`], ["Temperatura", fmt(num(s, "DES-01", "Temperatura"), 0, "°C")]);
  } else if (short === "QC-01") {
    filas.push(["Desviación medida", fmt(num(s, "QC-01", "DesviacionEscaneo"), 3, "mm")], ["Conformes (media)", fmt(num(s, "QC-01", "PiezasConformes"), 1, "%")]);
  } else if (short.startsWith("IF")) {
    filas.push(["Presión recinto", fmt(num(s, short, "Presion"), 1, "Pa")], ["Energía consumida", fmt(num(s, short, "EnergiaConsumida"), 0, "kWh")]);
  } else if (short.startsWith("MP")) {
    filas.push(["Humedad de arena", fmt(num(s, short, "HumedadArena"), 2, "%")], ["Ciclo", fmt(num(s, short, "TiempoCiclo"), 1, "s")]);
  } else {
    filas.push(["Vibración", fmt(num(s, short, "Vibracion"), 2, "mm/s")], ["OEE del activo", fmt(num(s, short, "OEE"), 1, "%")]);
  }
  return { valor: Math.max(5, Math.min(100, base)), filas };
}

function ordenTrabajo(s: Snap) {
  if (!s) return { t: "—", d: "Sin conexión con la planta" };
  if (estado(s, "DES-01") === "ALARM") return { t: "OT · Cambiar rodamiento DES-01", d: "Urgente · desmoldeo parado por vibración" };
  if ((num(s, "DES-01", "Vibracion") ?? 0) > 12) return { t: "OT · Revisar rodamiento DES-01", d: "Prioridad alta · vibración en aumento" };
  if (estado(s, "IF-02") === "ALARM") return { t: "OT · Extracción de humos IF-02", d: "Urgente · recinto en sobrepresión" };
  if (estado(s, "QC-01") === "WARN") return { t: "OT · Calibrar escáner QC-01", d: "Prioridad alta · desviación anormal" };
  if (estado(s, "MP-01") === "WARN") return { t: "OT · Revisar humedad de arena", d: "Prioridad media · mezclador / bentonita" };
  return { t: "OT · Inspección preventiva", d: "Planificada · sin incidencias" };
}

type Evento = { id: number; hora: string; sev: "critical" | "warning" | "info"; titulo: string; detalle: string };

/* ─────────────────────────── sinóptico 2D ─────────────────────────── */
function Sinoptico({ s, onSelect }: { s: Snap; onSelect: (id: string) => void }) {
  const cls = (short: string) => `syn-box ${(estado(s, short) ?? "RUN").toLowerCase()}`;
  const horno = (short: string, x: number) => {
    const T = num(s, short, "TemperaturaMetal"), nivel = num(s, short, "NivelCarga") ?? 0;
    return <g className={cls(short)} onClick={() => onSelect(byShort[short].id)} transform={`translate(${x},40)`}>
      <rect className="frame" width="130" height="170" rx="6" />
      <text x="10" y="20" className="t-title">{short}</text>
      <text x="120" y="20" className="t-right">{String(val(s, short, "Fase") ?? "—")}</text>
      <path d="M30 40 L100 40 L95 130 L35 130 Z" className="crisol" />
      <rect x="37" y={130 - 88 * Math.min(1, nivel / 100)} width="56" height={88 * Math.min(1, nivel / 100)} fill={colorT(T)} opacity=".9" />
      <text x="65" y="152" className="t-big">{fmt(T, 0, "°C")}</text>
      <text x="65" y="166" className="t-small">{fmt(num(s, short, "PotenciaBobina"), 0, "kW")} · {fmt(nivel, 0, "%")}</text>
    </g>;
  };
  const peso = num(s, "COL-01", "PesoCuchara") ?? 0, tCol = num(s, "COL-01", "TemperaturaColada");
  const vib = num(s, "DES-01", "Vibracion") ?? 0;
  const oee = kpi(s, "OEEPlanta");
  const u = s?.traz;
  return <svg className="sinoptico" viewBox="0 0 1180 420" role="img" aria-label="Sinóptico de la planta">
    <defs><marker id="flecha" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#3c5a63" /></marker></defs>
    {/* flujo */}
    <path d="M300 125 L345 125" className="flujo" markerEnd="url(#flecha)" />
    <path d="M490 125 L530 125" className="flujo" markerEnd="url(#flecha)" />
    <path d="M410 300 L560 300 L560 260" className="flujo" markerEnd="url(#flecha)" />
    <path d="M675 205 L720 205" className="flujo" markerEnd="url(#flecha)" />
    <path d="M900 205 L935 205" className="flujo" markerEnd="url(#flecha)" />
    <path d="M1010 255 L1010 290" className="flujo" markerEnd="url(#flecha)" />
    {horno("IF-01", 20)}{horno("IF-02", 160)}
    {/* cuchara */}
    <g className={cls("COL-01")} onClick={() => onSelect("pour-01")} transform="translate(350,40)">
      <rect className="frame" width="140" height="170" rx="6" />
      <text x="10" y="20" className="t-title">CUCHARA · COL-01</text>
      <path d="M30 45 L110 45 L100 125 L40 125 Z" className="crisol" />
      <rect x="42" y={125 - 78 * Math.min(1, peso / 1450)} width="56" height={78 * Math.min(1, peso / 1450)} fill={colorT(tCol)} opacity=".9" />
      <text x="70" y="146" className="t-big">{val(s, "COL-01", "CambioCuchara") === true ? "CAMBIO" : fmt(peso, 0, "kg")}</text>
      <text x="70" y="162" className="t-small">{fmt(tCol, 0, "°C")} · {val(s, "COL-01", "Colando") === true ? "colando" : "espera"}</text>
    </g>
    {/* línea y colada */}
    <g className={cls("COL-01")} onClick={() => onSelect("pour-01")} transform="translate(535,150)">
      <rect className="frame" width="140" height="110" rx="6" />
      <text x="10" y="20" className="t-title">LÍNEA DE MOLDEO</text>
      <text x="70" y="55" className="t-big">{fmt(kpi(s, "VelocidadLinea"), 1, "m/min")}</text>
      <text x="70" y="75" className="t-small">llenado {fmt(num(s, "COL-01", "NivelLlenado"), 0, "%")} · {fmt(num(s, "COL-01", "CaudalColada"), 1, "kg/s")}</text>
      <text x="70" y="95" className="t-small">ciclo {fmt(num(s, "COL-01", "TiempoCiclo"), 0, "s")}</text>
    </g>
    {/* moldeo */}
    <g className={cls("MP-01")} onClick={() => onSelect("mp-01")} transform="translate(260,250)">
      <rect className="frame" width="150" height="110" rx="6" />
      <text x="10" y="20" className="t-title">MOLDEO · MP-01/02</text>
      <text x="75" y="55" className="t-big">{fmt(num(s, "MP-01", "HumedadArena"), 2, "%")}</text>
      <text x="75" y="75" className="t-small">humedad de arena (MP-02 {fmt(num(s, "MP-02", "HumedadArena"), 2, "%")})</text>
      <text x="75" y="95" className="t-small">machos {fmt(num(s, "ROB-03", "MachosColocados"), 0)}</text>
    </g>
    {/* túnel */}
    <g className={cls("ENF-01")} onClick={() => onSelect("cool-01")} transform="translate(720,150)">
      <rect className="frame" width="180" height="110" rx="6" />
      <text x="10" y="20" className="t-title">TÚNEL · ENF-01</text>
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={12 + i * 13.5} y="32" width="10" height="16" rx="2" fill={colorT(1500 - i * 75)} opacity={0.25 + 0.06 * (12 - i)} />)}
      <text x="90" y="72" className="t-big">{fmt(num(s, "ENF-01", "MoldesEnTunel"), 0)} moldes</text>
      <text x="90" y="92" className="t-small">{fmt(num(s, "ENF-01", "TiempoResidencia"), 0, "min")} · salida {fmt(num(s, "ENF-01", "TemperaturaMolde"), 0, "°C")}</text>
    </g>
    {/* desmoldeo */}
    <g className={cls("DES-01")} onClick={() => onSelect("shake-01")} transform="translate(935,150)">
      <rect className="frame" width="150" height="105" rx="6" />
      <text x="10" y="20" className="t-title">DESMOLDEO · DES-01</text>
      <rect x="15" y="34" width="120" height="10" rx="3" className="barra" />
      <rect x="15" y="34" width={Math.min(120, (vib / 22) * 120)} height="10" rx="3" fill={vib > 18 ? "#ff5c5c" : vib > 12 ? "#ffb84d" : "#32d59b"} />
      <line x1={15 + (12 / 22) * 120} x2={15 + (12 / 22) * 120} y1="30" y2="48" className="umbral" />
      <line x1={15 + (18 / 22) * 120} x2={15 + (18 / 22) * 120} y1="30" y2="48" className="umbral" />
      <text x="75" y="70" className="t-big">{fmt(vib, 1, "mm/s")}</text>
      <text x="75" y="90" className="t-small">{val(s, "DES-01", "Marcha") === true ? "vibrando" : "en espera"} · {fmt(num(s, "DES-01", "Temperatura"), 0, "°C")}</text>
    </g>
    {/* calidad */}
    <g className={cls("QC-01")} onClick={() => onSelect("qc-01")} transform="translate(935,290)">
      <rect className="frame" width="150" height="110" rx="6" />
      <text x="10" y="20" className="t-title">CALIDAD · QC-01</text>
      <text x="75" y="52" className="t-big">{fmt(kpi(s, "PiezasConformes"), 1, "%")}</text>
      <text x="75" y="72" className="t-small">desviación {fmt(num(s, "QC-01", "DesviacionEscaneo"), 3, "mm")}</text>
      <text x="75" y="94" className={`t-small ${u?.Resultado === "RECHAZO" ? "mal" : "bien"}`}>{u?.Id ? `${u.Id} · ${u.Resultado}` : "—"}</text>
    </g>
    {/* KPIs */}
    <g transform="translate(20,250)">
      <rect className="frame" width="220" height="150" rx="6" />
      <text x="10" y="22" className="t-title">PLANTA NORTE</text>
      <text x="10" y="58" className="t-big izq" fill={oee != null && oee < 75 ? "#ff5c5c" : undefined}>OEE {fmt(oee, 1, "%")}</text>
      <text x="10" y="84" className="t-small izq">producción {fmt(kpi(s, "ProduccionTurno"), 1, "t")}</text>
      <text x="10" y="104" className="t-small izq">energía {fmt(kpi(s, "EnergiaEspecifica"), 0, "kWh/t")}</text>
      <text x="10" y="124" className="t-small izq">lote {String(s?.kpis?.LoteActivo?.v ?? "—")}</text>
      <text x="10" y="142" className="t-small izq">{s?.sim?.AveriaNombre && s.sim.Averia ? `avería: ${s.sim.AveriaNombre}` : "sin avería inyectada"}</text>
    </g>
  </svg>;
}

/* ─────────────────────────── trazabilidad ─────────────────────────── */
function Trazabilidad({ piezas }: { piezas: Traz[] }) {
  const [filtro, setFiltro] = useState<"todas" | "rechazos">("todas");
  const lista = piezas.filter((p) => filtro === "todas" || p.Resultado !== "OK");
  const porDefecto = piezas.reduce<Record<string, number>>((m, p) => { if (p.Resultado !== "OK") m[p.Defecto ?? "?"] = (m[p.Defecto ?? "?"] ?? 0) + 1; return m; }, {});
  const porLote = piezas.reduce<Record<string, [number, number]>>((m, p) => { const l = p.Lote ?? "?"; const x = m[l] ?? [0, 0]; x[0]++; if (p.Resultado !== "OK") x[1]++; m[l] = x; return m; }, {});
  const alerta = (cond: boolean) => (cond ? "fuera" : undefined);
  return <div className="traz-view">
    <div className="traz-side">
      <div className="panel-heading"><div><span>PIEZAS INSPECCIONADAS</span><b>{piezas.length} desde que abriste la página</b></div></div>
      <div className="traz-sum"><span>Rechazos por defecto</span>{Object.keys(porDefecto).length ? Object.entries(porDefecto).sort((a, b) => b[1] - a[1]).map(([d, n]) => <div key={d}><b>{n}</b>{d}</div>) : <div>ninguno</div>}</div>
      <div className="traz-sum"><span>Por colada (lote)</span>{Object.entries(porLote).slice(0, 8).map(([l, [n, r]]) => <div key={l}><b>{r}/{n}</b>{l}</div>)}</div>
      <p className="traz-nota">Las celdas en rojo están fuera de lo habitual: colada &lt; 1405 °C, humedad &gt; 4,3 %, sin inocular, desmoldeo &gt; 700 °C o desviación &gt; 0,2 mm. Para buscar una pieza concreta o retirar una colada, usa los métodos OPC UA <code>ConsultarPieza</code> y <code>PiezasDelLote</code>.</p>
    </div>
    <div className="traz-main">
      <div className="traz-filtro"><button className={filtro === "todas" ? "active" : ""} onClick={() => setFiltro("todas")}>TODAS</button><button className={filtro === "rechazos" ? "active" : ""} onClick={() => setFiltro("rechazos")}>SOLO RECHAZOS</button></div>
      <table className="traz-table"><thead><tr><th>Pieza</th><th>Colada</th><th>Molde</th><th>T colada</th><th>Humedad</th><th>Inoc.</th><th>Túnel</th><th>T desmoldeo</th><th>Desviación</th><th>Resultado</th><th>Defecto</th></tr></thead>
        <tbody>{lista.slice(0, 60).map((p) => <tr key={p.Id} className={p.Resultado !== "OK" ? "rechazo" : ""}>
          <td>{p.Id}</td><td>{p.Lote}</td><td>{p.Molde} <small>{p.Prensa}</small></td>
          <td className={alerta((p.TemperaturaColada ?? 9999) < 1405)}>{fmt(p.TemperaturaColada, 0, "°C")}</td>
          <td className={alerta((p.HumedadArena ?? 0) > 4.3)}>{fmt(p.HumedadArena, 2, "%")}</td>
          <td className={alerta(p.Inoculada === false)}>{p.Inoculada ? "sí" : "no"}</td>
          <td>{fmt(p.TiempoEnfriamiento, 0, "min")}</td>
          <td className={alerta((p.TemperaturaDesmoldeo ?? 0) > 700)}>{fmt(p.TemperaturaDesmoldeo, 0, "°C")}</td>
          <td className={alerta((p.Desviacion ?? 0) > 0.2)}>{fmt(p.Desviacion, 3, "mm")}</td>
          <td><span className={`res ${p.Resultado === "OK" ? "ok" : "mal"}`}>{p.Resultado}</span></td><td>{p.Defecto}</td>
        </tr>)}{!lista.length && <tr><td colSpan={11} className="vacio">Esperando piezas de QC-01…</td></tr>}</tbody></table>
    </div>
  </div>;
}

/* ─────────────────────────── página ─────────────────────────── */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedId, setSelectedId] = useState("if-01");
  const [vista, setVista] = useState<"3d" | "sinoptico" | "trazabilidad">("3d");
  const [running, setRunning] = useState(true);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [tab, setTab] = useState<"telemetry" | "tags" | "maintenance">("telemetry");
  const [camara, setCamara] = useState("general");
  const [eventos, setEventos] = useState<Evento[]>([]);
  const selected = useMemo(() => assets.find((a) => a.id === selectedId) ?? assets[0], [selectedId]);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const { live, snap, history, larga, piezas, escribir } = useOpcUaLive();
  const s: Snap = live ? snap : null;
  useFoundryScene(canvasRef, onSelect, running, Number(s?.sim?.Velocidad ?? 1), s ?? null);

  /* eventos: cambios de estado de los activos, averías inyectadas y piezas rechazadas */
  const previo = useRef<{ est: Record<string, string>; averia?: number; pieza?: string }>({ est: {} });
  const nEvento = useRef(0);
  useEffect(() => {
    if (!s) return;
    const nuevos: Evento[] = [];
    const hora = horaSim(s.sim?.TiempoSimulado);
    const add = (sev: Evento["sev"], titulo: string, detalle: string) => nuevos.push({ id: ++nEvento.current, hora, sev, titulo, detalle });
    for (const a of assets) {
      const e = String(val(s, a.short, "Estado") ?? "");
      const antes = previo.current.est[a.short];
      if (antes !== undefined && e !== antes && (e === "ALARM" || e === "WARN" || antes === "ALARM" || antes === "WARN")) {
        add(e === "ALARM" ? "critical" : e === "WARN" ? "warning" : "info", `${a.short} · ${ESTADO_TXT[e] ?? e}`, `${a.name} · antes: ${ESTADO_TXT[antes] ?? antes}`);
      }
      previo.current.est[a.short] = e;
    }
    const av = s.sim?.Averia;
    if (previo.current.averia !== undefined && av !== previo.current.averia) {
      add(av ? "warning" : "info", av ? `Avería inyectada: ${s.sim?.AveriaNombre}` : "Avería retirada", `Mantenimiento.Averia = ${av}`);
    }
    previo.current.averia = av;
    const t = s.traz;
    if (t?.Id && t.Id !== previo.current.pieza) {
      if (previo.current.pieza && t.Resultado !== "OK") add("warning", `Pieza rechazada ${t.Id}`, `${t.Defecto} · colada ${t.Lote} · ${t.Molde}`);
      previo.current.pieza = t.Id;
    }
    if (nuevos.length) setEventos((ev) => [...nuevos.reverse(), ...ev].slice(0, 60));
  }, [s]);

  // al volver a la vista 3D, la escena recalcula su tamaño (estaba oculta)
  useEffect(() => { if (vista === "3d") { const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 30); return () => clearTimeout(t); } }, [vista]);

  const la = s?.assets?.[selected.short];
  const st = (la?.Estado?.v as AssetStatus | undefined) ?? "IDLE";
  const temp = num(s, selected.short, "TemperaturaMetal") ?? num(s, selected.short, "TemperaturaColada") ?? num(s, selected.short, "TemperaturaMolde") ?? num(s, selected.short, "Temperatura");
  const pot = num(s, selected.short, "PotenciaBobina") ?? num(s, selected.short, "Potencia");
  const heroHist = useMemo(() => history.map((h) => {
    const a = h.assets[selected.short];
    const t = a && (a.TemperaturaMetal ?? a.TemperaturaColada ?? a.TemperaturaMolde ?? a.Temperatura);
    return typeof t?.v === "number" ? t.v : NaN;
  }), [history, selected.short]);
  const fmtTag = (lv: LiveValue | undefined) => lv == null ? "—" : typeof lv.v === "boolean" ? (lv.v ? "TRUE" : "FALSE") : typeof lv.v === "number" ? lv.v.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : String(lv.v);
  const cuenta = (e: AssetStatus) => assets.filter((a) => estado(s, a.short) === e).length;
  const activas = cuenta("ALARM") + cuenta("WARN");
  const serie = (k: keyof Punto) => larga.slice(-120).map((p) => p[k] as number);
  const tOee = tendencia(larga, "oee"), tConf = tendencia(larga, "conf"), tEn = tendencia(larga, "energia", 0);
  const sal = salud(s, selected.short);
  const ot = ordenTrabajo(s);
  const peso = num(s, "COL-01", "PesoCuchara");
  const pasos: [string, string, string, string, string][] = [
    ["01", "Carga y fusión", `IF-01 ${fmt(num(s, "IF-01", "TemperaturaMetal"), 0)} · IF-02 ${fmt(num(s, "IF-02", "TemperaturaMetal"), 0, "°C")}`, "if-01", "IF-01"],
    ["02", "Preparación arena", `Humedad ${fmt(num(s, "MP-01", "HumedadArena"), 2, "%")}`, "mp-01", "MP-01"],
    ["03", "Moldeo y machos", `Ciclo ${fmt(num(s, "MP-01", "TiempoCiclo"), 1, "s")} · ${fmt(num(s, "ROB-03", "MachosColocados"), 0)} machos`, "rob-03", "ROB-03"],
    ["04", "Colada automática", `${val(s, "COL-01", "CambioCuchara") === true ? "Cambio de cuchara" : `${fmt(peso, 0, "kg")} a ${fmt(num(s, "COL-01", "TemperaturaColada"), 0, "°C")}`}`, "pour-01", "COL-01"],
    ["05", "Enfriamiento", `${fmt(num(s, "ENF-01", "MoldesEnTunel"), 0)} moldes · ${fmt(num(s, "ENF-01", "TiempoResidencia"), 0, "min")}`, "cool-01", "ENF-01"],
    ["06", "Desmoldeo", `${val(s, "DES-01", "Marcha") === true ? "Vibrando" : "En espera"} · ${fmt(num(s, "DES-01", "Vibracion"), 1, "mm/s")}`, "shake-01", "DES-01"],
    ["07", "Calidad", `${fmt(kpi(s, "PiezasConformes"), 1, "%")} conformes`, "qc-01", "QC-01"],
  ];
  const trend = larga.slice(-900);
  const trendPath = (k: keyof Punto, min: number, max: number) => trend.map((p, i) => `${i ? "L" : "M"} ${(i / Math.max(1, trend.length - 1)) * 800} ${100 - ((Math.max(min, Math.min(max, p[k] as number)) - min) / (max - min)) * 100}`).join(" ");

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><i /><i /><i /></span><div><b>FERRO<span>VIA</span></b><small>DIGITAL FOUNDRY</small></div></div>
      <nav>
        <button className={vista === "3d" ? "active" : ""} onClick={() => setVista("3d")}>PLANTA 3D</button>
        <button className={vista === "sinoptico" ? "active" : ""} onClick={() => setVista("sinoptico")}>SINÓPTICO</button>
        <button className={vista === "trazabilidad" ? "active" : ""} onClick={() => setVista("trazabilidad")}>TRAZABILIDAD</button>
      </nav>
      <div className="header-actions">
        <button className="protocol" onClick={() => setProtocolOpen(true)}><span className="live-dot" style={live ? undefined : { background: "#ffb84d", boxShadow: "0 0 9px #ffb84d" }} />{live ? <>OPC UA · S7 <small>EN VIVO</small></> : <>OPC UA <small>SIN CONEXIÓN</small></>}</button>
        <button className="icon-button" aria-label="Alarmas activas" onClick={() => setVista("3d")}>{activas ? "●" : "○"}<span className="badge">{activas}</span></button>
        <div className="operator"><span>A</span><div><b>Turno A</b><small>PLANTA NORTE</small></div></div>
      </div>
    </header>

    <section className="plant-title">
      <div><span className="eyebrow">GEMELO DIGITAL / PLANTA NORTE</span><h1>Fundición de hierro <em>en tiempo real</em></h1></div>
      <div className="clock"><span>TURNO DESDE LAS 06:00</span><b>{horaSim(s?.sim?.TiempoSimulado)}</b><small>HORA SIMULADA</small></div>
      <div className="sim-controls">
        <button onClick={() => setRunning((v) => !v)} className={running ? "pause" : "play"} title="Congela solo la animación de esta vista">{running ? "Ⅱ  CONGELAR VISTA" : "▶  ANIMAR"}</button>
        <label>VELOCIDAD<select value={String(s?.sim?.Velocidad ?? 1)} disabled={!live} onChange={(e) => escribir("Simulacion.Velocidad", Number(e.target.value))}>{[1, 2, 5, 10, 20].map((v) => <option key={v} value={v}>{v}×</option>)}</select></label>
        <label className={s?.sim?.Averia ? "averia activa" : "averia"}>AVERÍA<select value={String(s?.sim?.Averia ?? 0)} disabled={!live} onChange={(e) => escribir("Mantenimiento.Averia", Number(e.target.value))}>{AVERIAS.map((n, i) => <option key={i} value={i}>{i} · {n}</option>)}</select></label>
      </div>
    </section>

    <section className="metrics-row">
      <Metric label="OEE PLANTA" value={fmt(kpi(s, "OEEPlanta"), 1, "%")} delta={tOee.txt} tone={(kpi(s, "OEEPlanta") ?? 100) < 75 ? "warn" : "good"} points={serie("oee")} />
      <Metric label="PRODUCCIÓN TURNO" value={fmt(kpi(s, "ProduccionTurno"), 1, "t")} delta={`${fmt(kpi(s, "VelocidadLinea"), 1)} m/min`} points={serie("prod")} />
      <Metric label="PIEZAS CONFORMES" value={fmt(kpi(s, "PiezasConformes"), 1, "%")} delta={tConf.txt} tone={(kpi(s, "PiezasConformes") ?? 100) < 95 ? "warn" : "good"} points={serie("conf")} />
      <Metric label="ENERGÍA ESPECÍFICA" value={fmt(kpi(s, "EnergiaEspecifica"), 0, "kWh/t")} delta={tEn.txt} tone={tEn.sube ? "warn" : "good"} points={serie("energia")} />
      <Metric label="CO₂ ESTIMADO" value={fmt(kpi(s, "CO2Estimado"), 3, "t/t")} delta="por t colada" points={serie("energia")} />
      <div className="batch-card"><span>COLADA EN LA CUCHARA</span><b>{String(s?.kpis?.LoteActivo?.v ?? "—")}</b><small>EN-GJS-500-7 · {fmt(peso, 0, "kg")} · {fmt(num(s, "COL-01", "TemperaturaColada"), 0, "°C")}</small><div><i style={{ width: `${Math.min(100, ((peso ?? 0) / 1450) * 100)}%` }} /><em>{fmt(((peso ?? 0) / 1450) * 100, 0, "%")}</em></div></div>
    </section>

    <section className="workspace">
      <aside className="process-panel panel">
        <div className="panel-heading"><div><span>FLUJO DE PROCESO</span><b>7 etapas · en vivo</b></div></div>
        <div className="process-list">{pasos.map((p) => { const e = estado(s, p[4]); return <button key={p[0]} onClick={() => setSelectedId(p[3])} className={`${e === "ALARM" ? "alarm" : e === "WARN" ? "warn" : e === "IDLE" ? "idle" : "active"} ${selectedId === p[3] ? "selected" : ""}`}><span className="step-no">{p[0]}</span><span><b>{p[1]}</b><small>{p[2]}</small></span><i /></button>; })}</div>
        <div className="recipe"><span>ÚLTIMA PIEZA · QC-01</span><div><b>{s?.traz?.Id ?? "—"}</b><small>{s?.traz?.Resultado ? `${s.traz.Resultado} · ${s.traz.Defecto}` : "esperando…"}</small></div><dl><div><dt>°C col.</dt><dd>{fmt(s?.traz?.TemperaturaColada, 0)}</dd></div><div><dt>Hum. %</dt><dd>{fmt(s?.traz?.HumedadArena, 1)}</dd></div><div><dt>Túnel′</dt><dd>{fmt(s?.traz?.TiempoEnfriamiento, 0)}</dd></div><div><dt>mm</dt><dd>{fmt(s?.traz?.Desviacion, 2)}</dd></div></dl><button onClick={() => setVista("trazabilidad")}>VER TRAZABILIDAD →</button></div>
      </aside>

      <section className={`scene-panel panel ${vista === "3d" ? "" : "oculta"}`}>
        <div className="scene-toolbar"><div><span className="live-dot" />ESCENA EN VIVO <small>OPC UA + S7</small></div><div className="vistas">{[["general", "GENERAL"], ["fusion", "FUSIÓN"], ["colada", "COLADA"], ["acabado", "ACABADO"]].map(([k, t]) => <button key={k} title={`Vista ${t.toLowerCase()}`} className={camara === k ? "active" : ""} onClick={() => { setCamara(k); window.dispatchEvent(new CustomEvent("fundicion:camara", { detail: k })); }}>{t}</button>)}</div></div>
        <canvas ref={canvasRef} />
        <div className={`zone-labels ${camara === "general" ? "" : "oculta"}`}><span className="z-fusion">FUSIÓN<small>{String(val(s, "IF-01", "Fase") ?? "—")} · {String(val(s, "IF-02", "Fase") ?? "—")}</small></span><span className="z-moldeo">MOLDEO<small>{fmt(num(s, "MP-01", "HumedadArena"), 1, "%")} HUMEDAD</small></span><span className="z-colada">COLADA<small>{val(s, "COL-01", "CambioCuchara") === true ? "CAMBIO DE CUCHARA" : fmt(peso, 0, "kg")}</small></span><span className="z-cooling">ENFRIAMIENTO<small>{fmt(num(s, "ENF-01", "MoldesEnTunel"), 0)} MOLDES</small></span><span className="z-quality">CALIDAD<small>{fmt(kpi(s, "PiezasConformes"), 1, "%")} OK</small></span></div>
        <div className="scene-legend"><span><i className="run" />Operativo {cuenta("RUN")}</span><span><i className="warn" />Aviso {cuenta("WARN")}</span><span><i className="alarm" />Alarma {cuenta("ALARM")}</span><span><i className="idle" />Espera {cuenta("IDLE")}</span></div>
        <div className="scene-tip">ARRASTRA PARA ORBITAR · RUEDA PARA ZOOM · SELECCIONA UNA MÁQUINA</div>
      </section>
      {vista === "sinoptico" && <section className="scene-panel panel syn-panel"><div className="scene-toolbar"><div><span className="live-dot" />SINÓPTICO DE OPERADOR <small>PULSA UN EQUIPO PARA VER SU DETALLE</small></div></div><Sinoptico s={s} onSelect={onSelect} /></section>}
      {vista === "trazabilidad" && <section className="scene-panel panel syn-panel"><Trazabilidad piezas={piezas} /></section>}

      <aside className="asset-panel panel">
        <div className="asset-head"><div><span className={`status-pill ${st === "ALARM" ? "alarm" : st === "WARN" ? "warn" : ""}`}>{s ? st : "—"}</span><small>{selected.short}</small></div></div>
        <h2>{selected.name}</h2><p>{selected.plc}<br />{live ? `OPC UA · ns=1;s=${selected.short}.* · S7 en los DB de su PLC` : "Sin conexión con el puente OPC UA"}</p>
        <div className="asset-tabs"><button className={tab === "telemetry" ? "active" : ""} onClick={() => setTab("telemetry")}>TELEMETRÍA</button><button className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}>TAGS S7</button><button className={tab === "maintenance" ? "active" : ""} onClick={() => setTab("maintenance")}>SALUD</button></div>
        {tab === "telemetry" && <><div className="hero-reading"><span>{selected.zone === "Fusión" || selected.zone === "Colada" ? "TEMPERATURA METAL" : "TEMPERATURA"}</span><b>{fmt(temp, 0, "°C")}</b><small>{live ? "OPC UA en vivo · muestreo 1 s" : "—"}</small><Sparkline points={heroHist} /></div>
          <div className="telemetry-grid"><div><span>POTENCIA</span><b>{pot == null ? "—" : pot >= 1000 ? fmt(pot / 1000, 2, "MW") : fmt(pot, 1, "kW")}</b></div><div><span>CICLO / CARGA</span><b>{fmt(num(s, selected.short, "NivelCarga") ?? num(s, selected.short, "TiempoCiclo") ?? num(s, selected.short, "TiempoResidencia"), 1)}</b></div><div><span>VIBRACIÓN</span><b>{fmt(num(s, selected.short, "Vibracion"), 2, "mm/s")}</b></div><div><span>PRESIÓN</span><b>{fmt(num(s, selected.short, "Presion"), 1)}</b></div><div><span>OEE ACTIVO</span><b>{fmt(num(s, selected.short, "OEE"), 1, "%")}</b></div><div><span>CALIDAD DATO</span><b>{live ? "GOOD · OPC UA" : "—"}</b></div></div></>}
        {tab === "tags" && <div className="tag-list"><div className="tag-head"><span>SÍMBOLO · VALOR</span><span>DIRECCIÓN S7</span></div>{selected.tags.map((t) => <div key={t[0]}><span><i />{t[0]}<em className="tag-val">{fmtTag(s?.tags[selected.short]?.[t[0]])}</em></span><code>{t[1]}</code></div>)}<button onClick={() => setProtocolOpen(true)}>CÓMO LEERLAS POR S7 →</button></div>}
        {tab === "maintenance" && <div className="health"><div className="health-ring" style={{ borderColor: sal.valor < 50 ? "#ff5c5c" : sal.valor < 80 ? "#ffb84d" : undefined }}><b>{s ? sal.valor : "—"}</b><span>SALUD</span></div><ul>{sal.filas.map(([k, v]) => <li key={k}><span>{k}</span><b>{v}</b></li>)}<li><span>Estado</span><b>{ESTADO_TXT[st] ?? "—"}</b></li></ul></div>}
        <div className="work-order"><span>PRÓXIMA ORDEN</span><b>{ot.t}</b><small>{ot.d}</small></div>
      </aside>
    </section>

    <section className="bottom-grid">
      <div className="panel trend-panel"><div className="panel-heading"><div><span>TENDENCIA</span><b>Última media hora (muestras cada 2 s)</b></div><div className="trend-legend"><span><i />OEE (50–100 %)</span><span><i />conformes (50–100 %)</span></div></div>
        <div className="trend-chart"><div className="y-axis"><span>100</span><span>83</span><span>67</span><span>50</span></div><svg viewBox="0 0 800 100" preserveAspectRatio="none"><path className="target" d={`M0 ${100 - ((75 - 50) / 50) * 100} L800 ${100 - ((75 - 50) / 50) * 100}`} />{trend.length > 1 && <><path className="line" d={trendPath("oee", 50, 100)} /><path className="line conf" d={trendPath("conf", 50, 100)} /></>}</svg><div className="x-axis"><span>−30 min</span><span>−20 min</span><span>−10 min</span><span>ahora</span></div></div></div>
      <div className="panel events-panel"><div className="panel-heading"><div><span>EVENTOS Y ALARMAS</span><b>{activas} activos con aviso o alarma · {eventos.length} eventos</b></div></div>
        <div className="event-list">{eventos.slice(0, 6).map((e) => <div key={e.id} className={`event ${e.sev}`}><i /><time>{e.hora}</time><span><b>{e.titulo}</b><small>{e.detalle}</small></span><em>{e.sev === "critical" ? "ALTA" : e.sev === "warning" ? "MEDIA" : "INFO"}</em></div>)}{!eventos.length && <div className="event info"><i /><time>—</time><span><b>Sin eventos</b><small>Los cambios de estado, las averías y los rechazos aparecerán aquí</small></span><em>INFO</em></div>}</div></div>
    </section>

    {protocolOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setProtocolOpen(false); }}><section className="protocol-modal"><button className="modal-close" onClick={() => setProtocolOpen(false)}>×</button><span className="eyebrow">CONECTIVIDAD OT / IT DEL LABORATORIO</span><h2>El mismo dato por dos caminos</h2><p className="modal-intro">El motor de proceso calcula la planta una vez y la publica por OPC UA (con nombre, unidad, alarmas, métodos e histórico) y por S7 (bytes en los bloques de datos de su PLC). Este gemelo digital la recibe del puente OPC UA → WebSocket.</p>
      <div className="architecture"><div><span>OPC UA</span><b>opc.tcp://…:4841/UA/Fundicion</b><small>ns=1;s=IF-01.TemperaturaMetal<br />Double · °C · alarmas · histórico</small></div><i>⇄</i><div className="gateway-box"><span>PLC S7 SIMULADO</span><b>fundicion-s7 · puerto 102</b><small>rack 0 · slot 1<br />DB10.DBD0 = REAL de 32 bits</small></div><i>→</i><div><span>GEMELO DIGITAL</span><b>Puente WebSocket :8081</b><small>snapshot cada 1 s<br />órdenes con lista cerrada</small></div></div>
      <div className="protocol-columns"><div><h3>Qué cambia entre uno y otro</h3><ul><li>OPC UA: nombres, unidades, tipos y estructura</li><li>S7: direcciones que hay que conocer (DB, offset, tipo)</li><li>OPC UA: suscripción, alarmas y métodos</li><li>S7: lectura periódica de bytes</li></ul></div><div><h3>Órdenes desde esta página</h3><dl><div><dt>Velocidad</dt><dd>Simulacion.Velocidad</dd></div><div><dt>Avería</dt><dd>Mantenimiento.Averia</dd></div><div><dt>Por S7</dt><dd>DB100.DBW0 / DBW2</dd></div><div><dt>Seguridad</dt><dd>Lista cerrada en el puente</dd></div></dl></div></div>
      <div className="modal-footer"><span><i className="live-dot" />{live ? "OPC UA EN VIVO · opc.tcp 4841 → ws 8081" : "SIN CONEXIÓN CON EL PUENTE OPC UA (ws 8081)"}</span><button onClick={() => setProtocolOpen(false)}>ENTENDIDO</button></div></section></div>}
  </main>;
}
