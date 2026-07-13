"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

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
  { id: "cool-01", short: "ENF-01", name: "Túnel de enfriamiento", zone: "Enfriamiento", status: "RUN", cycle: "47 min", temp: "612 °C", power: "54 kW", vibration: "1.2 mm/s", pressure: "1.8 kPa", oee: "94.3%", plc: "PLC-LIN-01 · ET200SP", tags: [["Mould.Temp", "DB40.DBD0"], ["Residence.Time", "DB40.DBD8"], ["Fan.Speed", "DB41.DBD0"], ["Exit.Ready", "DB42.DBX0.0"]] },
  { id: "shake-01", short: "DES-01", name: "Desmoldeo vibratorio", zone: "Acabado", status: "IDLE", cycle: "22.8 s", temp: "88 °C", power: "110 kW", vibration: "8.6 mm/s", pressure: "4.8 bar", oee: "81.6%", plc: "PLC-ACA-01 · S7-1512", tags: [["Vib.Frequency", "DB50.DBD0"], ["Motor.Current", "DB50.DBD8"], ["Dust.FilterDP", "DB51.DBD4"], ["Part.Present", "DB52.DBX0.0"]] },
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

const statusColor: Record<AssetStatus, number> = { RUN: 0x30d99b, WARN: 0xffb84d, IDLE: 0x718096, ALARM: 0xff5c5c };

function roundedBox(w: number, h: number, d: number, color: number, roughness = .7) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness, metalness: .25 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(r: number, h: number, color: number, emissive = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: emissive ? 1.5 : 0, roughness: .45, metalness: .5 }));
  mesh.castShadow = true;
  return mesh;
}

