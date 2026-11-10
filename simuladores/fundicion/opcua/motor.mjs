// Motor de proceso de la Fundición (Planta Norte).
//
// Simulación causal y trazable de una fundición de hierro en arena verde:
//
//   Fusión      dos hornos de inducción con balance de energía (carga de chatarra,
//               fusión, afino, espera y sangrado) → la energía por tonelada sale sola
//   Colada      la grúa cambia la cuchara llena desde un horno LISTO; el metal se enfría
//               en la cuchara y se cuela molde a molde (interlock con la línea)
//   Moldeo      cada molde nace en una prensa con su humedad de arena y su compactación,
//               lleva macho (ROB-03) e inoculación (ROB-01)
//   Enfriamiento los moldes recorren el túnel (cola FIFO): su temperatura baja con el tiempo
//   Desmoldeo   DES-01 vibra cada molde que sale; su rodamiento se desgasta
//   Calidad     QC-01 mide cada pieza; el defecto real depende de las causas
//               (colada fría, humedad, desmoldeo en caliente, sin inocular) y la medida,
//               además, de la deriva del escáner
//
// Todo es determinista con una semilla y avanza en pasos de 1 s simulado
// (`paso()`), así que se puede acelerar (varios pasos por segundo real) y probar.
//
// El motor no sabe nada de OPC UA: publica sus valores en `this.v`
// ("IF-01.TemperaturaMetal" → número), `this.flags`, `this.estados`, y la
// trazabilidad en `this.piezas` / `this.ultimaPieza`.

/* ─────────────────────────────── utilidades ─────────────────────────────── */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ewma = (prev, x, tau, dt = 1) => prev + (x - prev) * (1 - Math.exp(-dt / tau));
const sigmoide = (x) => 1 / (1 + Math.exp(-x));

/* ─────────────────────────────── constantes ─────────────────────────────── */
// Línea de moldes: misma geometría que la escena 3D (bucle de 34 u, 8 moldes,
// colada en x = POUR_X, avance 0,5 u/s mientras se mueve).
export const LINEA = { LOOP: 34, SPACING: 4.25, N: 8, POUR_X: 2.32, SPEED: 0.5 };
const MASA_PIEZA = 90;               // kg de hierro por molde (pieza de ~74 kg + bebederos)
const CUCHARA_MAX = 1450;            // kg
const CP = 820;                      // J/(kg·K) hierro líquido
const E_FUSION = 1.1e6;              // J/kg: calentar la chatarra y fundirla (~1250 °C)
const T_AMB = 25;
const CADENCIA_S = 52;               // ciclo de la línea, limitado por las prensas (≈ 70 moldes/h)
const TUNEL_CAPACIDAD = 54;          // moldes en el túnel (≈ 47 min a ritmo nominal)

export const AVERIAS = [
  "Sin avería",
  "Rodamiento del desmoldeo DES-01",
  "Extracción de humos IF-02",
  "Retraso de la grúa de cuchara",
  "Deriva del escáner 3D QC-01",
  "Humedad de arena alta (MP-01 y MP-02)",
  "Inoculación intermitente (ROB-01)",
  "Termopar del horno IF-01 descalibrado",
];

export const DEFECTOS = ["Ninguno", "Unión fría", "Porosidad", "Deformación", "Fundición blanca"];

/* ─────────────────────────────── el motor ─────────────────────────────── */
export class Planta {
  constructor({ semilla = 1, inicioCaliente = true } = {}) {
    this.rnd = mulberry32(semilla);
    this.t = 0;                       // segundos simulados
    this.averia = { codigo: 0, t: 0 };
    this.v = {};                      // variables numéricas publicadas
    this.flags = {};                  // señales (bool / string)
    this.estados = {};                // RUN / IDLE / WARN / ALARM por activo
    this.piezas = [];                 // últimas 500 piezas inspeccionadas
    this.ultimaPieza = null;
    this.contador = { moldes: 4120, piezas: 4040, coladas: 83, conformes: 0, inspeccionadas: 0 };
    this.fecha = "261110";

    this.hornos = [
      // capacidad 3 t, sangrados de 1 t, se deja un "pie" de 1 t líquido
      { id: "IF-01", cap: 3000, pie: 1000, pn: 3200, eta: 0.76, tObj: 1490, fase: "FUSION", mLiq: 1800, mSol: 900, T: 1290, faseT: 0, tilt: 0, kWh: 0, perdidas: 118 },
      { id: "IF-02", cap: 3000, pie: 1000, pn: 2800, eta: 0.75, tObj: 1470, fase: "LISTO", mLiq: 2950, mSol: 0, T: 1470, faseT: 0, tilt: 0, kWh: 0, perdidas: 115 },
    ];
    this.cuchara = { kg: 1180, T: 1452, lote: this.nuevoLote(), cambio: 0, horno: null };
    this.linea = { off: 0, estado: "MOVING", nivel: 0, pausa: 0, slots: Array(LINEA.N).fill(null), cicloT: 0, ultimoCiclo: CADENCIA_S };
    this.tunel = [];                  // FIFO de moldes colados
    this.desmoldeo = { molde: null, t: 0, marcha: false, desgaste: 0.05, disparado: false };
    this.prensa = { t: [0, 9] };      // fase de ciclo de cada prensa
    this.kpi = { disp: 0.93, rend: 0.95, cal: 0.985, energiaEw: 548, prod: 42.6, conformesEw: 98.4 };
    this.ventiladores = 780;

    if (inicioCaliente) this.arranqueEnCaliente();
    this.publicar();
  }

