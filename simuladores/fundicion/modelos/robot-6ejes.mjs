// Genera el modelo detallado del robot industrial de 6 ejes del gemelo (public/modelos/robot-6ejes.glb).
//
//   cd simuladores/fundicion && node modelos/robot-6ejes.mjs
//
// Diseño original y genérico (sin marca), construido con geometría de three.js y exportado a glTF binario.
// Las articulaciones son nodos con nombre: J1 (giro de la base, eje Y), J2 (hombro, eje Z), J3 (codo, eje Z),
// J4 (giro del antebrazo, eje X), J5 (muñeca, eje Z) y J6 (brida, eje X). Herramientas: «Pinza» y «Cuchara».
// Unidades: metros, con las mismas cotas que el robot sencillo de la escena (hombro a 1,4 m, brazo 1,6 m,
// antebrazo 1,28 m), así que se mueve con las mismas consignas.
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// El exportador usa FileReader (del navegador) para empaquetar el binario
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

/* ------------------------------------------------------------------ materiales */
const mat = (nombre, color, roughness, metalness, extra = {}) =>
  Object.assign(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }), { name: nombre });
const M = {
  pintura: mat("Pintura naranja", 0xd6661a, 0.4, 0.32),
  pinturaOscura: mat("Pintura naranja oscura", 0xa94c14, 0.45, 0.32),
  fundicion: mat("Fundición gris", 0x2b3035, 0.55, 0.6),
  motor: mat("Carcasa de motor", 0x3a4046, 0.42, 0.7),
  acero: mat("Acero mecanizado", 0xb9c1c7, 0.28, 0.9),
  cromo: mat("Cromo", 0xe3e8eb, 0.12, 1.0),
  goma: mat("Goma negra", 0x141618, 0.8, 0.0),
  aviso: mat("Etiqueta amarilla", 0xf2c21b, 0.5, 0.0),
  refractario: mat("Refractario", 0x6d625a, 0.9, 0.0),
  metal: mat("Metal fundido", 0xff5a14, 0.6, 0.0, { emissive: 0xff3c00, emissiveIntensity: 2.0 }),
};

