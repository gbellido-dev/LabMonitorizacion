"""Modelo del proceso: reactor Tennessee Eastman simplificado.

Portado a Python desde GRFICSv3 (Fortiphyd, GPL-3.0),
``simulation/simulation/TE_process.cc``, que a su vez implementa el modelo
simplificado de N. L. Ricker, "Model predictive control of a continuous,
nonlinear, two-phase reactor", J. Process Control 3 (1993) 109-123.

Reacción en fase gas  A + C -> D  (D sale líquido); B es un inerte.

Cambios respecto al original:
- El tiempo de simulación lo da quien llama (``step(dt_h)``) en lugar del
  reloj del sistema, para poder acelerar el proceso y probarlo.
- El analizador de purga entrega su muestra con el retardo previsto
  (el bucle original nunca copiaba la muestra retenida).
- El estado estacionario usaba un índice fuera de rango para la purga.
- Los fallos de sensor se aplican igual, pero con un generador aleatorio
  propio para que las pruebas sean reproducibles.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math
import random

# Constantes del modelo (TE_process.cc)
VT = 122.0          # volumen total del reactor [m3]
VL_MAX = 30.0       # volumen máximo de líquido [m3]
R_GAS = 8.314       # [kJ/(kmol K)]
T_GAS = 373.0       # [K]
L_DEN = 8.3         # densidad molar del líquido [kmol/m3]
CV = (6.4046, 0.4246, 0.352, 0.0417)   # coeficientes de válvula F1, F2, purga, producto
P_MAX = 3200.0      # límite físico de presión [kPa]

VALVULAS = ("f1", "f2", "purga", "producto")

# Modos de fallo de sensor
SENSOR_OK, SENSOR_CONGELADO, SENSOR_DERIVA, SENSOR_RUIDO, SENSOR_PERDIDA = range(5)
MODOS_SENSOR = {
    "ok": SENSOR_OK, "congelado": SENSOR_CONGELADO, "deriva": SENSOR_DERIVA,
    "ruido": SENSOR_RUIDO, "perdida": SENSOR_PERDIDA,
}
SENSORES = ("presion", "nivel", "caudal_f1", "caudal_f2", "caudal_purga", "caudal_producto", "analizador")


def _resolver_3x3(a: list[list[float]], b: list[float]) -> list[float]:
    """Regla de Cramer para un sistema 3x3 (sustituye a LAPACKE_dgesv)."""
    def det(m):
        return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
                - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
                + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))
    d = det(a)
    if abs(d) < 1e-12:
        raise ValueError("sistema singular")
    sol = []
    for col in range(3):
        m = [row[:] for row in a]
        for fila in range(3):
            m[fila][col] = b[fila]
        sol.append(det(m) / d)
    return sol


@dataclass
class Valvula:
    pos: float = 0.0            # posición real [%]
    sp: float = 0.0             # consigna recibida [%]
    atascada: bool = False      # se queda donde está
    velocidad_max: float = 0.0  # %/h; 0 = sin límite (sana)
    cv_factor: float = 1.0      # 1 = limpia; <1 = ensuciada

    def mover(self, dt_h: float) -> None:
        if self.atascada:
            return
        if self.velocidad_max <= 0:
            self.pos = self.sp
        else:
            paso = self.velocidad_max * dt_h
            self.pos += max(-paso, min(paso, self.sp - self.pos))
        self.pos = max(0.0, min(100.0, self.pos))


@dataclass
class FalloSensor:
    modo: int = SENSOR_OK
    severidad: float = 0.0      # deriva: unidades/h · ruido: amplitud · pérdida: fracción del ciclo (0-1)
    sesgo: float = 0.0


@dataclass
class Proceso:
    ya1: float = 0.485          # fracción de A en la alimentación 1
    yb1: float = 0.005          # fracción de B en la alimentación 1
    kpar: float = 0.00117       # constante cinética
    ncpar: float = 0.4          # exponente de Pc
    retardo_analizador_h: float = 0.1
    semilla: int | None = None

    # estado
    n_a: float = 0.0
    n_b: float = 0.0
    n_c: float = 0.0
    n_d: float = 0.0
    valvulas: dict[str, Valvula] = field(default_factory=dict)
    fallos: dict[str, FalloSensor] = field(default_factory=dict)

    # salidas reales
    presion: float = 2700.0
    nivel: float = 0.0
    caudal: dict[str, float] = field(default_factory=dict)
    y_purga: list[float] = field(default_factory=lambda: [0.47, 0.0, 0.0])
    coste: float = 0.0
    t_h: float = 0.0

    # analizador con retardo
    _y_retenida: list[float] = field(default_factory=list)
    _y_medida: list[float] = field(default_factory=list)
    _t_muestra: float = 0.0
    medidas: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.rng = random.Random(self.semilla)
        self.valvulas = {v: Valvula() for v in VALVULAS}
        self.fallos = {s: FalloSensor() for s in SENSORES}
        self.caudal = {v: 0.0 for v in VALVULAS}
        self.estado_estacionario()

    # ------------------------------------------------------------------ inicio
    def estado_estacionario(self, presion: float = 2700.0, producto: float = 100.0, ya3: float = 0.47) -> None:
        pa = presion * ya3
        pc = (producto / (self.kpar * pa ** 1.2)) ** (1.0 / self.ncpar)
        yc3 = pc / presion
        yb3 = (presion - pa - pc) / presion
        yc1 = 1.0 - self.ya1 - self.yb1
        f1, f2, f3 = _resolver_3x3(
            [[self.ya1, 1.0, -ya3], [self.yb1, 0.0, -yb3], [yc1, 0.0, -yc3]],
            [producto, 0.0, producto])
        raiz = math.sqrt(presion - 100.0)
        posiciones = {"f1": f1 / CV[0], "f2": f2 / CV[1], "purga": f3 / (CV[2] * raiz),
                      "producto": producto / (CV[3] * raiz)}
        for nombre, pos in posiciones.items():
            v = self.valvulas[nombre]
            v.pos = v.sp = pos
        self.n_d = 110.0
        vl = self.n_d / L_DEN
        nv = presion * (VT - vl) / (R_GAS * T_GAS)
        self.n_a, self.n_b, self.n_c = nv * ya3, nv * yb3, nv * yc3
        self.y_purga = [ya3, yb3, yc3]
        self._y_retenida = list(self.y_purga)
        self._y_medida = list(self.y_purga)
        self._t_muestra = self.t_h + self.retardo_analizador_h
        self.step(0.0)

    # ------------------------------------------------------------------ dinámica
    def step(self, dt_h: float) -> None:
        self.t_h += dt_h
        for v in self.valvulas.values():
            v.mover(dt_h)

        vl = self.n_d / L_DEN
        vv = VT - vl
        nv = self.n_a + self.n_b + self.n_c
        self.presion = nv * R_GAS * T_GAS / vv
        self.nivel = vl * 100.0 / VL_MAX

        f1v, f2v, pv, prv = (self.valvulas[n] for n in VALVULAS)
        c = self.caudal
        c["f1"] = CV[0] * f1v.cv_factor * f1v.pos
        c["f2"] = CV[1] * f2v.cv_factor * f2v.pos
        if self.presion >= 100.0:
            raiz = math.sqrt(self.presion - 100.0)
            c["purga"] = CV[2] * pv.cv_factor * pv.pos * raiz
            c["producto"] = CV[3] * prv.cv_factor * prv.pos * raiz
        else:
            c["purga"] = c["producto"] = 0.0
        if prv.pos <= 0.0 or self.nivel <= 0.0:
            c["producto"] = 0.0

        self.y_purga = [self.n_a / nv, self.n_b / nv, self.n_c / nv] if nv > 0 else [0.0, 0.0, 0.0]

        # analizador: entrega la muestra tomada hace un periodo de muestreo
        if self.t_h >= self._t_muestra:
            self._t_muestra += self.retardo_analizador_h
            self._y_medida = self._y_retenida
            self._y_retenida = list(self.y_purga)

        pa = self.y_purga[0] * self.presion
        pc = self.y_purga[2] * self.presion
        rr = self.kpar * pa ** 1.2 * pc ** self.ncpar if pa > 0 and pc > 0 else 0.0
        yc1 = 1.0 - self.ya1 - self.yb1
        ya3, yb3, yc3 = self.y_purga
        self.n_a = max(0.0, self.n_a + (self.ya1 * c["f1"] + c["f2"] - ya3 * c["purga"] - rr) * dt_h)
        self.n_b = max(0.0, self.n_b + (self.yb1 * c["f1"] - yb3 * c["purga"]) * dt_h)
        self.n_c = max(0.0, self.n_c + (yc1 * c["f1"] - yc3 * c["purga"] - rr) * dt_h)
        self.n_d = max(0.0, self.n_d + (rr - c["producto"]) * dt_h)

        self.presion = max(0.0, min(self.presion, P_MAX))
        self.nivel = max(0.0, min(self.nivel, 100.0))
        if c["producto"] > 0:
            self.coste = c["purga"] * (self._y_medida[0] * 2.206 + self._y_medida[2] * 6.177) / c["producto"]

        self._medir(dt_h)

    # ------------------------------------------------------------------ sensores
    def _aplicar(self, sensor: str, real: float, dt_h: float) -> float:
        f = self.fallos[sensor]
        anterior = self.medidas.get(sensor, real)
        if f.modo == SENSOR_CONGELADO:
            f.sesgo = 0.0
            return anterior
        if f.modo == SENSOR_DERIVA:
            f.sesgo += f.severidad * dt_h
            return real + f.sesgo
        f.sesgo = 0.0
        if f.modo == SENSOR_RUIDO:
            return real + self.rng.uniform(-f.severidad, f.severidad)
        if f.modo == SENSOR_PERDIDA:
            # pierde la señal durante una fracción de cada ciclo de 0,05 h
            fase = (self.t_h % 0.05) / 0.05
            return 0.0 if fase < f.severidad else real
        return real

    def _medir(self, dt_h: float) -> None:
        m = self.medidas
        m["presion"] = self._aplicar("presion", self.presion, dt_h)
        m["nivel"] = self._aplicar("nivel", self.nivel, dt_h)
        for v in VALVULAS:
            m[f"caudal_{v}"] = self._aplicar(f"caudal_{v}", self.caudal[v], dt_h)
        a = self.fallos["analizador"]
        anteriores = [m.get("a_purga", self._y_medida[0]), m.get("b_purga", self._y_medida[1]),
                      m.get("c_purga", self._y_medida[2])]
        if a.modo == SENSOR_CONGELADO:
            ys = anteriores
        elif a.modo == SENSOR_DERIVA:
            a.sesgo += a.severidad * dt_h
            ys = [y + a.sesgo for y in self._y_medida]
        elif a.modo == SENSOR_RUIDO:
            ys = [y + self.rng.uniform(-a.severidad, a.severidad) for y in self._y_medida]
        elif a.modo == SENSOR_PERDIDA and (self.t_h % 0.05) / 0.05 < a.severidad:
            ys = [0.0, 0.0, 0.0]
        else:
            ys = list(self._y_medida)
        m["a_purga"], m["b_purga"], m["c_purga"] = ys