function useFoundryScene(canvasRef: React.RefObject<HTMLCanvasElement | null>, onSelect: (id: string) => void, running: boolean, speed: number) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071015);
    scene.fog = new THREE.FogExp2(0x071015, .014);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 300);
    camera.position.set(32, 30, 40);
    const target = new THREE.Vector3(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0x92c8dc, 0x13191b, 1.5));
    const sun = new THREE.DirectionalLight(0xd9f4ff, 3.2);
    sun.position.set(12, 30, 18); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -35; sun.shadow.camera.right = 35; sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    scene.add(sun);
    const warm = new THREE.PointLight(0xff6b25, 35, 22, 1.4); warm.position.set(-16, 5, -6); scene.add(warm);

    const floor = roundedBox(55, .55, 30, 0x172329);
    floor.position.y = -.45; scene.add(floor);
    const grid = new THREE.GridHelper(55, 44, 0x38515c, 0x23343b); grid.position.y = -.15; scene.add(grid);
    const aisleMat = new THREE.MeshStandardMaterial({ color: 0xb48b28, roughness: .8 });
    [[0, .01, 0, .16, 52], [-7.7, .01, 0, .12, 29], [10.4, .01, 0, .12, 29]].forEach(([x,y,z,w,d]) => { const line = new THREE.Mesh(new THREE.BoxGeometry(w,.03,d), aisleMat); line.position.set(x,y,z); scene.add(line); });

    const clickable: THREE.Object3D[] = [];
    const animated: { type: string; object: THREE.Object3D; base?: number }[] = [];
    const addAsset = (id: string, group: THREE.Group) => {
      group.userData.assetId = id;
      group.traverse(o => { o.userData.assetId = id; if ((o as THREE.Mesh).isMesh) clickable.push(o); });
      scene.add(group);
    };
    const beacon = (status: AssetStatus, x: number, z: number, parent: THREE.Group) => {
      const pole = cylinder(.07, 1.5, 0x6f7d82); pole.position.set(x, 2.8, z); parent.add(pole);
      const light = cylinder(.16, .22, statusColor[status], statusColor[status]); light.position.set(x, 3.55, z); parent.add(light);
      animated.push({ type: "beacon", object: light });
    };

    // Induction furnaces
    [[-20, -7, "if-01", "RUN"], [-13.5, -7, "if-02", "WARN"]].forEach(([x,z,id,st]) => {
      const g = new THREE.Group(); g.position.set(x as number, 0, z as number);
      const body = cylinder(2.25, 3.4, 0x283940); body.position.y = 1.7; g.add(body);
      const band = new THREE.Mesh(new THREE.TorusGeometry(2.27,.16,10,32), new THREE.MeshStandardMaterial({color:0xb9c4c4,metalness:.8})); band.rotation.x=Math.PI/2; band.position.y=2.2; g.add(band);
      const melt = cylinder(1.72,.2,0xff4a14,0xff3a00); melt.position.y=3.43; g.add(melt); animated.push({type:"melt",object:melt});
      const hood = new THREE.Mesh(new THREE.ConeGeometry(2.7,2.2,24,1,true),new THREE.MeshStandardMaterial({color:0x26343a,side:THREE.DoubleSide,metalness:.45})); hood.position.y=5.5; hood.rotation.x=Math.PI; g.add(hood);
      const duct = cylinder(.45,3.2,0x35464c); duct.position.set(0,7.6,0); g.add(duct);
      for(let i=0;i<3;i++){const leg=roundedBox(.35,1.4,.35,0x607078); leg.position.set(-1.4+i*1.4,.6,1.7); g.add(leg);}
      beacon(st as AssetStatus, 2.55, 1.8, g); addAsset(id as string,g);
    });

    // Sand silo and mixer
    const silo = new THREE.Group(); silo.position.set(-21,0,6);
    const tank=cylinder(1.7,4.5,0x87969a); tank.position.y=4.4; silo.add(tank);
    const cone=new THREE.Mesh(new THREE.ConeGeometry(1.7,2,24),new THREE.MeshStandardMaterial({color:0x75868b,metalness:.4})); cone.position.y=1.2; cone.rotation.x=Math.PI; silo.add(cone);
    for(let i=0;i<4;i++){const leg=roundedBox(.18,2.4,.18,0x495a61);leg.position.set(i<2?-1.15:1.15,1.1,i%2?-1.15:1.15);silo.add(leg);} scene.add(silo);
    const pipe=roundedBox(8,.25,.25,0x596b71);pipe.position.set(-17,6.5,6);scene.add(pipe);

    // Moulding presses
    [[-9,5,"mp-01"],[-3.5,5,"mp-02"]].forEach(([x,z,id],idx)=>{
      const g=new THREE.Group();g.position.set(x as number,0,z as number);
      const base=roundedBox(4,.7,4,0x34474e);base.position.y=.35;g.add(base);
      [-1.55,1.55].forEach(px=>{[-1.5,1.5].forEach(pz=>{const col=roundedBox(.32,5,.32,0x8b9a9e);col.position.set(px,3,pz);g.add(col);});});
      const top=roundedBox(4,.6,4,0xa6b0b0);top.position.y=5.4;g.add(top);
      const ram=cylinder(.52,2.2,0xc4cccc);ram.position.y=4.1;g.add(ram);
      const plate=roundedBox(3.2,.35,3.1,0xc77c32);plate.position.y=2.6;g.add(plate);animated.push({type:"press",object:plate,base:2.6+idx*.15});
      const mould=roundedBox(2.8,.9,2.7,0x9b7344);mould.position.y=1.25;g.add(mould);
      beacon("RUN",2.15,1.8,g);addAsset(id as string,g);
    });

    // Main conveyor
    const rail=roundedBox(36,.5,3,0x2e4148);rail.position.set(5,.45,4.8);scene.add(rail);
    for(let x=-12;x<=22;x+=2){const roller=cylinder(.12,2.55,0x86959a);roller.rotation.z=Math.PI/2;roller.position.set(x,.85,4.8);scene.add(roller);}
    const moulds:THREE.Object3D[]=[];
    for(let i=0;i<8;i++){const m=roundedBox(2.2,1.2,2.15,0x8e6840);m.position.set(-10+i*4.4,1.45,4.8);scene.add(m);moulds.push(m);animated.push({type:"conveyor",object:m,base:m.position.x});}

    // Pouring gantry & ladle
    const pour=new THREE.Group();pour.position.set(1,0,-2);
    [-3.2,3.2].forEach(px=>{const post=roundedBox(.45,7,.55,0x52656b);post.position.set(px,3.5,0);pour.add(post);});
    const beam=roundedBox(7,.55,.6,0x829196);beam.position.y=6.8;pour.add(beam);
    const ladle=cylinder(1.45,2.2,0x333f43);ladle.position.set(0,3.8,0);ladle.rotation.z=.15;pour.add(ladle);
    const lip=cylinder(1.18,.16,0xff4a16,0xff3b00);lip.position.set(.16,4.9,0);pour.add(lip);animated.push({type:"melt",object:lip});
    const stream=cylinder(.13,2.6,0xff5a18,0xff3a00);stream.position.set(.45,2.1,0);pour.add(stream);animated.push({type:"stream",object:stream});
    beacon("RUN",3.6,1.2,pour);addAsset("pour-01",pour);

    // Cooling tunnel
    const cool=new THREE.Group();cool.position.set(13,0,-3);
    const tunnel=roundedBox(13,4.8,6,0x273941);tunnel.position.y=2.4;cool.add(tunnel);
    const opening=roundedBox(2.8,3.2,.25,0x101b1f);opening.position.set(-6.55,1.8,0);cool.add(opening);
    for(let i=-4;i<=4;i+=2){const vent=cylinder(.75,.18,0x132329);vent.rotation.x=Math.PI/2;vent.position.set(i,3.8,-3.08);cool.add(vent);const fan=cylinder(.38,.2,0x58a4b6);fan.rotation.x=Math.PI/2;fan.position.set(i,3.8,-3.2);cool.add(fan);animated.push({type:"fan",object:fan});}
    const roof=cylinder(.65,1.7,0x56696e);roof.position.set(3,5.6,0);cool.add(roof);beacon("RUN",6.8,2.5,cool);addAsset("cool-01",cool);

    // Shakeout
    const shake=new THREE.Group();shake.position.set(15,0,7);
    const shBase=roundedBox(5,1.2,4.5,0x42565d);shBase.position.y=.6;shake.add(shBase);
    const screen=roundedBox(4.4,.45,3.8,0x8b764e);screen.position.y=1.6;screen.rotation.z=.06;shake.add(screen);animated.push({type:"shake",object:screen,base:1.6});
    const dust=cylinder(1.1,3.5,0x586a70);dust.position.set(3.2,3,-1.2);shake.add(dust);beacon("IDLE",2.7,2.1,shake);addAsset("shake-01",shake);

    // Quality cell
    const qc=new THREE.Group();qc.position.set(22,0,6);
    const qcFloor=roundedBox(6,.3,6,0x263940);qcFloor.position.y=.15;qc.add(qcFloor);
    const gate=roundedBox(.4,5,.4,0x59c7c9);gate.position.set(-2,2.5,0);qc.add(gate);const gate2=gate.clone();gate2.position.x=2;qc.add(gate2);const qtop=roundedBox(4.4,.4,.4,0x59c7c9);qtop.position.y=4.8;qc.add(qtop);
    const scan=new THREE.PointLight(0x24e7e2,18,7);scan.position.set(0,2.8,0);qc.add(scan);
    const part=roundedBox(2,1.2,1.6,0x727d80);part.position.y=1;qc.add(part);animated.push({type:"scan",object:part});beacon("RUN",2.7,2.4,qc);addAsset("qc-01",qc);

    // Safety fences
    const fenceMat=new THREE.MeshStandardMaterial({color:0xd39b2f,metalness:.35});
    for(let x=-24;x<=24;x+=2){if(x>-3&&x<5)continue;const p=new THREE.Mesh(new THREE.BoxGeometry(.08,1.4,.08),fenceMat);p.position.set(x,.7,13);scene.add(p);}
    const railTop=roundedBox(49,.08,.08,0xd39b2f);railTop.position.set(0,1.3,13);scene.add(railTop);

    const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();
    let dragging=false,lastX=0,lastY=0,azimuth=.62,elevation=.52,distance=57,moved=false;
    const updateCamera=()=>{camera.position.set(target.x+Math.sin(azimuth)*Math.cos(elevation)*distance,target.y+Math.sin(elevation)*distance,target.z+Math.cos(azimuth)*Math.cos(elevation)*distance);camera.lookAt(target);};updateCamera();
    const resize=()=>{const rect=canvas.getBoundingClientRect();renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/Math.max(rect.height,1);camera.updateProjectionMatrix();};resize();
    const down=(e:PointerEvent)=>{dragging=true;moved=false;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);};
    const move=(e:PointerEvent)=>{if(!dragging)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;azimuth-=dx*.006;elevation=Math.max(.18,Math.min(1.15,elevation+dy*.004));lastX=e.clientX;lastY=e.clientY;updateCamera();};
    const up=(e:PointerEvent)=>{dragging=false;if(moved)return;const rect=canvas.getBoundingClientRect();pointer.x=((e.clientX-rect.left)/rect.width)*2-1;pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hit=raycaster.intersectObjects(clickable,false)[0];if(hit?.object.userData.assetId)onSelect(hit.object.userData.assetId);};
    const wheel=(e:WheelEvent)=>{e.preventDefault();distance=Math.max(28,Math.min(88,distance+e.deltaY*.035));updateCamera();};
    canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("wheel",wheel,{passive:false});window.addEventListener("resize",resize);
    const clock=new THREE.Clock();let raf=0;
    const loop=()=>{const t=clock.getElapsedTime()*speed;animated.forEach((a,i)=>{if(a.type==="beacon")((a.object as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity=1.1+Math.sin(t*3+i)*.7;if(!running)return;if(a.type==="melt")a.object.scale.setScalar(1+Math.sin(t*2+i)*.012);if(a.type==="press")a.object.position.y=(a.base||2.6)+Math.max(0,Math.sin(t*.75+i))*.8;if(a.type==="fan")a.object.rotation.z=t*5;if(a.type==="stream")a.object.visible=Math.sin(t*.55)>.05;if(a.type==="shake")a.object.position.x=Math.sin(t*24)*.045;if(a.type==="scan")a.object.rotation.y=t*.6;if(a.type==="conveyor"){const b=a.base||0;a.object.position.x=-10+((b+10+t*.35)%35.2);}});renderer.render(scene,camera);raf=requestAnimationFrame(loop);};loop();
    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",resize);canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("wheel",wheel);renderer.dispose();scene.traverse(o=>{if((o as THREE.Mesh).geometry)(o as THREE.Mesh).geometry.dispose();const m=(o as THREE.Mesh).material;if(m){(Array.isArray(m)?m:[m]).forEach(x=>x.dispose());}});};
  },[canvasRef,onSelect,running,speed]);
}

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
  useFoundryScene(canvasRef,onSelect,running,speed);
  useEffect(()=>{if(!running)return;const i=setInterval(()=>setSimTime(t=>new Date(t.getTime()+1000*speed)),1000);return()=>clearInterval(i);},[running,speed]);
  const injectAlarm=()=>{setAlarm(v=>!v);if(!alarm)setSelectedId("if-02");};

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><i/><i/><i/></span><div><b>FERRO<span>VIA</span></b><small>DIGITAL FOUNDRY</small></div></div>
      <nav><button className="active">PLANTA 3D</button><button>PRODUCCIÓN</button><button>CALIDAD</button><button>MANTENIMIENTO</button><button>ENERGÍA</button></nav>
      <div className="header-actions"><button className="protocol" onClick={()=>setProtocolOpen(true)}><span className="live-dot"/>S7 GATEWAY <small>SIMULADO</small></button><button className="icon-button" aria-label="Notificaciones">{alarm?"●":"○"}<span className="badge">{alarm?3:2}</span></button><div className="operator"><span>JM</span><div><b>J. Martínez</b><small>JEFE DE TURNO · A</small></div></div></div>
    </header>

    <section className="plant-title">
      <div><span className="eyebrow">GEMELO DIGITAL / PLANTA NORTE</span><h1>Fundición de hierro <em>en tiempo real</em></h1></div>
      <div className="clock"><span>{simTime.toLocaleDateString("es-ES",{day:"2-digit",month:"short",year:"numeric"}).toUpperCase()}</span><b>{simTime.toLocaleTimeString("es-ES")}</b><small>HORA SIMULADA</small></div>
      <div className="sim-controls"><button onClick={()=>setRunning(v=>!v)} className={running?"pause":"play"}>{running?"Ⅱ  PAUSAR":"▶  INICIAR"}</button><label>VELOCIDAD<select value={speed} onChange={e=>setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={4}>4×</option><option value={12}>12×</option></select></label><button className={alarm?"alarm active":"alarm"} onClick={injectAlarm}>{alarm?"RESTABLECER":"INYECTAR FALLO"}</button></div>
    </section>

    <section className="metrics-row">
      <Metric label="OEE PLANTA" value={alarm?"81,6%":"87,4%"} delta={alarm?"▼ 5,8%":"▲ 2,1%"} tone={alarm?"warn":"good"}/>
      <Metric label="PRODUCCIÓN TURNO" value="186 t" delta="72% objetivo"/>
      <Metric label="PIEZAS CONFORMES" value="98,4%" delta="▲ 0,6%"/>
      <Metric label="ENERGÍA ESPECÍFICA" value="548 kWh/t" delta="▼ 18 kWh/t"/>
      <Metric label="CO₂ ESTIMADO" value="0,42 t/t" delta="▼ 3,4%"/>
      <div className="batch-card"><span>LOTE ACTIVO</span><b>FE-260713-084</b><small>EN-GJS-500-7 · 12.480 kg</small><div><i style={{width:"68%"}}/><em>68%</em></div></div>
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
        <div className="asset-head"><div><span className={`status-pill ${alarm&&selected.id==="if-02"?"alarm":""}`}>{alarm&&selected.id==="if-02"?"ALARM":selected.status}</span><small>{selected.short}</small></div><button aria-label="Cerrar">×</button></div>
        <h2>{selected.name}</h2><p>{selected.plc}<br/>Último dato hace 84 ms</p>
        <div className="asset-tabs"><button className={tab==="telemetry"?"active":""} onClick={()=>setTab("telemetry")}>TELEMETRÍA</button><button className={tab==="tags"?"active":""} onClick={()=>setTab("tags")}>TAGS S7</button><button className={tab==="maintenance"?"active":""} onClick={()=>setTab("maintenance")}>SALUD</button></div>
        {tab==="telemetry"&&<><div className="hero-reading"><span>{selected.zone==="Fusión"||selected.zone==="Colada"?"TEMPERATURA METAL":"VARIABLE PRINCIPAL"}</span><b>{selected.temp}</b><small>Rango operativo nominal</small><Sparkline points={[28,31,29,35,37,41,38,43,44,42,46,45,48,47]}/></div><div className="telemetry-grid"><div><span>POTENCIA</span><b>{selected.power}</b></div><div><span>CICLO / CARGA</span><b>{selected.cycle}</b></div><div><span>VIBRACIÓN</span><b>{selected.vibration}</b></div><div><span>PRESIÓN</span><b>{selected.pressure}</b></div><div><span>OEE ACTIVO</span><b>{selected.oee}</b></div><div><span>CALIDAD DATO</span><b>GOOD · 100%</b></div></div></>}
        {tab==="tags"&&<div className="tag-list"><div className="tag-head"><span>SÍMBOLO</span><span>DIRECCIÓN</span></div>{selected.tags.map(t=><div key={t[0]}><span><i/>{t[0]}</span><code>{t[1]}</code></div>)}<button onClick={()=>setProtocolOpen(true)}>MAPA COMPLETO DE SEÑALES →</button></div>}
        {tab==="maintenance"&&<div className="health"><div className="health-ring"><b>92</b><span>SALUD</span></div><ul><li><span>Rodamientos</span><b>96%</b></li><li><span>Sistema eléctrico</span><b>91%</b></li><li><span>Hidráulica</span><b>88%</b></li><li><span>Próxima intervención</span><b>186 h</b></li></ul></div>}
        <div className="work-order"><span>PRÓXIMA ORDEN</span><b>OT-2841 · Inspección preventiva</b><small>En 186 h · Prioridad media</small></div>
      </aside>
    </section>

    <section className="bottom-grid">
      <div className="panel trend-panel"><div className="panel-heading"><div><span>TENDENCIA DE PRODUCCIÓN</span><b>Últimas 8 horas</b></div><div className="trend-legend"><span><i/>t/h real</span><span><i/>objetivo</span></div></div><div className="trend-chart"><div className="y-axis"><span>30</span><span>20</span><span>10</span><span>0</span></div><svg viewBox="0 0 800 100" preserveAspectRatio="none"><path className="target" d="M0 34 L800 34"/><path className="area" d="M0 78 C70 70 80 38 150 45 S240 60 300 38 S420 20 490 44 S600 68 660 35 S740 28 800 22 L800 100 L0 100Z"/><path className="line" d="M0 78 C70 70 80 38 150 45 S240 60 300 38 S420 20 490 44 S600 68 660 35 S740 28 800 22"/></svg><div className="x-axis"><span>06:00</span><span>08:00</span><span>10:00</span><span>12:00</span><span>14:00</span></div></div></div>
      <div className="panel events-panel"><div className="panel-heading"><div><span>EVENTOS Y ALARMAS</span><b>{alarm?"3 activas · 18 hoy":"2 activas · 17 hoy"}</b></div><button>VER TODAS →</button></div><div className="event-list">{alarm&&<div className="event critical"><i/><time>14:32:18</time><span><b>Temperatura de refrigeración alta</b><small>IF-02 · Fusión · Requiere reconocimiento</small></span><em>ALTA</em></div>}<div className="event warning"><i/><time>14:28:04</time><span><b>Vibración sobre umbral de aviso</b><small>DES-01 · Desmoldeo · 8,6 mm/s</small></span><em>MEDIA</em></div><div className="event info"><i/><time>14:21:42</time><span><b>Lote FE-083 enviado a calidad</b><small>QC-01 · 48/48 piezas conformes</small></span><em>INFO</em></div></div></div>
    </section>

    {protocolOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setProtocolOpen(false)}}><section className="protocol-modal"><button className="modal-close" onClick={()=>setProtocolOpen(false)}>×</button><span className="eyebrow">ARQUITECTURA DE CONECTIVIDAD OT / IT</span><h2>Integración Siemens S7</h2><p className="modal-intro">Sí, es posible conectar la simulación a PLC reales. La comunicación S7 se mantiene dentro de la red industrial y un gateway desacopla, normaliza y protege el acceso web.</p><div className="architecture"><div><span>PLANTA OT</span><b>S7-1500 / ET200SP</b><small>S7comm · OPC UA<br/>PROFINET</small></div><i>→</i><div className="gateway-box"><span>EDGE GATEWAY</span><b>Node-RED / Industrial Edge</b><small>Lectura 250 ms · buffer<br/>TLS · listas permitidas</small></div><i>→</i><div><span>GEMELO DIGITAL</span><b>API + WebSocket</b><small>MQTT Sparkplug B<br/>Historiador / MES</small></div></div><div className="protocol-columns"><div><h3>Reglas de seguridad</h3><ul><li>Sin acceso S7 directo desde Internet</li><li>Gateway en DMZ industrial con solo lectura</li><li>Escrituras separadas, autorizadas y auditadas</li><li>Certificados TLS y segmentación IEC 62443</li></ul></div><div><h3>Contrato de datos</h3><dl><div><dt>Frecuencia rápida</dt><dd>250 ms</dd></div><div><dt>Telemetría estándar</dt><dd>1 s</dd></div><div><dt>Eventos / alarmas</dt><dd>Por cambio</dd></div><div><dt>Buffer sin conexión</dt><dd>24 h</dd></div></dl></div></div><div className="modal-footer"><span><i className="live-dot"/>MODO ACTUAL: SIMULADOR DE TAGS</span><button onClick={()=>setProtocolOpen(false)}>ENTENDIDO</button></div></section></div>}
  </main>;
}
