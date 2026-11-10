"""Planta completa: proceso + control + alarmas + histórico.

Independiente de la capa web para poder probarla sin servidor.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
import time

from .control import LIMITES_CONSIGNA, Control
from .process import MODOS_SENSOR, SENSORES, VALVULAS, Proceso

SUBPASO_H = 0.002   # paso de integración máximo [h]


@dataclass
class DefAlarma:
    codigo: str
    texto: str
    severidad: str          # WARNING | MAJOR | CRITICAL
    variable: str
    mayor: bool             # True: salta por encima del límite
    limite: float
    histeresis: float


ALARMAS = [
    DefAlarma("PRESION_ALTA", "Presión alta en el reactor", "MAJOR", "presion_kpa", True, 2850, 50),
    DefAlarma("PRESION_MUY_ALTA", "Presión muy alta en el reactor", "CRITICAL", "presion_kpa", True, 2950, 50),
    DefAlarma("NIVEL_ALTO", "Nivel de líquido alto", "MAJOR", "nivel_pct", True, 80, 5),
    DefAlarma("NIVEL_BAJO", "Nivel de líquido bajo", "MAJOR", "nivel_pct", False, 15, 5),
    DefAlarma("PRODUCCION_BAJA", "Producción por debajo de 80 kmol/h", "WARNING", "caudal_producto_kmolh", False, 80, 5),
]


def ahora_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


@dataclass
class Planta:
    escala_tiempo: float = 120.0     # 1 s real = 2 min de proceso
    semilla: int | None = None
    proceso: Proceso = field(init=False)
    control: Control = field(init=False)
    secuencia: int = 0
    activas: dict[str, dict] = field(default_factory=dict)
    eventos: deque = field(default_factory=lambda: deque(maxlen=200))
    historico: deque = field(default_factory=lambda: deque(maxlen=3600))
    _ultimo_historico: float = 0.0
    averias: dict[str, dict] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.proceso = Proceso(semilla=self.semilla)
        self.control = Control()
        self.oyentes = []          # funciones llamadas con cada evento nuevo

    # ------------------------------------------------------------------ simulación
    def avanzar(self, dt_real_s: float) -> list[dict]:
        """Avanza la simulación ``dt_real_s`` segundos reales. Devuelve los eventos nuevos."""
        dt_h = dt_real_s * self.escala_tiempo / 3600.0
        while dt_h > 1e-9:
            paso = min(SUBPASO_H, dt_h)
            self.control.aplicar(self.proceso, paso)
            self.proceso.step(paso)
            dt_h -= paso
        self.secuencia += 1
        nuevos = self._evaluar_alarmas()
        t = time.time()
        if t - self._ultimo_historico >= 1.0:
            self._ultimo_historico = t
            self.historico.append({"ts": int(t * 1000), **self.medidas_planas()})
        return nuevos

    # ------------------------------------------------------------------ vistas
    def medidas_planas(self) -> dict:
        m = self.proceso.medidas
        return {
            "presion_kpa": round(m["presion"], 1),
            "nivel_pct": round(m["nivel"], 2),
            "caudal_f1_kmolh": round(m["caudal_f1"], 2),
            "caudal_f2_kmolh": round(m["caudal_f2"], 3),
            "caudal_purga_kmolh": round(m["caudal_purga"], 3),
            "caudal_producto_kmolh": round(m["caudal_producto"], 2),
            "a_purga_pct": round(m["a_purga"] * 100, 2),
            "b_purga_pct": round(m["b_purga"] * 100, 2),
            "c_purga_pct": round(m["c_purga"] * 100, 2),
            "coste_relativo": round(self.proceso.coste, 4),
        }

    def consignas(self) -> dict:
        c = self.control.consignas
        return {"caudal_producto_kmolh": c.caudal_producto, "presion_kpa": c.presion,
                "a_purga_pct": c.a_purga, "nivel_pct": c.nivel}

    def snapshot(self) -> dict:
        m = self.medidas_planas()
        v = self.proceso.valvulas
        return {
            "planta": "ReactorLab",
            "timestamp": ahora_iso(),
            "secuencia": self.secuencia,
            "tiempo_proceso_h": round(self.proceso.t_h, 4),
            "estado": {
                "modo": self.control.modo,
                "en_marcha": self.control.en_marcha,
                "paro_emergencia": self.control.paro_emergencia,
                "override_presion": self.control.override_activo,
                "alarmas_activas": len(self.activas),
            },
            "medidas": {
                "presion_kpa": m["presion_kpa"],
                "nivel_pct": m["nivel_pct"],
                "caudal_kmolh": {"f1": m["caudal_f1_kmolh"], "f2": m["caudal_f2_kmolh"],
                                 "purga": m["caudal_purga_kmolh"], "producto": m["caudal_producto_kmolh"]},
                "composicion_purga_pct": {"A": m["a_purga_pct"], "B": m["b_purga_pct"], "C": m["c_purga_pct"]},
                "coste_relativo": m["coste_relativo"],
            },
            "valvulas": {n: {"posicion_pct": round(v[n].pos, 2), "consigna_pct": round(v[n].sp, 2)}
                         for n in VALVULAS},
            "consignas": self.consignas(),
        }

    # ------------------------------------------------------------------ alarmas
    def _evento(self, tipo: str, **datos) -> dict:
        ev = {"evento": tipo, "timestamp": ahora_iso(), "planta": "ReactorLab", **datos}
        self.eventos.append(ev)
        return ev

    def _evaluar_alarmas(self) -> list[dict]:
        nuevos = []
        m = self.medidas_planas()
        for a in ALARMAS:
            valor = m[a.variable]
            activa = a.codigo in self.activas
            if not activa:
                disparo = valor > a.limite if a.mayor else valor < a.limite
                if disparo and not (self.control.paro_emergencia and a.codigo == "PRODUCCION_BAJA"):
                    info = {"codigo": a.codigo, "texto": a.texto, "severidad": a.severidad,
                            "variable": a.variable, "valor": valor, "limite": a.limite, "desde": ahora_iso()}
                    self.activas[a.codigo] = info
                    nuevos.append(self._evento("alarma.activada", alarma=dict(info)))
            else:
                borrado = valor < a.limite - a.histeresis if a.mayor else valor > a.limite + a.histeresis
                if borrado:
                    info = self.activas.pop(a.codigo)
                    info.update(valor=valor)
                    nuevos.append(self._evento("alarma.borrada", alarma=info))
        return nuevos

    # ------------------------------------------------------------------ órdenes
    def fijar_consignas(self, cambios: dict) -> dict:
        claves = {"caudal_producto_kmolh": "caudal_producto", "presion_kpa": "presion",
                  "a_purga_pct": "a_purga", "nivel_pct": "nivel"}
        aplicadas = {}
        for k, v in cambios.items():
            if v is None:
                continue
            if k not in claves:
                raise ValueError(f"consigna desconocida: {k}")
            lo, hi = LIMITES_CONSIGNA[claves[k]]
            if not lo <= float(v) <= hi:
                raise ValueError(f"{k} fuera de rango ({lo}-{hi})")
            setattr(self.control.consignas, claves[k], float(v))
            aplicadas[k] = float(v)
        if aplicadas:
            self._evento("consigna.cambiada", consignas=aplicadas)
        return self.consignas()

    def fijar_modo(self, modo: str) -> None:
        if modo not in ("auto", "manual"):
            raise ValueError("modo debe ser 'auto' o 'manual'")
        if modo != self.control.modo:
            self.control.modo = modo
            self._evento("estado.modo", modo=modo)

    def fijar_valvulas(self, posiciones: dict) -> None:
        if self.control.modo != "manual":
            raise PermissionError("las válvulas solo se mueven a mano en modo manual")
        for n, pos in posiciones.items():
            if pos is None:
                continue
            if n not in VALVULAS:
                raise ValueError(f"válvula desconocida: {n}")
            if not 0 <= float(pos) <= 100:
                raise ValueError(f"{n} fuera de rango (0-100)")
            self.proceso.valvulas[n].sp = float(pos)

    def fijar_marcha(self, en_marcha: bool) -> None:
        if en_marcha != self.control.en_marcha:
            self.control.en_marcha = en_marcha
            self._evento("estado.marcha", en_marcha=en_marcha)

    def fijar_paro(self, activo: bool) -> None:
        if activo != self.control.paro_emergencia:
            self.control.paro_emergencia = activo
            self._evento("estado.paro_emergencia", activo=activo)

    # ------------------------------------------------------------------ averías
    def inyectar(self, tipo: str, objetivo: str, valor: float | None = None, modo: str | None = None) -> dict:
        p = self.proceso
        if tipo in ("valvula_atascada", "valvula_lenta", "valvula_sucia"):
            if objetivo not in VALVULAS:
                raise ValueError(f"válvula desconocida: {objetivo}")
            v = p.valvulas[objetivo]
            if tipo == "valvula_atascada":
                v.atascada = True
            elif tipo == "valvula_lenta":
                v.velocidad_max = float(valor if valor is not None else 20.0)
            else:
                v.cv_factor = max(0.0, min(1.0, float(valor if valor is not None else 0.5)))
        elif tipo == "sensor":
            if objetivo not in SENSORES:
                raise ValueError(f"sensor desconocido: {objetivo}")
            if modo not in MODOS_SENSOR:
                raise ValueError(f"modo de sensor desconocido: {modo}")
            f = p.fallos[objetivo]
            f.modo, f.severidad, f.sesgo = MODOS_SENSOR[modo], float(valor or 0.0), 0.0
        else:
            raise ValueError(f"tipo de avería desconocido: {tipo}")
        clave = f"{tipo}:{objetivo}"
        info = {"id": clave, "tipo": tipo, "objetivo": objetivo, "valor": valor, "modo": modo, "desde": ahora_iso()}
        self.averias[clave] = info
        self._evento("averia.inyectada", averia=info)
        return info

    def quitar_averias(self) -> None:
        for v in self.proceso.valvulas.values():
            v.atascada, v.velocidad_max, v.cv_factor = False, 0.0, 1.0
        for f in self.proceso.fallos.values():
            f.modo, f.severidad, f.sesgo = 0, 0.0, 0.0
        if self.averias:
            self.averias.clear()
            self._evento("averia.retirada")

    def reiniciar(self) -> None:
        escala, semilla = self.escala_tiempo, self.semilla
        oyentes, activas, eventos = self.oyentes, list(self.activas.values()), self.eventos
        self.__init__(escala_tiempo=escala, semilla=semilla)
        self.oyentes, self.eventos = oyentes, eventos      # el historial de eventos se conserva
        m = self.medidas_planas()
        for info in activas:                               # avisar de que esas alarmas ya no están
            info.update(valor=m[info["variable"]])
            self._evento("alarma.borrada", alarma=info)
        self._evento("planta.reiniciada")
