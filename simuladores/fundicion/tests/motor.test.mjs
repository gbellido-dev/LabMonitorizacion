// Pruebas del motor de proceso:  node --test tests/motor.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { Planta, AVERIAS } from "../opcua/motor.mjs";

function simula({ averia = 0, minutos = 120, desde = 20, semilla = 7 } = {}) {
  const p = new Planta({ semilla });
  for (let i = 0; i < minutos * 60; i++) {
    if (i === desde * 60) p.setAveria(averia);
    p.paso();
  }
  const piezas = p.piezas.filter((x) => x.ts > desde * 60);
  return { p, piezas };
}

test("es determinista con la misma semilla", () => {
  const a = simula({ minutos: 30 }).p, b = simula({ minutos: 30 }).p;
  assert.deepEqual(a.v, b.v);
});

test("funcionamiento normal: OEE, energía, ritmo y calidad realistas", () => {
  const { p, piezas } = simula({ minutos: 240 });
  const oee = p.v["KPIs.OEEPlanta"];
  assert.ok(oee > 75 && oee < 96, `OEE ${oee}`);
  const e = p.v["KPIs.EnergiaEspecifica"];
  assert.ok(e > 500 && e < 800, `energía ${e} kWh/t`);
  const porHora = piezas.length / (220 / 60);
  assert.ok(porHora > 50 && porHora < 72, `piezas/h ${porHora}`);
  const ok = piezas.filter((x) => x.resultado === "OK").length / piezas.length;
  assert.ok(ok > 0.95, `conformes ${ok}`);
  const enfr = piezas.reduce((s, x) => s + x.enfriamientoMin, 0) / piezas.length;
  assert.ok(enfr > 40 && enfr < 60, `enfriamiento ${enfr} min`);
});

test("cada pieza es trazable hasta su molde, su colada y sus condiciones", () => {
  const { p } = simula({ minutos: 70 });
  const u = p.ultimaPieza;
  for (const k of ["id", "molde", "lote", "tColada", "humedad", "inoculada", "enfriamientoMin", "tDesmoldeo", "desviacion", "resultado", "defectoReal"]) {
    assert.ok(u[k] !== undefined && u[k] !== null, k);
  }
  assert.match(u.lote, /^FE-\d{6}-\d{3}$/);
});

test("avería 1: el rodamiento se degrada y acaba disparando el desmoldeo", () => {
  const { p } = simula({ averia: 1, minutos: 60, desde: 10 });
  assert.equal(p.estados["DES-01"], "ALARM");
  assert.ok(p.v["Simulacion.DesgasteRodamiento"] > 0.6);
});

test("avería 3: la grúa retrasa la cuchara y cae el OEE", () => {
  const n = simula({ minutos: 90 }).p.v["KPIs.OEEPlanta"];
  const f = simula({ averia: 3, minutos: 90 }).p.v["KPIs.OEEPlanta"];
  assert.ok(f < n - 15, `normal ${n}, con avería ${f}`);
});

test("avería 4: el escáner rechaza piezas buenas (falsos rechazos)", () => {
  const { piezas } = simula({ averia: 4, minutos: 80 });
  const falsos = piezas.filter((x) => x.resultado === "RECHAZO" && x.defectoReal === "Ninguno").length;
  assert.ok(falsos > 5, `falsos rechazos ${falsos}`);
});

test("averías 5, 6 y 7: defectos reales con su causa, y con el retraso del túnel", () => {
  const casos = { 5: "Porosidad", 6: "Fundición blanca", 7: "Unión fría" };
  for (const [a, defecto] of Object.entries(casos)) {
    const { piezas } = simula({ averia: Number(a), minutos: 130 });
    const antes = piezas.filter((x) => x.ts < (20 + 45) * 60 && x.defectoReal === defecto).length;
    const despues = piezas.filter((x) => x.ts > (20 + 60) * 60 && x.defectoReal === defecto).length;
    assert.ok(despues > antes + 3, `${AVERIAS[a]}: ${defecto} antes ${antes}, después ${despues}`);
  }
});

test("avería 7: el termopar engaña al control (la temperatura mostrada no es la real)", () => {
  const { p } = simula({ averia: 7, minutos: 60 });
  const mostrada = p.v["IF-01.TemperaturaMetal"], real = p.v["Simulacion.TemperaturaRealIF01"];
  assert.ok(mostrada - real > 50, `mostrada ${mostrada}, real ${real}`);
});

test("rechaza códigos de avería fuera de rango", () => {
  const p = new Planta();
  assert.equal(p.setAveria(99), false);
  assert.equal(p.setAveria(-1), false);
  assert.equal(p.setAveria(2), true);
});
