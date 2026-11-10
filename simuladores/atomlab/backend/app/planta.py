"""Planta AtomLab: envuelve el modelo físico con mandos, alarmas, eventos e histórico."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
import math
import threading

from .fisica import BETA, CAUDAL_NOM, N_BARRAS, P_ELECTRICA, P_NOMINAL, Central

GRUPOS_MANUALES = ("RR", "AR", "USP")


@dataclass(frozen=True)
class DefAlarma:
    codigo: str
    texto: str
    severidad: str          # WARNING, MAJOR, CRITICAL


ALARMAS = {
    a.codigo: a for a in (
        DefAlarma("ORM_BAJO", "Margen operativo de reactividad < 15 barras", "MAJOR"),
        DefAlarma("ORM_MUY_BAJO", "ORM < 8 barras: prohibido operar", "CRITICAL"),
        DefAlarma("POTENCIA_ALTA", "Potencia térmica > 105 %", "MAJOR"),
        DefAlarma("PERIODO_CORTO", "Periodo del reactor < 60 s", "MAJOR"),
        DefAlarma("BAJA_POTENCIA", "Potencia < 700 MWt: zona inestable (vacío positivo)", "WARNING"),
        DefAlarma("PRESION_ALTA", "Presión en separadores > 7,5 MPa", "MAJOR"),
        DefAlarma("NIVEL_BAJO", "Nivel en separadores < 30 %", "MAJOR"),
        DefAlarma("CAUDAL_BAJO", "Caudal de refrigerante < 70 %", "MAJOR"),
        DefAlarma("TURBINA_DISPARADA", "Turbina disparada", "WARNING"),
        DefAlarma("PROTECCIONES_ANULADAS", "Protecciones automáticas desconectadas", "CRITICAL"),
        DefAlarma("SCRAM", "Parada de emergencia AZ-5", "CRITICAL"),
        DefAlarma("RADIACION_ALTA", "Tasa de dosis alta en la sala central (> 1 mSv/h)", "MAJOR"),
        DefAlarma("ACCIDENTE", "Rotura de canales · liberación de actividad", "CRITICAL"),
    )
}


def _ahora() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _r(x: float, nd: int = 2) -> float:
    return round(float(x), nd)


class Planta:
    """Planta con su propio reloj. `avanzar(segundos_reales)` integra con subpasos adaptativos."""

    def __init__(self, escala: float = 1.0) -> None:
        self.bloqueo = threading.RLock()
        self.escala = escala
        self.oyentes: list = []          # funciones f(evento) para SSE/OPC UA
        self.reiniciar(emitir=False)

    # ------------------------------------------------------------------ ciclo de vida
    def reiniciar(self, escenario: str = "normal", emitir: bool = True) -> None:
        with self.bloqueo:
            self.c = Central()
            if escenario == "chernobil":
                self.c.escenario_chernobil()
            elif escenario != "normal":
                raise ValueError("escenario desconocido (normal, chernobil)")
            self.escenario = escenario
            self.secuencia = 0
            self.activas: dict[str, dict] = {}
            self._visto: dict[str, float] = {}
            self.eventos: deque = deque(maxlen=200)
            self.historico: deque = deque(maxlen=900)
            self._t_hist = -1e9
            self.pico_mwt = self.c.potencia_mwt()
            self._registrar_historico()
        if emitir:
            self.emitir("planta.reiniciada", {"escenario": escenario})

    def emitir(self, tipo: str, datos: dict) -> dict:
        evento = {"tipo": tipo, "timestamp": _ahora(), "t_s": _r(self.c.t, 3), "datos": datos}
        self.eventos.appendleft(evento)
        for f in list(self.oyentes):
            try:
                f(evento)
            except Exception:  # noqa: BLE001 - un oyente roto no debe parar la planta
                pass
        return evento

    # ------------------------------------------------------------------ integración
    def _dt(self) -> float:
        c = self.c
        if c.n > 1.3 or c.rho > 0.4 * BETA or (c.scram and c.t_paro is None and c.n > 0.05):
            return 0.002
        if c.n > 1.05 or c.rho > 0.1 * BETA or c.scram and (c.t_paro or 0) < 10:
            return 0.01
        return 0.05

    def avanzar(self, segundos_reales: float) -> None:
        with self.bloqueo:
            restante = max(0.0, segundos_reales) * self.escala
            danado, scram = self.c.danado, self.c.scram
            while restante > 1e-9:
                dt = min(self._dt(), restante)
                self.c.paso(dt)
                restante -= dt
                self.pico_mwt = max(self.pico_mwt, self.c.potencia_mwt())
            self.secuencia += 1
            if self.c.scram and not scram:
                self.emitir("proteccion.scram", {"motivo": self.c.motivo_scram})
            if self.c.danado and not danado:
                self.emitir("proteccion.accidente", {"pico_mwt": round(self.pico_mwt)})
            self._evaluar_alarmas()
            if self.c.t - self._t_hist >= 1.0:
                self._registrar_historico()

    # ------------------------------------------------------------------ alarmas
    def _condiciones(self) -> dict[str, tuple[bool, float]]:
        c = self.c
        p = c.potencia_mwt()
        d = c.dosis()
        en_marcha = c.n > 0.02 and not c.scram
        return {
            "ORM_BAJO": (en_marcha and c.orm() < 15, c.orm()),
            "ORM_MUY_BAJO": (en_marcha and c.orm() < 8, c.orm()),
            "POTENCIA_ALTA": (p > 1.05 * P_NOMINAL, p),
            "PERIODO_CORTO": (0 < c.periodo < 60 and p > 0.01 * P_NOMINAL and not c.danado, c.periodo),
            "BAJA_POTENCIA": (en_marcha and p < 700, p),
            "PRESION_ALTA": (c.presion > 7.5, c.presion),
            "NIVEL_BAJO": (c.nivel < 30, c.nivel),
            "CAUDAL_BAJO": (c.caudal < 0.7 * CAUDAL_NOM, c.caudal),
            "TURBINA_DISPARADA": (c.turbina_disparada, c.valv_turbina),
            "PROTECCIONES_ANULADAS": (not c.protecciones, 0.0),
            "SCRAM": (c.scram, 0.0),
            "RADIACION_ALTA": (d["sala_central"] > 1.0, d["sala_central"]),
            "ACCIDENTE": (c.danado, c.liberacion),
        }

    def _evaluar_alarmas(self) -> None:
        for codigo, (activa, valor) in self._condiciones().items():
            if activa:
                self._visto[codigo] = self.c.t
            elif codigo in self.activas and self.c.t - self._visto.get(codigo, -1e9) < 3.0:
                continue                      # histéresis temporal: 3 s sin condición para borrarla
            if activa and codigo not in self.activas:
                a = ALARMAS[codigo]
                self.activas[codigo] = {"codigo": codigo, "texto": a.texto, "severidad": a.severidad,
                                        "valor": _r(valor, 3), "desde": _ahora(), "t_s": _r(self.c.t, 3)}
                self.emitir("alarma.activada", self.activas[codigo])
            elif not activa and codigo in self.activas:
                datos = self.activas.pop(codigo)
                self.emitir("alarma.borrada", {"codigo": codigo, "severidad": datos["severidad"], "texto": datos["texto"]})

    # ------------------------------------------------------------------ mandos
    def _comprobar(self) -> None:
        if self.c.danado:
            raise PermissionError("La planta está destruida: solo se puede reiniciar")

    def fijar_potencia(self, mwt: float) -> None:
        with self.bloqueo:
            self._comprobar()
            if not 0 <= mwt <= P_NOMINAL:
                raise ValueError(f"la consigna debe estar entre 0 y {P_NOMINAL:.0f} MWt")
            self.c.consigna_mwt = float(mwt)
        self.emitir("consigna.potencia", {"mwt": mwt})

    def fijar_regulador(self, auto: bool) -> None:
        with self.bloqueo:
            self._comprobar()
            self.c.regulador_auto = bool(auto)
            if auto:
                self.c.consigna_mwt = round(self.c.potencia_mwt())
                self.c.consigna_rampa = self.c.consigna_mwt
            else:
                self.c.grupos["AR"].objetivo = None
        self.emitir("estado.regulador", {"auto": bool(auto)})

    def mover_barras(self, grupo: str, insercion_pct: float) -> None:
        with self.bloqueo:
            self._comprobar()
            if grupo not in GRUPOS_MANUALES:
                raise ValueError("grupo no válido (RR, AR, USP)")
            if grupo == "AR" and self.c.regulador_auto:
                raise RuntimeError("Las AR están en automático: pasa el regulador a manual")
            if not 0 <= insercion_pct <= 100:
                raise ValueError("la inserción va de 0 a 100 %")
            self.c.mover_grupo(grupo, insercion_pct / 100.0)
        self.emitir("barras.orden", {"grupo": grupo, "insercion_pct": insercion_pct})

    def fijar_bombas(self, n: int) -> None:
        with self.bloqueo:
            self._comprobar()
            if not 0 <= n <= 8:
                raise ValueError("bombas en marcha: de 0 a 8")
            self.c.bcp = int(n)
        self.emitir("circuito.bombas", {"en_marcha": n})

    def fijar_protecciones(self, activas: bool) -> None:
        with self.bloqueo:
            self._comprobar()
            self.c.protecciones = bool(activas)
        self.emitir("proteccion.anuladas" if not activas else "proteccion.activadas", {"activas": bool(activas)})

    def az5(self, motivo: str = "AZ-5 manual") -> None:
        with self.bloqueo:
            ya = self.c.scram
            self.c.az5(motivo)
        if not ya:
            self.emitir("proteccion.scram", {"motivo": motivo})

    def rearmar(self) -> None:
        with self.bloqueo:
            self._comprobar()
            if self.c.n > 0.05 and any(g.z < 0.99 for g in self.c.grupos.values()):
                raise RuntimeError("Espera a que las barras terminen de entrar")
            self.c.rearmar()
            self.c.regulador_auto = False
        self.emitir("proteccion.rearme", {})

    def turbina(self, disparar: bool) -> None:
        with self.bloqueo:
            self._comprobar()
            self.c.disparar_turbina() if disparar else self.c.rearmar_turbina()
            if not disparar:
                self.c._prueba_inercia = False
        self.emitir("turbina.disparo" if disparar else "turbina.rearme", {})

    def prueba_turbina(self) -> None:
        with self.bloqueo:
            self._comprobar()
            self.c.prueba_turbina()
        self.emitir("turbina.prueba_inercia", {"bombas_arrastradas": max(0, self.c.bcp - 4)})

    # ------------------------------------------------------------------ lectura
    def estado(self) -> str:
        c = self.c
        if c.danado:
            return "ACCIDENTE"
        if c.scram:
            return "SCRAM"
        if c.n < 0.01:
            return "PARADA"
        return "OPERACION"

    def _registrar_historico(self) -> None:
        c = self.c
        self._t_hist = c.t
        self.historico.append({"t_s": _r(c.t, 1), "potencia_mwt": _r(c.potencia_mwt(), 1),
                               "potencia_mwe": _r(c.p_electrica, 1), "reactividad_beta": _r(c.rho / BETA, 3),
                               "presion_mpa": _r(c.presion, 3), "vacio_pct": _r(c.vacio, 2), "orm": _r(c.orm(), 1),
                               "xenon": _r(c.xenon, 3), "dosis_sala_central": c.dosis()["sala_central"]})

    def instantanea(self) -> dict:
        """Estado completo, anidado por sistemas (lo mismo que el espacio de direcciones OPC UA)."""
        with self.bloqueo:
            c = self.c
            vapor_turbina = 1650.0 * c.valv_turbina / 100.0 * c.presion / 7.0
            calor_cond = vapor_turbina * 2.1 + 1650.0 * c.bypass / 100.0 * c.presion / 7.0 * 2.6   # MW
            t_fria = 22.0 + 2.0 * calor_cond / 2200.0
            dosis = c.dosis()
            periodo = c.periodo if math.isfinite(c.periodo) and abs(c.periodo) < 1e4 else 9999.0
            return {
                "planta": "AtomLab", "tipo": "RBMK-1000", "escenario": self.escenario,
                "timestamp": _ahora(), "secuencia": self.secuencia, "t_s": _r(c.t, 2), "escala": self.escala,
                "estado": self.estado(),
                "reactor": {
                    "potencia_mwt": _r(c.potencia_mwt(), 1), "potencia_pct": _r(100 * c.potencia_mwt() / P_NOMINAL, 2),
                    "potencia_neutronica_pct": _r(100 * c.n, 3), "calor_residual_mwt": _r(P_NOMINAL * c.calor_residual, 1),
                    "reactividad_beta": _r(c.rho / BETA, 4), "reactividad_pcm": _r(c.rho * 1e5, 1),
                    "periodo_s": _r(periodo, 1), "orm_barras": _r(c.orm(), 1),
                    "coef_vacio_pcm_pct": _r(c.alfa_vacio() * 1e5, 2),
                    "t_combustible_c": _r(c.t_comb, 1), "t_grafito_c": _r(c.t_graf, 1),
                    "xenon_rel": _r(c.xenon, 3), "yodo_rel": _r(c.yodo, 3), "vacio_pct": _r(c.vacio, 2),
                    "pico_mwt": _r(self.pico_mwt, 0),
                    "barras": {k: {"nombre": g.nombre, "n": g.n, "insercion_pct": _r(100 * g.z, 1),
                                   "objetivo_pct": None if g.objetivo is None else _r(100 * g.objetivo, 1)}
                               for k, g in c.grupos.items()},
                    "regulador_auto": c.regulador_auto, "consigna_mwt": _r(c.consigna_mwt, 0),
                },
                "circuito": {
                    "bombas_en_marcha": c.bcp, "caudal_kgs": _r(c.caudal, 0), "caudal_pct": _r(100 * c.caudal / CAUDAL_NOM, 1),
                    "t_entrada_c": _r(c.t_entrada, 2), "subenfriamiento_c": _r(c.t_entrada_sat() - c.t_entrada, 2),
                    "calidad_pct": _r(100 * c.calidad, 2), "vapor_kgs": _r(c.vapor, 1),
                    "presion_mpa": _r(c.presion, 3), "nivel_separadores_pct": _r(c.nivel, 1),
                    "agua_alimentacion_kgs": _r(c.alimentacion, 1),
                },
                "turbina": {
                    "valvula_admision_pct": _r(c.valv_turbina, 1), "bypass_condensador_pct": _r(c.bypass, 1),
                    "velocidad_rpm": _r(c.rpm_turbina, 0), "disparada": c.turbina_disparada,
                    "prueba_inercia": c._prueba_inercia,
                },
                "generador": {
                    "potencia_mwe": _r(c.p_electrica, 1), "frecuencia_hz": _r(c.rpm_turbina / 60.0, 2),
                    "acoplado": c.p_electrica > 0, "rendimiento_pct": _r(100 * c.p_electrica / max(1.0, c.potencia_mwt()), 1),
                },
                "condensador": {
                    "temperatura_c": _r(c.t_cond, 1),
                    "presion_kpa": _r(0.61 * math.exp(17.27 * c.t_cond / (c.t_cond + 237.3)), 2),
                    "calor_evacuado_mw": _r(calor_cond, 0),
                },
                "refrigeracion": {
                    "t_agua_fria_c": _r(t_fria, 1), "t_agua_caliente_c": _r(t_fria + 9.0 * calor_cond / 2200.0, 1),
                    "caudal_m3s": 60.0, "penacho_pct": _r(min(100.0, 100.0 * calor_cond / 2200.0), 1),
                },
                "radiacion": {f"{k}_msvh": v for k, v in dosis.items()} | {"liberacion_rel": _r(c.liberacion, 4)},
                "proteccion": {
                    "scram": c.scram, "motivo": c.motivo_scram, "protecciones_activas": c.protecciones,
                    "danado": c.danado, "combustible_fundido_pct": _r(c.fundido_pct, 1),
                    "alarmas_activas": len(self.activas),
                },
            }

    def medidas(self) -> dict:
        """Lo mismo que `instantanea`, aplanado (clave_subclave) y sin textos."""
        plano: dict = {}

        def recorrer(prefijo: str, valor) -> None:
            if isinstance(valor, dict):
                for k, v in valor.items():
                    recorrer(f"{prefijo}_{k}" if prefijo else k, v)
            elif isinstance(valor, (int, float, bool)) and valor is not None:
                plano[prefijo] = valor

        s = self.instantanea()
        for sistema in ("reactor", "circuito", "turbina", "generador", "condensador", "refrigeracion", "radiacion", "proteccion"):
            datos = dict(s[sistema])
            if sistema == "reactor":
                barras = datos.pop("barras")
                for k, g in barras.items():
                    plano[f"barras_{k}_pct"] = g["insercion_pct"]
            recorrer(sistema, datos)
        plano["estado"] = s["estado"]
        return plano


__all__ = ["Planta", "ALARMAS", "P_ELECTRICA", "N_BARRAS"]
