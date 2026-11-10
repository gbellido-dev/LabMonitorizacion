"""Control de la planta: los cuatro lazos del PLC de GRFICS en unidades reales.

Estructura tomada del programa del PLC de GRFICSv3 (``plc/st_files``):

    Lazo            Variable medida           Actúa sobre
    producción      caudal de producto        válvula F1
    presión         presión del reactor       válvula de purga
    composición     % de A en la purga        válvula F2
    nivel           nivel de líquido          válvula de producto

más un *override*: si la presión supera el límite, se reduce la consigna
de producción. Los controladores son PI en forma de velocidad, como en el
PLC original, pero sintonizados en unidades de ingeniería.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .process import Proceso


@dataclass
class PI:
    kp: float                 # % de válvula por unidad de error
    ki: float                 # % de válvula por unidad de error y hora
    accion: int = 1           # +1 directa, -1 inversa
    e_ant: float | None = None

    def paso(self, sp: float, pv: float, salida: float, dt_h: float) -> float:
        e = (sp - pv) * self.accion
        de = 0.0 if self.e_ant is None else e - self.e_ant
        self.e_ant = e
        return max(0.0, min(100.0, salida + self.kp * de + self.ki * e * dt_h))

    def reiniciar(self) -> None:
        self.e_ant = None


@dataclass
class Consignas:
    caudal_producto: float = 100.0   # kmol/h
    presion: float = 2700.0          # kPa
    a_purga: float = 47.0            # %
    nivel: float = 44.0              # %
    presion_override: float = 2900.0 # kPa


# Rangos en los que la planta tiene un punto de funcionamiento alcanzable
LIMITES_CONSIGNA = {
    "caudal_producto": (60.0, 110.0),
    "presion": (2500.0, 2950.0),
    "a_purga": (40.0, 55.0),
    "nivel": (20.0, 75.0),
}


@dataclass
class Control:
    consignas: Consignas = field(default_factory=Consignas)
    modo: str = "auto"               # "auto" | "manual"
    en_marcha: bool = True
    paro_emergencia: bool = False
    override_activo: bool = False
    lazos: dict[str, PI] = field(default_factory=lambda: {
        # sintonía obtenida por búsqueda sobre escalones de consigna y averías
        "f1": PI(kp=0.0927, ki=0.0849, accion=1),       # producción  [kmol/h]
        "purga": PI(kp=0.0404, ki=6.0, accion=-1),      # presión     [kPa]
        "f2": PI(kp=12.2, ki=0.70, accion=1),           # % de A      [%]
        "producto": PI(kp=18.5, ki=190.7, accion=-1),   # nivel       [%]
    })

    def aplicar(self, p: Proceso, dt_h: float) -> None:
        v = p.valvulas
        if self.paro_emergencia or not self.en_marcha:
            # posición segura: cerrar alimentaciones, abrir purga y producto
            v["f1"].sp, v["f2"].sp, v["purga"].sp, v["producto"].sp = 0.0, 0.0, 100.0, 100.0
            for lazo in self.lazos.values():
                lazo.reiniciar()
            return
        if self.modo != "auto":
            for lazo in self.lazos.values():
                lazo.reiniciar()
            return
        c = self.consignas
        m = p.medidas
        # override: con presión por encima del límite se reduce la producción
        sp_producto = c.caudal_producto
        self.override_activo = m["presion"] > c.presion_override
        if self.override_activo:
            sp_producto = max(0.0, c.caudal_producto - 0.5 * (m["presion"] - c.presion_override))
        v["f1"].sp = self.lazos["f1"].paso(sp_producto, m["caudal_producto"], v["f1"].sp, dt_h)
        v["purga"].sp = self.lazos["purga"].paso(c.presion, m["presion"], v["purga"].sp, dt_h)
        v["f2"].sp = self.lazos["f2"].paso(c.a_purga, m["a_purga"] * 100.0, v["f2"].sp, dt_h)
        v["producto"].sp = self.lazos["producto"].paso(c.nivel, m["nivel"], v["producto"].sp, dt_h)
