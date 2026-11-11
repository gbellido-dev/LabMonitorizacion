"""Simulación rápida para la serie 4 de IA: «¿qué pasaría si se pulsa el AZ-5 ahora?».

Dos usos:

* `lote(casos, semilla)`: genera estados de operación al azar (potencia, barras, xenón, bombas,
  subenfriamiento, prueba de inercia), pulsa el AZ-5 en cada uno y devuelve las medidas que había
  justo antes (las mismas claves que `GET /api/v1/medidas`) y lo que pasó después. Sirve para
  entrenar un modelo **sustituto** del simulador.
* `que_pasaria(central)`: lo mismo desde el estado actual de la central, en una copia (la planta real
  no se toca). Es la «verdad» con la que se compara el modelo en tiempo real.

Cada caso cuesta unas centésimas de segundo de CPU: 500 casos, unos 20 s.
"""

from __future__ import annotations

import random
import time

from .fisica import BETA_I, CAUDAL_NOM, LAMBDA_I, LAMBDA_P, P_NOMINAL, VAPOR_NOM, Central
from .planta import Planta

SEGUNDOS_TRAS_AZ5 = 20.0
POTENCIAS = (200.0, 400.0, 700.0, 1000.0, 1600.0, 2400.0, 3200.0)

# claves de `medidas()` que dicen lo que ya pasó (no son entradas válidas de un modelo)
NO_ENTRADAS = ("reactor_pico_mwt", "proteccion_scram", "proteccion_danado", "proteccion_combustible_fundido_pct",
               "proteccion_alarmas_activas", "radiacion_liberacion_rel", "estado")


def operacion(potencia: float, insercion: float, xenon: float, bombas: int, subenfriamiento: float) -> Central:
    """Una central crítica y estable en el punto de operación pedido, con el regulador en manual."""
    c = Central()
    c.n = potencia / P_NOMINAL
    c.c = [b / (l * LAMBDA_P) * c.n for b, l in zip(BETA_I, LAMBDA_I)]
    c.xenon, c.yodo = xenon, 1.0
    c.grupos["RR"].z, c.grupos["AR"].z, c.grupos["USP"].z, c.grupos["AZ"].z = insercion, min(1.0, 2 * insercion), insercion, 0.0
    for g in c.grupos.values():
        g.objetivo = None
    c.bcp, c.caudal = bombas, CAUDAL_NOM * bombas / 6
    c.consigna_mwt = c.consigna_rampa = potencia
    c.regulador_auto, c.protecciones = False, False
    vapor = VAPOR_NOM * potencia / P_NOMINAL
    c.valv_turbina = c._int_turbina = 100.0 * vapor / 1650.0
    c.alimentacion = c.vapor = vapor
    c.t_entrada = c.t_entrada_sat() - subenfriamiento
    for _ in range(1200):                      # asentar la termohidráulica
        c._termohidraulica(0.5)
        c._temperaturas(0.5)
    c.t_graf = c.t_entrada_sat() + 380.0 * c.n ** 0.8
    c.rho_sesgo = 0.0
    c.rho_sesgo = -c._reactividad()            # crítico en ese estado
    c.t = 0.0
    return c


def _despues_az5(p: Planta) -> dict:
    """Pulsa el AZ-5 en la planta `p` (una copia) y la deja evolucionar."""
    antes = p.c.potencia_mwt()
    p.pico_mwt = antes
    p.c.az5("AZ-5 (simulación)")
    p.avanzar(SEGUNDOS_TRAS_AZ5)
    return {"az5_pico_mwt": round(p.pico_mwt, 0), "az5_pico_rel": round(p.pico_mwt / max(antes, 1.0), 2),
            "az5_danado": p.c.danado}


def caso(rng: random.Random) -> dict | None:
    """Un estado al azar y lo que pasa al pulsar el AZ-5. None si la central ya se rompió antes."""
    params = {
        "potencia_inicial_mwt": rng.choice(POTENCIAS),
        # cada grupo de barras por su lado; más casos con pocas barras dentro (donde está el peligro)
        "insercion_rr": round(0.01 + 0.59 * rng.random() ** 2, 3),
        "insercion_ar": round(0.8 * rng.random() ** 2, 3),
        "insercion_usp": round(0.6 * rng.random() ** 2, 3),
        "xenon_inicial": round(rng.uniform(0.6, 1.8), 2),
        "bombas": rng.choice((6, 7, 8)),
        # más casos con el agua de entrada casi saturada (como en 1986)
        "subenfriamiento_inicial_c": round(0.3 + 11.7 * rng.random() ** 2, 1),
        "prueba_inercia": rng.random() < 0.5,
        "segundos_antes_az5": round(rng.uniform(5.0, 45.0), 1),
    }
    c = operacion(params["potencia_inicial_mwt"], params["insercion_rr"], params["xenon_inicial"],
                  params["bombas"], params["subenfriamiento_inicial_c"])
    c.grupos["AR"].z, c.grupos["USP"].z = params["insercion_ar"], params["insercion_usp"]
    c.rho_sesgo = 0.0
    c.rho_sesgo = -c._reactividad()            # sigue crítica con las barras donde están
    p = Planta(escala=1.0, central=c)
    p.avanzar(5.0)
    if params["prueba_inercia"]:
        p.c.prueba_turbina()
    p.avanzar(params["segundos_antes_az5"])
    if p.c.danado:
        return None
    fila = {k: v for k, v in p.medidas().items() if k not in NO_ENTRADAS}
    return {"escenario": params, "medidas": fila, **_despues_az5(p)}


def lote(casos: int, semilla: int | None = None) -> dict:
    rng = random.Random(semilla)
    t0 = time.perf_counter()
    filas, descartados = [], 0
    while len(filas) < casos:
        r = caso(rng)
        if r is None:
            descartados += 1
            continue
        filas.append(r)
    return {"casos": filas, "descartados": descartados, "segundos_cpu": round(time.perf_counter() - t0, 2),
            "segundos_tras_az5": SEGUNDOS_TRAS_AZ5}


def que_pasaria(central: Central) -> dict:
    """«¿Qué pasaría si pulso el AZ-5 ahora?». `central` debe ser ya una COPIA (se modifica)."""
    t0 = time.perf_counter()
    p = Planta(escala=1.0, central=central)
    if p.c.danado:
        return {"az5_pico_mwt": None, "az5_pico_rel": None, "az5_danado": True, "ms": 0.0,
                "nota": "la central ya está dañada"}
    r = _despues_az5(p)
    r["ms"] = round(1000 * (time.perf_counter() - t0), 1)
    return r


__all__ = ["lote", "que_pasaria", "operacion", "NO_ENTRADAS"]
