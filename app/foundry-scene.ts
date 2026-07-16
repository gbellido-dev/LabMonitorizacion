"use client";

import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { LiveSnapshot } from "./use-opcua-live";

type AssetStatus = "RUN" | "WARN" | "IDLE" | "ALARM";

type Frame = { wall: number; sim: number; dt: number; sdt: number; running: boolean; pouring: boolean; live: LiveSnapshot | null };
type Updater = (f: Frame) => void;

/* Lectura de telemetría OPC UA en vivo (null/undefined => usar fallback interno) */
const lval = (s: LiveSnapshot | null, short: string, name: string) => s?.assets?.[short]?.[name]?.v;
const lnum = (s: LiveSnapshot | null, short: string, name: string) => {
  const v = lval(s, short, name);
  return typeof v === "number" ? v : null;
};
const lrun = (s: LiveSnapshot | null, short: string) => {
  const v = lval(s, short, "Estado");
  return typeof v === "string" ? v === "RUN" : null;
};
const lkpi = (s: LiveSnapshot | null, name: string) => {
  const v = s?.kpis?.[name]?.v;
  return typeof v === "number" ? v : null;
};

/* ---------------------------------- procedural textures ---------------------------------- */

function concreteTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#31373b";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 12000; i++) {
    const v = Math.random();
    g.fillStyle = v > 0.5 ? `rgba(255,255,255,${Math.random() * 0.035})` : `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 18 + Math.random() * 70;
    const grad = g.createRadialGradient(x, y, 2, x, y, r);
    grad.addColorStop(0, `rgba(${Math.random() > 0.6 ? "58,48,40" : "18,20,22"},${0.10 + Math.random() * 0.14})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  g.strokeStyle = "rgba(10,12,14,.55)"; g.lineWidth = 3;
  g.strokeRect(-2, -2, 516, 516);
  g.beginPath(); g.moveTo(256, 0); g.lineTo(256, 512); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
  g.strokeStyle = "rgba(255,255,255,.05)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(259, 0); g.lineTo(259, 512); g.moveTo(0, 259); g.lineTo(512, 259); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function corrugatedTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 64;
  const g = c.getContext("2d")!;
  for (let x = 0; x < 256; x += 16) {
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, "#242c31");
    grad.addColorStop(0.35, "#3d474d");
    grad.addColorStop(0.6, "#2b3439");
    grad.addColorStop(1, "#20272c");
    g.fillStyle = grad;
    g.fillRect(x, 0, 16, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hazardTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9a12b"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#181a1c";
  for (let i = -128; i < 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i - 112, 128); g.lineTo(i - 128, 128);
    g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.4, "rgba(255,255,255,.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function smokeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 42; i++) {
    const x = 34 + Math.random() * 60, y = 34 + Math.random() * 60, r = 12 + Math.random() * 22;
    const grad = g.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,.10)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

/* ---------------------------------- particle systems ---------------------------------- */

function makeSparks(count: number, tex: THREE.Texture, color: number, size = 0.16) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { pos[i * 3 + 1] = -100; }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const mat = new THREE.PointsMaterial({ size, map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let cursor = 0;
  const update = (dt: number, origin: THREE.Vector3 | null, rate: number) => {
    for (let i = 0; i < count; i++) {
      if (life[i] > 0) {
        life[i] -= dt;
        vel[i * 3 + 1] -= 11 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < 0.06) { pos[i * 3 + 1] = 0.06; vel[i * 3 + 1] *= -0.32; vel[i * 3] *= 0.55; vel[i * 3 + 2] *= 0.55; }
        if (life[i] <= 0) pos[i * 3 + 1] = -100;
      }
    }
    if (origin && dt > 0) {
      const n = Math.min(count, Math.ceil(rate * dt));
      for (let k = 0; k < n; k++) {
        const i = cursor; cursor = (cursor + 1) % count;
        pos[i * 3] = origin.x + (Math.random() - 0.5) * 0.18;
        pos[i * 3 + 1] = origin.y;
        pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.18;
        vel[i * 3] = (Math.random() - 0.5) * 3.6;
        vel[i * 3 + 1] = 1.4 + Math.random() * 4.2;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 3.6;
        life[i] = 0.3 + Math.random() * 0.8;
      }
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  };
  return { points, update };
}

function makeSmoke(tex: THREE.Texture, n: number, tint: number, height = 4.4, baseOpacity = 0.13) {
  const group = new THREE.Group();
  const items: { s: THREE.Sprite; age: number; dur: number; drift: number }[] = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: tint, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(m);
    items.push({ s, age: Math.random() * 5, dur: 3.2 + Math.random() * 2.4, drift: Math.random() * 6.28 });
    group.add(s);
  }
  const update = (dt: number, active: boolean) => {
    for (const it of items) {
      it.age += dt;
      if (it.age > it.dur) {
        if (!active) { it.s.material.opacity = 0; continue; }
        it.age = 0; it.dur = 3.2 + Math.random() * 2.4; it.drift = Math.random() * 6.28;
      }
      const k = it.age / it.dur;
      it.s.position.set(Math.sin(it.drift + k * 2.2) * k * 1.1, 0.4 + k * height, Math.cos(it.drift) * k * 0.9);
      const sc = 0.8 + k * 2.8;
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = baseOpacity * Math.sin(Math.PI * Math.min(k, 1));
    }
  };
  return { group, update };
}

/* ---------------------------------- scene ---------------------------------- */

