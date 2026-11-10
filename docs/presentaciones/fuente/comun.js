// Generador común de las presentaciones de protocolos de LabMonitorizacion (pptxgenjs).
// Cada presentación es una lista de diapositivas { tipo, ... } que se pintan con los bloques de abajo.
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const md = require("react-icons/md");
const { applyTheme } = require("./tema.js");

const W = 13.333, H = 7.5, MX = 0.6;            // lienzo LAYOUT_WIDE y margen lateral
const Y0 = 1.55, Y1 = 6.75;                       // zona de contenido

const iconos = new Map();
async function icono(nombre, color = "FFFFFF") {
  const clave = nombre + color;
  if (!iconos.has(clave)) {
    const Comp = md[nombre] || md.MdCircle;
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: 256 }));
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    iconos.set(clave, "image/png;base64," + png.toString("base64"));
  }
  return iconos.get(clave);
}

function crear(meta) {
  const THEME = {
    name: `LabMonitorizacion ${meta.protocolo}`,
    headFontFace: "Cambria", bodyFontFace: "Calibri",
    colors: {
      dk1: "1E252E", lt1: "FFFFFF", dk2: "1B2430", lt2: "EEF2F5",
      accent1: meta.color1, accent2: meta.color2, accent3: "5B6B7C", accent4: "2E9E5B",
      accent5: "D64545", accent6: "8A6FB0", hlink: meta.color1, folHlink: "5B6B7C",
    },
  };
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.author = "LabMonitorizacion";
  pres.company = "LabMonitorizacion";
  pres.title = meta.titulo;
  pres.subject = `Protocolo ${meta.protocolo}`;
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;
  const pie = `LabMonitorizacion · ${meta.protocolo}`;

  // ----------------------------------------------------------------- diseños (layouts)
  pres.defineSlideMaster({
    title: "PORTADA", background: { color: C.text2 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 2.1, w: 9.6, h: 1.9, fontSize: 46, bold: true,
        color: C.background1, valign: "bottom", align: "left", margin: 0 }, text: "Título" } },
      { placeholder: { options: { name: "body", type: "body", x: MX, y: 4.2, w: 9.6, h: 1.2, fontSize: 20,
        color: "C9D3DD", valign: "top", align: "left", margin: 0 }, text: "Subtítulo" } },
    ],
  });
  pres.defineSlideMaster({
    title: "SECCION", background: { color: C.text2 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: MX + 2.2, y: 2.6, w: 9.5, h: 1.3, fontSize: 40, bold: true,
        color: C.background1, valign: "middle", align: "left", margin: 0 }, text: "Sección" } },
      { placeholder: { options: { name: "body", type: "body", x: MX + 2.2, y: 3.95, w: 9.5, h: 1.0, fontSize: 18,
        color: "C9D3DD", valign: "top", align: "left", margin: 0 }, text: "Descripción" } },
    ],
  });
  pres.defineSlideMaster({
    title: "CIERRE", background: { color: C.text2 },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.9, w: W - 2 * MX, h: 1.2, fontSize: 40, bold: true,
        color: C.background1, valign: "middle", align: "left", margin: 0 }, text: "Cierre" } },
    ],
  });
  pres.defineSlideMaster({
    title: "CONTENIDO", background: { color: C.background1 },
    margin: [0.5, MX, 0.7, MX],
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.42, w: W - 2 * MX, h: 0.85, fontSize: 32, bold: true,
        color: C.text1, valign: "middle", align: "left", margin: 0 }, text: "Título" } },
      { text: { text: pie, options: { x: MX, y: H - 0.48, w: 6, h: 0.3, fontSize: 10, color: "7A8794", margin: 0 } } },
    ],
    slideNumber: { x: W - MX - 0.6, y: H - 0.48, w: 0.6, h: 0.3, fontSize: 10, color: "7A8794", align: "right" },
  });

  const d = { pres, C, THEME, meta, n: 0 };

  // ----------------------------------------------------------------- utilidades de dibujo
  d.circuloIcono = async (s, nombre, x, y, diam = 0.62, color = C.accent1) => {
    s.addShape(pres.shapes.OVAL, { x, y, w: diam, h: diam, fill: { color }, line: { color, width: 0 }, objectName: "icono-fondo" });
    const m = diam * 0.24;
    s.addImage({ data: await icono(nombre), x: x + m, y: y + m, w: diam - 2 * m, h: diam - 2 * m, objectName: "icono" });
  };
  d.texto = (s, texto, o) => s.addText(texto, { isTextBox: true, fontSize: 16, color: C.text1, valign: "top", margin: 0, ...o });
  d.caja = (s, x, y, w, h, o = {}) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08, fill: { color: o.fill || C.background2 }, line: { color: o.line || o.fill || C.background2, width: o.lw || 0.75 },
    shadow: o.sombra ? { type: "outer", color: "000000", opacity: 0.12, blur: 6, offset: 2, angle: 90 } : undefined, objectName: o.nombre || "caja",
  });
  d.flecha = (s, x1, y1, x2, y2, o = {}) => s.addShape(pres.shapes.LINE, {
    x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1) || 0.001, h: Math.abs(y2 - y1) || 0.001,
    flipH: x2 < x1, flipV: y2 < y1,
    line: { color: o.color || "7A8794", width: o.ancho || 2, endArrowType: o.sinPunta ? undefined : "triangle",
            beginArrowType: o.doble ? "triangle" : undefined, dashType: o.discontinua ? "dash" : "solid" },
    objectName: "flecha",
  });
  // texto con **negritas** y `código`
  d.rico = (txt, base = {}) => {
    const partes = [];
    String(txt).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/).filter(Boolean).forEach((p) => {
      if (p.startsWith("**")) partes.push({ text: p.slice(2, -2), options: { ...base, bold: true } });
      else if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) partes.push({ text: p.slice(1, -1), options: { ...base, italic: true } });
      else if (p.startsWith("`")) partes.push({ text: p.slice(1, -1), options: { ...base, fontFace: "Courier New", color: base.codigo || C.accent1 } });
      else partes.push({ text: p, options: { ...base } });
    });
    if (!partes.length) partes.push({ text: " ", options: { ...base } });   // nunca un cuadro de texto vacío
    return partes;
  };
  d.vinetas = (items, tam = 18, color) => {
    const runs = [];
    items.forEach((it, i) => {
      const partes = d.rico(it, { fontSize: tam, color: color || C.text1 });
      partes[0].options = { ...partes[0].options, bullet: { indent: 20 }, paraSpaceAfter: 10 };
      partes.slice(1).forEach((p) => { p.options = { ...p.options, paraSpaceAfter: 10 }; });
      partes[partes.length - 1].options = { ...partes[partes.length - 1].options, breakLine: i < items.length - 1 };
      runs.push(...partes);
    });
    return runs;
  };
  d.codigo = (s, codigo, x, y, w, h, tam = 13) => {
    d.caja(s, x, y, w, h, { fill: "1B2430", nombre: "codigo-fondo" });
    s.addText(codigo, { isTextBox: true, x: x + 0.25, y: y + 0.2, w: w - 0.5, h: h - 0.4, fontFace: "Courier New", fontSize: tam,
      color: "E4ECF3", valign: "top", margin: 0, objectName: "codigo" });
  };
  return d;
}

