// Genera los modelos detallados de los equipos de la Fundición (public/modelos/equipos.glb).
//
//   cd simuladores/fundicion && node modelos/equipos.mjs        (o: npm run modelos)
//
// Un solo glTF con una pieza por nodo raíz. Cada pieza está en las coordenadas del grupo de la escena en el que se
// monta (las cotas son las del gemelo), así que la escena solo tiene que añadirla a ese grupo y ocultar las mallas
// sencillas que sustituye. Lo que cambia con el proceso (el baño de metal, el chorro, las luces, el metal de la
// cuchara, las piezas calientes) sigue siendo de la escena.
//
//   HornoCuerpo        cuerpo del horno de inducción (bascula con Inclinacion)
//   HornoBase          pedestal, bastidor de basculación y cilindros hidráulicos
//   GruaPuente         vigas del puente grúa, testeros y pasarela
//   GruaCarro          carro con tambor, motor y reductor
//   GruaGancho         polipasto (motón con poleas y gancho)
//   GruaCuchara        cuchara de colada con muñones y asa
//   DesmoldeoBastidor  bastidor, muelles y tolva de la parrilla vibrante
//   DesmoldeoRejilla   parrilla que vibra (bandeja, barras y motovibradores)
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(b).toString("base64")}`;
      this.onloadend?.();
    });
  }
};

/* ------------------------------------------------------------------ materiales (los del gemelo) */
const mat = (nombre, color, roughness, metalness, extra = {}) =>
  Object.assign(new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }), { name: nombre });
const M = {
  acero: mat("Acero", 0x4a565e, 0.5, 0.72),
  aceroOscuro: mat("Acero oscuro", 0x2b3339, 0.58, 0.55),
  carcasa: mat("Carcasa", 0x39454d, 0.55, 0.5),
  aceroClaro: mat("Acero claro", 0x93a0a6, 0.34, 0.82),
  cromo: mat("Cromo", 0xd9dee1, 0.15, 1),
  cobre: mat("Cobre", 0xb2652c, 0.3, 0.95),
  refractario: mat("Refractario", 0x8f877a, 0.92, 0.05),
  refractarioInterior: mat("Refractario interior", 0x6d5c4c, 0.95, 0.02, { side: THREE.DoubleSide }),
  amarillo: mat("Amarillo seguridad", 0xd6a02a, 0.55, 0.35),
  negro: mat("Negro", 0x14181c, 0.72, 0.3),
  goma: mat("Goma", 0x16191c, 0.85, 0.0),
  motor: mat("Motor", 0x2f5f7a, 0.45, 0.45),
  muelle: mat("Muelle", 0x8a9aa3, 0.35, 0.85),
};

/* ------------------------------------------------------------------ ayudas */
const malla = (geo, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); return o; };
const caja = (w, h, d, m, x, y, z) => malla(new THREE.BoxGeometry(w, h, d), m, x, y, z);
const rcaja = (w, h, d, r, m, x, y, z) => malla(new RoundedBoxGeometry(w, h, d, 2, r), m, x, y, z);
const cil = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 24, abierto = false) =>
  malla(new THREE.CylinderGeometry(rt, rb, h, seg, 1, abierto), m, x, y, z);
const ejeX = (o) => { o.rotation.z = Math.PI / 2; return o; };
const ejeZ = (o) => { o.rotation.x = Math.PI / 2; return o; };
const torno = (perfil, m, seg = 36) => malla(new THREE.LatheGeometry(perfil.map(([r, h]) => new THREE.Vector2(r, h)), seg), m);
const anillo = (radio, tubo, m, y, seg = 32) => { const o = malla(new THREE.TorusGeometry(radio, tubo, 6, seg), m, 0, y, 0); o.rotation.x = Math.PI / 2; return o; };
const tubo = (puntos, radio, m, seg = 24) =>
  malla(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(puntos.map((p) => new THREE.Vector3(...p))), seg, radio, 6, false), m);
const pernos = (g, n, radio, y, r = 0.03) => {
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; g.add(cil(r, r, 0.05, M.cromo, Math.cos(a) * radio, y, Math.sin(a) * radio, 6)); }
};
// barra de un punto a otro (para cilindros hidráulicos, tirantes…)
const barra = (a, b, radio, m, seg = 16) => {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
  const o = cil(radio, radio, d.length(), m, 0, 0, 0, seg);
  o.position.copy(va.clone().add(vb).multiplyScalar(0.5));
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return o;
};
const muelle = (radio, alto, vueltas, hilo, m) => {
  const pts = [];
  for (let i = 0; i <= vueltas * 14; i++) { const t = i / 14; pts.push([Math.cos(t * Math.PI * 2) * radio, (t / vueltas) * alto, Math.sin(t * Math.PI * 2) * radio]); }
  return tubo(pts, hilo, m, vueltas * 14);
};
const pieza = (nombre) => { const g = new THREE.Group(); g.name = nombre; return g; };
const escena = new THREE.Scene();

/* ================================================================== horno de inducción */
{
  // Cuerpo: coordenadas del grupo «cuerpo» del horno (origen en el suelo, centro del horno)
  const c = pieza("HornoCuerpo"); escena.add(c);
  // envolvente de acero con bridas arriba y abajo
  c.add(torno([[2.18, 0.48], [2.4, 0.48], [2.4, 0.62], [2.27, 0.66], [2.27, 3.42], [2.42, 3.46], [2.42, 3.6], [2.2, 3.6]], M.carcasa, 48));
  // yugos magnéticos verticales con sus pernos
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
    const y = rcaja(0.26, 2.7, 0.2, 0.03, M.aceroOscuro, Math.cos(a) * 2.36, 2.04, Math.sin(a) * 2.36);
    y.rotation.y = -a; c.add(y);
    for (const yy of [0.85, 3.2]) c.add(cil(0.035, 0.035, 0.06, M.cromo, Math.cos(a) * 2.48, yy, Math.sin(a) * 2.48, 6));
  }
  // la bobina de cobre asoma entre los yugos
  for (let i = 0; i < 10; i++) c.add(anillo(2.3, 0.06, M.cobre, 0.98 + i * 0.25, 40));
  // labio refractario y crisol abierto (el baño de la escena se ve dentro)
  c.add(torno([[2.2, 3.6], [2.34, 3.62], [2.34, 3.92], [2.2, 4.02], [1.8, 4.05], [1.68, 4.0], [1.66, 3.9]], M.refractario, 48));
  c.add(cil(1.67, 1.6, 1.9, M.refractarioInterior, 0, 3.0, 0, 40, true));
  // pico de sangrado: canal con paredes, hacia +z
  const pico = new THREE.Group(); pico.position.set(0, 3.86, 2.2); c.add(pico);
  pico.add(caja(0.7, 0.12, 1.0, M.refractario, 0, -0.04, 0.15));
  for (const s of [-1, 1]) pico.add(caja(0.1, 0.22, 1.0, M.refractario, s * 0.3, 0.1, 0.15));
  pico.add(caja(0.86, 0.3, 0.12, M.carcasa, 0, -0.1, 0.66));
  // orejetas de basculación hasta el eje (y = 3,8, z = 2,3)
  for (const s of [-1, 1]) {
    c.add(rcaja(0.18, 0.7, 0.9, 0.04, M.aceroOscuro, s * 2.42, 3.55, 1.85));
    c.add(ejeX(cil(0.16, 0.16, 0.24, M.acero, s * 2.42, 3.8, 2.3)));
  }
  // mangueras de refrigeración de la bobina (detrás)
  for (const [x, y] of [[-0.8, 1.2], [0.8, 1.6], [0, 2.4]]) {
    c.add(tubo([[x, y, -2.32], [x * 1.2, y - 0.3, -2.7], [x * 1.3, 0.8, -2.9]], 0.05, M.goma));
  }
}
{
  // Base: coordenadas del grupo del horno
  const b = pieza("HornoBase"); escena.add(b);
  b.add(cil(2.55, 2.65, 0.42, M.aceroOscuro, 0, 0.21, 0, 40));
  pernos(b, 16, 2.45, 0.44);
  for (let i = 0; i < 4; i++) {                     // células de carga (pesan la carga del horno)
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(rcaja(0.32, 0.12, 0.32, 0.02, M.acero, Math.cos(a) * 1.8, 0.48, Math.sin(a) * 1.8));
  }
  // bastidor de basculación: dos columnas hasta el eje en el lado del pico
  for (const s of [-1, 1]) {
    b.add(rcaja(0.4, 3.5, 0.6, 0.05, M.amarillo, s * 2.72, 2.05, 2.3));
    b.add(rcaja(0.5, 0.3, 1.6, 0.04, M.amarillo, s * 2.72, 0.55, 1.7));
    b.add(ejeX(cil(0.24, 0.24, 0.42, M.aceroOscuro, s * 2.72, 3.8, 2.3)));
    b.add(ejeX(cil(0.11, 0.11, 0.62, M.cromo, s * 2.62, 3.8, 2.3)));
  }
  // cilindros hidráulicos de basculación (detrás: empujan el cuerpo para inclinarlo hacia el pico)
  for (const s of [-1, 1]) {
    const pie = [s * 1.9, 0.5, -1.2], cabeza = [s * 1.9, 2.6, -1.5];
    b.add(barra(pie, [s * 1.9, 1.75, -1.35], 0.17, M.amarillo));
    b.add(barra([s * 1.9, 1.6, -1.33], cabeza, 0.08, M.cromo));
    b.add(rcaja(0.3, 0.2, 0.3, 0.03, M.aceroOscuro, s * 1.9, 0.45, -1.2));
    b.add(tubo([[s * 2.05, 0.8, -1.2], [s * 2.4, 0.6, -1.6], [s * 2.6, 0.3, -2.2]], 0.03, M.goma, 16));
  }
  // barras de potencia y cables refrigerados desde el convertidor (detrás)
  for (const x of [-0.5, -0.17, 0.17, 0.5]) b.add(caja(0.12, 0.04, 1.4, M.cobre, x, 0.5, -2.9));
  for (const x of [-0.5, 0.5]) b.add(tubo([[x, 0.55, -2.2], [x, 0.9, -2.35], [x * 0.8, 1.3, -2.32]], 0.07, M.goma, 16));
}

/* ================================================================== puente grúa */
{
  // Puente: coordenadas del grupo «crane» (vigas a lo largo de z, x = ±0,62)
  const p = pieza("GruaPuente"); escena.add(p);
  for (const s of [-1, 1]) {
    const x = s * 0.62;
    p.add(caja(0.42, 0.78, 26.4, M.amarillo, x, 11.62, 0));                      // viga cajón
    p.add(caja(0.56, 0.06, 26.4, M.amarillo, x, 12.04, 0));                       // ala superior
    p.add(caja(0.56, 0.06, 26.4, M.amarillo, x, 11.2, 0));                        // ala inferior
    for (let z = -12.6; z <= 12.6; z += 1.4) p.add(caja(0.05, 0.7, 0.05, M.aceroOscuro, x + s * 0.22, 11.62, z));   // rigidizadores
    p.add(caja(0.08, 0.06, 26.4, M.acero, x, 12.1, 0));                           // carril del carro
  }
  // pasarela con barandilla por fuera de una viga
  p.add(caja(0.7, 0.05, 25.6, M.aceroClaro, 1.3, 11.22, 0));
  for (let z = -12.6; z <= 12.6; z += 1.6) p.add(caja(0.04, 1.0, 0.04, M.amarillo, 1.62, 11.72, z));
  p.add(caja(0.04, 0.04, 25.6, M.amarillo, 1.62, 12.2, 0));
  p.add(caja(0.04, 0.04, 25.6, M.amarillo, 1.62, 11.75, 0));
  // testeros con ruedas y motores de traslación
  for (const z of [-13.1, 13.1]) {
    p.add(rcaja(2.2, 0.62, 1.1, 0.06, M.amarillo, 0, 11.5, z));
    for (const x of [-0.8, 0.8]) p.add(ejeZ(cil(0.32, 0.32, 0.16, M.aceroOscuro, x, 11.25, z + Math.sign(z) * 0.3)));
    const mot = ejeX(cil(0.16, 0.16, 0.5, M.motor, 0, 11.5, z - Math.sign(z) * 0.7)); p.add(mot);
    p.add(rcaja(0.36, 0.36, 0.3, 0.04, M.aceroOscuro, 0.4, 11.5, z - Math.sign(z) * 0.7));
  }
  // armario eléctrico y festón de cables
  p.add(rcaja(0.6, 0.9, 0.4, 0.04, M.carcasa, 1.3, 11.7, 9.5));
}
{
  // Carro: coordenadas del grupo «trolley»
  const t = pieza("GruaCarro"); escena.add(t);
  t.add(rcaja(1.9, 0.18, 1.6, 0.03, M.aceroOscuro, 0, 12.18, 0));
  for (const x of [-0.62, 0.62]) for (const z of [-0.6, 0.6]) t.add(ejeX(cil(0.16, 0.16, 0.1, M.negro, x, 12.18, z)));
  // tambor del cable con sus espiras
  const tambor = ejeX(cil(0.34, 0.34, 1.1, M.acero, 0, 12.6, 0.1, 28)); t.add(tambor);
  for (let i = 0; i < 9; i++) { const r = malla(new THREE.TorusGeometry(0.345, 0.018, 6, 24), M.aceroOscuro, -0.45 + i * 0.11, 12.6, 0.1); r.rotation.y = Math.PI / 2; t.add(r); }
  for (const x of [-0.62, 0.62]) t.add(rcaja(0.1, 0.62, 0.8, 0.02, M.amarillo, x, 12.55, 0.1));
  // motor de elevación, freno y reductor
  t.add(ejeX(cil(0.2, 0.2, 0.62, M.motor, 0.25, 12.58, -0.6)));
  t.add(ejeX(cil(0.22, 0.22, 0.12, M.aceroOscuro, -0.12, 12.58, -0.6)));
  t.add(rcaja(0.4, 0.5, 0.42, 0.05, M.aceroOscuro, -0.42, 12.55, -0.45));
  t.add(rcaja(0.24, 0.12, 0.24, 0.02, M.amarillo, 0.72, 12.38, 0.7));
}
{
  // Gancho: coordenadas del propio motón (centrado)
  const h = pieza("GruaGancho"); escena.add(h);
  for (const s of [-1, 1]) h.add(rcaja(0.06, 0.62, 0.42, 0.03, M.amarillo, s * 0.2, 0.05, 0));
  for (const x of [-0.08, 0.08]) h.add(ejeX(cil(0.18, 0.18, 0.08, M.aceroOscuro, x, 0.12, 0)));
  h.add(ejeX(cil(0.04, 0.04, 0.5, M.cromo, 0, 0.12, 0)));
  h.add(caja(0.34, 0.08, 0.16, M.aceroOscuro, 0, -0.25, 0));
  h.add(cil(0.05, 0.05, 0.2, M.acero, 0, -0.38, 0));
  const gancho = malla(new THREE.TorusGeometry(0.14, 0.045, 10, 24, Math.PI * 1.45), M.aceroOscuro, 0, -0.6, 0);
  gancho.rotation.z = Math.PI * 0.78; h.add(gancho);
  h.add(caja(0.3, 0.05, 0.42, M.negro, 0, 0.38, 0));        // franjas de aviso
}
{
  // Cuchara: coordenadas del grupo «craneLadle» (el metal de la escena está a y = 6,0…6,8)
  const l = pieza("GruaCuchara"); escena.add(l);
  l.add(torno([[0, 5.42], [0.76, 5.42], [0.8, 5.48], [0.99, 6.9], [1.04, 6.94], [1.04, 7.02], [0.9, 7.02]], M.carcasa, 40));
  l.add(cil(0.9, 0.7, 1.5, M.refractarioInterior, 0, 6.27, 0, 36, true));
  l.add(anillo(0.9, 0.035, M.refractario, 7.0, 40));
  for (const y of [5.75, 6.3]) l.add(anillo(0.84 + (y - 5.42) * 0.13, 0.04, M.aceroOscuro, y, 40));
  // pico de vertido hacia +x
  l.add(rcaja(0.32, 0.12, 0.34, 0.03, M.carcasa, 1.08, 6.98, 0));
  // muñones y asa (sube hasta el gancho)
  for (const s of [-1, 1]) {
    l.add(ejeZ(cil(0.12, 0.12, 0.22, M.acero, 0, 6.55, s * 1.04)));
    l.add(rcaja(0.12, 1.1, 0.08, 0.03, M.aceroOscuro, 0, 7.0, s * 1.18));
  }
  l.add(rcaja(0.14, 0.12, 2.44, 0.04, M.aceroOscuro, 0, 7.55, 0));
  l.add(rcaja(0.18, 0.2, 0.2, 0.03, M.aceroOscuro, 0, 7.66, 0));
  // reductor de volteo (para vaciar la cuchara)
  l.add(rcaja(0.26, 0.3, 0.2, 0.04, M.motor, 0, 6.55, 1.32));
}

/* ================================================================== desmoldeo vibrante */
{
  // Bastidor: coordenadas del grupo «shake»
  const s = pieza("DesmoldeoBastidor"); escena.add(s);
  for (const z of [-1.6, 1.6]) s.add(caja(4.8, 0.32, 0.3, M.amarillo, 0, 0.3, z));        // largueros
  for (const x of [-2.2, 0, 2.2]) s.add(caja(0.3, 0.28, 3.5, M.amarillo, x, 0.3, 0));     // travesaños
  for (const [x, z] of [[-1.9, -1.6], [1.9, -1.6], [-1.9, 1.6], [1.9, 1.6]]) {
    s.add(rcaja(0.4, 0.12, 0.4, 0.02, M.aceroOscuro, x, 0.52, z));
    const m = muelle(0.15, 0.75, 6, 0.028, M.muelle); m.position.set(x, 0.58, z); s.add(m);
  }
  // tolva de arena bajo la parrilla
  s.add(cil(1.6, 0.4, 1.0, M.aceroOscuro, 0, -0.05, 0, 4).rotateY(Math.PI / 4));
  s.add(caja(4.4, 0.08, 3.6, M.aceroOscuro, 0, 0.47, 0));
}
{
  // Parrilla: coordenadas del grupo «grate» (vibra; las piezas calientes son de la escena)
  const r = pieza("DesmoldeoRejilla"); escena.add(r);
  r.add(caja(4.2, 0.1, 3.5, M.aceroOscuro, 0, -0.2, 0));
  for (const z of [-1.75, 1.75]) r.add(caja(4.2, 0.55, 0.1, M.carcasa, 0, 0.05, z));      // paredes laterales
  r.add(caja(0.1, 0.4, 3.5, M.carcasa, -2.1, 0.0, 0));
  for (let z = -1.5; z <= 1.5; z += 0.25) r.add(caja(3.9, 0.06, 0.07, M.acero, 0, 0.0, z));  // barras de la parrilla
  for (let x = -1.8; x <= 1.8; x += 0.6) r.add(caja(0.07, 0.1, 3.3, M.aceroOscuro, x, -0.06, 0));
  // motovibradores a los dos lados
  for (const z of [-1.95, 1.95]) {
    r.add(ejeX(cil(0.22, 0.22, 0.7, M.motor, 0.6, 0.0, z)));
    for (const x of [0.23, 0.97]) r.add(ejeX(cil(0.25, 0.25, 0.06, M.aceroOscuro, x, 0.0, z)));
    r.add(rcaja(0.8, 0.08, 0.36, 0.02, M.aceroOscuro, 0.6, -0.24, z));
  }
  for (const [x, z] of [[-1.9, -1.6], [1.9, -1.6], [-1.9, 1.6], [1.9, 1.6]]) r.add(rcaja(0.4, 0.1, 0.4, 0.02, M.aceroOscuro, x, -0.3, z));
}

/* ------------------------------------------------------------------ exportar */
let triangulos = 0;
escena.traverse((o) => {
  if (o.isMesh) triangulos += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
});
const glb = await new GLTFExporter().parseAsync(escena, { binary: true });
const salida = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "modelos", "equipos.glb");
mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, Buffer.from(glb));
console.log(`ok ${salida} · ${(glb.byteLength / 1024).toFixed(0)} KB · ${Math.round(triangulos)} triángulos`);
