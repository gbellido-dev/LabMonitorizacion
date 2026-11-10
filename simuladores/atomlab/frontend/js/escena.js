// Escena 3D de la central RBMK: edificio del reactor en corte, sala de turbinas, torre de refrigeración.
// Todas las medidas en metros. y = altura. El reactor está en el origen.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as T from "./texturas.js";

const NUCLEO = { radio: 5.9, reflector: 6.9, paso: 0.25, base: 8.0, alto: 7.0 };
NUCLEO.techo = NUCLEO.base + NUCLEO.alto;
const ELENA = { radio: 8.6, alto: 3.0 };            // losa superior (esquema "E")
const SUELO_SALA = NUCLEO.techo + 0.5 + ELENA.alto;  // suelo de la sala central

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1);
const ARRIBA = new THREE.Vector3(0, 1, 0);

function colorCuerpoNegro(tc) {
  // color aproximado de un cuerpo a temperatura tc (°C), para la luz de los canales
  const t = THREE.MathUtils.clamp((tc - 250) / 2600, 0, 1);
  const c = new THREE.Color();
  if (t < 0.35) c.setRGB(0.55 + t, 0.08 + 0.5 * t, 0.02);
  else if (t < 0.7) c.setRGB(1, 0.25 + (t - 0.35) * 1.6, 0.05 + (t - 0.35) * 0.4);
  else c.setRGB(1, 0.8 + (t - 0.7) * 0.6, 0.2 + (t - 0.7) * 2.2);
  return c;
}

function colorDosis(msvh) {
  const l = Math.log10(Math.max(1e-4, msvh));         // -4 .. 5
  const t = THREE.MathUtils.clamp((l + 4) / 9, 0, 1);
  return new THREE.Color().setHSL(0.36 * (1 - t), 0.95, 0.5);
}

export class Central3D {
  constructor(contenedor, { calidad = "alta" } = {}) {
    this.contenedor = contenedor;
    this.calidad = calidad;
    this.estado = null;
    this.visual = { rr: 0.27, ar: 0.5, usp: 0.4, az: 0, vacio: 20, n: 1, tc: 800, rpm: 3000, bombas: 6 };
    this.corte = true;
    this.verRadiacion = false;
    this.reloj = new THREE.Timer();
    this.fps = 0;
    this.animables = [];
    this.flujos = [];
    this.accidente = null;

    this._renderer();
    this._entorno();
    this._materiales();
    this._terreno();
    this._edificioReactor();
    this._nucleo();
    this._circuito();
    this._salaTurbinas();
    this._torre();
    this._chimenea();
    this._exteriores();
    this._particulas();
    this._radiacion();
    this._etiquetas();
    this._post();
    this.ponerCorte(true);
    this.vista("general", 0);

    new ResizeObserver(() => this._tamano()).observe(contenedor);
    this._tamano();
    this.renderer.setAnimationLoop(() => this._fotograma());
  }

