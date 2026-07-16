"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFoundryScene } from "./foundry-scene";
import { useOpcUaLive, fmtLive, type LiveValue } from "./use-opcua-live";

type AssetStatus = "RUN" | "WARN" | "IDLE" | "ALARM";
type Asset = {
  id: string;
  short: string;
  name: string;
  zone: string;
  status: AssetStatus;
  cycle: string;
  temp: string;
  power: string;
  vibration: string;
  pressure: string;
  oee: string;
  plc: string;
  tags: [string, string][];
};

const assets: Asset[] = [
  { id: "if-01", short: "IF-01", name: "Horno de inducción 01", zone: "Fusión", status: "RUN", cycle: "68%", temp: "1.487 °C", power: "1.84 MW", vibration: "2.1 mm/s", pressure: "-12 Pa", oee: "91.2%", plc: "PLC-FUS-01 · S7-1515", tags: [["Metal.Temp", "DB10.DBD0"], ["Coil.Power", "DB10.DBD8"], ["Tilt.Angle", "DB11.DBD4"], ["ReadyToPour", "DB11.DBX12.0"]] },
  { id: "if-02", short: "IF-02", name: "Horno de inducción 02", zone: "Fusión", status: "WARN", cycle: "42%", temp: "1.362 °C", power: "1.46 MW", vibration: "3.8 mm/s", pressure: "-9 Pa", oee: "84.7%", plc: "PLC-FUS-01 · S7-1515", tags: [["Metal.Temp", "DB10.DBD20"], ["Coil.Power", "DB10.DBD28"], ["Cooling.Flow", "DB12.DBD0"], ["Alarm.Word", "DB90.DBW4"]] },
  { id: "mp-01", short: "MP-01", name: "Prensa de moldeo superior", zone: "Moldeo", status: "RUN", cycle: "18.4 s", temp: "46 °C", power: "72 kW", vibration: "1.7 mm/s", pressure: "6.2 bar", oee: "88.9%", plc: "PLC-MOL-01 · S7-1512", tags: [["Cycle.Time", "DB20.DBD0"], ["Press.Force", "DB20.DBD8"], ["Sand.Moisture", "DB21.DBD4"], ["Mould.OK", "DB22.DBX0.2"]] },
  { id: "mp-02", short: "MP-02", name: "Prensa de moldeo inferior", zone: "Moldeo", status: "RUN", cycle: "18.1 s", temp: "44 °C", power: "68 kW", vibration: "1.5 mm/s", pressure: "6.0 bar", oee: "90.1%", plc: "PLC-MOL-01 · S7-1512", tags: [["Cycle.Time", "DB20.DBD20"], ["Press.Force", "DB20.DBD28"], ["Sand.Density", "DB21.DBD16"], ["Mould.OK", "DB22.DBX0.3"]] },
  { id: "pour-01", short: "COL-01", name: "Estación de colada automática", zone: "Colada", status: "RUN", cycle: "31.2 s", temp: "1.421 °C", power: "38 kW", vibration: "0.8 mm/s", pressure: "—", oee: "86.5%", plc: "PLC-COL-01 · S7-1516F", tags: [["Ladle.Weight", "DB30.DBD0"], ["Pour.Temp", "DB30.DBD8"], ["Flow.Rate", "DB31.DBD0"], ["Safety.Zone", "DB32.DBX1.0"]] },
  { id: "rob-01", short: "ROB-01", name: "Robot de inoculación y escoriado", zone: "Colada", status: "RUN", cycle: "24.5 s", temp: "41 °C", power: "9 kW", vibration: "0.4 mm/s", pressure: "6.0 bar", oee: "93.6%", plc: "PLC-COL-01 · S7-1516F", tags: [["Axis.J1..J6", "DB35.DBD0"], ["TCP.Speed", "DB35.DBD24"], ["Program.No", "DB35.DBW30"], ["Cell.Safe", "DB36.DBX0.0"]] },
  { id: "rob-03", short: "ROB-03", name: "Robot posicionador de machos", zone: "Moldeo", status: "RUN", cycle: "16.8 s", temp: "38 °C", power: "7 kW", vibration: "0.3 mm/s", pressure: "6.2 bar", oee: "95.1%", plc: "PLC-MOL-01 · S7-1512", tags: [["Axis.J1..J6", "DB25.DBD0"], ["Grip.Closed", "DB25.DBX28.0"], ["Core.Present", "DB25.DBX28.1"], ["Cell.Safe", "DB26.DBX0.0"]] },
  { id: "cool-01", short: "ENF-01", name: "Túnel de enfriamiento", zone: "Enfriamiento", status: "RUN", cycle: "47 min", temp: "612 °C", power: "54 kW", vibration: "1.2 mm/s", pressure: "1.8 kPa", oee: "94.3%", plc: "PLC-LIN-01 · ET200SP", tags: [["Mould.Temp", "DB40.DBD0"], ["Residence.Time", "DB40.DBD8"], ["Fan.Speed", "DB41.DBD0"], ["Exit.Ready", "DB42.DBX0.0"]] },
  { id: "shake-01", short: "DES-01", name: "Desmoldeo vibratorio", zone: "Acabado", status: "IDLE", cycle: "22.8 s", temp: "88 °C", power: "110 kW", vibration: "8.6 mm/s", pressure: "4.8 bar", oee: "81.6%", plc: "PLC-ACA-01 · S7-1512", tags: [["Vib.Frequency", "DB50.DBD0"], ["Motor.Current", "DB50.DBD8"], ["Dust.FilterDP", "DB51.DBD4"], ["Part.Present", "DB52.DBX0.0"]] },
  { id: "rob-02", short: "ROB-02", name: "Robot de manipulación de piezas", zone: "Acabado", status: "RUN", cycle: "21.2 s", temp: "44 °C", power: "11 kW", vibration: "0.5 mm/s", pressure: "6.1 bar", oee: "92.4%", plc: "PLC-ACA-01 · S7-1512", tags: [["Axis.J1..J6", "DB55.DBD0"], ["Payload.Kg", "DB55.DBD24"], ["Pick.Count", "DB55.DBD28"], ["Cell.Safe", "DB56.DBX0.0"]] },
  { id: "qc-01", short: "QC-01", name: "Célula de calidad 3D", zone: "Calidad", status: "RUN", cycle: "14.6 s", temp: "24 °C", power: "12 kW", vibration: "0.2 mm/s", pressure: "6.1 bar", oee: "97.8%", plc: "PLC-QA-01 · S7-1500", tags: [["Scan.Deviation", "DB60.DBD0"], ["Part.Weight", "DB60.DBD8"], ["Defect.Class", "DB61.DBW0"], ["Part.Accepted", "DB62.DBX0.0"]] },
];

