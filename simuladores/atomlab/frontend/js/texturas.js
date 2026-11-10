// Texturas procedurales (canvas): no hace falta descargar imágenes.
import * as THREE from "three";

function lienzo(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d")];
}

// Ruido de valor con varias octavas (suficiente para hormigón, óxido, suciedad).
function ruido(ctx, w, h, { base, varia, escala = 1, octavas = 4, alfa = 1 }) {
  const img = ctx.getImageData(0, 0, w, h);
  const capas = [];
  for (let o = 0; o < octavas; o++) {
    const n = 4 * 2 ** o * escala;
    capas.push({ n, g: Array.from({ length: (n + 1) * (n + 1) }, Math.random), a: 1 / 2 ** o });
  }
  const suave = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0, s = 0;
      for (const { n, g, a } of capas) {
        const fx = (x / w) * n, fy = (y / h) * n;
        const ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = suave(fx - ix), ty = suave(fy - iy);
        const q = (i, j) => g[((iy + j) % n) * (n + 1) + ((ix + i) % n)];
        v += a * ((q(0, 0) * (1 - tx) + q(1, 0) * tx) * (1 - ty) + (q(0, 1) * (1 - tx) + q(1, 1) * tx) * ty);
        s += a;
      }
      v = v / s - 0.5 + (Math.random() - 0.5) * 0.25;
      const k = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const mezcla = base[c] + varia * v * 255;
        img.data[k + c] = img.data[k + c] * (1 - alfa) + mezcla * alfa;
      }
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function textura(c, repetir = [1, 1], color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repetir);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function hormigon(repetir = [4, 4], tono = [168, 164, 156]) {
  const [c, x] = lienzo(256);
  ruido(x, 256, 256, { base: tono, varia: 0.22, escala: 1, octavas: 5 });
  // juntas de encofrado
  x.strokeStyle = "rgba(60,58,55,.35)"; x.lineWidth = 2;
  for (let i = 0; i <= 256; i += 128) { x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
  x.lineWidth = 1;
  for (let i = 0; i <= 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); }
  // manchas de agua
  for (let i = 0; i < 12; i++) {
    const g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(50,48,45,.08)"); g.addColorStop(1, "rgba(50,48,45,0)");
    x.fillStyle = g; x.fillRect(Math.random() * 256, 0, 3 + Math.random() * 10, 120 + Math.random() * 136);
  }
  return textura(c, repetir);
}

export function rugosidad(repetir = [4, 4]) {
  const [c, x] = lienzo(128);
  ruido(x, 128, 128, { base: [200, 200, 200], varia: 0.6, escala: 2, octavas: 4 });
  return textura(c, repetir, false);
}

export function grafito() {
  // cara de los bloques de grafito: casi negro, satinado, con aristas marcadas
  const [c, x] = lienzo(128);
  ruido(x, 128, 128, { base: [44, 45, 48], varia: 0.18, escala: 3, octavas: 3 });
  x.strokeStyle = "rgba(10,10,12,.9)"; x.lineWidth = 3;
  x.strokeRect(1.5, 1.5, 125, 125);
  x.strokeStyle = "rgba(120,120,125,.25)"; x.lineWidth = 1;
  x.strokeRect(5, 5, 118, 118);
  for (let y = 0; y < 128; y += 21) { x.fillStyle = "rgba(0,0,0,.55)"; x.fillRect(0, y, 128, 1.5); }   // bloques de 0,6 m
  return textura(c, [1, 12]);
}

export function acero(tono = [150, 156, 162], vetas = true) {
  const [c, x] = lienzo(256);
  ruido(x, 256, 256, { base: tono, varia: 0.12, escala: 1, octavas: 3 });
  if (vetas) {
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.05})`;
      x.fillRect(0, Math.random() * 256, 256, 1);
    }
  }
  return textura(c, [2, 2]);
}

export function pintura(color, desgaste = 0.25) {
  const [c, x] = lienzo(256);
  const base = new THREE.Color(color).getRGB({}, THREE.SRGBColorSpace);   // valores sRGB para el canvas
  ruido(x, 256, 256, { base: [base.r * 255, base.g * 255, base.b * 255], varia: desgaste * 0.4, escala: 1, octavas: 4 });
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(80,60,40,${Math.random() * 0.12})`;
    x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 0, 7); x.fill();
  }
  return textura(c, [1, 1]);
}