  nuevoLote() {
    this.contador.coladas = (this.contador?.coladas ?? 83) + 1;
    return `FE-${this.fecha}-${String(this.contador.coladas).padStart(3, "0")}`;
  }

  gauss(s = 1) {
    const u = 1 - this.rnd(), w = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w) * s;
  }

  /* La planta arranca a media jornada: túnel lleno de moldes de distintas
   * edades, para que desde el primer minuto salgan piezas al desmoldeo. */
  arranqueEnCaliente() {
    for (let i = 0; i < TUNEL_CAPACIDAD - 2; i++) {
      const edad = (TUNEL_CAPACIDAD - 2 - i) * CADENCIA_S * 1.08;
      const m = this.nuevoMolde(i % 2);
      Object.assign(m, { tColada: 1418 + this.gauss(6), lote: `FE-${this.fecha}-0${70 + Math.floor(i / 9)}`, inoculada: true,
        tVertido: -edad, nivel: 100 });
      this.tunel.push(m);
    }
    this.contador.coladas = 83;
  }

  nuevoMolde(prensa) {
    const hum = this.humedadArena(prensa);
    this.contador.moldes += 1;
    return {
      id: `M-${String(this.contador.moldes).padStart(6, "0")}`,
      prensa: prensa === 0 ? "MP-01" : "MP-02",
      humedad: hum,
      compactacion: 6.1 + this.gauss(0.08),
      macho: true,
      inoculada: null, tColada: null, lote: null, tVertido: null, nivel: 0,
    };
  }

  humedadArena(prensa) {
    const base = 3.6 + (prensa ? 0.05 : 0) + this.gauss(0.12);
    return this.averia.codigo === 5 ? base + Math.min(0.8, this.averia.t / 600) : base;
  }

  setAveria(codigo) {
    if (!Number.isInteger(codigo) || codigo < 0 || codigo >= AVERIAS.length) return false;
    if (codigo !== this.averia.codigo) {
      // al quitar la avería del rodamiento se considera cambiado (desgaste nuevo)
      if (this.averia.codigo === 1 && codigo !== 1) { this.desmoldeo.desgaste = 0.05; this.desmoldeo.disparado = false; }
      this.averia = { codigo, t: 0 };
    }
    return true;
  }

  /* ───────────── un paso de 1 s simulado ───────────── */
  paso() {
    this.t += 1;
    this.averia.t += 1;
    this.pasoHornos();
    this.pasoCuchara();
    this.pasoLinea();
    this.pasoTunel();
    this.pasoDesmoldeo();
    this.pasoKpis();
    this.publicar();
  }

  /* Hornos: P·η = calentar/fundir + pérdidas. */
  pasoHornos() {
    for (const h of this.hornos) {
      h.faseT += 1;
      const eta = h.eta;
      // termopar descalibrado (avería 7): IF-01 lee hasta 60 °C de más y el control se fía de esa lectura
      h.offset = h.id === "IF-01" && this.averia.codigo === 7 ? Math.min(60, this.averia.t * 0.2) : 0;
      const Tm = h.T + h.offset;
      let P = 0;                                         // kW eléctricos
      const perdidasW = h.perdidas * (h.T - T_AMB);       // W
      if (h.fase === "CARGA") {
        P = h.pn * 0.35;
        if (h.faseT % 12 === 0 && h.mLiq + h.mSol < h.cap - 50) h.mSol += Math.min(380, h.cap - h.mLiq - h.mSol);
        if (h.mLiq + h.mSol >= h.cap - 50) this.fase(h, "FUSION");
      } else if (h.fase === "FUSION") {
        P = h.pn;
        if (h.mSol <= 0 && Tm >= h.tObj - 25) this.fase(h, "AFINO");
      } else if (h.fase === "AFINO") {
        P = h.pn * clamp(0.25 + (h.tObj - Tm) / 40, 0.12, 0.8);
        if (h.faseT >= 75 && Math.abs(Tm - h.tObj) < 12) this.fase(h, "LISTO");
      } else if (h.fase === "LISTO") {
        P = clamp((perdidasW / 1000 + (h.tObj - Tm) * 6) / eta, 0, h.pn * 0.4);
      } else if (h.fase === "SANGRADO") {
        P = h.pn * 0.1;
        h.tilt = Math.min(95, h.tilt + 8);
      }
      if (h.fase !== "SANGRADO") h.tilt = Math.max(0, h.tilt - 8);
      let neto = P * 1000 * eta - perdidasW;              // W
      if (h.mSol > 0 && neto > 0) {                       // fundir chatarra primero
        const fundido = Math.min(h.mSol, (neto * 0.85) / E_FUSION);
        h.mSol -= fundido; h.mLiq += fundido;
        neto *= 0.15;
        // la chatarra fría enfría el baño hacia ~1250 °C
        h.T += ((1250 - h.T) * 0.004) * (h.mSol / Math.max(500, h.mLiq));
      }
      h.T += neto / (Math.max(200, h.mLiq) * CP);
      h.T = clamp(h.T, 1150, 1560);
      h.P = P;
      h.kWh += P / 3600;
    }
  }

  fase(h, nueva) { h.fase = nueva; h.faseT = 0; }

  /* Cuchara: se enfría y se cambia por una llena cuando no queda para un molde. */
  pasoCuchara() {
    const c = this.cuchara;
    c.T = Math.max(1180, c.T - (0.06 + 0.00004 * (c.T - 1300) * (1450 / Math.max(300, c.kg))));   // °C/s, más rápido con poca carga
    if (c.cambio > 0) {                                  // la grúa está cambiando la cuchara
      c.cambio -= 1;
      if (c.cambio === 0) {
        const h = c.horno;
        const masa = Math.min(1000, h.mLiq - 300);
        h.mLiq -= masa; this.fase(h, h.mLiq < h.pie + 50 ? "CARGA" : "LISTO");
        c.kg = Math.min(CUCHARA_MAX, masa + c.kg * 0);   // la cuchara vieja (fría) va a reciclar
        // al sangrar se pierden ~18 °C; si la grúa tarda, el metal se enfría colgado del gancho
        c.T = h.T - 18 - 0.12 * Math.max(0, c.cambioTotal - 25) + this.gauss(3);
        c.lote = this.nuevoLote();
        c.horno = null;
      }
      return;
    }
    const necesita = c.kg < MASA_PIEZA * 1.3 && this.linea.estado !== "FILLING";
    if (necesita) {
      const listos = this.hornos.filter((h) => h.fase === "LISTO" && h.mLiq > 1300).sort((a, b) => b.T - a.T);
      if (listos.length) {
        const h = listos[0];
        this.fase(h, "SANGRADO");
        c.horno = h;
        // cambio de cuchara: 45 s; con la grúa averiada, 4-6 min
        c.cambio = this.averia.codigo === 3 ? 240 + Math.floor(this.rnd() * 120) : 25;
        c.cambioTotal = c.cambio;
      }
    }
  }

  /* Línea de moldes con interlock de colada (misma máquina de estados que la escena). */
  pasoLinea() {
    const L = this.linea, c = this.cuchara;
    L.cicloT += 1;
    const xMolde = (k) => -12 + ((k * LINEA.SPACING + L.off) % LINEA.LOOP);
    // el túnel lleno (desmoldeo parado) bloquea la línea
    const bloqueada = this.tunel.length >= TUNEL_CAPACIDAD + 6;
    if (L.estado === "MOVING" && !bloqueada) {
      let dmin = Infinity, kmin = -1;
      for (let k = 0; k < LINEA.N; k++) {
        const d = (LINEA.POUR_X - xMolde(k) + LINEA.LOOP * 2) % LINEA.LOOP;
        if (d > 0.1 && d < dmin) { dmin = d; kmin = k; }
      }
      if (dmin <= LINEA.SPEED) {
        L.off = (L.off + dmin) % LINEA.LOOP;
        L.estado = "WAIT_METAL"; L.nivel = 0; L.k = kmin;
        // el molde que llega a la colada se fabricó en una prensa (alternan)
        L.slots[kmin] = this.nuevoMolde(this.contador.moldes % 2);
      } else {
        L.off = (L.off + LINEA.SPEED) % LINEA.LOOP;
      }
    }
    L.esperando = L.estado === "WAIT_METAL" && (c.cambio > 0 || c.kg < MASA_PIEZA);
    if (L.estado === "WAIT_METAL" && c.cambio === 0 && c.kg >= MASA_PIEZA) {
      L.estado = "FILLING";
      const m = L.slots[L.k];
      m.tColada = c.T; m.lote = c.lote;
      // ROB-01 inocula en la colada; con la avería 6 falla ~1 de cada 3
      m.inoculada = !(this.averia.codigo === 6 && this.rnd() < 0.35);
    }
    L.caudal = 0;
    if (L.estado === "FILLING") {
      // el caudal baja un poco con el metal frío (más viscoso)
      L.caudal = clamp(8.2 + (c.T - 1420) * 0.02 + this.gauss(0.25), 5, 9.5);
      const kg = Math.min(L.caudal, c.kg);
      c.kg -= kg;
      L.nivel = Math.min(100, L.nivel + (kg / MASA_PIEZA) * 100);
      if (L.nivel >= 100) {
        const m = L.slots[L.k];
        m.tVertido = this.t; m.nivel = 100;
        this.tunel.push(m); L.slots[L.k] = null;
        this.kpi.prod += MASA_PIEZA / 1000;
        L.estado = "PAUSE"; L.pausa = 0;
        L.ultimoCiclo = Math.max(CADENCIA_S, this.t - (L.inicioAnterior ?? this.t - CADENCIA_S));
        L.inicioAnterior = this.t; L.cicloT = 0;
      }
    }
    // tras colar, la línea espera a que la prensa tenga el siguiente molde (cadencia)
    if (L.estado === "PAUSE" && ++L.pausa >= 2 ) {
      // micro-paradas de las prensas: ~1 de cada 3 moldes llega con retraso (pérdida de rendimiento)
      if (L.retraso === undefined) L.retraso = this.rnd() < 0.3 ? 5 + Math.floor(this.rnd() * 30) : 0;
      if (this.t - (L.inicioCiclo ?? 0) >= CADENCIA_S + L.retraso) { L.estado = "MOVING"; L.inicioCiclo = this.t; L.retraso = undefined; }
    }
    L.velocidad = L.estado === "MOVING" && !bloqueada ? 1.5 : 0;
    L.bloqueada = bloqueada;
    // las prensas fabrican al ritmo de la línea
    for (let i = 0; i < 2; i++) this.prensa.t[i] = (this.prensa.t[i] + 1) % 18;
  }

  /* Túnel: temperatura de cada molde según su edad; ventiladores que regulan la salida. */
  tempMolde(m) {
    const edadMin = (this.t - m.tVertido) / 60;
    const tau = 53 / (0.55 + 0.45 * (this.ventiladores / 780));     // min (a 47 min sale a ~610 °C)
    return T_AMB + (m.tColada - T_AMB) * Math.exp(-edadMin / tau);
  }

  pasoTunel() {
    // regulación de ventiladores para sacar los moldes a ~610 °C
    const cab = this.tunel[0];
    if (cab) {
      const err = this.tempMolde(cab) - 610;
      this.ventiladores = clamp(this.ventiladores + err * 0.02, 600, 980);
    }
  }

  /* Desmoldeo: saca un molde del túnel cuando la línea ha colado otro (el túnel es FIFO). */
  pasoDesmoldeo() {
    const d = this.desmoldeo;
    // desgaste del rodamiento: muy lento en normal, rápido con la avería 1
    if (d.marcha) d.desgaste += this.averia.codigo === 1 ? 0.0008 : 0.0000015;
    d.desgaste = clamp(d.desgaste, 0, 1.2);
    if (d.disparado) { d.marcha = false; return; }
    if (d.molde) {
      d.t += 1;
      if (d.t >= 22) { this.inspeccionar(d.molde, d.tDesmoldeo); d.molde = null; d.marcha = false; }
    } else if (this.tunel.length >= TUNEL_CAPACIDAD) {
      d.molde = this.tunel.shift(); d.t = 0; d.marcha = true;
      d.tDesmoldeo = this.tempMolde(d.molde);
    }
    // el rodamiento muy dañado dispara la protección por vibración
    if (this.vibracionDesmoldeo() > 21) { d.disparado = true; d.marcha = false; }
  }

  vibracionDesmoldeo() {
    const d = this.desmoldeo;
    const extra = 9 * Math.pow(Math.max(0, d.desgaste - 0.05), 1.6) * 3.2;   // crece no linealmente
    return d.marcha ? 8.6 + extra : 0.5 + extra * 0.35;
  }

  /* Calidad: defecto real por causas; medida con la deriva del escáner. */
  inspeccionar(m, tDesmoldeo) {
    const r = this.rnd;
    // probabilidades de cada defecto según sus causas
    const pFria = sigmoide((1395 - m.tColada) / 6) * 0.9;
    const pPoros = sigmoide((m.humedad - 4.5) / 0.15) * 0.8;
    const pDeform = sigmoide((tDesmoldeo - 700) / 12) * 0.7;
    const pBlanca = m.inoculada ? 0.002 : 0.55;
    let defecto = "Ninguno";
    if (r() < pFria) defecto = "Unión fría";
    else if (r() < pPoros) defecto = "Porosidad";
    else if (r() < pDeform) defecto = "Deformación";
    else if (r() < pBlanca) defecto = "Fundición blanca";
    else if (r() < 0.006) defecto = ["Unión fría", "Porosidad", "Deformación"][Math.floor(r() * 3)];   // rechazo de fondo
    const desvReal = Math.abs(0.07 + this.gauss(0.016)) + (defecto === "Deformación" ? 0.25 + r() * 0.2 : 0)
      + (defecto === "Unión fría" ? 0.12 + r() * 0.1 : 0);
    const deriva = this.derivaEscaner();
    const desvMedida = desvReal + deriva + this.gauss(0.006);
    // el escáner rechaza por geometría (> 0,25 mm) y ve el defecto superficial con cierta probabilidad
    const visible = defecto === "Porosidad" ? r() < 0.85 : defecto === "Fundición blanca" ? r() < 0.6 : defecto !== "Ninguno";
    const rechazo = desvMedida > 0.25 || visible;
    this.contador.piezas += 1;
    this.contador.inspeccionadas += 1;
    if (!rechazo) this.contador.conformes += 1;
    const pieza = {
      id: `P-${String(this.contador.piezas).padStart(6, "0")}`, molde: m.id, prensa: m.prensa, lote: m.lote,
      tColada: round(m.tColada, 1), humedad: round(m.humedad, 2), inoculada: m.inoculada,
      enfriamientoMin: round((this.t - m.tVertido) / 60, 1), tDesmoldeo: round(tDesmoldeo, 0),
      desviacion: round(desvMedida, 3), resultado: rechazo ? "RECHAZO" : "OK", defecto: rechazo ? (visible ? defecto : "Fuera de tolerancia") : "Ninguno",
      defectoReal: defecto, ts: this.t,
    };
    this.ultimaPieza = pieza;
    this.piezas.push(pieza);
    if (this.piezas.length > 500) this.piezas.shift();
    this.kpi.conformesEw = ewma(this.kpi.conformesEw, rechazo ? 0 : 100, 40);
  }

  /* KPIs: OEE = disponibilidad × rendimiento × calidad (medias móviles de ~10 min). */
  pasoKpis() {
    const L = this.linea;
    const parada = L.esperando || L.bloqueada;
    this.kpi.disp = ewma(this.kpi.disp, parada ? 0 : 1, 600);
    // rendimiento: ciclo ideal frente al real, sin contar las paradas (eso es disponibilidad)
    if (L.cicloT === 0) this.kpi.rend = ewma(this.kpi.rend, clamp(CADENCIA_S / Math.max(CADENCIA_S, L.ultimoCiclo - (L.paradaCiclo ?? 0)), 0, 1), 20);
    if (L.cicloT === 0) L.paradaCiclo = 0;
    if (parada) L.paradaCiclo = (L.paradaCiclo ?? 0) + 1;
    this.kpi.cal = this.kpi.conformesEw / 100;
    // energía por tonelada colada (media móvil): kW de los dos hornos / t/h coladas
    const kW = this.hornos.reduce((s, h) => s + h.P, 0);
    const tph = (MASA_PIEZA / 1000) * (3600 / Math.max(20, L.ultimoCiclo)) * this.kpi.disp;
    this.kpi.energiaEw = ewma(this.kpi.energiaEw, kW / Math.max(1, tph), 1800);
  }

  /* ───────────── publicar en variables con nombre ───────────── */
  publicar() {
    const v = this.v, f = this.flags, e = this.estados, r = (x, d = 1) => round(x + this.gauss(1) * 0, d);
    const g = (s) => this.gauss(s);
    const L = this.linea, c = this.cuchara, d = this.desmoldeo, av = this.averia.codigo;

    // KPIs
    const oee = this.kpi.disp * this.kpi.rend * this.kpi.cal * 100;
    v["KPIs.OEEPlanta"] = round(oee, 1);
    v["KPIs.ProduccionTurno"] = round(this.kpi.prod, 2);
    v["KPIs.PiezasConformes"] = round(this.kpi.conformesEw, 2);
    v["KPIs.EnergiaEspecifica"] = round(this.kpi.energiaEw, 0);
    v["KPIs.CO2Estimado"] = round(0.17 + this.kpi.energiaEw * 0.000456, 3);
    v["KPIs.VelocidadLinea"] = round(L.velocidad ? L.velocidad + g(0.03) : 0, 2);
    v["KPIs.PosicionLinea"] = round(L.off, 2);
    f["KPIs.LoteActivo"] = c.lote;

    // Hornos
    for (const h of this.hornos) {
      const id = h.id;
      v[`${id}.TemperaturaMetal`] = round(h.T + (h.offset ?? 0) + g(1.5), 1);   // lo que mide el termopar
      v[`${id}.PotenciaBobina`] = round(h.P + g(h.P * 0.01), 0);
      v[`${id}.Vibracion`] = round((id === "IF-01" ? 2.1 : 3.8) * (0.4 + 0.6 * h.P / h.pn) + g(0.12), 2);
      v[`${id}.Presion`] = round(id === "IF-02" && av === 2 ? this.presionAveria() : (id === "IF-01" ? -12 : -9) + g(1), 1);
      v[`${id}.NivelCarga`] = round((h.mLiq + h.mSol) / h.cap * 100, 1);
      v[`${id}.OEE`] = round((id === "IF-01" ? 91.2 : 84.7) + g(0.3), 1);
      f[`${id}.Fase`] = h.fase === "SANGRADO" ? "LISTO" : h.fase;   // los clientes ven 4 fases
      v[`${id}.Inclinacion`] = round(h.tilt, 0);
      v[`${id}.EnergiaConsumida`] = round(h.kWh, 1);
      e[id] = id === "IF-02" && av === 2 ? "ALARM" : h.fase === "CARGA" ? "IDLE" : "RUN";
    }
    if (av !== 2) e["IF-02"] = e["IF-02"] === "IDLE" ? "IDLE" : "RUN";

    // Prensas de moldeo
    for (const [i, id] of [[0, "MP-01"], [1, "MP-02"]]) {
      const enCiclo = this.prensa.t[i] < 6;
      v[`${id}.TiempoCiclo`] = round((i ? 18.1 : 18.4) + g(0.2), 2);
      v[`${id}.Temperatura`] = round((i ? 44 : 46) + g(0.4), 1);
      v[`${id}.Potencia`] = round((enCiclo ? 120 : 45) + g(3), 1);
      v[`${id}.Vibracion`] = round((enCiclo ? 2.6 : 0.9) + g(0.1), 2);
      v[`${id}.Presion`] = round((i ? 6.0 : 6.2) + g(0.05), 2);
      v[`${id}.OEE`] = round((i ? 90.1 : 88.9) + g(0.3), 1);
      v[`${id}.HumedadArena`] = round(this.humedadArena(i), 2);
      e[id] = av === 5 ? "WARN" : "RUN";
    }
    v["ROB-03.TiempoCiclo"] = round(16.8 + g(0.2), 2);
    v["ROB-03.Temperatura"] = round(38 + g(0.4), 1);
    v["ROB-03.Potencia"] = round(7 + g(0.5), 2);
    v["ROB-03.Vibracion"] = round(0.3 + g(0.03), 2);
    v["ROB-03.Presion"] = round(6.2 + g(0.05), 2);
    v["ROB-03.OEE"] = round(95.1 + g(0.2), 1);
    v["ROB-03.MachosColocados"] = this.contador.moldes - 2880;
    e["ROB-03"] = "RUN";

    // Colada
    const colando = L.estado === "FILLING";
    v["COL-01.TemperaturaColada"] = round(c.T + g(1), 1);
    v["COL-01.TiempoCiclo"] = round(L.ultimoCiclo, 1);
    v["COL-01.Potencia"] = round((colando ? 52 : 30) + g(2), 1);
    v["COL-01.Vibracion"] = round(0.8 + g(0.06), 2);
    v["COL-01.PesoCuchara"] = round(c.cambio > 0 ? 0 : c.kg, 0);
    v["COL-01.CaudalColada"] = round(L.caudal, 2);
    v["COL-01.NivelLlenado"] = round(L.nivel, 0);
    v["COL-01.OEE"] = round(this.kpi.disp * 93, 1);
    f["COL-01.Colando"] = colando;
    f["COL-01.MoldeEnPosicion"] = L.estado !== "MOVING";
    f["COL-01.CambioCuchara"] = c.cambio > 0;
    e["COL-01"] = L.esperando && c.cambio > 120 ? "WARN" : "RUN";
    v["ROB-01.TiempoCiclo"] = round(24.5 + g(0.25), 2);
    v["ROB-01.Temperatura"] = round(41 + g(0.5), 1);
    v["ROB-01.Potencia"] = round((colando ? 12 : 6) + g(0.5), 2);
    v["ROB-01.Vibracion"] = round(0.4 + g(0.04), 2);
    v["ROB-01.Presion"] = round(6.0 + g(0.05), 2);
    v["ROB-01.VelocidadTCP"] = round(colando ? 1.2 + g(0.1) : 0.2, 2);
    v["ROB-01.OEE"] = round(93.6 + g(0.2), 1);
    e["ROB-01"] = av === 6 ? "WARN" : "RUN";

    // Túnel de enfriamiento
    const cab = this.tunel[0];
    v["ENF-01.TemperaturaMolde"] = round(cab ? this.tempMolde(cab) : 612, 1);
    v["ENF-01.TiempoResidencia"] = round(cab ? (this.t - cab.tVertido) / 60 : 47, 1);
    v["ENF-01.Potencia"] = round(30 + this.ventiladores * 0.031 + g(1), 1);
    v["ENF-01.Vibracion"] = round(1.2 + g(0.08), 2);
    v["ENF-01.Presion"] = round(1.8 + g(0.05), 2);
    v["ENF-01.VelocidadVentiladores"] = round(this.ventiladores, 0);
    v["ENF-01.OEE"] = round(94.3 + g(0.2), 1);
    v["ENF-01.MoldesEnTunel"] = this.tunel.length;
    e["ENF-01"] = this.linea.bloqueada ? "WARN" : "RUN";

    // Desmoldeo
    const vib = this.vibracionDesmoldeo();
    v["DES-01.TiempoCiclo"] = round(22.8 + g(0.3), 2);
    v["DES-01.Temperatura"] = round(88 + Math.max(0, d.desgaste - 0.05) * 42 + g(0.8), 1);
    v["DES-01.Potencia"] = round((d.marcha ? 110 : 12) * (1 + Math.max(0, d.desgaste - 0.05) * 0.15) + g(2), 0);
    v["DES-01.Vibracion"] = round(vib + g(d.marcha ? 0.35 : 0.04), 2);
    v["DES-01.Presion"] = round(4.8 + g(0.08), 2);
    v["DES-01.FrecuenciaVibracion"] = round(d.marcha ? 24 + g(0.3) : 0, 1);
    v["DES-01.OEE"] = round(d.disparado ? 0 : 81.6 + g(0.4), 1);
    f["DES-01.Marcha"] = d.marcha;
    e["DES-01"] = d.disparado ? "ALARM" : vib > 13 ? "WARN" : d.marcha ? "RUN" : "IDLE";
    v["ROB-02.TiempoCiclo"] = round(21.2 + g(0.25), 2);
    v["ROB-02.Temperatura"] = round(44 + g(0.5), 1);
    v["ROB-02.Potencia"] = round((d.marcha ? 14 : 7) + g(0.6), 2);
    v["ROB-02.Vibracion"] = round(0.5 + g(0.05), 2);
    v["ROB-02.Presion"] = round(6.1 + g(0.05), 2);
    v["ROB-02.CargaUtil"] = round(d.marcha ? 34 + g(2) : 0, 1);
    v["ROB-02.PiezasManipuladas"] = this.contador.piezas - 860;
    v["ROB-02.OEE"] = round(92.4 + g(0.2), 1);
    e["ROB-02"] = d.disparado ? "IDLE" : "RUN";

    // Calidad
    const up = this.ultimaPieza;
    const deriva = this.derivaEscaner();
    v["QC-01.TiempoCiclo"] = round(14.6 + g(0.2), 2);
    v["QC-01.Temperatura"] = round(24 + g(0.2), 1);
    v["QC-01.Potencia"] = round(12 + g(0.6), 2);
    v["QC-01.Vibracion"] = round(0.2 + g(0.02), 2);
    v["QC-01.Presion"] = round(6.1 + g(0.04), 2);
    v["QC-01.DesviacionEscaneo"] = round(up ? up.desviacion : 0.08 + deriva, 3);
    v["QC-01.PiezasConformes"] = round(this.kpi.conformesEw, 2);
    v["QC-01.OEE"] = round(97.8 + g(0.2), 1);
    e["QC-01"] = av === 4 && this.averia.t > 60 ? "WARN" : "RUN";

    // Datos para el profesorado y la IA (la "verdad" de la simulación)
    v["Simulacion.DesgasteRodamiento"] = round(d.desgaste, 3);
    v["Simulacion.DerivaEscaner"] = round(deriva, 3);
    v["Simulacion.TemperaturaRealIF01"] = round(this.hornos[0].T, 1);
    v["Simulacion.TiempoSimulado"] = this.t;
  }

  derivaEscaner() {
    // la deriva crece 0,0003 mm/s hasta 0,16 mm (≈ 9 min): cada vez más piezas buenas se rechazan
    return this.averia.codigo === 4 ? Math.min(0.16, this.averia.t * 0.0003) : 0;
  }

  presionAveria() {
    // la extracción falla poco a poco: de −9 Pa a +6 Pa en ~2 min
    return -9 + Math.min(15, this.averia.t * 0.13) + this.gauss(1.2);
  }

  /* Valor de cada señal S7 a partir del estado del proceso. */
  tagS7(activo, simbolo) {
    const v = this.v, f = this.flags, up = this.ultimaPieza;
    const h = this.hornos.find((x) => x.id === activo);
    switch (`${activo}:${simbolo}`) {
      case "IF-01:Metal.Temp": case "IF-02:Metal.Temp": return v[`${activo}.TemperaturaMetal`];
      case "IF-01:Coil.Power": case "IF-02:Coil.Power": return v[`${activo}.PotenciaBobina`];
      case "IF-01:Tilt.Angle": return h.tilt;
      case "IF-01:ReadyToPour": return h.fase === "LISTO";
      case "IF-02:Cooling.Flow": return round(18 + h.P * 0.006, 1);
      case "IF-02:Alarm.Word": return (this.averia.codigo === 2 ? 1 : 0) | (h.T > 1530 ? 2 : 0);
      case "MP-01:Cycle.Time": case "MP-02:Cycle.Time": return v[`${activo}.TiempoCiclo`];
      case "MP-01:Press.Force": case "MP-02:Press.Force": return round(v[`${activo}.Presion`] * 52, 1);
      case "MP-01:Sand.Moisture": return v["MP-01.HumedadArena"];
      case "MP-02:Sand.Density": return round(1.55 - (v["MP-02.HumedadArena"] - 3.6) * 0.03, 3);
      case "MP-01:Mould.OK": case "MP-02:Mould.OK": return v[`${activo}.HumedadArena`] < 4.3;
      case "ROB-03:Axis.J1..J6": return round((this.t * 21) % 360, 1);
      case "ROB-03:Grip.Closed": return this.prensa.t[0] % 17 < 8;
      case "ROB-03:Core.Present": return true;
      case "ROB-03:Cell.Safe": case "ROB-01:Cell.Safe": case "ROB-02:Cell.Safe": return true;
      case "COL-01:Ladle.Weight": return v["COL-01.PesoCuchara"];
      case "COL-01:Pour.Temp": return v["COL-01.TemperaturaColada"];
      case "COL-01:Flow.Rate": return v["COL-01.CaudalColada"];
      case "COL-01:Safety.Zone": return !f["COL-01.CambioCuchara"];
      case "ROB-01:Axis.J1..J6": return round((this.t * 17) % 360, 1);
      case "ROB-01:TCP.Speed": return v["ROB-01.VelocidadTCP"];
      case "ROB-01:Program.No": return f["COL-01.Colando"] ? 3 : 1;
      case "ENF-01:Mould.Temp": return v["ENF-01.TemperaturaMolde"];
      case "ENF-01:Residence.Time": return v["ENF-01.TiempoResidencia"];
      case "ENF-01:Fan.Speed": return v["ENF-01.VelocidadVentiladores"];
      case "ENF-01:Exit.Ready": return this.tunel.length >= TUNEL_CAPACIDAD;
      case "DES-01:Vib.Frequency": return v["DES-01.FrecuenciaVibracion"];
      case "DES-01:Motor.Current": return round(v["DES-01.Potencia"] / (0.4 * 1.732 * 0.85), 1);
      case "DES-01:Dust.FilterDP": return round(820 + (this.t % 3600) * 0.05, 1);
      case "DES-01:Part.Present": return !!this.desmoldeo.molde;
      case "ROB-02:Axis.J1..J6": return round((this.t * 19) % 360, 1);
      case "ROB-02:Payload.Kg": return v["ROB-02.CargaUtil"];
      case "ROB-02:Pick.Count": return v["ROB-02.PiezasManipuladas"];
      case "QC-01:Scan.Deviation": return v["QC-01.DesviacionEscaneo"];
      case "QC-01:Part.Weight": return round(MASA_PIEZA * 0.82 + this.gauss(0.4), 2);
      case "QC-01:Defect.Class": return up ? Math.max(0, DEFECTOS.indexOf(up.defecto)) : 0;
      case "QC-01:Part.Accepted": return up ? up.resultado === "OK" : true;
      default: return 0;
    }
  }
}

function round(x, d = 1) {
  const k = 10 ** d;
  return Math.round(x * k) / k;
}