const processSteps = [
  ["01", "Carga y fusión", "2 hornos · 18,4 t", "active"],
  ["02", "Preparación arena", "Humedad 3,2%", "active"],
  ["03", "Moldeo cope / drag", "3 moldes en cola", "active"],
  ["04", "Colada automática", "Lote FE-260713-084", "active"],
  ["05", "Enfriamiento", "12 moldes · 47 min", "active"],
  ["06", "Desmoldeo y granalla", "Próximo en 02:18", "idle"],
  ["07", "Calidad y expedición", "98,4% conformes", "active"],
];


function Sparkline({ color = "#34d6a0", points = [16,24,18,31,28,40,35,42,38,51,46,54] }: { color?: string; points?: number[] }) {
  const max=Math.max(...points),min=Math.min(...points);const d=points.map((p,i)=>`${i===0?"M":"L"} ${i*(100/(points.length-1))} ${34-((p-min)/(max-min||1))*28}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/><path d={`${d} L 100 36 L 0 36 Z`} fill={color} opacity=".08"/></svg>;
}

function Metric({label,value,delta,tone}:{label:string;value:string;delta:string;tone?:string}) {return <div className="metric"><div className="metric-label">{label}</div><div className="metric-row"><strong>{value}</strong><span className={tone||"good"}>{delta}</span></div><Sparkline color={tone==="warn"?"#ffb84d":"#32d59b"}/></div>;}

export default function Home() {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const [selectedId,setSelectedId]=useState("if-01");
  const [running,setRunning]=useState(true);
  const [speed,setSpeed]=useState(1);
  const [simTime,setSimTime]=useState(new Date(2026,6,13,14,32,18));
  const [protocolOpen,setProtocolOpen]=useState(false);
  const [alarm,setAlarm]=useState(false);
  const [tab,setTab]=useState<"telemetry"|"tags"|"maintenance">("telemetry");
  const selected=useMemo(()=>assets.find(a=>a.id===selectedId)??assets[0],[selectedId]);
  const onSelect=useCallback((id:string)=>setSelectedId(id),[]);
  // Telemetría en vivo desde el puente OPC UA -> WebSocket (fallback: valores estáticos)
  const { live, snap, history } = useOpcUaLive();
  // La escena 3D se anima con los datos OPC UA (colada, balizas, fases, ritmos)
  useFoundryScene(canvasRef,onSelect,running,speed,live?snap:null);
  useEffect(()=>{if(!running)return;const i=setInterval(()=>setSimTime(t=>new Date(t.getTime()+1000*speed)),1000);return()=>clearInterval(i);},[running,speed]);
  const injectAlarm=()=>{setAlarm(v=>!v);if(!alarm)setSelectedId("if-02");};
  const la = live ? snap?.assets[selected.short] : undefined;
  const liveTempLV = la && (la.TemperaturaMetal ?? la.TemperaturaColada ?? la.TemperaturaMolde ?? la.Temperatura);
  const liveTemp = fmtLive(liveTempLV, 0);
  const livePower = (() => {
    const p = la && (la.PotenciaBobina ?? la.Potencia);
    if (!p || typeof p.v !== "number") return null;
    return p.v >= 1000 ? `${(p.v / 1000).toLocaleString("es-ES", { maximumFractionDigits: 2 })} MW` : `${p.v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} kW`;
  })();
  const liveCycle = la ? fmtLive(la.NivelCarga ?? la.TiempoCiclo ?? la.TiempoResidencia, 1) : null;
  const liveStatus = (la?.Estado?.v as AssetStatus | undefined) ?? selected.status;
  const k = live ? snap?.kpis : undefined;
  // histórico corto de la variable principal para el sparkline del panel
  const heroHist = useMemo(() => (live ? history : [])
    .map(s => { const a = s.assets[selected.short]; const t = a && (a.TemperaturaMetal ?? a.TemperaturaColada ?? a.TemperaturaMolde ?? a.Temperatura); return typeof t?.v === "number" ? t.v : null; })
    .filter((v): v is number => v != null), [history, live, selected.short]);
  const fmtTag = (lv: LiveValue | undefined) => lv == null ? null : typeof lv.v === "boolean" ? (lv.v ? "TRUE" : "FALSE") : typeof lv.v === "number" ? lv.v.toLocaleString("es-ES", { maximumFractionDigits: 1 }) : String(lv.v);

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><i/><i/><i/></span><div><b>FERRO<span>VIA</span></b><small>DIGITAL FOUNDRY</small></div></div>
      <nav><button className="active">PLANTA 3D</button><button>PRODUCCIÓN</button><button>CALIDAD</button><button>MANTENIMIENTO</button><button>ENERGÍA</button></nav>
      <div className="header-actions"><button className="protocol" onClick={()=>setProtocolOpen(true)}><span className="live-dot" style={live?undefined:{background:"#ffb84d",boxShadow:"0 0 9px #ffb84d"}}/>{live?<>OPC UA <small>EN VIVO · 4840</small></>:<>OPC UA <small>SIN CONEXIÓN</small></>}</button><button className="icon-button" aria-label="Notificaciones">{alarm?"●":"○"}<span className="badge">{alarm?3:2}</span></button><div className="operator"><span>JM</span><div><b>J. Martínez</b><small>JEFE DE TURNO · A</small></div></div></div>
    </header>

    <section className="plant-title">
      <div><span className="eyebrow">GEMELO DIGITAL / PLANTA NORTE</span><h1>Fundición de hierro <em>en tiempo real</em></h1></div>
      <div className="clock"><span>{simTime.toLocaleDateString("es-ES",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}</span><b>{simTime.toLocaleTimeString("es-ES")}</b><small>HORA SIMULADA</small></div>
      <div className="sim-controls"><button onClick={()=>setRunning(v=>!v)} className={running?"pause":"play"}>{running?"Ⅱ  PAUSAR":"▶  INICIAR"}</button><label>VELOCIDAD<select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={12}>12×</option></select></label><button className={alarm?"alarm active":"alarm"} onClick={injectAlarm}>{alarm?"RESTABLECER":"INYECTAR FALLO"}</button></div>
    </section>

    <section className="metrics-row">
      <Metric label="OEE PLANTA" value={alarm?"81,6%":fmtLive(k?.OEEPlanta,1)??"87,4%"} delta={alarm?"▼ 5,8%":"▲ 2,1%"} tone={alarm?"warn":"good"}/>
      <Metric label="PRODUCCIÓN TURNO" value={fmtLive(k?.ProduccionTurno,1)??"186 t"} delta="72% objetivo"/>
      <Metric label="PIEZAS CONFORMES" value={fmtLive(k?.PiezasConformes,1)??"98,4%"} delta="▲ 0,6%"/>
      <Metric label="ENERGÍA ESPECÍFICA" value={fmtLive(k?.EnergiaEspecifica,0)??"548 kWh/t"} delta="▼ 18 kWh/t"/>
      <Metric label="CO₂ ESTIMADO" value={fmtLive(k?.CO2Estimado,3)??"0,42 t/t"} delta="▼ 3,4%"/>
      <div className="batch-card"><span>LOTE ACTIVO</span><b>{(k?.LoteActivo?.v as string)??"FE-260713-084"}</b><small>EN-GJS-500-7 · 12.480 kg</small><div><i style={{width:"68%"}}/><em>68%</em></div></div>
    </section>

    <section className="workspace">
      <aside className="process-panel panel">
        <div className="panel-heading"><div><span>FLUJO DE PROCESO</span><b>7 etapas</b></div><button aria-label="Opciones">•••</button></div>
        <div className="process-list">{processSteps.map((s,i)=><button key={s[0]} onClick={()=>{const map=["if-01","if-01","mp-01","pour-01","cool-01","shake-01","qc-01"];setSelectedId(map[i]);}} className={`${s[3]} ${selected.zone===s[1].split(" ")[0]?"selected":""}`}><span className="step-no">{s[0]}</span><span><b>{s[1]}</b><small>{s[2]}</small></span><i/></button>)}</div>
        <div className="recipe"><span>RECETA ACTIVA</span><div><b>EN-GJS-500-7</b><small>Hierro nodular</small></div><dl><div><dt>C</dt><dd>3,62%</dd></div><div><dt>Si</dt><dd>2,48%</dd></div><div><dt>Mg</dt><dd>0,041%</dd></div><div><dt>CE</dt><dd>4,45</dd></div></dl><button>VER TRAZABILIDAD →</button></div>
      </aside>

      <section className="scene-panel panel">
        <div className="scene-toolbar"><div><span className="live-dot"/>ESCENA EN VIVO <small>64 ACTIVOS · 1.284 SEÑALES</small></div><div><button title="Vista isométrica">◇</button><button title="Centrar vista">⌖</button><button title="Capas">▱</button><button title="Pantalla completa">⛶</button></div></div>
        <canvas ref={canvasRef}/>
        <div className="zone-labels"><span className="z-fusion">FUSIÓN<small>2 ACTIVOS</small></span><span className="z-moldeo">MOLDEO<small>5 ACTIVOS</small></span><span className="z-colada">COLADA<small>3 ACTIVOS</small></span><span className="z-cooling">ENFRIAMIENTO<small>12 MOLDES</small></span><span className="z-quality">CALIDAD<small>98,4% OK</small></span></div>
        <div className="scene-legend"><span><i className="run"/>Operativo 58</span><span><i className="warn"/>Atención 4</span><span><i className="idle"/>Espera 2</span></div>
        <div className="scene-tip">ARRASTRA PARA ORBITAR · RUEDA PARA ZOOM · SELECCIONA UNA MÁQUINA</div>
      </section>

      <aside className="asset-panel panel">
        <div className="asset-head"><div><span className={`status-pill ${alarm&&selected.id==="if-02"?"alarm":""}`}>{alarm&&selected.id==="if-02"?"ALARM":liveStatus}</span><small>{selected.short}</small></div><button aria-label="Cerrar">×</button></div>
        <h2>{selected.name}</h2><p>{selected.plc}<br/>{live?"OPC UA · ns=1;s="+selected.short+".* · 1 s":"Último dato hace 84 ms"}</p>
        <div className="asset-tabs"><button className={tab==="telemetry"?"active":""} onClick={()=>setTab("telemetry")}>TELEMETRÍA</button><button className={tab==="tags"?"active":""} onClick={()=>setTab("tags")}>TAGS S7</button><button className={tab==="maintenance"?"active":""} onClick={()=>setTab("maintenance")}>SALUD</button></div>
        {tab==="telemetry"&&<><div className="hero-reading"><span>{selected.zone==="Fusión"||selected.zone==="Colada"?"TEMPERATURA METAL":"VARIABLE PRINCIPAL"}</span><b>{liveTemp??selected.temp}</b><small>{live?"OPC UA en vivo · muestreo 1 s":"Rango operativo nominal"}</small><Sparkline points={heroHist.length>1?heroHist:[28,31,29,35,37,41,38,43,44,42,46,45,48,47]}/></div><div className="telemetry-grid"><div><span>POTENCIA</span><b>{livePower??selected.power}</b></div><div><span>CICLO / CARGA</span><b>{liveCycle??selected.cycle}</b></div><div><span>VIBRACIÓN</span><b>{fmtLive(la?.Vibracion,2)??selected.vibration}</b></div><div><span>PRESIÓN</span><b>{fmtLive(la?.Presion,2)??selected.pressure}</b></div><div><span>OEE ACTIVO</span><b>{fmtLive(la?.OEE,1)??selected.oee}</b></div><div><span>CALIDAD DATO</span><b>{live?"GOOD · OPC UA":"GOOD · 100%"}</b></div></div></>}
        {tab==="tags"&&<div className="tag-list"><div className="tag-head"><span>SÍMBOLO {live?"· VALOR":""}</span><span>DIRECCIÓN</span></div>{selected.tags.map(t=>{const tv=live?snap?.tags[selected.short]?.[t[0]]:undefined;return <div key={t[0]}><span><i/>{t[0]}{tv!=null&&<em className="tag-val">{fmtTag(tv)}</em>}</span><code>{t[1]}</code></div>;})}<button onClick={()=>setProtocolOpen(true)}>MAPA COMPLETO DE SEÑALES →</button></div>}
        {tab==="maintenance"&&<div className="health"><div className="health-ring"><b>92</b><span>SALUD</span></div><ul><li><span>Rodamientos</span><b>96%</b></li><li><span>Sistema eléctrico</span><b>91%</b></li><li><span>Hidráulica</span><b>88%</b></li><li><span>Próxima intervención</span><b>186 h</b></li></ul></div>}
        <div className="work-order"><span>PRÓXIMA ORDEN</span><b>OT-2841 · Inspección preventiva</b><small>En 186 h · Prioridad media</small></div>
      </aside>
    </section>

    <section className="bottom-grid">
      <div className="panel trend-panel"><div className="panel-heading"><div><span>TENDENCIA DE PRODUCCIÓN</span><b>Últimas 8 horas</b></div><div className="trend-legend"><span><i/>t/h real</span><span><i/>objetivo</span></div></div><div className="trend-chart"><div className="y-axis"><span>30</span><span>20</span><span>10</span><span>0</span></div><svg viewBox="0 0 800 100" preserveAspectRatio="none"><path className="target" d="M0 34 L800 34"/><path className="area" d="M0 78 C70 70 80 38 150 45 S240 60 300 38 S420 20 490 44 S600 68 660 35 S740 28 800 22 L800 100 L0 100Z"/><path className="line" d="M0 78 C70 70 80 38 150 45 S240 60 300 38 S420 20 490 44 S600 68 660 35 S740 28 800 22"/></svg><div className="x-axis"><span>06:00</span><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span></div></div></div>
      <div className="panel events-panel"><div className="panel-heading"><div><span>EVENTOS Y ALARMAS</span><b>{alarm?"3 activas · 18 hoy":"2 activas · 17 hoy"}</b></div><button>VER TODAS →</button></div><div className="event-list">{alarm&&<div className="event critical"><i/><time>14:32:18</time><span><b>Temperatura de refrigeración alta</b><small>IF-02 · Fusión · Requiere reconocimiento</small></span><em>ALTA</em></div>}<div className="event warning"><i/><time>14:28:04</time><span><b>Vibración sobre umbral de aviso</b><small>DES-01 · Desmoldeo · 8,6 mm/s</small></span><em>MEDIA</em></div><div className="event info"><i/><time>14:21:42</time><span><b>Lote FE-083 enviado a calidad</b><small>QC-01 · 48/48 piezas conformes</small></span><em>INFO</em></div></div></div>
    </section>

    {protocolOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setProtocolOpen(false)}}><section className="protocol-modal"><button className="modal-close" onClick={()=>setProtocolOpen(false)}>×</button><span className="eyebrow">ARQUITECTURA DE CONECTIVIDAD OT / IT</span><h2>Integración Siemens S7</h2><p className="modal-intro">Sí, es posible conectar la simulación a PLC reales. La comunicación S7 se mantiene dentro de la red industrial y un gateway desacopla, normaliza y protege el acceso web.</p><div className="architecture"><div><span>PLANTA OT</span><b>S7-1500 / ET200SP</b><small>S7comm · OPC UA<br/>PROFINET</small></div><i>→</i><div className="gateway-box"><span>EDGE GATEWAY</span><b>Node-RED / Industrial Edge</b><small>Lectura 250 ms · buffer<br/>TLS · listas permitidas</small></div><i>→</i><div><span>GEMELO DIGITAL</span><b>API + WebSocket</b><small>MQTT Sparkplug B<br/>Historiador / MES</small></div></div><div className="protocol-columns"><div><h3>Reglas de seguridad</h3><ul><li>Sin acceso S7 directo desde Internet</li><li>Gateway en DMZ industrial con solo lectura</li><li>Escrituras separadas, autorizadas y auditadas</li><li>Certificados TLS y segmentación IEC 62443</li></ul></div><div><h3>Contrato de datos</h3><dl><div><dt>Frecuencia rápida</dt><dd>250 ms</dd></div><div><dt>Telemetría estándar</dt><dd>1 s</dd></div><div><dt>Eventos / alarmas</dt><dd>Por cambio</dd></div><div><dt>Buffer sin conexión</dt><dd>24 h</dd></div></dl></div></div><div className="modal-footer"><span><i className="live-dot"/>{live?"MODO ACTUAL: OPC UA EN VIVO · opc.tcp 4840 → ws 8081":"MODO ACTUAL: SIMULADOR DE TAGS (puente OPC UA no conectado)"}</span><button onClick={()=>setProtocolOpen(false)}>ENTENDIDO</button></div></section></div>}
  </main>;
}