  // ------------------------------------------------------------------ base
  _renderer() {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    r.setPixelRatio(this.calidad === "baja" ? 1 : Math.min(window.devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.localClippingEnabled = true;
    this.contenedor.appendChild(r.domElement);
    this.renderer = r;

    this.escena = new THREE.Scene();
    this.camara = new THREE.PerspectiveCamera(40, 1, 0.3, 6000);
    this.controles = new OrbitControls(this.camara, r.domElement);
    this.controles.enableDamping = true;
    this.controles.maxPolarAngle = Math.PI * 0.495;
    this.controles.minDistance = 4;
    this.controles.maxDistance = 1400;

    this.etiquetasRenderer = new CSS2DRenderer();
    this.etiquetasRenderer.domElement.className = "capa-etiquetas";
    this.contenedor.appendChild(this.etiquetasRenderer.domElement);
  }

  _entorno() {
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
    const elev = THREE.MathUtils.degToRad(32), azim = THREE.MathUtils.degToRad(55);   // sol detrás de la cámara general
    this.sol = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - elev, azim);
    u.sunPosition.value.copy(this.sol);
    this.escena.add(sky);
    this.cielo = sky;

    // iluminación basada en imagen a partir del propio cielo
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const esc = new THREE.Scene();
    const cieloSinSol = new Sky();
    cieloSinSol.scale.setScalar(5000);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) cieloSinSol.material.uniforms[k].value = u[k].value;
    cieloSinSol.material.uniforms.sunPosition.value.copy(this.sol);
    if (cieloSinSol.material.uniforms.showSunDisc) cieloSinSol.material.uniforms.showSunDisc.value = false;
    esc.add(cieloSinSol);
    this.escena.environment = pmrem.fromScene(esc, 0.04).texture;
    this.escena.environmentIntensity = 0.3;
    this.escena.fog = new THREE.FogExp2(0xaebccb, 0.00055);

    const sol = new THREE.DirectionalLight(0xfff1dc, 3.2);
    sol.position.copy(this.sol).multiplyScalar(400).add(new THREE.Vector3(50, 0, -30));
    sol.target.position.set(50, 0, -30);
    sol.castShadow = true;
    const sombra = { alta: 4096, media: 2048, baja: 1024 }[this.calidad] ?? 2048;
    sol.shadow.mapSize.set(sombra, sombra);
    const s = sol.shadow.camera;
    s.left = -190; s.right = 190; s.top = 190; s.bottom = -190; s.near = 10; s.far = 1000;
    sol.shadow.bias = -0.0004; sol.shadow.normalBias = 0.6;
    this.escena.add(sol, sol.target);
    this.escena.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a5040, 0.35));
  }

  _materiales() {
    // planos de corte: se elimina el cuadrante x>0, z>0 del edificio del reactor
    this.planosCorte = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)];
    const corte = (m) => { m.clipIntersection = true; m.clippingPlanes = this.planosCorte; m.side = THREE.DoubleSide; m.userData.corte = true; return m; };
    const rug = T.rugosidad();
    this.m = {
      hormigon: new THREE.MeshStandardMaterial({ map: T.hormigon([6, 6], [150, 147, 140]), roughnessMap: rug, roughness: 0.95, metalness: 0 }),
      hormigonCorte: corte(new THREE.MeshStandardMaterial({ map: T.hormigon([3, 3], [152, 148, 140]), roughnessMap: rug, roughness: 0.95 })),
      hormigonClaro: new THREE.MeshStandardMaterial({ map: T.hormigon([10, 10], [196, 192, 184]), roughness: 0.92 }),
      fachada: corte(new THREE.MeshStandardMaterial({ map: T.ventanas(6, 18), roughness: 0.85 })),
      chapa: new THREE.MeshStandardMaterial({ map: T.chapa(), roughness: 0.7, metalness: 0.3 }),
      grafito: corte(new THREE.MeshStandardMaterial({ map: T.grafito(), color: 0x9a9a9a, roughness: 0.55, metalness: 0.15 })),
      acero: new THREE.MeshStandardMaterial({ map: T.acero(), roughness: 0.38, metalness: 0.9 }),
      aceroCorte: corte(new THREE.MeshStandardMaterial({ map: T.acero([130, 136, 140]), roughness: 0.42, metalness: 0.85 })),
      aceroOscuro: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.5, metalness: 0.8 }),
      tuberia: new THREE.MeshStandardMaterial({ map: T.pintura("#c9cdc8", 0.3), roughness: 0.55, metalness: 0.35 }),
      aislamiento: new THREE.MeshStandardMaterial({ map: T.acero([206, 208, 204]), roughness: 0.45, metalness: 0.6 }),
      verdeTurbina: new THREE.MeshStandardMaterial({ map: T.pintura("#6f9a8c", 0.25), roughness: 0.5, metalness: 0.35 }),
      amarillo: new THREE.MeshStandardMaterial({ map: T.pintura("#e0a91c", 0.3), roughness: 0.5, metalness: 0.35 }),
      rojo: new THREE.MeshStandardMaterial({ map: T.pintura("#a8312b", 0.3), roughness: 0.6, metalness: 0.2 }),
      azul: new THREE.MeshStandardMaterial({ map: T.pintura("#35648f", 0.25), roughness: 0.55, metalness: 0.3 }),
      motor: new THREE.MeshStandardMaterial({ map: T.pintura("#58707a", 0.25), roughness: 0.5, metalness: 0.45 }),
      franjas: new THREE.MeshStandardMaterial({ map: T.franjas(10), roughness: 0.75 }),
      b4c: new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.4, metalness: 0.7 }),
      desplazador: new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 0.5, metalness: 0.3 }),
      agua: new THREE.MeshPhysicalMaterial({ color: 0x2a6f9c, roughness: 0.08, metalness: 0, transmission: 0.25, transparent: true, opacity: 0.85 }),
    };
    corte(this.m.desplazador); corte(this.m.b4c);
    this.m.desplazador.side = this.m.b4c.side = THREE.FrontSide;
    // canales de combustible: emisión con perfil axial y color por instancia (reparto radial de potencia)
    this.m.canal = corte(new THREE.MeshStandardMaterial({ color: 0x3a2a20, emissive: 0xff6a1a, emissiveMap: T.degradadoAxial(), emissiveIntensity: 1, roughness: 0.4, metalness: 0.4 }));
    this.m.canal.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader.replace("#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\n totalEmissiveRadiance *= vColor;\n#endif");
    };
  }

  _malla(geo, mat, { x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sombra = true, padre = this.escena } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = sombra; m.receiveShadow = true;
    padre.add(m);
    return m;
  }

  _tubo(puntos, radio, mat, { flujo = null, segmentos = 64, padre = this.escena, sombra = true } = {}) {
    const curva = new THREE.CatmullRomCurve3(puntos.map((p) => new THREE.Vector3(...p)), false, "catmullrom", 0.05);
    const geo = new THREE.TubeGeometry(curva, segmentos, radio, 14, false);
    const m = this._malla(geo, mat, { padre, sombra });
    if (flujo) {
      const tex = T.flujo(flujo.color);
      tex.repeat.set(Math.max(2, curva.getLength() / 6), 1);
      const capa = new THREE.Mesh(new THREE.TubeGeometry(curva, segmentos, radio * 1.02, 14, false),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
      padre.add(capa);
      this.flujos.push({ tex, capa, clave: flujo.clave, velocidad: flujo.velocidad ?? 1 });
    }
    return m;
  }

  // ------------------------------------------------------------------ terreno y exteriores
  _terreno() {
    const suelo = this._malla(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: T.suelo(), roughness: 1 }), { rx: -Math.PI / 2, sombra: false });
    suelo.position.y = -0.02;
    const asf = new THREE.MeshStandardMaterial({ map: T.asfalto(), roughness: 0.95 });
    this._malla(new THREE.PlaneGeometry(260, 220), asf, { x: 45, y: 0, z: -30, rx: -Math.PI / 2, sombra: false });
    this._malla(new THREE.PlaneGeometry(14, 900), asf, { x: -60, y: 0.01, z: 0, rx: -Math.PI / 2, sombra: false });
  }

  _exteriores() {
    // transformadores principales y línea de alta tensión
    for (const x of [62, 92]) {
      const g = new THREE.Group(); g.position.set(x, 0, 34); this.escena.add(g);
      this._malla(new THREE.BoxGeometry(9, 1, 6), this.m.hormigonClaro, { y: 0.5, padre: g });
      this._malla(new THREE.BoxGeometry(6, 5, 4), this.m.motor, { y: 3.5, padre: g });
      for (let i = -2; i <= 2; i++) this._malla(new THREE.BoxGeometry(0.15, 3.6, 3.6), this.m.aceroOscuro, { x: i * 1.1, y: 3.4, z: 2.4, padre: g });
      for (let i = -1; i <= 1; i++) this._malla(new THREE.CylinderGeometry(0.18, 0.28, 3, 10), this.m.hormigonClaro, { x: i * 1.8, y: 7.4, padre: g });
    }
    const torreAT = (x, z) => {
      const g = new THREE.Group(); g.position.set(x, 0, z); this.escena.add(g);
      const perfil = new THREE.BoxGeometry(0.35, 32, 0.35);
      for (const [a, b] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) {
        const p = this._malla(perfil, this.m.aceroOscuro, { x: a * 0.6, y: 16, z: b * 0.6, padre: g });
        p.rotation.set(-b * 0.03, 0, a * 0.03);
      }
      this._malla(new THREE.BoxGeometry(14, 0.5, 0.5), this.m.aceroOscuro, { y: 30, padre: g });
      this._malla(new THREE.BoxGeometry(9, 0.4, 0.4), this.m.aceroOscuro, { y: 24, padre: g });
      return g;
    };
    torreAT(78, 70); torreAT(78, 190); torreAT(78, 310);
    const cable = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (const dx of [-6.5, 0, 6.5]) {
      for (const [z0, z1] of [[70, 190], [190, 310]]) {
        const pts = [];
        for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([78 + dx, 29.6 - 6 * Math.sin(Math.PI * t), z0 + (z1 - z0) * t]); }
        this._tubo(pts, 0.05, cable, { segmentos: 30, sombra: false });
      }
    }
    // vallado y edificios auxiliares (unidad vecina, a la izquierda)
    this._malla(new THREE.BoxGeometry(50, 28, 36), this.m.hormigon, { x: -52, y: 14, z: 0 });
    this._malla(new THREE.BoxGeometry(46, 6, 30), this.m.chapa, { x: -52, y: 31, z: 0 });
    this._malla(new THREE.BoxGeometry(30, 12, 22), this.m.hormigonClaro, { x: 5, y: 6, z: 42 });
    this._malla(new THREE.BoxGeometry(30, 0.8, 22), this.m.aceroOscuro, { x: 5, y: 12.4, z: 42 });
    // árboles (pinos) instanciados
    const tronco = new THREE.CylinderGeometry(0.25, 0.35, 6, 6).translate(0, 3, 0);
    const copa = new THREE.ConeGeometry(2.6, 9, 8).translate(0, 9.5, 0);
    const mt = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), mc = new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 0.95 });
    const N = 600, it = new THREE.InstancedMesh(tronco, mt, N), ic = new THREE.InstancedMesh(copa, mc, N);
    let k = 0;
    while (k < N) {
      const a = Math.random() * Math.PI * 2, r = 240 + Math.random() * 500;
      const x = Math.cos(a) * r + 40, z = Math.sin(a) * r - 40;
      if (Math.abs(x - 78) < 25 && z > 40) continue;
      const s = 0.7 + Math.random() * 0.8;
      tmpM.compose(tmpV.set(x, 0, z), tmpQ.setFromAxisAngle(ARRIBA, Math.random() * 6), tmpS.set(s, s * (0.8 + Math.random() * 0.5), s));
      it.setMatrixAt(k, tmpM); ic.setMatrixAt(k, tmpM); k++;
    }
    tmpS.set(1, 1, 1);
    ic.castShadow = true;
    this.escena.add(it, ic);
  }

  // ------------------------------------------------------------------ edificio del reactor
  _edificioReactor() {
    const g = new THREE.Group(); this.escena.add(g); this.edificio = g;
    const H = 52, A = 19;            // altura y semiancho del bloque del reactor
    // muros exteriores con fachada y losas (todo cortado por el cuadrante)
    const muro = (w, h, d, x, y, z, mat = this.m.hormigonCorte) => this._malla(new THREE.BoxGeometry(w, h, d), mat, { x, y, z, padre: g });
    muro(2 * A, H, 1, 0, H / 2, A);   muro(2 * A, H, 1, 0, H / 2, -A);
    muro(1, H, 2 * A, A, H / 2, 0);   muro(1, H, 2 * A, -A, H / 2, 0);
    const fachada = (w, x, z, ry) => this._malla(new THREE.PlaneGeometry(w, 18), this.m.fachada, { x, y: 9.5, z, ry, padre: g });
    fachada(2 * A, 0, A + 0.55, 0); fachada(2 * A, A + 0.55, 0, Math.PI / 2);
    this.techo = muro(2 * A + 1, 1.2, 2 * A + 1, 0, H + 0.6);
    // losas interiores
    for (const y of [3.5, SUELO_SALA]) {
      const forma = new THREE.Shape();
      forma.moveTo(-A, -A); forma.lineTo(A, -A); forma.lineTo(A, A); forma.lineTo(-A, A);
      const hueco = new THREE.Path(); hueco.absarc(0, 0, y > 10 ? ELENA.radio + 0.05 : 7.8, 0, Math.PI * 2, true);
      forma.holes.push(hueco);
      this._malla(new THREE.ExtrudeGeometry(forma, { depth: 0.8, bevelEnabled: false }).rotateX(Math.PI / 2), this.m.hormigonCorte, { y: y, padre: g });
    }
    // bóveda de hormigón alrededor del núcleo y depósito de agua anular (blindaje lateral)
    this._malla(new THREE.CylinderGeometry(10.5, 10.5, SUELO_SALA - 3.5, 64, 1, true), this.m.hormigonCorte, { y: (SUELO_SALA + 3.5) / 2, padre: g });
    this._malla(new THREE.CylinderGeometry(9.2, 9.2, NUCLEO.alto + 2, 64, 1, true), this.m.aceroCorte, { y: NUCLEO.base + NUCLEO.alto / 2, padre: g });
    // grúa puente de la sala central y máquina de recarga
    const yG = H - 6;
    for (const z of [-15, 15]) this._malla(new THREE.BoxGeometry(2 * A - 2, 1.2, 0.8), this.m.amarillo, { y: yG, z, padre: g });
    this.grua = this._malla(new THREE.BoxGeometry(3, 2, 30), this.m.amarillo, { x: -6, y: yG + 1, padre: g });
    const recarga = new THREE.Group(); recarga.position.set(-4.5, SUELO_SALA, -1.5); g.add(recarga);
    for (const [x, z] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) this._malla(new THREE.BoxGeometry(0.8, 9, 0.8), this.m.amarillo, { x, y: 4.5, z, padre: recarga });
    this._malla(new THREE.BoxGeometry(9.5, 1.4, 7.5), this.m.amarillo, { y: 9.3, padre: recarga });
    this._malla(new THREE.CylinderGeometry(1.4, 1.4, 7, 24), this.m.motor, { y: 7, padre: recarga });
    this._malla(new THREE.BoxGeometry(2.2, 1.6, 2.2), this.m.rojo, { y: 11, padre: recarga });
    // lámparas de la sala central
    for (const [x, z] of [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, 0]]) {
      const l = new THREE.PointLight(0xfff3df, 70, 45, 1.6); l.position.set(x, H - 3, z); g.add(l);
    }
    const lb = new THREE.PointLight(0xffe2c0, 90, 30, 1.6); lb.position.set(8, 6, 8); g.add(lb);
  }

  // ------------------------------------------------------------------ núcleo
  _nucleo() {
    const g = new THREE.Group(); this.escena.add(g); this.reactor = g;
    const { paso, radio, reflector, base, alto } = NUCLEO;
    const columnas = [], canales = [], control = [];
    const n = Math.ceil(reflector / paso);
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const x = i * paso, z = j * paso, r = Math.hypot(x, z);
        if (r > reflector) continue;
        columnas.push([x, z, r]);
        if (r <= radio) (i % 3 === 0 && j % 3 === 0 && r > 0.3 ? control : canales).push([x, z, r]);
      }
    }
    // bloques de grafito: columnas de 0,25 × 0,25 m (incluye los reflectores superior e inferior)
    const geoCol = new THREE.BoxGeometry(paso * 0.985, alto + 1.0, paso * 0.985);
    const col = new THREE.InstancedMesh(geoCol, this.m.grafito, columnas.length);
    columnas.forEach(([x, z], k) => { tmpM.makeTranslation(x, base + alto / 2, z); col.setMatrixAt(k, tmpM); });
    col.receiveShadow = true;
    g.add(col);
    // canales de combustible: tubo de circonio con 2 haces de 18 barras de UO2 (se ve el brillo)
    const geoCanal = new THREE.CylinderGeometry(0.044, 0.044, alto, 10, 1, false);
    this.canales = new THREE.InstancedMesh(geoCanal, this.m.canal, canales.length);
    this.radiosCanal = new Float32Array(canales.length);
    canales.forEach(([x, z, r], k) => {
      tmpM.makeTranslation(x, base + alto / 2, z); this.canales.setMatrixAt(k, tmpM);
      this.radiosCanal[k] = r;
      this.canales.setColorAt(k, new THREE.Color(1, 1, 1));
    });
    g.add(this.canales);
    // barras de control: absorbente de B4C + desplazador de grafito (telescopio de 1,25 m)
    const gruposOrden = [];
    control.sort((a, b) => a[2] - b[2]);
    control.forEach((c, k) => {
      let grupo = "RR";
      if (k % 9 === 4 && gruposOrden.filter((x) => x === "AR").length < 12) grupo = "AR";
      else if (k % 8 === 1) grupo = "AZ";
      else if (k % 8 === 5) grupo = "USP";
      gruposOrden.push(grupo);
    });
    this.barras = { pos: control, grupo: gruposOrden };
    const geoAbs = new THREE.CylinderGeometry(0.041, 0.041, 1, 10).translate(0, 0.5, 0);     // origen en el extremo inferior
    const geoDes = new THREE.CylinderGeometry(0.04, 0.04, 1, 10).translate(0, 0.5, 0);
    this.absorbentes = new THREE.InstancedMesh(geoAbs, this.m.b4c, control.length);
    this.desplazadores = new THREE.InstancedMesh(geoDes, this.m.desplazador, control.length);
    g.add(this.absorbentes, this.desplazadores);
    // agua en los canales de control (se ve donde no hay barra: azul)
    const agua = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.039, 0.039, alto, 8), Object.assign(this.m.agua.clone(), { opacity: 0.6 }), control.length);
    agua.material.clippingPlanes = this.planosCorte; agua.material.clipIntersection = true;
    control.forEach(([x, z], k) => { tmpM.makeTranslation(x, base + alto / 2, z); agua.setMatrixAt(k, tmpM); });
    g.add(agua);

    // losa superior "Elena" (esquema E) y losa inferior (esquema OR)
    this.elena = new THREE.Group(); this.elena.position.y = NUCLEO.techo + 0.5; g.add(this.elena);
    this._malla(new THREE.CylinderGeometry(ELENA.radio, ELENA.radio, ELENA.alto, 72), this.m.aceroCorte, { y: ELENA.alto / 2, padre: this.elena });
    this._malla(new THREE.CylinderGeometry(ELENA.radio, ELENA.radio, 2, 72), this.m.aceroCorte, { y: base - 1.5, padre: g });
    // tapas de los canales en el suelo de la sala central ("pyatachok"): acero y colores por grupo de barras
    const tapas = new THREE.InstancedMesh(new THREE.BoxGeometry(paso * 0.9, 0.12, paso * 0.9), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.7 }), canales.length + control.length);
    const colorGrupo = { RR: 0xd8d2c0, AR: 0x3fa34d, USP: 0xd8b23a, AZ: 0xc0392b };
    [...canales.map((c) => [c, null]), ...control.map((c, k) => [c, gruposOrden[k]])].forEach(([[x, z], gr], k) => {
      tmpM.makeTranslation(x, ELENA.alto + 0.06, z); tapas.setMatrixAt(k, tmpM);
      tapas.setColorAt(k, new THREE.Color(gr ? colorGrupo[gr] : 0x8b9095));
    });
    tapas.receiveShadow = true;
    this.elena.add(tapas);
    // servomotores de las barras sobre las tapas de control
    const servos = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 8).translate(0, 0.55, 0), this.m.aceroOscuro, control.length);
    control.forEach(([x, z], k) => { tmpM.makeTranslation(x, ELENA.alto + 0.12, z); servos.setMatrixAt(k, tmpM); });
    servos.castShadow = true;
    this.elena.add(servos);
    // líneas inferiores de agua (una de cada 6 canales, para no saturar)
    const lineas = canales.filter((_, k) => k % 6 === 0);
    const geoL = new THREE.CylinderGeometry(0.03, 0.03, base - 4.5, 6).translate(0, (base - 4.5) / 2 + 4.3, 0);
    const lin = new THREE.InstancedMesh(geoL, this.m.aceroCorte, lineas.length);
    lineas.forEach(([x, z], k) => { tmpM.makeTranslation(x * 1.15, 0, z * 1.15); lin.setMatrixAt(k, tmpM); });
    g.add(lin);

    // luz del núcleo (ilumina la bóveda en el corte)
    this.luzNucleo = new THREE.PointLight(0xff7a2a, 0, 26, 1.5);
    this.luzNucleo.position.set(3, base + alto / 2, 3);
    g.add(this.luzNucleo);
  }

  // ------------------------------------------------------------------ circuito: separadores, BCP, tuberías
  _circuito() {
    const g = new THREE.Group(); this.escena.add(g);
    const ySep = SUELO_SALA + 4.2;
    this.separadores = [];
    // 4 separadores de vapor de 30 m (2 por lado). Se ven por dentro en el corte, con el nivel de agua.
    for (const x of [-13.8, -10.9, 10.9, 13.8]) {
      const cuerpo = this._malla(new THREE.CylinderGeometry(1.3, 1.3, 30, 40, 1, true).rotateX(Math.PI / 2), this.m.aceroCorte, { x, y: ySep, padre: g });
      for (const z of [-15, 15]) this._malla(new THREE.SphereGeometry(1.3, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(z > 0 ? Math.PI / 2 : -Math.PI / 2), this.m.aceroCorte, { x, y: ySep, z, padre: g });
      const aguaMat = this.m.agua.clone();
      const plano = new THREE.Plane(new THREE.Vector3(0, -1, 0), ySep);
      aguaMat.clippingPlanes = [plano];
      const agua = this._malla(new THREE.CylinderGeometry(1.24, 1.24, 29.8, 40).rotateX(Math.PI / 2), aguaMat, { x, y: ySep, padre: g, sombra: false });
      this.separadores.push({ cuerpo, agua, plano, y: ySep });
      // 47 tubos de vapor-agua por separador desde la losa superior (en grupo, combinados en una geometría)
      const geos = [];
      for (let k = 0; k < 24; k++) {
        const z = -13 + (26 * k) / 23, s = Math.sign(x);
        const ang = Math.atan2(z, s * ELENA.radio);
        const x0 = Math.cos(ang) * (ELENA.radio - 0.3), z0 = Math.sin(ang) * (ELENA.radio - 0.3);
        const c = new THREE.CatmullRomCurve3([new THREE.Vector3(x0, NUCLEO.techo + 1, z0), new THREE.Vector3(x0 * 1.06, SUELO_SALA + 0.4, z0),
          new THREE.Vector3((x0 + x) / 2, ySep - 0.6, (z0 + z) / 2), new THREE.Vector3(x, ySep - 1.1, z)]);
        geos.push(new THREE.TubeGeometry(c, 20, 0.05, 6));
      }
      this._malla(mergeGeometries(geos), this.m.aceroCorte, { padre: g });
      // bajantes hacia el colector de aspiración de las bombas
      for (const z of [-11, -4, 4, 11]) this._tubo([[x, ySep - 1.2, z], [x, 8, z], [Math.sign(x) * 15.5, 4.6, z * 0.9]], 0.16, this.m.aislamiento, { padre: g, segmentos: 24 });
    }
    // 8 bombas de circulación principal (4 por lado)
    this.bombas = [];
    let k = 0;
    for (const s of [1, -1]) {
      for (const z of [-10.5, -3.5, 3.5, 10.5]) {
        const b = new THREE.Group(); b.position.set(s * 15.5, 0.8, z); g.add(b);
        this._malla(new THREE.SphereGeometry(1.2, 28, 18), this.m.aislamiento, { y: 1.4, padre: b });
        this._malla(new THREE.CylinderGeometry(0.5, 0.6, 1.6, 20), this.m.aceroOscuro, { y: 2.9, padre: b });
        this._malla(new THREE.CylinderGeometry(0.95, 0.95, 2.6, 28), this.m.motor, { y: 4.8, padre: b });
        const acople = this._malla(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 12), new THREE.MeshStandardMaterial({ map: T.franjas(3), roughness: 0.6 }), { y: 3.5, padre: b });
        const luz = this._malla(new THREE.SphereGeometry(0.16, 12, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x00ff55, emissiveIntensity: 3 }), { y: 6.3, padre: b, sombra: false });
        this.bombas.push({ acople, luz, indice: k++ });
        // impulsión hacia los colectores de distribución, bajo el núcleo
        this._tubo([[s * 15.5, 2.2, z], [s * 11, 2.6, z * 0.8], [s * 6, 4.4, z * 0.4]], 0.22, this.m.aislamiento,
          { padre: g, segmentos: 24, flujo: { color: "#7cc8ff", clave: "caudal", velocidad: 1.2 } });
      }
    }
    // tuberías de vapor vivo: de los separadores a la sala de turbinas (4 líneas)
    const yV = ySep + 1;
    this._tubo([[13.8, yV, -12], [13.8, yV + 2, -17], [22, yV + 2, -17.5], [30, yV + 2, -12], [34, 13.5, -8]], 0.42, this.m.aislamiento, { padre: g, flujo: { color: "#ffffff", clave: "vapor" } });
    this._tubo([[10.9, yV, -14], [10.9, yV + 3.5, -18.6], [24, yV + 3.5, -19], [31, yV + 3, -12], [34, 13.5, -6.8]], 0.42, this.m.aislamiento, { padre: g, flujo: { color: "#ffffff", clave: "vapor" } });
    this._tubo([[13.8, yV, 12], [13.8, yV + 2, 17], [22, yV + 2, 17.5], [30, yV + 2, 12], [34, 13.5, 8]], 0.42, this.m.aislamiento, { padre: g, flujo: { color: "#ffffff", clave: "vapor" } });
    this._tubo([[-13.8, yV, -14], [-13.8, yV + 5, -18.4], [0, yV + 5, -18.4], [22, yV + 5, -19.2], [31, yV + 4, -12], [34, 13.5, 6.8]], 0.42, this.m.aislamiento, { padre: g, flujo: { color: "#ffffff", clave: "vapor" } });
    // agua de alimentación de vuelta del condensador
    this._tubo([[40, 4, 14], [26, 5, 17.5], [18, 7, 17.5], [12, 18, 17], [12, ySep - 1, 14]], 0.25, this.m.azul, { padre: g, flujo: { color: "#58b0ff", clave: "alimentacion", velocidad: 0.7 } });
  }

  // ------------------------------------------------------------------ sala de turbinas
  _salaTurbinas() {
    const g = new THREE.Group(); this.escena.add(g); this.salaTurbinas = g;
    const x0 = 26, x1 = 128, z = 24, H = 34;
    this.paredFrontal = this._malla(new THREE.BoxGeometry(x1 - x0, H, 0.8), this.m.chapa, { x: (x0 + x1) / 2, y: H / 2, z, padre: g });
    this._malla(new THREE.BoxGeometry(x1 - x0, H, 0.8), this.m.chapa, { x: (x0 + x1) / 2, y: H / 2, z: -z, padre: g });
    this._malla(new THREE.BoxGeometry(0.8, H, 2 * z), this.m.chapa, { x: x1, y: H / 2, padre: g });
    this._malla(new THREE.BoxGeometry(0.8, H, 2 * z), this.m.hormigon, { x: x0, y: H / 2, padre: g });
    this.techoTurbinas = this._malla(new THREE.BoxGeometry(x1 - x0 + 1, 1.4, 2 * z + 1), this.m.chapa, { x: (x0 + x1) / 2, y: H + 0.7, padre: g });
    const banda = this._malla(new THREE.PlaneGeometry(x1 - x0, 8), new THREE.MeshStandardMaterial({ map: T.ventanas(2, 34), roughness: 0.6 }), { x: (x0 + x1) / 2, y: 26, z: z + 0.45, padre: g });
    this.ventanasFrontal = banda;
    this._malla(new THREE.BoxGeometry(x1 - x0 - 2, 0.6, 2 * z - 2), this.m.hormigonClaro, { x: (x0 + x1) / 2, y: 9, padre: g, sombra: false }); // planta de operación (con huecos implícitos)
    // grúa de la sala
    for (const zz of [-21, 21]) this._malla(new THREE.BoxGeometry(x1 - x0 - 2, 1, 0.8), this.m.amarillo, { x: (x0 + x1) / 2, y: H - 4, z: zz, padre: g });
    this._malla(new THREE.BoxGeometry(3, 2.2, 42), this.m.amarillo, { x: 98, y: H - 3, padre: g });

    // dos turbogeneradores de 500 MWe: AP + 4 BP + generador + excitatriz
    this.ejes = [];
    for (const zt of [-9, 9]) {
      const t = new THREE.Group(); t.position.set(0, 9.6, zt); g.add(t);
      this._malla(new THREE.BoxGeometry(80, 3, 9), this.m.hormigon, { x: 74, y: -1.8, padre: t });   // bancada
      const casco = (x, largo, radio, mat = this.m.verdeTurbina) => {
        this._malla(new THREE.CylinderGeometry(radio, radio, largo, 40, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), mat, { x, y: 0.3, padre: t });
        this._malla(new THREE.BoxGeometry(largo, 0.6, radio * 2.05), this.m.aceroOscuro, { x, y: 0.3, padre: t });
        this._malla(new THREE.BoxGeometry(largo * 0.98, radio * 0.9, radio * 1.96), mat, { x, y: -radio * 0.45 + 0.1, padre: t });
      };
      casco(40, 8, 2.2);
      for (let i = 0; i < 4; i++) {
        casco(50 + i * 10.5, 9, 3.3);
        // condensador bajo cada cuerpo de baja presión
        this._malla(new THREE.BoxGeometry(8.5, 6, 8), this.m.azul, { x: 50 + i * 10.5, y: -6.5, padre: t });
        // tuberías de cruce desde el AP
        this._tubo([[42, 2.4, 0], [44, 4.6, 0], [50 + i * 10.5 - 2, 4.6, 0], [50 + i * 10.5, 3.2, 0]], 0.5, this.m.aislamiento, { padre: t, segmentos: 24 });
      }
      this._malla(new THREE.CylinderGeometry(2.3, 2.3, 13, 40).rotateZ(Math.PI / 2), this.m.amarillo, { x: 98, y: 0.2, padre: t });
      this._malla(new THREE.BoxGeometry(13.4, 1.6, 5.2), this.m.amarillo, { x: 98, y: -1.6, padre: t });
      this._malla(new THREE.CylinderGeometry(1.1, 1.1, 3.5, 24).rotateZ(Math.PI / 2), this.m.motor, { x: 107, y: 0, padre: t });
      // eje visible en los acoplamientos (gira según las rpm)
      const eje = this._malla(new THREE.CylinderGeometry(0.42, 0.42, 72, 16).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: T.franjas(36), roughness: 0.4, metalness: 0.7 }), { x: 73, y: 0.3, padre: t });
      this.ejes.push(eje);
      // válvulas de parada y regulación a la entrada
      this._malla(new THREE.CylinderGeometry(0.9, 0.9, 3, 20), this.m.aislamiento, { x: 35, y: 3.4, z: zt > 0 ? -1.4 : 1.4, padre: t });
    }
    // conductos de agua de circulación hacia la torre
    this._tubo([[60, -0.6, -24], [60, -0.6, -70], [140, -0.6, -150]], 1.3, this.m.hormigonClaro, { flujo: { color: "#8fd3ff", clave: "circulacion", velocidad: 0.5 }, sombra: false });
    this._tubo([[80, -0.6, -24], [80, -0.6, -60], [150, -0.6, -130]], 1.3, this.m.hormigonClaro, { flujo: { color: "#ffb08f", clave: "circulacion", velocidad: 0.5 }, sombra: false });
  }

  // ------------------------------------------------------------------ torre de refrigeración (tiro natural)
  _torre() {
    const g = new THREE.Group(); g.position.set(175, 0, -175); this.escena.add(g); this.torre = g;
    const pts = [];
    const r = (y) => 27 * Math.sqrt(1 + ((y - 88) / 52) ** 2) - 2;
    for (let i = 0; i <= 40; i++) { const y = 10 + (110 * i) / 40; pts.push(new THREE.Vector2(r(y), y)); }
    const mat = new THREE.MeshStandardMaterial({ map: T.hormigon([10, 6], [182, 178, 170]), roughness: 0.95, side: THREE.DoubleSide });
    this._malla(new THREE.LatheGeometry(pts, 96), mat, { padre: g });
    // pilares diagonales en la base
    const n = 48, rb = r(10);
    const pilar = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 11.5, 0.9), this.m.hormigon, n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      tmpM.compose(tmpV.set(Math.cos(a) * rb, 5, Math.sin(a) * rb), tmpQ.setFromEuler(new THREE.Euler(0, -a, (i % 2 ? 1 : -1) * 0.28)), tmpS.set(1, 1, 1));
      pilar.setMatrixAt(i, tmpM);
    }
    pilar.castShadow = true;
    g.add(pilar);
    this._malla(new THREE.CylinderGeometry(rb + 3, rb + 3, 1.2, 96), this.m.hormigonClaro, { y: 0.6, padre: g });
    this._malla(new THREE.CircleGeometry(rb + 1, 96).rotateX(-Math.PI / 2), this.m.agua, { y: 1.25, padre: g, sombra: false });
    this.bocaTorre = new THREE.Vector3(175, 120, -175);
  }

  _chimenea() {
    // chimenea de ventilación compartida entre las unidades (con celosía)
    const g = new THREE.Group(); g.position.set(-24, 0, -6); this.escena.add(g);
    this._malla(new THREE.CylinderGeometry(2.6, 4.2, 150, 32), this.m.franjas, { y: 75, padre: g });
    const barra = new THREE.CylinderGeometry(0.22, 0.22, 1, 6).translate(0, 0.5, 0);
    const geos = [];
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      for (let y = 0; y < 140; y += 14) {
        const p0 = new THREE.Vector3(Math.cos(a) * (9 - y * 0.045), y, Math.sin(a) * (9 - y * 0.045));
        const p1 = new THREE.Vector3(Math.cos(a) * (9 - (y + 14) * 0.045), y + 14, Math.sin(a) * (9 - (y + 14) * 0.045));
        const a2 = a + Math.PI / 2;
        const q1 = new THREE.Vector3(Math.cos(a2) * (9 - (y + 14) * 0.045), y + 14, Math.sin(a2) * (9 - (y + 14) * 0.045));
        for (const [u, v] of [[p0, p1], [p0, q1]]) {
          const d = v.clone().sub(u);
          const gb = barra.clone();
          tmpM.compose(u, tmpQ.setFromUnitVectors(ARRIBA, d.clone().normalize()), tmpS.set(1, d.length(), 1));
          gb.applyMatrix4(tmpM); geos.push(gb);
        }
      }
    }
    tmpS.set(1, 1, 1);
    this._malla(mergeGeometries(geos), this.m.aceroOscuro, { padre: g });
  }

  // ------------------------------------------------------------------ partículas: vapor, burbujas, humo, escombros
  _particulas() {
    const tex = T.humo();
    // penacho de la torre
    const N = 160;
    this.penacho = { n: N, edad: new Float32Array(N), sprites: [] };
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xf4f6f8, transparent: true, depthWrite: false, opacity: 0, fog: true }));
      this.escena.add(s); this.penacho.sprites.push(s); this.penacho.edad[i] = Math.random();
    }
    // vapor de las válvulas de alivio a la atmósfera (BRU-A) sobre el edificio
    this.alivio = { sprites: [], edad: new Float32Array(40) };
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthWrite: false, opacity: 0 }));
      this.escena.add(s); this.alivio.sprites.push(s); this.alivio.edad[i] = Math.random();
    }
    // humo e incendio del grafito tras el accidente
    this.humo = { sprites: [], edad: new Float32Array(140) };
    for (let i = 0; i < 140; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; this.escena.add(s); this.humo.sprites.push(s); this.humo.edad[i] = Math.random();
    }
    // burbujas de vapor en los canales que quedan en el plano de corte
    const geo = new THREE.BufferGeometry();
    const NB = 1600, pos = new Float32Array(NB * 3);
    // las caras del corte son x = 0 (con z > 0) y z = 0 (con x > 0)
    for (let i = 0; i < NB; i++) {
      const q = Math.max(1, Math.round((Math.random() * NUCLEO.radio * 0.97) / NUCLEO.paso)) * NUCLEO.paso;
      const y = NUCLEO.base + Math.random() * NUCLEO.alto;
      pos.set(Math.random() < 0.5 ? [0, y, q] : [q, y, 0], i * 3);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.burbujas = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, color: 0xe8f4ff, transparent: true, opacity: 0.8, depthWrite: false, map: tex, alphaTest: 0.05 }));
    this.escena.add(this.burbujas);
  }

  _radiacion() {
    // esferas de tasa de dosis por zona (se activan con "Ver radiación")
    const zonas = { sala_central: [0, SUELO_SALA + 6, 0, 16], sala_turbinas: [75, 12, 0, 26], sala_control: [5, 14, 42, 9], exterior: [40, 4, 80, 30] };
    this.zonasDosis = {};
    for (const [k, [x, y, z, r]] of Object.entries(zonas)) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        uniforms: { color: { value: new THREE.Color(0x22ff66) }, intensidad: { value: 0.4 }, tiempo: { value: 0 } },
        vertexShader: "varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }",
        fragmentShader: "uniform vec3 color; uniform float intensidad; uniform float tiempo; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(1.-abs(dot(vN,vV)), 2.2); float o = 0.55+0.45*sin(vP.y*1.6 - tiempo*2.5); gl_FragColor = vec4(color*(f*intensidad*(0.6+0.4*o)), 1.); }",
      });
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
      m.position.set(x, y, z); m.visible = false; m.renderOrder = 5;
      this.escena.add(m); this.zonasDosis[k] = m;
    }
    // chispas de ionización (más densas cuanto mayor es la dosis en la sala central)
    const N = 900, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos.set([(Math.random() * 2 - 1) * 16, SUELO_SALA + Math.random() * 30, (Math.random() * 2 - 1) * 16], i * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.chispas = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.25, color: 0x9dff9d, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.escena.add(this.chispas);
  }

  // ------------------------------------------------------------------ etiquetas con datos en vivo
  _etiquetas() {
    const defs = {
      reactor: ["Reactor RBMK-1000", [-2, SUELO_SALA + 13, 2]],
      nucleo: ["Núcleo · grafito + UO₂", [9, NUCLEO.base + 3, 9]],
      separadores: ["Separadores de vapor", [13.8, SUELO_SALA + 7.5, 14]],
      bombas: ["Bombas de circulación (BCP)", [17, 9, 12]],
      turbina: ["Turbinas", [52, 20, 9]],
      generador: ["Generador", [98, 18, 9]],
      condensador: ["Condensador", [60, 3, 17]],
      torre: ["Torre de refrigeración", [175, 128, -175]],
    };
    this.etiquetas = {};
    for (const [k, [titulo, [x, y, z]]] of Object.entries(defs)) {
      const div = document.createElement("div");
      div.className = "etiqueta3d"; div.dataset.vista = k;
      div.innerHTML = `<b>${titulo}</b><span></span>`;
      div.addEventListener("click", () => this.vista(k === "nucleo" ? "nucleo" : k === "torre" ? "torre" : ["turbina", "generador", "condensador"].includes(k) ? "turbinas" : "reactor"));
      const o = new CSS2DObject(div); o.position.set(x, y, z);
      this.escena.add(o); this.etiquetas[k] = div.querySelector("span");
    }
  }

  _post() {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.calidad === "baja" ? 0 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.escena, this.camara));
    if (this.calidad === "alta") {
      this.gtao = new GTAOPass(this.escena, this.camara, 1, 1);
      this.gtao.blendIntensity = 0.8;
      this.gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1 });
      this.composer.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  _tamano() {
    const w = this.contenedor.clientWidth, h = this.contenedor.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.etiquetasRenderer.setSize(w, h);
    this.camara.aspect = w / h;
    this.camara.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ interacción
  vista(nombre, duracion = 1.6) {
    const v = {
      general: [[205, 92, 175], [42, 8, -22]],
      reactor: [[42, 66, 46], [0, 12, 0]],
      nucleo: [[13, 20.5, 15], [0, 11.5, 0]],
      sala: [[16, SUELO_SALA + 12, 22], [0, SUELO_SALA, 0]],
      turbinas: [[78, 52, 78], [74, 8, 0]],
      torre: [[300, 80, -40], [175, 55, -175]],
    }[nombre];
    if (!v) return;
    this._vuelo = { desde: [this.camara.position.clone(), this.controles.target.clone()], hasta: [new THREE.Vector3(...v[0]), new THREE.Vector3(...v[1])], t: 0, d: duracion };
    if (!duracion) { this.camara.position.copy(this._vuelo.hasta[0]); this.controles.target.copy(this._vuelo.hasta[1]); this._vuelo = null; }
    this.ponerCorte(this.corte, nombre);
  }

  ponerCorte(activo) {
    this.corte = activo;
    this.planosCorte[0].constant = activo ? 0 : 1e4;
    this.planosCorte[1].constant = activo ? 0 : 1e4;
    this.techo.visible = !activo;
    this.techoTurbinas.visible = !activo;
    this.paredFrontal.visible = !activo;
    this.ventanasFrontal.visible = !activo;
  }

  ponerRadiacion(activo) { this.verRadiacion = activo; }

  actualizar(estado) { this.estado = estado; }

  // ------------------------------------------------------------------ bucle de dibujo
  _fotograma() {
    this.reloj.update();
    const dt = Math.min(0.1, this.reloj.getDelta()), t = this.reloj.getElapsed();
    this.fps = this.fps * 0.95 + (dt > 0 ? 0.05 / dt : 0);
    if (this._vuelo) {
      const f = this._vuelo; f.t = Math.min(1, f.t + dt / f.d);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camara.position.lerpVectors(f.desde[0], f.hasta[0], e);
      this.controles.target.lerpVectors(f.desde[1], f.hasta[1], e);
      if (f.t >= 1) this._vuelo = null;
    }
    this.controles.update();
    if (this.estado) this._aplicarEstado(dt, t);
    this.composer.render();
    this.etiquetasRenderer.render(this.escena, this.camara);
  }

  _aplicarEstado(dt, t) {
    const s = this.estado, v = this.visual, k = 1 - Math.exp(-dt * 6);
    const b = s.reactor.barras;
    v.rr += (b.RR.insercion_pct / 100 - v.rr) * k; v.ar += (b.AR.insercion_pct / 100 - v.ar) * k;
    v.usp += (b.USP.insercion_pct / 100 - v.usp) * k; v.az += (b.AZ.insercion_pct / 100 - v.az) * k;
    v.vacio += (s.reactor.vacio_pct - v.vacio) * k;
    v.n += (s.reactor.potencia_pct / 100 - v.n) * (1 - Math.exp(-dt * 12));
    v.tc += (s.reactor.t_combustible_c - v.tc) * k;
    v.rpm += (s.turbina.velocidad_rpm - v.rpm) * k;
    const danado = s.proteccion.danado;

    // barras de control
    const { base, alto, techo } = NUCLEO;
    this.barras.pos.forEach(([x, z], i) => {
      const gr = this.barras.grupo[i], ins = { RR: v.rr, AR: v.ar, USP: v.usp, AZ: v.az }[gr];
      if (gr === "USP") {          // entran por abajo, sin desplazador
        tmpM.compose(tmpV.set(x, base - 3.5 + ins * 3.5, z), tmpQ.identity(), tmpS.set(1, 3.5, 1));
        this.absorbentes.setMatrixAt(i, tmpM);
        tmpM.compose(tmpV.set(x, -50, z), tmpQ.identity(), tmpS.set(1, 0.01, 1));
        this.desplazadores.setMatrixAt(i, tmpM);
        return;
      }
      const fondoAbs = techo - ins * alto;
      tmpM.compose(tmpV.set(x, fondoAbs, z), tmpQ.identity(), tmpS.set(1, 6.2, 1));
      this.absorbentes.setMatrixAt(i, tmpM);
      const topeDes = fondoAbs - 1.25;
      tmpM.compose(tmpV.set(x, topeDes - 4.5, z), tmpQ.identity(), tmpS.set(1, 4.5, 1));
      this.desplazadores.setMatrixAt(i, tmpM);
    });
    tmpS.set(1, 1, 1);
    this.absorbentes.instanceMatrix.needsUpdate = this.desplazadores.instanceMatrix.needsUpdate = true;

    // brillo de los canales: reparto radial J0 y color de cuerpo negro según la temperatura del combustible
    const brillo = danado ? 4 + 2 * Math.sin(t * 7) * Math.sin(t * 3.1) : THREE.MathUtils.clamp(0.25 + 1.3 * Math.log10(1 + 9 * v.n) , 0.05, 14);
    this.m.canal.emissive.copy(colorCuerpoNegro(danado ? 2600 : v.tc));
    this.m.canal.emissiveIntensity = brillo;
    if (!this._radialHecho || this._radialN !== Math.round(v.rr * 20)) {
      const c = new THREE.Color();
      for (let i = 0; i < this.radiosCanal.length; i++) {
        const x = (2.405 * this.radiosCanal[i]) / (NUCLEO.radio + 0.6);
        const j0 = 1 - x * x / 4 + x ** 4 / 64 - x ** 6 / 2304;
        const f = Math.max(0.08, j0) * (0.9 + 0.2 * Math.random());
        this.canales.setColorAt(i, c.setRGB(f, f, f));
      }
      this.canales.instanceColor.needsUpdate = true;
      this._radialHecho = true; this._radialN = Math.round(v.rr * 20);
    }
    this.luzNucleo.intensity = Math.min(900, 40 * brillo * brillo);
    this.luzNucleo.color.copy(this.m.canal.emissive);

    // burbujas: suben más deprisa y son más numerosas con más vacío
    const pos = this.burbujas.geometry.attributes.position;
    const visibles = Math.floor(pos.count * THREE.MathUtils.clamp(v.vacio / 40, 0, 1));
    this.burbujas.geometry.setDrawRange(0, this.corte ? visibles : 0);
    const sube = (0.6 + v.vacio / 15) * dt * 3;
    for (let i = 0; i < visibles; i++) {
      let y = pos.getY(i) + sube * (0.6 + ((i * 7919) % 100) / 100);
      if (y > techo) y = base + Math.random() * 0.4;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;

    // separadores: nivel
    for (const sep of this.separadores) {
      sep.plano.constant = sep.y - 1.3 + 2.6 * THREE.MathUtils.clamp(s.circuito.nivel_separadores_pct / 100, 0.02, 0.98);
    }
    // bombas
    this.bombas.forEach((b) => {
      const marcha = b.indice < s.circuito.bombas_en_marcha && !danado;
      const giro = marcha ? (s.turbina.prueba_inercia && b.indice >= 4 ? v.rpm / 3000 : 1) : 0;
      b.acople.rotation.y += giro * dt * 25;
      b.luz.material.emissive.setHex(marcha ? 0x00ff55 : 0xff2200);
    });
    // turbinas
    for (const e of this.ejes) e.rotation.x += (v.rpm / 3000) * dt * 30;
    // flujos animados
    const caudales = {
      caudal: danado ? 0 : s.circuito.caudal_pct / 100,
      vapor: s.turbina.valvula_admision_pct / 100,
      alimentacion: s.circuito.agua_alimentacion_kgs / 1470,
      circulacion: 1,
    };
    for (const f of this.flujos) {
      const q = caudales[f.clave] ?? 1;
      f.tex.offset.x -= dt * q * f.velocidad * 1.5;
      f.capa.material.opacity = 0.12 + 0.45 * Math.min(1, q);
      f.capa.visible = q > 0.01;
    }

    // penacho de la torre
    const pen = s.refrigeracion.penacho_pct / 100;
    this.penacho.sprites.forEach((sp, i) => {
      let e = (this.penacho.edad[i] += dt * 0.045);
      if (e > 1) { e = this.penacho.edad[i] = 0; sp.userData.d = [Math.random() * 2 - 1, Math.random() * 2 - 1]; }
      const d = sp.userData.d || (sp.userData.d = [Math.random() * 2 - 1, Math.random() * 2 - 1]);
      const viento = 60 * e * e;
      sp.position.set(this.bocaTorre.x + d[0] * (18 + 30 * e) + viento, this.bocaTorre.y + 120 * e, this.bocaTorre.z + d[1] * (18 + 30 * e) + viento * 0.4);
      sp.scale.setScalar(26 + 90 * e);
      sp.material.opacity = pen * 0.5 * Math.sin(Math.PI * Math.min(1, e * 1.3)) * (1 - e * 0.5);
    });
    // alivio de vapor a la atmósfera si la presión sube mucho
    const alivio = THREE.MathUtils.clamp((s.circuito.presion_mpa - 7.4) / 1.2, 0, 1);
    this.alivio.sprites.forEach((sp, i) => {
      let e = (this.alivio.edad[i] += dt * 0.5);
      if (e > 1) e = this.alivio.edad[i] = 0;
      sp.position.set(17 + 3 * Math.sin(i), 56 + 35 * e, -10 + (i % 5) * 4 + 6 * e);
      sp.scale.setScalar(4 + 16 * e);
      sp.material.opacity = alivio * 0.7 * (1 - e);
    });

    // radiación
    const dosis = s.radiacion;
    for (const [k, m] of Object.entries(this.zonasDosis)) {
      const d = dosis[`${k}_msvh`];
      m.visible = this.verRadiacion;
      m.material.uniforms.color.value.copy(colorDosis(d));
      m.material.uniforms.intensidad.value = 0.35 + 0.25 * THREE.MathUtils.clamp(Math.log10(d * 1000 + 1), 0, 8);
      m.material.uniforms.tiempo.value = t;
    }
    const dc = dosis.sala_central_msvh;
    this.chispas.material.opacity = this.verRadiacion || danado ? THREE.MathUtils.clamp(Math.log10(dc * 100) / 6, 0, 1) : 0;
    this.chispas.rotation.y += dt * 0.05;

    this._accidente(s, dt, t);

    // etiquetas
    const e = this.etiquetas;
    e.reactor.textContent = `${s.reactor.potencia_mwt.toFixed(0)} MWt · ρ ${s.reactor.reactividad_beta.toFixed(2)} β · ORM ${s.reactor.orm_barras.toFixed(0)}`;
    e.nucleo.textContent = `UO₂ ${s.reactor.t_combustible_c.toFixed(0)} °C · vacío ${s.reactor.vacio_pct.toFixed(0)} %`;
    e.separadores.textContent = `${s.circuito.presion_mpa.toFixed(2)} MPa · nivel ${s.circuito.nivel_separadores_pct.toFixed(0)} %`;
    e.bombas.textContent = `${s.circuito.bombas_en_marcha}/8 · ${(s.circuito.caudal_kgs / 1000).toFixed(1)} t/s`;
    e.turbina.textContent = `${s.turbina.velocidad_rpm.toFixed(0)} rpm · admisión ${s.turbina.valvula_admision_pct.toFixed(0)} %`;
    e.generador.textContent = `${s.generador.potencia_mwe.toFixed(0)} MWe · ${s.generador.frecuencia_hz.toFixed(1)} Hz`;
    e.condensador.textContent = `${s.condensador.presion_kpa.toFixed(1)} kPa · ${s.condensador.temperatura_c.toFixed(0)} °C`;
    e.torre.textContent = `${s.refrigeracion.t_agua_caliente_c.toFixed(0)} → ${s.refrigeracion.t_agua_fria_c.toFixed(0)} °C`;
  }

  _accidente(s, dt, t) {
    const danado = s.proteccion.danado;
    if (danado && !this.accidente) {
      // explosión: la losa superior salta y se queda de canto, el techo desaparece y salen escombros
      const N = 260;
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const esc = new THREE.InstancedMesh(geo, this.m.hormigon, N), graf = new THREE.InstancedMesh(geo, this.m.grafito.clone(), 120);
      graf.material.clippingPlanes = []; esc.castShadow = graf.castShadow = true;
      const piezas = [];
      for (let i = 0; i < N + 120; i++) {
        const a = Math.random() * Math.PI * 2, v = 10 + Math.random() * 28;
        piezas.push({ m: i < N ? esc : graf, i: i < N ? i : i - N, p: new THREE.Vector3((Math.random() - 0.5) * 20, 50 + Math.random() * 5, (Math.random() - 0.5) * 20),
          v: new THREE.Vector3(Math.cos(a) * v * 0.6, 18 + Math.random() * 30, Math.sin(a) * v * 0.6), r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0),
          s: i < N ? 0.6 + Math.random() * 2.2 : 0.25 + Math.random() * 0.4, quieta: false });
      }
      this.escena.add(esc, graf);
      this.accidente = { t0: t, piezas, esc, graf, fuego: new THREE.PointLight(0xff5a1a, 0, 90, 1.3), flash: new THREE.PointLight(0xffffff, 2e6, 600, 1.4) };
      this.accidente.fuego.position.set(0, SUELO_SALA + 4, 0);
      this.accidente.flash.position.set(0, 60, 0);
      this.escena.add(this.accidente.fuego, this.accidente.flash);
      this.techo.visible = false;
      this.humo.sprites.forEach((sp) => (sp.visible = true));
    }
    if (!danado && this.accidente) {           // reinicio: reconstruir el estado intacto
      const a = this.accidente;
      this.escena.remove(a.esc, a.graf, a.fuego, a.flash);
      this.elena.position.y = NUCLEO.techo + 0.5; this.elena.rotation.set(0, 0, 0);
      this.humo.sprites.forEach((sp) => (sp.visible = false));
      this.accidente = null;
      this.ponerCorte(this.corte);
      return;
    }
    if (!this.accidente) return;
    const a = this.accidente, ta = t - a.t0;
    a.flash.intensity = 4e5 * Math.exp(-ta * 5);
    a.fuego.intensity = 260 * (0.75 + 0.25 * Math.sin(t * 13) * Math.sin(t * 5.3));
    // losa superior (~1000 t) de canto
    const f = Math.min(1, ta / 2.2);
    this.elena.position.y = NUCLEO.techo + 0.5 + 9 * Math.sin(Math.PI * f) * (1 - f) + 2.2 * f;
    this.elena.rotation.x = 1.25 * f; this.elena.rotation.z = 0.25 * f;
    for (const p of a.piezas) {
      if (!p.quieta) {
        p.v.y -= 9.81 * dt;
        p.p.addScaledVector(p.v, dt);
        p.r.x += dt * 2; p.r.y += dt * 1.3;
        const suelo = Math.abs(p.p.x - 77) < 51 && Math.abs(p.p.z) < 24 ? 35.4 : Math.hypot(p.p.x, p.p.z) < 26 ? 53 : 0.3;
        if (p.p.y < suelo + p.s / 2) { p.p.y = suelo + p.s / 2; p.quieta = true; }
      }
      tmpM.compose(p.p, tmpQ.setFromEuler(p.r), tmpS.set(p.s, p.s * 0.6, p.s));
      p.m.setMatrixAt(p.i, tmpM);
    }
    tmpS.set(1, 1, 1);
    a.esc.instanceMatrix.needsUpdate = a.graf.instanceMatrix.needsUpdate = true;
    // humo del incendio del grafito, con el resplandor del núcleo por debajo
    this.humo.sprites.forEach((sp, i) => {
      let e = (this.humo.edad[i] += dt * 0.06);
      if (e > 1) e = this.humo.edad[i] = 0;
      const d = sp.userData.d || (sp.userData.d = [Math.random() * 2 - 1, Math.random() * 2 - 1]);
      sp.position.set(d[0] * (5 + 25 * e) + 70 * e * e, SUELO_SALA + 4 + 170 * e, d[1] * (5 + 25 * e) - 25 * e * e);
      sp.scale.setScalar(8 + 70 * e);
      const brasa = Math.max(0, 1 - e * 5);
      sp.material.color.setRGB(0.23 + 0.7 * brasa, 0.21 + 0.25 * brasa, 0.2 + 0.05 * brasa);
      sp.material.opacity = Math.min(1, ta / 3) * 0.75 * Math.sin(Math.PI * Math.min(1, e * 1.2));
    });
  }
}