// ===================================================================== tipos de diapositiva
const PINTAR = {
  portada(d, s, e) {
    s.addText(e.titulo, { placeholder: "title" });
    s.addText(e.subtitulo, { placeholder: "body" });
    s.addShape(d.pres.shapes.OVAL, { x: 10.2, y: 1.6, w: 2.6, h: 2.6, fill: { color: d.C.accent1 }, line: { color: d.C.accent1, width: 0 }, objectName: "sello" });
    d.texto(s, d.meta.sigla, { x: 10.2, y: 1.6, w: 2.6, h: 2.6, fontSize: d.meta.sigla.length > 5 ? 30 : 40, bold: true, color: d.C.background1, align: "center", valign: "middle", fontFace: "Cambria" });
    d.texto(s, d.rico(e.pie || "", { fontSize: 14, color: "9FB0C0" }), { x: MX, y: 6.4, w: 12, h: 0.5 });
  },
  seccion(d, s, e) {
    s.addText(e.titulo, { placeholder: "title" });
    s.addText(e.texto || "", { placeholder: "body" });
    s.addShape(d.pres.shapes.OVAL, { x: MX, y: 2.55, w: 1.6, h: 1.6, fill: { color: d.C.accent1 }, line: { color: d.C.accent1, width: 0 }, objectName: "numero-fondo" });
    d.texto(s, String(e.numero), { x: MX, y: 2.55, w: 1.6, h: 1.6, fontSize: 48, bold: true, color: d.C.background1, align: "center", valign: "middle", fontFace: "Cambria" });
  },
  async cifras(d, s, e) {
    const n = e.cifras.length, gap = 0.35, w = (W - 2 * MX - gap * (n - 1)) / n, y = e.intro ? 2.35 : Y0;
    if (e.intro) d.texto(s, d.rico(e.intro, { fontSize: 18 }), { x: MX, y: Y0, w: W - 2 * MX, h: 0.7 });
    e.cifras.forEach((c, i) => {
      const x = MX + i * (w + gap);
      d.caja(s, x, y, w, 2.5, { nombre: "cifra" });
      d.texto(s, c.valor, { x: x + 0.3, y: y + 0.3, w: w - 0.6, h: 1.2, fontSize: c.valor.length > 6 ? 40 : 54, bold: true, color: d.C.accent1, fontFace: "Cambria", valign: "middle" });
      d.texto(s, d.rico(c.texto, { fontSize: 17, color: d.C.text1 }), { x: x + 0.3, y: y + 1.55, w: w - 0.6, h: 0.85 });
    });
    if (e.nota) {
      const yn = y + 2.85;
      await d.circuloIcono(s, e.icono || "MdLightbulb", MX, yn + 0.05, 0.55, d.C.accent2);
      d.texto(s, d.rico(e.nota, { fontSize: 18 }), { x: MX + 0.8, y: yn, w: W - 2 * MX - 0.8, h: Y1 - yn });
    }
  },
  async tarjetas(d, s, e) {
    const cols = e.columnas || Math.min(3, e.items.length), filas = Math.ceil(e.items.length / cols);
    const gap = 0.3, yI = e.intro ? Y0 + 0.75 : Y0;
    if (e.intro) d.texto(s, d.rico(e.intro, { fontSize: 17 }), { x: MX, y: Y0, w: W - 2 * MX, h: 0.6 });
    const yF = e.nota ? Y1 - 1.1 : Y1;
    const w = (W - 2 * MX - gap * (cols - 1)) / cols, h = Math.min(filas === 1 ? 3.4 : 9, (yF - yI - gap * (filas - 1)) / filas);
    for (const [i, it] of e.items.entries()) {
      const x = MX + (i % cols) * (w + gap), y = yI + Math.floor(i / cols) * (h + gap);
      d.caja(s, x, y, w, h, { nombre: "tarjeta" });
      await d.circuloIcono(s, it.icono || "MdCircle", x + 0.25, y + 0.25, 0.6, it.color || d.C.accent1);
      d.texto(s, d.rico(it.titulo, { fontSize: 18, bold: true }), { x: x + 1.0, y: y + 0.25, w: w - 1.2, h: 0.6, valign: "middle", fontFace: "Cambria" });
      d.texto(s, d.rico(it.texto, { fontSize: it.tam || e.tam || 17 }), { x: x + 0.25, y: y + 1.0, w: w - 0.5, h: h - 1.15 });
    }
    if (e.nota) {
      const yn = yI + filas * h + (filas - 1) * gap + 0.4;
      await d.circuloIcono(s, e.iconoNota || "MdLightbulb", MX, yn + 0.05, 0.55, d.C.accent2);
      d.texto(s, d.rico(e.nota, { fontSize: 18 }), { x: MX + 0.8, y: yn, w: W - 2 * MX - 0.8, h: 0.9 });
    }
  },
  compara(d, s, e) {
    const gap = 0.4, w = (W - 2 * MX - gap) / 2;
    e.columnas.forEach((c, i) => {
      const x = MX + i * (w + gap), color = i === 0 ? d.C.accent3 : d.C.accent1;
      d.caja(s, x, Y0, w, 0.7, { fill: color, nombre: "cabecera" });
      d.texto(s, c.titulo, { x: x + 0.3, y: Y0, w: w - 0.6, h: 0.7, fontSize: 20, bold: true, color: d.C.background1, valign: "middle", fontFace: "Cambria" });
      d.caja(s, x, Y0 + 0.85, w, Y1 - Y0 - 0.85 - (e.conclusion ? 0.75 : 0), { nombre: "columna" });
      d.texto(s, d.vinetas(c.items, e.tam || 19), { x: x + 0.3, y: Y0 + 1.05, w: w - 0.6, h: Y1 - Y0 - 1.25 - (e.conclusion ? 0.75 : 0) });
    });
    if (e.conclusion) d.texto(s, d.rico(e.conclusion, { fontSize: 16, italic: true, color: d.C.text1 }), { x: MX, y: Y1 - 0.55, w: W - 2 * MX, h: 0.55, valign: "middle" });
  },
  tabla(d, s, e) {
    const cab = e.cabecera.map((t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: d.THEME.colors.accent1 }, fontSize: e.tam || 16, valign: "middle" } }));
    const filas = e.filas.map((f, i) => f.map((t, j) => ({ text: d.rico(t, { fontSize: e.tam || 16, color: d.C.text1, codigo: d.THEME.colors.accent1 }),
      options: { fill: { color: i % 2 ? "FFFFFF" : "EEF2F5" }, valign: "middle", bold: j === 0 && e.primeraNegrita !== false } })));
    const yT = e.intro ? Y0 + 0.7 : Y0;
    if (e.intro) d.texto(s, d.rico(e.intro, { fontSize: 17 }), { x: MX, y: Y0, w: W - 2 * MX, h: 0.6 });
    const total = e.anchos.reduce((a, b) => a + b, 0), escala = (W - 2 * MX) / total;
    s.addTable([cab, ...filas], { x: MX, y: yT, w: W - 2 * MX, colW: e.anchos.map((a) => a * escala), border: { type: "solid", color: "D5DDE5", pt: 0.75 },
      margin: [4, 6, 4, 6], rowH: e.altoFila || 0.6, fontFace: "Calibri", objectName: "tabla" });
    if (e.nota) d.texto(s, d.rico(e.nota, { fontSize: 14, italic: true, color: "5B6B7C" }), { x: MX, y: Y1 - 0.4, w: W - 2 * MX, h: 0.45 });
  },
  flujo(d, s, e) {
    // nodos en fila con flechas etiquetadas; e.nodos = [{titulo, texto, color}], e.flechas = ["etiqueta", ...]
    const n = e.nodos.length, flecha = e.hueco || 1.0, w = (W - 2 * MX - flecha * (n - 1)) / n, y = e.y || Y0 + 0.2, h = e.alto || 2.7;
    e.nodos.forEach((nd, i) => {
      const x = MX + i * (w + flecha);
      d.caja(s, x, y, w, h, { fill: nd.color || d.C.background2, sombra: true, nombre: "nodo" });
      const claro = nd.color && nd.color !== d.C.background2;
      d.texto(s, nd.titulo, { x: x + 0.15, y: y + 0.15, w: w - 0.3, h: 0.65, fontSize: 19, bold: true, align: "center", valign: "middle", color: claro ? d.C.background1 : d.C.text1, fontFace: "Cambria" });
      d.texto(s, d.rico(nd.texto || "", { fontSize: e.tamNodo || 16, color: claro ? d.C.background1 : d.C.text1, codigo: claro ? "FFFFFF" : d.THEME.colors.accent1 }), { x: x + 0.15, y: y + 0.85, w: w - 0.3, h: h - 1.0, align: "center" });
      if (i < n - 1) {
        const xa = x + w + 0.08, xb = x + w + flecha - 0.08, ym = y + h / 2;
        d.flecha(s, xa, ym, xb, ym, { color: d.C.accent2, doble: e.doble?.[i] });
        if (e.flechas?.[i]) d.texto(s, e.flechas[i], { x: x + w - 0.1, y: ym - 0.75, w: flecha + 0.2, h: 0.6, fontSize: 11, align: "center", valign: "bottom", color: "5B6B7C" });
      }
    });
    if (e.abajo) d.texto(s, d.vinetas(e.abajo, e.tam || 18), { x: MX, y: y + h + 0.4, w: W - 2 * MX, h: Y1 - (y + h + 0.4) });
  },
  codigo(d, s, e) {
    const wI = e.anchoTexto ?? 5.0;
    if (wI > 0) d.texto(s, d.vinetas(e.puntos, e.tam || 16), { x: MX, y: Y0, w: wI, h: Y1 - Y0 });
    d.codigo(s, e.codigo, MX + (wI > 0 ? wI + 0.35 : 0), Y0, W - 2 * MX - (wI > 0 ? wI + 0.35 : 0), Y1 - Y0, e.tamCodigo || 13);
  },
  async lista(d, s, e) {
    const wI = e.destacado ? 7.4 : W - 2 * MX;
    d.texto(s, d.vinetas(e.puntos, e.tam || 18), { x: MX, y: Y0, w: wI, h: Y1 - Y0 });
    if (e.destacado) {
      const x = MX + wI + 0.4, w = W - MX - x;
      d.caja(s, x, Y0, w, Y1 - Y0, { fill: d.C.text2, nombre: "destacado" });
      await d.circuloIcono(s, e.destacado.icono || "MdLightbulb", x + 0.35, Y0 + 0.35, 0.7, d.C.accent1);
      d.texto(s, e.destacado.titulo, { x: x + 0.35, y: Y0 + 1.25, w: w - 0.7, h: 0.6, fontSize: 20, bold: true, color: d.C.background1, fontFace: "Cambria" });
      d.texto(s, d.rico(e.destacado.texto, { fontSize: 17, color: "DCE4EC", codigo: "F2C46D" }), { x: x + 0.35, y: Y0 + 1.95, w: w - 0.7, h: Y1 - Y0 - 2.2 });
    }
  },
  secuencia(d, s, e) {
    // e.actores = ["Cliente", "Servidor"], e.mensajes = [{de, a, texto, discontinua}]
    const n = e.actores.length, xI = e.anchoTexto ? MX + e.anchoTexto + 0.4 : MX, wD = W - MX - xI;
    const paso = wD / n, xs = e.actores.map((_, i) => xI + paso * (i + 0.5));
    e.actores.forEach((a, i) => {
      d.caja(s, xs[i] - 1.1, Y0, 2.2, 0.6, { fill: i === 0 ? d.C.accent1 : d.C.text2, nombre: "actor" });
      d.texto(s, a, { x: xs[i] - 1.1, y: Y0, w: 2.2, h: 0.6, fontSize: 15, bold: true, color: d.C.background1, align: "center", valign: "middle" });
      d.flecha(s, xs[i], Y0 + 0.6, xs[i], Y1, { sinPunta: true, discontinua: true, color: "A9B6C2", ancho: 1.25 });
    });
    const dy = Math.min(0.62, (Y1 - Y0 - 0.9) / e.mensajes.length);
    e.mensajes.forEach((m, k) => {
      const y = Y0 + 1.05 + k * dy, x1 = xs[m.de], x2 = xs[m.a];
      if (m.de === m.a) {
        d.texto(s, d.rico(m.texto, { fontSize: 13, italic: true, color: "5B6B7C" }), { x: x1 + 0.1, y: y - 0.25, w: paso - 0.2, h: 0.45 });
        return;
      }
      d.flecha(s, x1, y, x2, y, { color: m.color || (m.discontinua ? d.C.accent2 : d.C.accent1), discontinua: m.discontinua });
      d.texto(s, d.rico(m.texto, { fontSize: 14, color: d.C.text1 }), { x: Math.min(x1, x2) + 0.1, y: y - 0.32, w: Math.abs(x2 - x1) - 0.2, h: 0.3, align: "center", valign: "bottom" });
    });
    if (e.anchoTexto) d.texto(s, d.vinetas(e.puntos, e.tam || 17), { x: MX, y: Y0, w: e.anchoTexto, h: Y1 - Y0 });
  },
  trama(d, s, e) {
    // e.campos = [{nombre, bytes, valor, color}] ; dibuja una trama de bytes proporcional
    const total = e.campos.reduce((a, c) => a + (c.peso || c.bytes), 0), wT = W - 2 * MX, y = Y0 + 0.3;
    let x = MX;
    e.campos.forEach((c, i) => {
      const w = wT * (c.peso || c.bytes) / total;
      s.addShape(d.pres.shapes.RECTANGLE, { x, y, w, h: 1.1, fill: { color: c.color || (i % 2 ? d.C.accent1 : d.C.text2) }, line: { color: "FFFFFF", width: 2 }, objectName: "campo" });
      d.texto(s, c.nombre, { x: x + 0.05, y: y + 0.08, w: w - 0.1, h: 0.55, fontSize: 13, bold: true, color: d.C.background1, align: "center", valign: "middle" });
      d.texto(s, `${c.bytes} B`, { x: x + 0.05, y: y + 0.62, w: w - 0.1, h: 0.4, fontSize: 12, color: "DCE4EC", align: "center" });
      d.texto(s, c.valor || "", { x: x + 0.02, y: y + 1.2, w: w - 0.04, h: 0.45, fontSize: 13, fontFace: "Courier New", color: d.C.text1, align: "center" });
      x += w;
    });
    if (e.grupos) e.grupos.forEach((g) => {
      const x1 = MX + wT * g.desde / total, x2 = MX + wT * g.hasta / total;
      d.flecha(s, x1, y - 0.15, x2, y - 0.15, { doble: true, color: "7A8794", ancho: 1.25 });
      d.texto(s, g.texto, { x: x1, y: y - 0.55, w: x2 - x1, h: 0.35, fontSize: 12, align: "center", color: "5B6B7C" });
    });
    if (e.puntos) d.texto(s, d.vinetas(e.puntos, e.tam || 18), { x: MX, y: y + 1.95, w: W - 2 * MX, h: Y1 - y - 1.95 });
  },
  async arbol(d, s, e) {
    const wA = e.anchoArbol || 5.6;
    d.caja(s, MX, Y0, wA, Y1 - Y0, { nombre: "arbol-fondo" });
    d.texto(s, e.arbol, { x: MX + 0.3, y: Y0 + 0.25, w: wA - 0.5, h: Y1 - Y0 - 0.5, fontFace: "Courier New", fontSize: e.tamArbol || 13 });
    const x = MX + wA + 0.4, w = W - MX - x;
    if (e.anatomia) {
      d.texto(s, "Anatomía de un NodeId", { x, y: Y0, w, h: 0.45, fontSize: 18, bold: true, fontFace: "Cambria" });
      const total = e.anatomia.reduce((a, p) => a + p.texto.length, 0);
      let xx = x;
      e.anatomia.forEach((p, i) => {
        const ww = w * p.texto.length / total;
        s.addShape(d.pres.shapes.RECTANGLE, { x: xx, y: Y0 + 0.6, w: ww, h: 0.7, fill: { color: i % 2 ? d.C.accent1 : d.C.text2 }, line: { color: "FFFFFF", width: 2 }, objectName: "trozo" });
        d.texto(s, p.texto, { x: xx, y: Y0 + 0.6, w: ww, h: 0.7, fontSize: 15, fontFace: "Courier New", color: d.C.background1, align: "center", valign: "middle", bold: true });
        d.texto(s, p.significa, { x: xx, y: Y0 + 1.35, w: ww, h: 0.6, fontSize: 11, align: "center", color: "5B6B7C" });
        xx += ww;
      });
    }
    d.texto(s, d.vinetas(e.puntos, e.tam || 17), { x, y: e.anatomia ? Y0 + 2.2 : Y0, w, h: Y1 - (e.anatomia ? Y0 + 2.2 : Y0) });
  },
  async cuadricula(d, s, e) {
    // 2 x 2 con cabecera de color (p. ej. las 4 tablas de Modbus)
    const gap = 0.3, w = (W - 2 * MX - gap) / 2, h = (Y1 - Y0 - gap) / 2;
    for (const [i, c] of e.celdas.entries()) {
      const x = MX + (i % 2) * (w + gap), y = Y0 + Math.floor(i / 2) * (h + gap);
      d.caja(s, x, y, w, h, { nombre: "celda" });
      await d.circuloIcono(s, c.icono, x + 0.25, y + 0.25, 0.62, c.color || d.C.accent1);
      d.texto(s, c.titulo, { x: x + 1.05, y: y + 0.2, w: w - 3.1, h: 0.45, fontSize: 19, bold: true, fontFace: "Cambria" });
      d.texto(s, d.rico(c.sub, { fontSize: 13, color: "5B6B7C" }), { x: x + 1.05, y: y + 0.62, w: w - 3.1, h: 0.35 });
      d.caja(s, x + w - 1.95, y + 0.3, 1.7, 0.55, { fill: d.C.background1, line: "C9D3DD", nombre: "etiqueta" });
      d.texto(s, c.etiqueta, { x: x + w - 1.95, y: y + 0.3, w: 1.7, h: 0.55, fontSize: 13, bold: true, align: "center", valign: "middle", color: d.C.accent1 });
      d.texto(s, d.rico(c.texto, { fontSize: e.tam || 16 }), { x: x + 0.3, y: y + 1.1, w: w - 0.6, h: h - 1.25 });
    }
  },
  async cierre(d, s, e) {
    s.addText(e.titulo, { placeholder: "title" });
    const paso = Math.min(0.95, 4.4 / e.puntos.length);
    for (const [i, p] of e.puntos.entries()) {
      const y = 2.5 + i * paso;
      await d.circuloIcono(s, "MdCheck", MX, y, 0.55, d.C.accent1);
      d.texto(s, d.rico(p, { fontSize: 21, color: "E4ECF3", codigo: "F2C46D" }), { x: MX + 0.85, y: y - 0.1, w: 11.2, h: 0.75, valign: "middle" });
    }
  },
};
PINTAR.portada.layout = "PORTADA";
PINTAR.seccion.layout = "SECCION";
PINTAR.cierre.layout = "CIERRE";

async function construir(meta, diapositivas, salida) {
  const d = crear(meta);
  let seccion = "Introducción";
  d.pres.addSection({ title: seccion });
  for (const e of diapositivas) {
    if (e.tipo === "seccion") { seccion = e.titulo; d.pres.addSection({ title: seccion }); }
    const pintar = PINTAR[e.tipo];
    if (!pintar) throw new Error("tipo desconocido " + e.tipo);
    const s = d.pres.addSlide({ masterName: pintar.layout || "CONTENIDO", sectionTitle: seccion });
    if (!pintar.layout) s.addText(e.titulo, { placeholder: "title" });
    await pintar(d, s, e);
    if (e.notas) s.addNotes(e.notas);
  }
  await d.pres.writeFile({ fileName: salida });
  await applyTheme(salida, d.THEME);
  return salida;
}

module.exports = { construir, W, H, MX };