/* ------------------------------------------------------------------ ayudas */
const malla = (geo, m, x = 0, y = 0, z = 0, nombre) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  if (nombre) o.name = nombre;
  return o;
};
const rcaja = (w, h, d, r, m, x, y, z) => malla(new RoundedBoxGeometry(w, h, d, 3, r), m, x, y, z);
const cil = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 28) => malla(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
const ejeX = (o) => { o.rotation.z = Math.PI / 2; return o; };   // cilindro tumbado a lo largo de X
const ejeZ = (o) => { o.rotation.x = Math.PI / 2; return o; };   // cilindro a lo largo de Z
// sólido de revolución a partir de un perfil [radio, altura]
const torno = (perfil, m, seg = 32) => malla(new THREE.LatheGeometry(perfil.map(([r, h]) => new THREE.Vector2(r, h)), seg), m);
// corona de tornillos alrededor de un eje Y
const tornillos = (n, radio, y, m = M.acero, r = 0.022, h = 0.03) => {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    g.add(cil(r, r, h, m, Math.cos(a) * radio, y, Math.sin(a) * radio, 6));
  }
  return g;
};
// motor eléctrico con aletas y tapa (a lo largo de su eje Y local)
const motorElectrico = (radio, largo) => {
  const g = new THREE.Group();
  g.add(cil(radio, radio, largo, M.motor, 0, largo / 2, 0));
  for (let i = 0; i < 6; i++) g.add(cil(radio * 1.08, radio * 1.08, 0.012, M.motor, 0, 0.05 + i * (largo - 0.1) / 5, 0));
  g.add(cil(radio * 0.92, radio, 0.04, M.fundicion, 0, largo + 0.02, 0));
  const conector = rcaja(radio * 0.7, 0.07, radio * 0.7, 0.01, M.goma, radio * 0.9, largo * 0.7, 0);
  g.add(conector);
  return g;
};
// eslabón extruido con extremos redondeados (perfil en XY, de y=0 a y=largo)
const eslabon = (r0, r1, largo, grosor, m) => {
  const s = new THREE.Shape();
  s.absarc(0, 0, r0, Math.PI, 0, true);
  s.lineTo(r1, largo);
  s.absarc(0, largo, r1, 0, Math.PI, true);
  s.lineTo(-r0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: grosor, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 16 });
  geo.translate(0, 0, -grosor / 2);
  return malla(geo, m);
};
// manguera de cables a lo largo de una curva
const manguera = (puntos, radio = 0.035) => {
  const curva = new THREE.CatmullRomCurve3(puntos.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const g = new THREE.Group();
  g.add(malla(new THREE.TubeGeometry(curva, 40, radio, 8, false), M.goma));
  for (const t of [0.2, 0.5, 0.8]) {        // abrazaderas
    const p = curva.getPointAt(t), d = curva.getTangentAt(t);
    const abr = malla(new THREE.TorusGeometry(radio * 1.25, 0.012, 8, 20), M.acero, p.x, p.y, p.z);
    abr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    g.add(abr);
  }
  return g;
};
const articulacion = (nombre, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.name = nombre; g.position.set(x, y, z); return g; };

/* ------------------------------------------------------------------ el robot */
const robot = new THREE.Group();
robot.name = "Robot6Ejes";

// Base fija: placa con tornillos, zócalo y motor del eje 1
const base = new THREE.Group(); base.name = "Base"; robot.add(base);
base.add(cil(0.6, 0.64, 0.08, M.fundicion, 0, 0.04, 0));
base.add(tornillos(8, 0.53, 0.095));
base.add(torno([[0, 0.08], [0.5, 0.08], [0.5, 0.14], [0.44, 0.2], [0.4, 0.62], [0.42, 0.66], [0.42, 0.72], [0, 0.72]], M.pintura));
base.add(cil(0.43, 0.43, 0.05, M.fundicion, 0, 0.78, 0));             // rodamiento del eje 1
const m1 = motorElectrico(0.11, 0.3); m1.position.set(-0.42, 0.2, 0.18); base.add(m1);
base.add(rcaja(0.12, 0.08, 0.2, 0.02, M.goma, 0.47, 0.18, 0));          // entrada de cables
base.add(malla(new THREE.PlaneGeometry(0.16, 0.08), M.aviso, 0, 0.42, 0.401));

// J1: carrusel que gira sobre la base
const J1 = articulacion("J1", 0, 0.84, 0); robot.add(J1);
J1.add(torno([[0, -0.04], [0.42, -0.04], [0.45, 0.0], [0.45, 0.1], [0.36, 0.22], [0, 0.22]], M.pintura));
J1.add(rcaja(0.7, 0.62, 0.62, 0.12, M.pintura, 0.05, 0.44, 0));          // hombro
J1.add(ejeZ(cil(0.3, 0.3, 0.7, M.pinturaOscura, 0.0, 0.56, 0)));        // carcasa del eje 2
J1.add(ejeZ(cil(0.18, 0.18, 0.74, M.acero, 0.0, 0.56, 0)));
const m2 = motorElectrico(0.12, 0.32); m2.rotation.x = -Math.PI / 2; m2.position.set(0.0, 0.56, -0.36); J1.add(m2);
J1.add(tornillos(10, 0.24, 0.0).translateY(0));
J1.add(manguera([[-0.36, -0.6, 0.05], [-0.42, -0.2, 0.05], [-0.4, 0.2, 0.1], [-0.3, 0.6, 0.3]]));

// J2: brazo (hombro → codo, 1,6 m hacia +Y)
const J2 = articulacion("J2", 0, 0.56, 0); J1.add(J2);
J2.add(eslabon(0.26, 0.2, 1.6, 0.26, M.pintura));
J2.add(ejeZ(cil(0.12, 0.12, 0.46, M.acero, 0, 0, 0)));                  // eje del hombro
// cilindro compensador (muelle a gas) a un lado del brazo
const compensador = new THREE.Group(); compensador.position.set(-0.22, 0.25, 0.3); compensador.rotation.z = 0.12; J2.add(compensador);
compensador.add(cil(0.075, 0.075, 0.7, M.pinturaOscura, 0, 0.35, 0));
compensador.add(cil(0.03, 0.03, 0.5, M.cromo, 0, 0.95, 0));
compensador.add(cil(0.085, 0.085, 0.06, M.fundicion, 0, 0.02, 0));
compensador.add(rcaja(0.2, 0.09, 0.12, 0.02, M.fundicion, 0.09, 1.2, -0.05));     // soporte de la varilla en el brazo
compensador.add(rcaja(0.16, 0.12, 0.1, 0.02, M.fundicion, 0.08, -0.02, -0.06));   // y su anclaje abajo
J2.add(manguera([[-0.25, 0.1, -0.2], [-0.27, 0.6, -0.22], [-0.24, 1.1, -0.22], [-0.18, 1.55, -0.2]], 0.032));

// J3: codo, con contrapeso, motor del eje 3 y arranque del antebrazo hacia +X
const J3 = articulacion("J3", 0, 1.6, 0); J2.add(J3);
J3.add(ejeZ(cil(0.25, 0.25, 0.5, M.pinturaOscura, 0, 0, 0)));
J3.add(rcaja(0.62, 0.42, 0.42, 0.1, M.pintura, -0.1, 0, 0));
J3.add(rcaja(0.32, 0.36, 0.36, 0.08, M.pinturaOscura, -0.44, 0, 0));    // contrapeso
const m3 = motorElectrico(0.1, 0.28); m3.rotation.x = Math.PI / 2; m3.position.set(0, 0, 0.27); J3.add(m3);
const m4 = motorElectrico(0.085, 0.24); m4.rotation.z = Math.PI / 2; m4.position.set(-0.6, 0.0, 0); J3.add(m4);

// J4: el antebrazo gira sobre su eje (X)
const J4 = articulacion("J4", 0.2, 0, 0); J3.add(J4);
const ante = torno([[0, 0], [0.19, 0], [0.19, 0.08], [0.16, 0.3], [0.13, 0.82], [0.14, 0.9], [0, 0.9]], M.pintura);
ante.rotation.z = -Math.PI / 2; J4.add(ante);                              // perfil de revolución a lo largo de +X
J4.add(ejeX(cil(0.2, 0.2, 0.04, M.fundicion, 0.02, 0, 0)));
J4.add(manguera([[0.1, 0.17, 0.0], [0.45, 0.18, 0.0], [0.8, 0.16, 0.02]], 0.022));
// horquilla de la muñeca
J4.add(rcaja(0.14, 0.08, 0.34, 0.03, M.pintura, 0.92, 0, 0));
J4.add(rcaja(0.24, 0.24, 0.06, 0.03, M.pintura, 1.06, 0, 0.15));
J4.add(rcaja(0.24, 0.24, 0.06, 0.03, M.pintura, 1.06, 0, -0.15));

// J5: cabeza de la muñeca (pivota en la horquilla)
const J5 = articulacion("J5", 1.08, 0, 0); J4.add(J5);
J5.add(ejeZ(cil(0.1, 0.1, 0.25, M.pinturaOscura, 0, 0, 0)));
J5.add(ejeX(cil(0.085, 0.1, 0.16, M.pintura, 0.1, 0, 0)));

// J6: brida y herramientas
const J6 = articulacion("J6", 0.2, 0, 0); J5.add(J6);
J6.add(ejeX(cil(0.075, 0.075, 0.03, M.acero, 0.0, 0, 0)));
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  J6.add(ejeX(cil(0.009, 0.009, 0.034, M.fundicion, 0.0, Math.cos(a) * 0.055, Math.sin(a) * 0.055, 6)));
}
// pinza neumática de dos dedos
const pinza = new THREE.Group(); pinza.name = "Pinza"; J6.add(pinza);
pinza.add(rcaja(0.12, 0.2, 0.2, 0.02, M.motor, 0.08, 0, 0));
pinza.add(ejeX(cil(0.03, 0.03, 0.1, M.cromo, 0.15, 0.06, 0)));
for (const s of [1, -1]) {
  pinza.add(rcaja(0.06, 0.05, 0.05, 0.01, M.acero, 0.17, 0, s * 0.08));
  pinza.add(rcaja(0.22, 0.04, 0.035, 0.01, M.acero, 0.3, -0.02, s * 0.08));
  pinza.add(rcaja(0.05, 0.03, 0.04, 0.008, M.goma, 0.39, -0.02, s * 0.065));
}
// cuchara de inoculación (ROB-01)
const cuchara = new THREE.Group(); cuchara.name = "Cuchara"; J6.add(cuchara);
cuchara.add(ejeX(cil(0.03, 0.03, 0.3, M.acero, 0.15, 0, 0)));
const vaso = torno([[0, 0], [0.2, 0], [0.24, 0.32], [0.22, 0.34], [0.18, 0.04], [0, 0.04]], M.refractario);
vaso.position.set(0.42, -0.32, 0); cuchara.add(vaso);
const metal = malla(new THREE.CircleGeometry(0.2, 32), M.metal, 0.42, -0.05, 0, "MetalCuchara"); metal.rotation.x = -Math.PI / 2;
cuchara.add(metal);

/* ------------------------------------------------------------------ exportar */
robot.traverse((o) => {
  if (o.isMesh) o.castShadow = o.receiveShadow = true;
});
const escena = new THREE.Scene(); escena.add(robot);
let triangulos = 0;
robot.traverse((o) => { if (o.isMesh) triangulos += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
const glb = await new GLTFExporter().parseAsync(escena, { binary: true });
const salida = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "modelos", "robot-6ejes.glb");
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, Buffer.from(glb));
console.log(`ok ${salida} · ${(glb.byteLength / 1024).toFixed(0)} KB · ${Math.round(triangulos)} triángulos`);