function createFoundryScene(canvas: HTMLCanvasElement, onSelect: (id: string) => void, ctl: { current: { running: boolean; speed: number; live: LiveSnapshot | null } }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090e12);
  scene.fog = new THREE.FogExp2(0x0a1014, 0.0075);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.38;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
  const target = new THREE.Vector3(0, 1.6, 0);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.58;

  /* ---- lights ---- */
  scene.add(new THREE.HemisphereLight(0x9db2be, 0x1c2023, 1.15));
  const sun = new THREE.DirectionalLight(0xdcE8ef, 3.4);
  sun.position.set(22, 27, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  /* ---- shared materials & textures ---- */
  const texConcrete = concreteTexture(); texConcrete.repeat.set(7.5, 4.5);
  const texCorru = corrugatedTexture(); texCorru.repeat.set(24, 1);
  const texHazard = hazardTexture();
  const texGlow = glowTexture();
  const texSmoke = smokeTexture();

  const sm = (color: number, roughness: number, metalness: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness, ...opts });

  const M = {
    steel: sm(0x4a565e, 0.5, 0.72),
    darkSteel: sm(0x2b3339, 0.58, 0.55),
    lining: sm(0x39454d, 0.55, 0.5),
    lightSteel: sm(0x93a0a6, 0.34, 0.82),
    chrome: sm(0xd9dee1, 0.15, 1),
    copper: sm(0xb2652c, 0.3, 0.95),
    refract: sm(0xc9bfae, 0.92, 0.05),
    sand: sm(0x8a6f47, 0.95, 0.02),
    yellow: sm(0xd6a02a, 0.55, 0.35),
    robotOrange: sm(0xd6661a, 0.4, 0.32),
    robotJoint: sm(0x22272c, 0.44, 0.55),
    cabinet: sm(0x38434b, 0.52, 0.42),
    black: sm(0x14181c, 0.72, 0.3),
    casting: sm(0x676d71, 0.55, 0.7),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe2ea, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.13, side: THREE.DoubleSide }),
  };

  const mesh = <G extends THREE.BufferGeometry>(geo: G, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 22) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z);

  const updaters: Updater[] = [];
  const clickable: THREE.Object3D[] = [];
  const addAsset = (id: string, group: THREE.Group) => {
    group.userData.assetId = id;
    group.traverse(o => { o.userData.assetId = id; if ((o as THREE.Mesh).isMesh) clickable.push(o); });
    scene.add(group);
  };

  /* ---- floor & zone paint ---- */
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 36), new THREE.MeshStandardMaterial({ map: texConcrete, roughness: 0.93, metalness: 0.04 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const zoneRect = (x1: number, z1: number, x2: number, z2: number, color: number) => {
    const w = x2 - x1, d = z2 - z1;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.045, depthWrite: false }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(x1 + w / 2, 0.015, z1 + d / 2);
    scene.add(fill);
    const lineMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false });
    const edge = (lx: number, lz: number, lw: number, ld: number) => {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(lw, ld), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(lx, 0.02, lz);
      scene.add(l);
    };
    edge(x1 + w / 2, z1, w, 0.09); edge(x1 + w / 2, z2, w, 0.09);
    edge(x1, z1 + d / 2, 0.09, d); edge(x2, z1 + d / 2, 0.09, d);
  };
  zoneRect(-27, -12.5, -9.5, -0.5, 0xff6a3a);
  zoneRect(-13, 1.4, -0.9, 8.6, 0x4a9dd0);
  zoneRect(-0.7, 1.4, 5.3, 8.6, 0xffa23a);
  zoneRect(5.5, 1.4, 19, 8.6, 0x39d6c3);
  zoneRect(20, 1.4, 29, 15, 0x59c7e8);

  // pedestrian walkway
  const walkMat = new THREE.MeshBasicMaterial({ color: 0xb48b28, transparent: true, opacity: 0.55, depthWrite: false });
  [[0, 13.2, 56, 0.14], [0, 11.6, 56, 0.14]].forEach(([x, z, w, d]) => {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(w, d), walkMat);
    l.rotation.x = -Math.PI / 2; l.position.set(x, 0.02, z); scene.add(l);
  });
  for (let z = -14; z <= 10; z += 1.4) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), walkMat);
    l.rotation.x = -Math.PI / 2; l.position.set(1.9, 0.02, z); scene.add(l);
  }

  /* ---- building shell ---- */
  const backWall = box(60, 12.5, 0.5, new THREE.MeshStandardMaterial({ map: texCorru, roughness: 0.6, metalness: 0.5 }), 0, 6.25, -18.25);
  backWall.receiveShadow = true; backWall.castShadow = false; scene.add(backWall);
  const texCorru2 = texCorru.clone(); texCorru2.repeat.set(15, 1);
  const sideWall = box(0.5, 12.5, 36, new THREE.MeshStandardMaterial({ map: texCorru2, roughness: 0.6, metalness: 0.5 }), -30.25, 6.25, 0);
  sideWall.castShadow = false; scene.add(sideWall);
  const winMat = sm(0x0e2530, 0.3, 0.1, { emissive: 0x87c8dd, emissiveIntensity: 0.35 });
  const winBand = box(56, 1.5, 0.12, winMat, 0, 9.4, -17.95); winBand.castShadow = false; scene.add(winBand);
  const winBand2 = box(0.12, 1.5, 33, winMat, -29.95, 9.4, 0); winBand2.castShadow = false; scene.add(winBand2);

  // structural columns + crane rails
  const columnAt = (x: number, z: number) => {
    const g = new THREE.Group();
    g.add(box(0.56, 11, 0.16, M.steel, 0, 5.5, -0.2));
    g.add(box(0.56, 11, 0.16, M.steel, 0, 5.5, 0.2));
    g.add(box(0.16, 11, 0.26, M.steel, 0, 5.5, 0));
    g.add(box(0.9, 0.12, 0.9, M.darkSteel, 0, 0.06, 0));
    g.position.set(x, 0, z);
    scene.add(g);
  };
  for (let x = -28; x <= 28; x += 8) { columnAt(x, -13); columnAt(x, 13); }
  [[-29.6, -5], [-29.6, 5]].forEach(([x, z]) => columnAt(x, z));
  const railL = box(58, 0.3, 0.4, M.steel, 0, 11.15, -13); railL.castShadow = false; scene.add(railL);
  const railR = box(58, 0.3, 0.4, M.steel, 0, 11.15, 13); railR.castShadow = false; scene.add(railR);

  // roof trusses
  for (let x = -24; x <= 24; x += 8) {
    const truss = new THREE.Group();
    const bottom = box(0.24, 0.24, 32, M.steel, 0, 11.9, -1.5);
    const top = box(0.24, 0.24, 32, M.steel, 0, 13.2, -1.5);
    truss.add(bottom, top);
    for (let z = -16; z <= 13; z += 4.8) {
      const v = box(0.1, 1.3, 0.1, M.steel, 0, 12.55, z); v.castShadow = false; truss.add(v);
      const d = cyl(0.045, 0.045, 4.95, M.steel, 0, 12.55, z + 2.4, 8);
      d.rotation.x = Math.PI / 2 - Math.atan2(1.3, 4.8) * (z % 9.6 === 0 ? 1 : -1);
      d.castShadow = false; truss.add(d);
    }
    truss.position.x = x;
    scene.add(truss);
  }
  for (const z of [-13.5, -6, 1.5, 9]) {
    const p = box(58, 0.16, 0.16, M.darkSteel, 0, 13.35, z); p.castShadow = false; scene.add(p);
  }

  // high-bay lamps
  const lampPositions: [number, number, boolean][] = [
    [-20, -6, true], [-8, -6, false], [4, -6, true], [16, -6, false],
    [-20, 6, false], [-8, 6, true], [4, 6, false], [16, 6, true], [26, 6, true],
  ];
  for (const [lx, lz, hasLight] of lampPositions) {
    const rod = cyl(0.04, 0.04, 0.9, M.darkSteel, lx, 11.45, lz, 8); rod.castShadow = false; scene.add(rod);
    const shade = mesh(new THREE.ConeGeometry(0.62, 0.55, 18, 1, true), sm(0x272e33, 0.5, 0.6, { side: THREE.DoubleSide }), lx, 10.85, lz);
    shade.castShadow = false; scene.add(shade);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.4, 18), sm(0xfff3d8, 0.4, 0, { emissive: 0xffe9c4, emissiveIntensity: 2.6 }));
    disk.rotation.x = -Math.PI / 2; disk.position.set(lx, 10.62, lz); scene.add(disk);
    if (hasLight) {
      const spot = new THREE.SpotLight(0xeaf2f6, 320, 32, 0.62, 0.6, 1.6);
      spot.position.set(lx, 10.6, lz);
      spot.target.position.set(lx, 0, lz);
      scene.add(spot, spot.target);
    }
  }

  /* ---- overhead crane with ladle ---- */
  const crane = new THREE.Group();
  [[-13.1], [13.1]].forEach(([tz]) => crane.add(box(1.6, 0.5, 1.2, M.yellow, 0, 11.5, tz)));
  crane.add(box(0.5, 0.85, 26.4, M.yellow, -0.62, 11.62, 0));
  crane.add(box(0.5, 0.85, 26.4, M.yellow, 0.62, 11.62, 0));
  const trolley = new THREE.Group();
  trolley.add(box(1.7, 0.55, 1.5, M.darkSteel, 0, 12.3, 0));
  const cableL = cyl(0.025, 0.025, 4.6, M.black, -0.28, 9.7, 0, 6);
  const cableR = cyl(0.025, 0.025, 4.6, M.black, 0.28, 9.7, 0, 6);
  const hookBlock = box(0.5, 0.55, 0.35, M.darkSteel, 0, 7.25, 0);
  const craneLadle = new THREE.Group();
  craneLadle.add(cyl(0.98, 0.78, 1.55, M.lining, 0, 6.2, 0));
  craneLadle.add(mesh(new THREE.TorusGeometry(0.98, 0.07, 8, 24), M.darkSteel, 0, 6.95, 0));
  (craneLadle.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
  craneLadle.add(box(2.3, 0.09, 0.09, M.steel, 0, 7, 0));
  trolley.add(cableL, cableR, hookBlock, craneLadle);
  crane.add(trolley);
  scene.add(crane);
  updaters.push(f => {
    crane.position.x = -9.5 + Math.sin(f.sim * 0.06) * 10.5;
    trolley.position.z = -1 + Math.sin(f.sim * 0.045 + 1.2) * 8.5;
    craneLadle.rotation.z = Math.sin(f.sim * 0.6) * 0.02;
  });

  /* ---- status beacon (stack light) ---- */
  // El estado se lee de OPC UA (Estado del activo) con el estático de fallback
  const beacon = (short: string | null, fallback: AssetStatus, x: number, z: number, parent: THREE.Group, h = 2.6) => {
    parent.add(cyl(0.05, 0.05, h, M.lightSteel, x, h / 2, z, 10));
    const segs: { mat: THREE.MeshStandardMaterial; role: AssetStatus }[] = [];
    ([[0xff5c5c, "ALARM"], [0xffb84d, "WARN"], [0x30d99b, "RUN"]] as [number, AssetStatus][]).forEach(([col, role], i) => {
      const m = sm(col, 0.4, 0.1, { emissive: col, emissiveIntensity: 0.05, transparent: true, opacity: 0.55 });
      const seg = cyl(0.11, 0.11, 0.16, m, x, h + 0.42 - i * 0.17, z, 14);
      seg.castShadow = false;
      parent.add(seg);
      segs.push({ mat: m, role });
    });
    const cap = cyl(0.12, 0.12, 0.04, M.black, x, h + 0.53, z, 14); cap.castShadow = false; parent.add(cap);
    updaters.push(f => {
      const liveEstado = short ? lval(f.live, short, "Estado") : undefined;
      const st = (typeof liveEstado === "string" ? liveEstado : fallback) as AssetStatus;
      for (const sgm of segs) {
        const active = sgm.role === st;
        sgm.mat.emissiveIntensity = active ? 1.2 + Math.sin(f.wall * 3.2 + x * 2 + z) * 0.7 : 0.05;
        sgm.mat.opacity = active ? 1 : 0.55;
      }
    });
  };

  /* ---- control cabinet ---- */
  const cabinet = (x: number, z: number, ry = 0, screen = false) => {
    const g = new THREE.Group();
    g.add(box(1.5, 2.1, 0.62, M.cabinet, 0, 1.15, 0));
    g.add(box(1.56, 0.1, 0.68, M.darkSteel, 0, 0.05, 0));
    g.add(box(0.02, 1.8, 0.5, M.black, 0.76, 1.15, 0));
    [0x30d99b, 0x39d6c3, 0xffb84d].forEach((c, i) => {
      const led = box(0.05, 0.05, 0.03, sm(c, 0.3, 0, { emissive: c, emissiveIntensity: 1.4 }), -0.45 + i * 0.2, 1.85, 0.325);
      led.castShadow = false;
      g.add(led);
    });
    if (screen) {
      const scr = box(0.62, 0.42, 0.02, sm(0x0d2027, 0.3, 0, { emissive: 0x2a6f80, emissiveIntensity: 0.9 }), 0, 1.4, 0.325);
      scr.castShadow = false; g.add(scr);
    }
    const conduit = cyl(0.05, 0.05, 7.4, M.darkSteel, 0.5, 5.9, -0.2, 8);
    conduit.castShadow = false; g.add(conduit);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    scene.add(g);
    return g;
  };
  cabinet(-24, -17.4, 0, true); cabinet(-16, -17.4); cabinet(-6, -17.4, 0, true);
  cabinet(4, -17.4); cabinet(12, -17.4, 0, true); cabinet(22, -17.4);
  const tray = box(56, 0.06, 0.5, M.darkSteel, 0, 9.9, -17.6); tray.castShadow = false; scene.add(tray);

  /* ---- robot arm builder ---- */
  const makeRobot = (tool: "gripper" | "cup") => {
    const g = new THREE.Group();
    g.add(cyl(0.58, 0.66, 0.2, M.robotJoint, 0, 0.1, 0));
    g.add(cyl(0.34, 0.46, 0.62, M.robotOrange, 0, 0.5, 0));
    const j1 = new THREE.Group(); j1.position.y = 0.84; g.add(j1);
    j1.add(box(0.82, 0.55, 0.68, M.robotOrange, 0, 0.24, 0));
    const axle = cyl(0.29, 0.29, 0.9, M.robotJoint, 0, 0.56, 0); axle.rotation.x = Math.PI / 2; j1.add(axle);
    const j2 = new THREE.Group(); j2.position.y = 0.56; j1.add(j2);
    j2.add(box(0.32, 1.62, 0.44, M.robotOrange, 0, 0.8, 0));
    j2.add(box(0.36, 0.5, 0.5, M.robotJoint, 0, 0.06, 0));
    const j3 = new THREE.Group(); j3.position.y = 1.6; j2.add(j3);
    const elbow = cyl(0.25, 0.25, 0.84, M.robotJoint); elbow.rotation.x = Math.PI / 2; j3.add(elbow);
    j3.add(box(1.28, 0.3, 0.34, M.robotOrange, 0.62, 0, 0));
    j3.add(box(0.5, 0.4, 0.44, M.robotOrange, -0.38, 0, 0)); // counterweight
    const j4 = new THREE.Group(); j4.position.x = 1.28; j3.add(j4);
    const wrist = cyl(0.13, 0.16, 0.4, M.robotJoint); wrist.rotation.z = Math.PI / 2; wrist.position.x = 0.12; j4.add(wrist);
    if (tool === "gripper") {
      j4.add(box(0.08, 0.34, 0.34, M.lightSteel, 0.34, 0, 0));
      j4.add(box(0.34, 0.07, 0.09, M.chrome, 0.55, -0.1, 0.12));
      j4.add(box(0.34, 0.07, 0.09, M.chrome, 0.55, -0.1, -0.12));
    } else {
      const cup = cyl(0.3, 0.22, 0.4, M.lining, 0.45, -0.18, 0);
      const meltTop = new THREE.Mesh(new THREE.CircleGeometry(0.24, 16), sm(0xff5a14, 0.6, 0, { emissive: 0xff3c00, emissiveIntensity: 2 }));
      meltTop.rotation.x = -Math.PI / 2; meltTop.position.set(0.45, 0.03, 0);
      j4.add(cup, meltTop);
    }
    return { group: g, j1, j2, j3, j4 };
  };
  const spawnRobot = (id: string, x: number, z: number, ry: number, phase: number, tool: "gripper" | "cup", status: AssetStatus = "RUN", cycleNom = 20) => {
    const r = makeRobot(tool);
    const g = new THREE.Group();
    g.add(r.group);
    g.add(box(1.7, 0.14, 1.7, M.darkSteel, 0, 0.07, 0));
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.85, 28), new THREE.MeshBasicMaterial({ map: texHazard, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.022; g.add(ring);
    const short = id.toUpperCase();
    beacon(short, status, 1.05, 1.05, g, 1.9);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    addAsset(id, g);
    // velocidad según TiempoCiclo OPC UA; se detiene si Estado != RUN
    let p = phase;
    updaters.push(f => {
      const run = lrun(f.live, short) ?? true;
      const cyc = lnum(f.live, short, "TiempoCiclo") ?? cycleNom;
      if (run) p += f.sdt * 0.55 * Math.min(3, Math.max(0.3, cycleNom / Math.max(cyc, 1)));
      r.j1.rotation.y = Math.sin(p * 0.6) * 1.05;
      r.j2.rotation.z = -0.42 + Math.sin(p) * 0.26;
      r.j3.rotation.z = 0.9 + Math.cos(p * 0.8) * 0.34;
      r.j4.rotation.x = Math.sin(p * 1.6) * 0.7;
      r.j4.rotation.z = Math.sin(p * 0.9) * 0.25;
    });
  };

  /* ---- induction furnaces ---- */
  const furnaceData: [number, number, string, AssetStatus][] = [[-20, -7, "if-01", "RUN"], [-13.5, -7, "if-02", "WARN"]];
  for (const [fx, fz, id, st] of furnaceData) {
    const g = new THREE.Group();
    g.position.set(fx, 0, fz);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.5, 40), new THREE.MeshBasicMaterial({ map: texHazard, transparent: true, opacity: 0.65, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.022; g.add(ring);
    g.add(cyl(2.5, 2.6, 0.5, M.darkSteel, 0, 0.25, 0, 30));
    g.add(cyl(2.1, 2.32, 3.1, M.lining, 0, 2.05, 0, 30));
    for (let i = 0; i < 5; i++) {
      const coil = mesh(new THREE.TorusGeometry(2.24, 0.12, 10, 34), M.copper, 0, 1.15 + i * 0.42, 0);
      coil.rotation.x = Math.PI / 2;
      g.add(coil);
    }
    g.add(cyl(2.32, 2.32, 0.38, M.refract, 0, 3.8, 0, 30));
    const meltMat = sm(0xff5a12, 0.55, 0, { emissive: 0xff3800, emissiveIntensity: 2.2 });
    const melt = cyl(1.62, 1.62, 0.16, meltMat, 0, 4.02, 0, 28);
    melt.castShadow = false;
    g.add(melt);
    const glowL = new THREE.PointLight(0xff5a14, 26, 15, 1.8);
    glowL.position.set(0, 4.8, 0); g.add(glowL);
    // brillo del baño proporcional a la temperatura OPC UA del horno
    const nomT = id === "if-01" ? 1487 : 1362;
    const fShort = (id as string).toUpperCase();
    updaters.push(f => {
      const t = lnum(f.live, fShort, "TemperaturaMetal") ?? nomT;
      const heat = Math.max(0.25, Math.min(1.35, (t - 1230) / 250));
      meltMat.emissiveIntensity = (2 + Math.sin(f.wall * 6.5 + fx) * 0.28 + Math.sin(f.wall * 13.1) * 0.16) * heat;
      glowL.intensity = (22 + Math.sin(f.wall * 9.2 + fz) * 5 + Math.sin(f.wall * 23.7) * 2.5) * heat;
    });
    // fume hood + ducting
    const hood = mesh(new THREE.ConeGeometry(2.75, 2.2, 26, 1, true), sm(0x2a3339, 0.5, 0.55, { side: THREE.DoubleSide }), 0, 6.3, 0);
    hood.rotation.x = Math.PI;
    g.add(hood);
    g.add(cyl(0.5, 0.5, 3.2, M.lining, 0, 8.6, 0));
    g.add(mesh(new THREE.SphereGeometry(0.55, 14, 10), M.lining, 0, 10.2, 0));
    const duct = cyl(0.5, 0.5, 10.6, M.lining, 0, 10.2, -5.5); duct.rotation.x = Math.PI / 2; g.add(duct);
    // hydraulic tilt cylinders
    [[-1.9, 0.5], [1.9, -0.5]].forEach(([px, rz]) => {
      const piston = cyl(0.13, 0.13, 2.7, M.chrome, px, 1.6, 1.35);
      piston.rotation.z = rz as number;
      const sleeve = cyl(0.2, 0.2, 1.4, M.yellow, px + (rz as number) * 0.5, 1, 1.35);
      sleeve.rotation.z = rz as number;
      g.add(piston, sleeve);
    });
    // operator platform + stairs + railing
    const plat = box(6, 0.14, 2.4, M.lightSteel, 0, 2.35, 3.1);
    g.add(plat);
    g.add(box(6, 0.1, 0.1, M.yellow, 0, 3.4, 4.25));
    g.add(box(6, 0.07, 0.07, M.yellow, 0, 2.95, 4.25));
    for (let px = -2.9; px <= 2.9; px += 1.45) g.add(box(0.07, 1.1, 0.07, M.yellow, px, 2.9, 4.25));
    for (let s = 0; s < 6; s++) g.add(box(1.1, 0.09, 0.34, M.lightSteel, 3.6, 0.35 + s * 0.4, 4.05 - s * 0.36));
    [[-2.9], [2.9]].forEach(([px]) => g.add(box(0.16, 2.35, 0.16, M.steel, px, 1.17, 3.1)));
    beacon(fShort, st, -3.4, 3.6, g);
    addAsset(id, g);
    // humo sobre el horno: solo en fases activas (FUSION / AFINO) según OPC UA
    const smoke = makeSmoke(texSmoke, 9, 0x97a1a8);
    smoke.group.position.set(fx, 5.6, fz);
    scene.add(smoke.group);
    updaters.push(f => {
      const fase = lval(f.live, fShort, "Fase");
      const active = f.running && (typeof fase === "string" ? fase === "FUSION" || fase === "AFINO" : true);
      smoke.update(f.sdt, active);
    });
  }

  /* ---- charging area: scrap skip + ingots ---- */
  const scrap = new THREE.Group();
  scrap.position.set(-26, 0, -1.5);
  scrap.add(cyl(1.4, 1.05, 1.7, M.darkSteel, 0, 0.85, 0, 20));
  const rim = mesh(new THREE.TorusGeometry(1.4, 0.09, 8, 24), M.steel, 0, 1.7, 0); rim.rotation.x = Math.PI / 2; scrap.add(rim);
  for (let i = 0; i < 8; i++) {
    scrap.add(mesh(new THREE.DodecahedronGeometry(0.22 + Math.random() * 0.14), M.casting, (Math.random() - 0.5) * 1.5, 1.75 + Math.random() * 0.25, (Math.random() - 0.5) * 1.5));
  }
  scene.add(scrap);
  for (let layer = 0; layer < 4; layer++) {
    for (let i = 0; i < 3; i++) {
      const ingot = box(1.5, 0.26, 0.44, M.casting, -26.5 + (layer % 2 ? 0 : (i - 1) * 0.5), 0.15 + layer * 0.28, -5.5 + (layer % 2 ? (i - 1) * 0.5 : 0));
      if (layer % 2) ingot.rotation.y = Math.PI / 2;
      scene.add(ingot);
    }
  }

  /* ---- sand silo + mixer + piping ---- */
  const silo = new THREE.Group();
  silo.position.set(-21, 0, 6.5);
  silo.add(cyl(1.65, 1.65, 4.6, M.lightSteel, 0, 4.7, 0, 26));
  const siloCone = cyl(1.65, 0.35, 1.9, M.steel, 0, 1.45, 0, 26);
  silo.add(siloCone);
  silo.add(cyl(1.7, 1.7, 0.18, M.steel, 0, 7.05, 0, 26));
  for (let i = 0; i < 4; i++) silo.add(box(0.16, 2.6, 0.16, M.steel, i < 2 ? -1.15 : 1.15, 1.3, i % 2 ? -1.15 : 1.15));
  for (let r = 0; r < 9; r++) silo.add(box(0.4, 0.045, 0.045, M.lightSteel, 1.78, 1.2 + r * 0.62, 0));
  [[1.68], [1.94]].forEach(([lx]) => silo.add(box(0.05, 5.7, 0.05, M.lightSteel, lx, 4, 0)));
  const siloRail = mesh(new THREE.TorusGeometry(1.72, 0.045, 8, 26), M.yellow, 0, 7.6, 0); siloRail.rotation.x = Math.PI / 2; silo.add(siloRail);
  scene.add(silo);
  const mixer = new THREE.Group();
  mixer.position.set(-14.5, 0, 8.6);
  mixer.add(box(2.5, 1.9, 2.1, M.lining, 0, 1.05, 0));
  mixer.add(cyl(0.42, 0.42, 0.8, M.darkSteel, -0.6, 2.4, 0));
  mixer.add(cyl(0.9, 1.3, 1, M.steel, 0.5, 2.6, 0, 4));
  scene.add(mixer);
  const sandPipe1 = cyl(0.16, 0.16, 6.6, M.steel, -17.6, 6.6, 7.5, 10); sandPipe1.rotation.z = Math.PI / 2; sandPipe1.rotation.y = -0.32; scene.add(sandPipe1);
  const sandPipe2 = cyl(0.14, 0.14, 9.5, M.steel, -9, 6.9, 7, 10); sandPipe2.rotation.z = Math.PI / 2; sandPipe2.rotation.y = 0.42; scene.add(sandPipe2);

  /* ---- moulding presses (portal over the line) ---- */
  const pressData: [number, string][] = [[-9, "mp-01"], [-3.5, "mp-02"]];
  pressData.forEach(([px, id], idx) => {
    const g = new THREE.Group();
    g.position.set(px as number, 0, 4.8);
    g.add(box(4.3, 0.9, 1.15, M.darkSteel, 0, 0.45, 2.15));
    g.add(box(4.3, 0.9, 1.15, M.darkSteel, 0, 0.45, -2.15));
    [-1.55, 1.55].forEach(cx => [-1.85, 1.85].forEach(cz => g.add(cyl(0.17, 0.17, 5.4, M.chrome, cx, 3.1, cz, 16))));
    g.add(box(4.3, 1.1, 4.6, M.lining, 0, 6, 0));
    g.add(box(4.4, 0.16, 4.7, M.yellow, 0, 5.4, 0));
    g.add(cyl(0.58, 0.58, 1.5, M.darkSteel, 0, 7.3, 0));
    const hose1 = mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 20, 3.6), M.black, 1.4, 7.1, 1.6);
    hose1.rotation.y = 0.8; g.add(hose1);
    const ram = cyl(0.42, 0.42, 1.9, M.chrome, 0, 4.6, 0, 18);
    const platen = box(3, 0.42, 3.1, M.steel, 0, 3.4, 0);
    g.add(ram, platen);
    // ritmo de prensada ligado al TiempoCiclo OPC UA; se para si Estado != RUN
    const pShort = (id as string).toUpperCase();
    let pressPh = idx * 1.7;
    updaters.push(f => {
      const run = lrun(f.live, pShort) ?? true;
      const cyc = lnum(f.live, pShort, "TiempoCiclo") ?? 18.3;
      if (run) pressPh += f.sdt * (2 * Math.PI) / (Math.max(cyc, 4) * 0.45);
      const y = 3 + Math.max(0, Math.sin(pressPh)) * 1.1;
      platen.position.y = y;
      ram.position.y = y + 1.15;
      ram.scale.y = (6 - y) / 1.9;
    });
    // sand hopper feeding from overhead pipe
    g.add(cyl(0.85, 0.3, 1.1, M.steel, 1.6, 7.2, 1.2, 4));
    beacon(pShort, "RUN", 2.5, 2.6, g);
    addAsset(id as string, g);
  });
  cabinet(-11.6, 8.8, Math.PI, true);

  /* ---- conveyor line ---- */
  const convY = 1.06;
  scene.add(box(34, 0.26, 0.2, M.darkSteel, 4, convY - 0.05, 3.65));
  scene.add(box(34, 0.26, 0.2, M.darkSteel, 4, convY - 0.05, 5.95));
  scene.add(box(34, 0.06, 2.2, M.black, 4, 0.55, 4.8));
  for (let x = -12; x <= 20; x += 1.35) {
    const roller = cyl(0.1, 0.1, 2.2, M.chrome, x, convY, 4.8, 12);
    roller.rotation.x = Math.PI / 2;
    roller.castShadow = false;
    scene.add(roller);
  }
  for (let x = -11; x <= 20; x += 4.4) {
    scene.add(box(0.16, 0.92, 0.16, M.steel, x, 0.46, 3.7));
    scene.add(box(0.16, 0.92, 0.16, M.steel, x, 0.46, 5.9));
  }
  // moulds with glowing pour cups
  const mouldUnits: { g: THREE.Group; cupMat: THREE.MeshStandardMaterial; base: number }[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    g.add(box(2.05, 1, 1.95, M.sand, 0, 0.5, 0));
    g.add(box(2.15, 0.14, 2.05, M.darkSteel, 0, 0.06, 0));
    g.add(box(2.15, 0.14, 2.05, M.darkSteel, 0, 0.94, 0));
    const cupMat = sm(0xff5a14, 0.6, 0, { emissive: 0xff3800, emissiveIntensity: 0 });
    const cup = cyl(0.2, 0.14, 0.09, cupMat, 0.4, 1.05, 0.3, 14);
    cup.castShadow = false;
    g.add(cup);
    g.position.set(-12 + i * 4.25, convY + 0.1, 4.8);
    scene.add(g);
    mouldUnits.push({ g, cupMat, base: -12 + i * 4.25 });
  }
  // avance de línea proporcional a KPIs.VelocidadLinea (nominal 1,5 m/min)
  let lineOff = 0;
  updaters.push(f => {
    lineOff += f.sdt * 0.5 * ((lkpi(f.live, "VelocidadLinea") ?? 1.5) / 1.5);
    for (const m of mouldUnits) {
      const x = -12 + ((m.base + 12 + lineOff) % 34);
      m.g.position.x = x;
      m.cupMat.emissiveIntensity = x < 1.4 ? 0 : x < 6.5 ? 2.3 : Math.max(0.25, 2.3 - (x - 6.5) * 0.3);
    }
  });

  /* ---- automatic pouring station ---- */
  const pour = new THREE.Group();
  pour.position.set(1, 0, 4.8);
  [-2.8, 2.8].forEach(px => {
    pour.add(box(0.5, 7.2, 0.6, M.steel, px, 3.6, 0));
    pour.add(box(0.7, 0.14, 0.8, M.darkSteel, px, 0.07, 0));
  });
  pour.add(box(6.4, 0.62, 0.72, M.steel, 0, 7.15, 0));
  pour.add(box(1.05, 0.5, 0.85, M.darkSteel, 0.55, 6.6, 0));
  const tiltGroup = new THREE.Group();
  tiltGroup.position.set(0.55, 5.1, 0);
  const ladleBody = cyl(1.05, 0.8, 1.8, M.lining, 0, -0.3, 0, 24);
  const ladleRim = mesh(new THREE.TorusGeometry(1.05, 0.08, 8, 26), M.darkSteel, 0, 0.58, 0);
  ladleRim.rotation.x = Math.PI / 2;
  const ladleMeltMat = sm(0xff5a14, 0.55, 0, { emissive: 0xff3800, emissiveIntensity: 2.1 });
  const ladleMelt = new THREE.Mesh(new THREE.CircleGeometry(0.92, 22), ladleMeltMat);
  ladleMelt.rotation.x = -Math.PI / 2; ladleMelt.position.y = 0.5;
  const spout = box(0.5, 0.3, 0.4, M.lining, 1.05, 0.42, 0);
  tiltGroup.add(ladleBody, ladleRim, ladleMelt, spout);
  pour.add(tiltGroup);
  pour.add(box(2.5, 0.06, 0.06, M.steel, 0.55, 5.65, 0));
  const streamMat = sm(0xff5a18, 0.5, 0, { emissive: 0xff3a00, emissiveIntensity: 2.6 });
  const stream = cyl(0.09, 0.06, 3.1, streamMat, 1.72, 3.35, 0, 10);
  stream.castShadow = false;
  pour.add(stream);
  const splash = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16), sm(0xffa040, 0.5, 0, { emissive: 0xff6a10, emissiveIntensity: 2.2 }));
  splash.rotation.x = -Math.PI / 2; splash.position.set(1.72, 2.02, 0);
  pour.add(splash);
  const pourGlow = new THREE.PointLight(0xff6a18, 0, 12, 1.8);
  pourGlow.position.set(1.72, 2.9, 0);
  pour.add(pourGlow);
  // safety railing around station
  [[0, 1.9, 6.4, 0], [0, 7.7, 6.4, 0]].forEach(([cx, cz, len]) => {
    pour.add(box(len as number, 0.07, 0.07, M.yellow, cx as number, 1.15, (cz as number) - 4.8));
    for (let px = -3; px <= 3; px += 1.5) pour.add(box(0.07, 1.15, 0.07, M.yellow, px + (cx as number), 0.57, (cz as number) - 4.8));
  });
  beacon("COL-01", "RUN", -3.4, 2.4, pour);
  addAsset("pour-01", pour);
  let tilt = 0.12;
  updaters.push(f => {
    const targetTilt = f.pouring ? 0.5 : 0.1;
    tilt += (targetTilt - tilt) * Math.min(1, f.sdt * 2.2);
    tiltGroup.rotation.z = -tilt;
    stream.visible = f.pouring;
    splash.visible = f.pouring;
    pourGlow.intensity = f.pouring ? 26 + Math.sin(f.wall * 17) * 7 : 0;
  });
  const pourSparks = makeSparks(160, texGlow, 0xffa24a, 0.14);
  scene.add(pourSparks.points);
  const pourOrigin = new THREE.Vector3(2.72, 1.95, 4.8);
  updaters.push(f => pourSparks.update(f.sdt, f.pouring ? pourOrigin : null, 130));
  const pourSmoke = makeSmoke(texSmoke, 6, 0x8a8f94, 3, 0.1);
  pourSmoke.group.position.set(2.7, 2.2, 4.8);
  scene.add(pourSmoke.group);
  updaters.push(f => pourSmoke.update(f.sdt, f.running && f.pouring));
  spawnRobot("rob-01", 4.9, 1.5, 2.4, 0.8, "cup", "RUN", 24.5);

  /* ---- cooling tunnel (line passes through) ---- */
  const cool = new THREE.Group();
  cool.position.set(12, 0, 4.8);
  cool.add(box(11, 4.4, 0.34, M.lining, 0, 2.3, 2.75));
  cool.add(box(11, 4.4, 0.34, M.lining, 0, 2.3, -2.75));
  cool.add(box(11.6, 0.32, 5.9, M.lining, 0, 4.66, 0));
  for (let rx = -4.5; rx <= 4.5; rx += 1.5) {
    cool.add(box(0.2, 4.4, 0.14, M.darkSteel, rx, 2.3, 2.95));
    cool.add(box(0.2, 4.4, 0.14, M.darkSteel, rx, 2.3, -2.95));
  }
  [[-5.5], [5.5]].forEach(([ex]) => {
    cool.add(box(0.22, 0.6, 5.9, M.yellow, ex, 4.5, 0));
    cool.add(box(0.22, 2.2, 1.5, M.lining, ex, 3.55, 2), box(0.22, 2.2, 1.5, M.lining, ex, 3.55, -2));
  });
  const heatMat = sm(0xff4a10, 0.6, 0, { emissive: 0xff3000, emissiveIntensity: 0.9, transparent: true, opacity: 0.5 });
  const heatPlane = box(0.05, 2.6, 2.4, heatMat, -5.45, 1.6, 0);
  heatPlane.castShadow = false;
  cool.add(heatPlane);
  updaters.push(f => { heatMat.emissiveIntensity = 0.75 + Math.sin(f.wall * 7.7) * 0.25; });
  const fans: THREE.Group[] = [];
  for (const fxo of [-3.5, -1.2, 1.2, 3.5]) {
    cool.add(cyl(0.72, 0.78, 0.5, M.darkSteel, fxo, 5.05, 0, 18));
    const blades = new THREE.Group();
    for (let b = 0; b < 3; b++) {
      const bl = box(1.25, 0.05, 0.16, M.lightSteel);
      bl.rotation.y = (b / 3) * Math.PI;
      blades.add(bl);
    }
    blades.position.set(fxo, 5.2, 0);
    cool.add(blades);
    fans.push(blades);
  }
  // velocidad de giro proporcional a ENF-01.VelocidadVentiladores (nominal 780 rpm)
  const fanPh = fans.map(() => Math.random() * 6);
  updaters.push(f => {
    const rpmK = (lnum(f.live, "ENF-01", "VelocidadVentiladores") ?? 780) / 780;
    fans.forEach((fan, i) => { fanPh[i] += f.sdt * (5 + i * 0.3) * rpmK; fan.rotation.y = fanPh[i]; });
  });
  cool.add(cyl(0.5, 0.5, 4.2, M.lining, 3, 7.2, 0));
  cool.add(mesh(new THREE.SphereGeometry(0.55, 14, 10), M.lining, 3, 9.3, 0));
  const coolDuct = cyl(0.5, 0.5, 21.5, M.lining, 3, 9.3, -11.5); coolDuct.rotation.x = Math.PI / 2; cool.add(coolDuct);
  beacon("ENF-01", "RUN", -5.2, 3.4, cool);
  addAsset("cool-01", cool);

  /* ---- shakeout at end of line ---- */
  const shake = new THREE.Group();
  shake.position.set(23, 0, 4.8);
  [[-1.8, -1.5], [1.8, -1.5], [-1.8, 1.5], [1.8, 1.5]].forEach(([sx, sz]) => shake.add(cyl(0.17, 0.2, 0.5, M.yellow, sx, 0.25, sz, 12)));
  shake.add(box(4.6, 0.9, 3.9, M.darkSteel, 0, 0.95, 0));
  const grate = new THREE.Group();
  grate.add(box(4.1, 0.28, 3.4, M.lining, 0, 0, 0));
  for (let bz = -1.4; bz <= 1.4; bz += 0.35) grate.add(box(3.9, 0.08, 0.12, M.steel, 0, 0.2, bz));
  const hotMat = sm(0x5c4038, 0.62, 0.42, { emissive: 0x7a1c00, emissiveIntensity: 0.32 });
  [[-1, 0.55, -0.6], [0.8, 0.55, 0.5], [0.1, 0.55, -1]].forEach(([cx, cy, cz]) => {
    grate.add(box(1.1, 0.55, 0.8, hotMat, cx, cy, cz));
    grate.add(cyl(0.28, 0.28, 0.7, hotMat, cx, cy + 0.2, cz + 0.25, 12));
  });
  grate.position.y = 1.55;
  shake.add(grate);
  // vibra solo cuando DES-01 está en MARCHA según OPC UA, a su frecuencia real
  const shakeRunning = (f: Frame) => {
    const est = lval(f.live, "DES-01", "Estado");
    return f.running && (typeof est === "string" ? est === "RUN" : true);
  };
  let shPh = 0;
  updaters.push(f => {
    if (shakeRunning(f)) {
      shPh += f.sdt * 42 * ((lnum(f.live, "DES-01", "FrecuenciaVibracion") ?? 24) / 24);
      grate.position.x = Math.sin(shPh) * 0.03;
      grate.position.y = 1.55 + Math.abs(Math.sin(shPh)) * 0.02;
    } else {
      grate.position.x = 0;
      grate.position.y = 1.55;
    }
  });
  shake.add(cyl(1.35, 0.35, 1.1, M.steel, 0, -0.1, 0, 4));
  // dust hood + cyclone collector
  shake.add(box(4.7, 0.5, 3.9, M.lining, 0, 5, 0));
  [[-2.1, -1.7], [2.1, -1.7], [-2.1, 1.7], [2.1, 1.7]].forEach(([sx, sz]) => shake.add(box(0.12, 4.4, 0.12, M.steel, sx, 2.9, sz)));
  const hoodDuct = cyl(0.42, 0.42, 4.6, M.lining, 2.4, 5.6, -1.4);
  hoodDuct.rotation.z = Math.PI / 2.4; hoodDuct.rotation.y = 0.5;
  shake.add(hoodDuct);
  beacon("DES-01", "IDLE", -2.6, 2.3, shake);
  addAsset("shake-01", shake);
  const cyclone = new THREE.Group();
  cyclone.position.set(27.6, 0, 1.6);
  cyclone.add(cyl(0.95, 0.95, 2.3, M.lightSteel, 0, 4.4, 0, 22));
  cyclone.add(cyl(0.95, 0.22, 2.1, M.lightSteel, 0, 2.2, 0, 22));
  cyclone.add(cyl(0.22, 0.22, 1.2, M.steel, 0, 0.75, 0, 14));
  cyclone.add(box(1.1, 0.9, 1.1, M.darkSteel, 0, 0.45, 0));
  cyclone.add(cyl(0.3, 0.3, 4.2, M.lightSteel, 0, 7.5, 0, 14));
  for (let i = 0; i < 3; i++) cyclone.add(box(0.12, 5.4, 0.12, M.steel, i === 0 ? -1.15 : 1.15, 2.7, i === 2 ? -1.15 : 1.15));
  scene.add(cyclone);
  const shakeSparks = makeSparks(60, texGlow, 0xffc060, 0.1);
  scene.add(shakeSparks.points);
  const shakeOrigin = new THREE.Vector3(23, 2, 4.8);
  updaters.push(f => shakeSparks.update(f.sdt, shakeRunning(f) && Math.sin(f.sim * 0.9) > 0.55 ? shakeOrigin : null, 40));
  spawnRobot("rob-02", 24.4, 8.1, -2, 2.6, "gripper", "RUN", 21.2);

  /* ---- quality cell ---- */
  const qc = new THREE.Group();
  qc.position.set(23.5, 0, 12);
  qc.add(box(6, 0.18, 5.6, M.lightSteel, 0, 0.09, 0));
  [[-2.85, -2.65], [2.85, -2.65], [-2.85, 2.65], [2.85, 2.65]].forEach(([cx, cz]) => qc.add(box(0.22, 3.5, 0.22, M.lightSteel, cx, 1.75, cz)));
  qc.add(box(6, 0.22, 0.22, M.lightSteel, 0, 3.5, -2.65), box(6, 0.22, 0.22, M.lightSteel, 0, 3.5, 2.65));
  qc.add(box(0.22, 0.22, 5.5, M.lightSteel, -2.85, 3.5, 0), box(0.22, 0.22, 5.5, M.lightSteel, 2.85, 3.5, 0));
  const glassPanel = (w: number, x: number, z: number, ry: number) => {
    const p = box(w, 3.1, 0.04, M.glass, x, 1.85, z);
    p.rotation.y = ry; p.castShadow = false;
    qc.add(p);
  };
  glassPanel(5.6, 0, -2.65, 0); glassPanel(5.2, -2.85, 0, Math.PI / 2); glassPanel(5.2, 2.85, 0, Math.PI / 2); glassPanel(2.4, 1.6, 2.65, 0);
  const turntable = new THREE.Group();
  turntable.add(cyl(0.95, 1.05, 0.35, M.darkSteel, 0, 0.18, 0, 26));
  const qcPart = new THREE.Group();
  qcPart.add(box(1.4, 0.5, 1, M.casting, 0, 0.62, 0));
  qcPart.add(cyl(0.32, 0.32, 0.6, M.casting, 0.25, 1.05, 0, 16));
  turntable.add(qcPart);
  turntable.position.set(-0.4, 0.18, 0);
  qc.add(turntable);
  const scanHead = new THREE.Group();
  scanHead.add(box(0.35, 0.35, 0.5, M.black, 0, 3.1, 0));
  scanHead.add(box(2.6, 3, 0.02, new THREE.MeshBasicMaterial({ color: 0x35e0e8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 1.6, 0));
  scanHead.position.set(-0.4, 0, 0);
  qc.add(scanHead);
  const scanLight = new THREE.PointLight(0x2ce0da, 9, 8, 1.8);
  scanLight.position.set(-0.4, 2.6, 0);
  qc.add(scanLight);
  let qcPh = 0;
  updaters.push(f => {
    if (lrun(f.live, "QC-01") ?? true) qcPh += f.sdt;
    turntable.rotation.y = qcPh * 0.7;
    scanHead.position.z = Math.sin(qcPh * 0.65) * 1.7;
    scanLight.intensity = 7 + Math.sin(f.wall * 5.2) * 2.5;
  });
  // operator console
  qc.add(box(0.5, 1.1, 0.5, M.cabinet, 3.6, 0.55, 1.4));
  const qcScreen = box(0.9, 0.6, 0.05, sm(0x0d2027, 0.3, 0, { emissive: 0x2a8fa0, emissiveIntensity: 1.1 }), 3.6, 1.55, 1.4);
  qcScreen.rotation.y = -0.7; qcScreen.castShadow = false;
  qc.add(qcScreen);
  beacon("QC-01", "RUN", -3.4, -2.2, qc);
  addAsset("qc-01", qc);
  spawnRobot("rob-03", -6.3, 8.4, Math.PI + 0.5, 4.1, "gripper", "RUN", 16.8);

  /* ---- finished goods pallets ---- */
  const pallet = (px: number, pz: number, stack: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) g.add(box(1.9, 0.09, 0.28, M.sand, 0, 0.1, -0.7 + i * 0.7));
    g.add(box(1.9, 0.07, 1.8, M.sand, 0, 0.18, 0));
    for (let s = 0; s < stack; s++) {
      g.add(box(1.3, 0.42, 0.9, M.casting, (s % 2) * 0.15 - 0.05, 0.45 + s * 0.46, 0));
      g.add(cyl(0.24, 0.24, 0.5, M.casting, 0.3 - (s % 2) * 0.4, 0.62 + s * 0.46, 0.15, 14));
    }
    g.position.set(px, 0, pz);
    scene.add(g);
  };
  pallet(27.6, 12.8, 2); pallet(27.6, 15.2, 3); pallet(25.2, 15.4, 1);

  /* ---- perimeter safety fencing ---- */
  const fenceRun = (x1: number, x2: number, z: number) => {
    const len = x2 - x1, cx = (x1 + x2) / 2;
    scene.add(box(len, 0.06, 0.06, M.yellow, cx, 1.18, z));
    scene.add(box(len, 0.05, 0.05, M.yellow, cx, 0.74, z));
    scene.add(box(len, 0.22, 0.03, M.darkSteel, cx, 0.13, z));
    for (let x = x1; x <= x2; x += 2) scene.add(box(0.08, 1.25, 0.08, M.yellow, x, 0.62, z));
  };
  fenceRun(-28, -1, 15.6); fenceRun(5, 22, 15.6);
  fenceRun(-28, -10, -13.9); // fence in front of furnace bay

  /* ---- dust motes ---- */
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(220 * 3);
  for (let i = 0; i < 220; i++) {
    motePos[i * 3] = (Math.random() - 0.5) * 56;
    motePos[i * 3 + 1] = 0.5 + Math.random() * 11;
    motePos[i * 3 + 2] = (Math.random() - 0.5) * 33;
  }
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.06, map: texGlow, color: 0x9fb4c0, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  scene.add(motes);
  updaters.push(f => { motes.rotation.y = f.wall * 0.004; motes.position.y = Math.sin(f.wall * 0.11) * 0.25; });

  /* ---- camera controls ---- */
  let azimuth = 0.62, elevation = 0.5, distance = 56;
  let dragging = false, panning = false, lastX = 0, lastY = 0, moved = false;
  const updateCamera = () => {
    camera.position.set(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    camera.lookAt(target);
  };
  updateCamera();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    composer.setSize(rect.width, rect.height);
    camera.aspect = rect.width / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
  };
  resize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const down = (e: PointerEvent) => {
    dragging = true; moved = false; panning = e.button === 2 || e.shiftKey;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    if (panning) {
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const upv = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      target.addScaledVector(right, -dx * distance * 0.0011);
      target.addScaledVector(upv, dy * distance * 0.0011);
      target.x = Math.max(-26, Math.min(28, target.x));
      target.z = Math.max(-16, Math.min(17, target.z));
      target.y = Math.max(0, Math.min(8, target.y));
    } else {
      azimuth -= dx * 0.006;
      elevation = Math.max(0.14, Math.min(1.2, elevation + dy * 0.004));
    }
    lastX = e.clientX; lastY = e.clientY;
    updateCamera();
  };
  const up = (e: PointerEvent) => {
    dragging = false;
    if (moved || panning) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(clickable, false)[0];
    if (hit?.object.userData.assetId) onSelect(hit.object.userData.assetId);
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    distance = Math.max(22, Math.min(95, distance + e.deltaY * 0.04));
    updateCamera();
  };
  const ctx = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", ctx);
  window.addEventListener("resize", resize);

  /* ---- main loop ---- */
  const clock = new THREE.Clock();
  let sim = 0, raf = 0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    const wall = clock.elapsedTime;
    const { running, speed, live } = ctl.current;
    const sdt = running ? dt * speed : 0;
    sim += sdt;
    // la colada la manda OPC UA (COL-01.Colando); sin conexión, ciclo interno
    const liveColando = live?.assets?.["COL-01"]?.Colando?.v;
    const pouring = running && (typeof liveColando === "boolean" ? liveColando : Math.sin(sim * 0.5) > -0.2);
    const frame: Frame = { wall, sim, dt, sdt, running, pouring, live };
    for (const u of updaters) u(frame);
    composer.render();
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("contextmenu", ctx);
    composer.dispose();
    pmrem.dispose();
    envTex.dispose();
    [texConcrete, texCorru, texCorru2, texHazard, texGlow, texSmoke].forEach(t => t.dispose());
    scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach(x => x.dispose());
    });
    renderer.dispose();
  };
}

export function useFoundryScene(canvasRef: RefObject<HTMLCanvasElement | null>, onSelect: (id: string) => void, running: boolean, speed: number, liveSnap: LiveSnapshot | null = null) {
  const ctl = useRef<{ running: boolean; speed: number; live: LiveSnapshot | null }>({ running, speed, live: liveSnap });
  useEffect(() => {
    ctl.current.running = running;
    ctl.current.speed = speed;
  }, [running, speed]);
  useEffect(() => {
    ctl.current.live = liveSnap;
  }, [liveSnap]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return createFoundryScene(canvas, onSelect, ctl);
  }, [canvasRef, onSelect]);
}