export function suelo() {
  const [c, x] = lienzo(512);
  ruido(x, 512, 512, { base: [98, 112, 74], varia: 0.35, escala: 2, octavas: 5 });   // hierba seca
  return textura(c, [60, 60]);
}

export function asfalto() {
  const [c, x] = lienzo(256);
  ruido(x, 256, 256, { base: [72, 72, 74], varia: 0.25, escala: 4, octavas: 3 });
  return textura(c, [20, 20]);
}

export function chapa(tono = [150, 160, 152]) {
  // chapa grecada de las fachadas
  const [c, x] = lienzo(256);
  ruido(x, 256, 256, { base: tono, varia: 0.16, escala: 1, octavas: 3 });
  for (let i = 0; i < 256; i += 16) {
    const g = x.createLinearGradient(i, 0, i + 16, 0);
    g.addColorStop(0, "rgba(0,0,0,.18)"); g.addColorStop(0.5, "rgba(255,255,255,.12)"); g.addColorStop(1, "rgba(0,0,0,.18)");
    x.fillStyle = g; x.fillRect(i, 0, 16, 256);
  }
  return textura(c, [8, 2]);
}

export function ventanas(filas = 3, columnas = 24) {
  const [c, x] = lienzo(512, 128);
  x.fillStyle = "#b5b8ae"; x.fillRect(0, 0, 512, 128);
  ruido(x, 512, 128, { base: [181, 184, 174], varia: 0.15, escala: 1, octavas: 3, alfa: 0.6 });
  const w = 512 / columnas, h = 128 / filas;
  for (let f = 0; f < filas; f++) {
    for (let k = 0; k < columnas; k++) {
      const g = x.createLinearGradient(0, f * h, 0, (f + 1) * h);
      g.addColorStop(0, "#2a3946"); g.addColorStop(1, "#5c7486");
      x.fillStyle = g; x.fillRect(k * w + 2, f * h + h * 0.25, w - 4, h * 0.5);
    }
  }
  return textura(c, [1, 1]);
}

export function franjas(n = 8) {
  // chimenea de ventilación a franjas rojas y blancas
  const [c, x] = lienzo(64, 512);
  for (let i = 0; i < n * 2; i++) {
    x.fillStyle = i % 2 ? "#ddd8cf" : "#b3322b";
    x.fillRect(0, (i * 512) / (n * 2), 64, 512 / (n * 2) + 1);
  }
  ruido(x, 64, 512, { base: [128, 128, 128], varia: 0.4, escala: 1, octavas: 3, alfa: 0.18 });
  return textura(c, [1, 1]);
}

export function degradadoAxial() {
  // perfil axial del flujo neutrónico (coseno) para la luz de los canales
  const [c, x] = lienzo(4, 256);
  const g = x.createLinearGradient(0, 0, 0, 256);
  for (let i = 0; i <= 10; i++) {
    const v = Math.round(255 * Math.sin((Math.PI * i) / 10) ** 1.2);
    g.addColorStop(i / 10, `rgb(${v},${v},${v})`);
  }
  x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function humo() {
  // sprite blando para vapor y humo
  const [c, x] = lienzo(128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.4, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const img = x.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] *= 0.75 + Math.random() * 0.25;
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function flujo(color = "#8fd3ff") {
  // franjas que se desplazan por las tuberías para mostrar el caudal
  const [c, x] = lienzo(64, 8);
  x.fillStyle = "#000"; x.fillRect(0, 0, 64, 8);
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, color); g.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = g; x.fillRect(0, 0, 64, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
