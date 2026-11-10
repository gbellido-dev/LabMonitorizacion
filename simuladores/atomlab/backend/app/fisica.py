"""Modelo físico simplificado de una central RBMK-1000 (tipo Chernóbil), con fines didácticos.

No es un código de seguridad nuclear: reproduce cualitativamente los
fenómenos que se estudian en clase con órdenes de magnitud realistas.

Núcleo
  - Cinética puntual con 6 grupos de neutrones retardados (Euler implícito).
  - Reactividad = barras + vacío (POSITIVO en el RBMK) + Doppler (negativo)
    + grafito (positivo, lento) + xenón.
  - Barras con desplazador de grafito: al entrar desde arriba del todo,
    durante el primer tramo AÑADEN reactividad (efecto positivo del SCRAM).
  - Margen operativo de reactividad (ORM) en barras equivalentes.
  - Yodo-135 / xenón-135 y calor residual.

Circuito único (agua ligera en ebullición)
  canales -> separadores de vapor -> turbinas -> condensador -> agua de
  alimentación -> bombas de circulación principal (BCP) -> canales
"""

from __future__ import annotations

from dataclasses import dataclass, field
import math

# ------------------------------------------------------------------ constantes
P_NOMINAL = 3200.0               # MWt
P_ELECTRICA = 1000.0             # MWe (2 turbogeneradores de 500 MWe)
_B = (0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273)
BETA = 0.0050                    # fracción efectiva de neutrones retardados
BETA_I = tuple(b * BETA / sum(_B) for b in _B)
LAMBDA_I = (0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01)   # 1/s
LAMBDA_P = 1.0e-3                # tiempo de generación de neutrones inmediatos [s]

ALFA_VACIO = 2.0e-4              # Δk/k por punto de vacío (positivo)
ALFA_DOPPLER = -1.2e-5           # por °C de combustible
ALFA_GRAFITO = 1.2e-5            # por °C de grafito
VALOR_BARRAS = 0.10              # valor total de las 211 barras
N_BARRAS = 211

LAMBDA_I135, LAMBDA_XE = 2.87e-5, 2.09e-5   # 1/s (6,7 h y 9,2 h)
SIGMA_XE = 1.1e-4                # quemado del xenón a flujo nominal [1/s]
FRACCION_XE_DIRECTO = 0.05
RHO_XE_NOMINAL = -0.024          # reactividad del xenón en equilibrio a potencia nominal

T_SAT = 284.0                    # °C a 7 MPa
T_ALIMENTACION = 165.0           # °C
CAUDAL_NOM = 10400.0             # kg/s con 6 BCP (37 500 t/h)
H_FG, CP = 1.51e6, 5.3e3
RHO_L, RHO_G, SLIP = 740.0, 36.5, 1.8
VAPOR_NOM = 1470.0               # kg/s a 3200 MWt (calidad de salida ≈ 14 %)

T_FUSION_UO2 = 2800.0            # °C


def valor_integral(z: float) -> float:
    """Fracción del valor de una barra según su inserción (0 = fuera, 1 = dentro)."""
    z = max(0.0, min(1.0, z))
    return z - math.sin(2 * math.pi * z) / (2 * math.pi)


def desplazador(z: float) -> float:
    """Reactividad añadida por el desplazador de grafito (fracción del valor de la barra)."""
    if z <= 0.0 or z >= 0.35:
        return 0.0
    return 0.09 * math.sin(math.pi * z / 0.35)


@dataclass
class Grupo:
    nombre: str
    n: int
    z: float                     # inserción 0..1
    v: float = 0.057             # recorrido por segundo (0,4 m/s en 7 m)
    objetivo: float | None = None
    por_arriba: bool = True      # las USP entran por abajo y no tienen desplazador

    def mover(self, dt: float) -> None:
        if self.objetivo is None:
            return
        d = self.objetivo - self.z
        paso = self.v * dt
        self.z = self.objetivo if abs(d) <= paso else self.z + math.copysign(paso, d)

    def rho(self) -> float:
        peso = self.n / N_BARRAS * VALOR_BARRAS
        r = -peso * valor_integral(self.z)
        if self.por_arriba:
            r += peso * desplazador(self.z)
        return r


@dataclass
class Central:
    # ---------------------------------------------------------------- estado del núcleo
    n: float = 1.0
    c: list = field(default_factory=list)
    yodo: float = 1.0
    xenon: float = 1.0
    t_comb: float = 0.0
    t_graf: float = 650.0
    calor_residual: float = 0.0
    t_paro: float | None = None
    periodo: float = math.inf
    rho: float = 0.0
    rho_sesgo: float = 0.0
    grupos: dict = field(default_factory=dict)
    # ---------------------------------------------------------------- circuito
    bcp: int = 6                 # bombas de circulación en marcha (de 8)
    caudal: float = CAUDAL_NOM
    t_entrada: float = 270.0
    vacio: float = 0.0
    calidad: float = 0.0
    vapor: float = VAPOR_NOM
    presion: float = 7.0
    nivel: float = 50.0
    valv_turbina: float = 100.0  # %
    turbina_disparada: bool = False
    bypass: float = 0.0          # % válvulas de descarga al condensador (BRU-K)
    _int_turbina: float = 0.0
    _int_bypass: float = 0.0
    alimentacion: float = VAPOR_NOM
    rpm_turbina: float = 3000.0
    p_electrica: float = P_ELECTRICA
    t_cond: float = 33.0
    # ---------------------------------------------------------------- control y protección
    consigna_mwt: float = P_NOMINAL
    consigna_rampa: float = P_NOMINAL
    regulador_auto: bool = True
    protecciones: bool = True
    scram: bool = False
    motivo_scram: str = ""
    danado: bool = False         # rotura de canales / explosión
    _prueba_inercia: bool = False
    fundido_pct: float = 0.0
    t_sobrepotencia: float = 0.0
    liberacion: float = 0.0      # actividad liberada (relativa)
    t: float = 0.0

    def __post_init__(self) -> None:
        self.grupos = {
            "RR": Grupo("RR · regulación manual", 151, 0.27),
            "AR": Grupo("AR · regulación automática", 12, 0.50),
            "USP": Grupo("USP · barras cortas (por abajo)", 24, 0.40, por_arriba=False),
            "AZ": Grupo("AZ · emergencia", 24, 0.0),
        }
        self.c = [b / (l * LAMBDA_P) * self.n for b, l in zip(BETA_I, LAMBDA_I)]
        self._estacionario()
        self.rho_sesgo = 0.0
        self.rho_sesgo = -self._reactividad()      # el estado inicial es crítico

    def _estacionario(self) -> None:
        """Lleva el circuito al régimen permanente a potencia nominal (sin cinética)."""
        self.presion, self.nivel, self.caudal = 7.0, 50.0, CAUDAL_NOM
        self.alimentacion = VAPOR_NOM
        self.t_entrada = (T_SAT * (CAUDAL_NOM - VAPOR_NOM) + T_ALIMENTACION * VAPOR_NOM) / CAUDAL_NOM
        self.valv_turbina = self._int_turbina = 100.0 * VAPOR_NOM / 1650.0
        for _ in range(3000):
            self._termohidraulica(0.5)
            self._temperaturas(0.5)
        self.t_graf = self.t_entrada_sat() + 380.0
        self.t_comb = self.t_entrada_sat() + 500.0

    # ---------------------------------------------------------------- ayudas
    def t_entrada_sat(self) -> float:
        return T_SAT + 18.0 * (self.presion - 7.0)

    def potencia_mwt(self) -> float:
        return P_NOMINAL * (self.n + self.calor_residual)

    def orm(self) -> float:
        """Margen operativo de reactividad: barras de regulación equivalentes totalmente insertadas."""
        return sum(g.n * valor_integral(g.z) for k, g in self.grupos.items() if k in ("RR", "AR", "USP"))

    def alfa_vacio(self) -> float:
        """Coeficiente de vacío: crece cuando quedan pocas barras dentro (menos absorbente
        que compita con el agua). Con ORM ≈ 0 llega a unas 2,5 veces el valor nominal."""
        return ALFA_VACIO * (1.0 + 1.5 * max(0.0, 26.0 - self.orm()) / 26.0)

    def _reactividad(self) -> float:
        rho_barras = sum(g.rho() for g in self.grupos.values())
        return (rho_barras + self.alfa_vacio() * self.vacio + ALFA_DOPPLER * self.t_comb
                + ALFA_GRAFITO * self.t_graf + RHO_XE_NOMINAL * self.xenon + self.rho_sesgo)

    # ---------------------------------------------------------------- escenarios
    def escenario_chernobil(self) -> None:
        """Condiciones aproximadas de la unidad 4 a la 01:22 del 26-04-1986.

        200 MWt tras horas a media potencia y una caída a 30 MW: xenón alto,
        casi todas las barras extraídas (ORM ≈ 7), las 8 bombas en marcha,
        agua de entrada casi saturada y varias protecciones desconectadas.
        """
        self.__init__()
        self.n = 200.0 / P_NOMINAL
        self.c = [b / (l * LAMBDA_P) * self.n for b, l in zip(BETA_I, LAMBDA_I)]
        self.xenon, self.yodo = 1.65, 1.10
        self.grupos["RR"].z, self.grupos["AR"].z, self.grupos["USP"].z, self.grupos["AZ"].z = 0.035, 0.12, 0.08, 0.0
        for g in self.grupos.values():
            g.objetivo = None
        self.bcp, self.caudal = 8, CAUDAL_NOM * 8 / 6
        self.consigna_mwt = self.consigna_rampa = 200.0
        self.regulador_auto, self.protecciones = False, False
        self.valv_turbina = self._int_turbina = 8.0
        self.alimentacion = self.vapor = 60.0
        self.t_entrada = self.t_entrada_sat() - 0.6
        for _ in range(1200):                      # asentar la termohidráulica a 200 MWt
            self._termohidraulica(0.5)
            self._temperaturas(0.5)
        self.t_graf = self.t_entrada_sat() + 380.0 * self.n ** 0.8
        self.rho_sesgo = 0.0
        self.rho_sesgo = -self._reactividad()     # crítico en ese estado
        self.t = 0.0

    def prueba_turbina(self) -> None:
        """Prueba de inercia: se cierran las válvulas de la turbina y 4 BCP pierden velocidad con ella."""
        self.disparar_turbina()
        self._prueba_inercia = True

    # ---------------------------------------------------------------- órdenes
    def az5(self, motivo: str = "AZ-5 manual") -> None:
        if not self.scram:
            self.scram, self.motivo_scram = True, motivo
            for g in self.grupos.values():
                g.objetivo = 1.0

    def rearmar(self) -> None:
        if self.danado:
            return
        self.scram, self.motivo_scram = False, ""
        self.grupos["AZ"].objetivo = 0.0
        for k in ("RR", "AR", "USP"):
            self.grupos[k].objetivo = self.grupos[k].z

    def mover_grupo(self, grupo: str, objetivo: float) -> None:
        if self.scram:
            raise PermissionError("Con el SCRAM activo las barras no se pueden extraer")
        if grupo not in self.grupos:
            raise ValueError(f"grupo desconocido: {grupo}")
        self.grupos[grupo].objetivo = max(0.0, min(1.0, objetivo))

    def disparar_turbina(self) -> None:
        self.turbina_disparada = True

    def rearmar_turbina(self) -> None:
        self.turbina_disparada = False

    # ---------------------------------------------------------------- dinámica
    def paso(self, dt: float) -> None:
        self.t += dt
        for g in self.grupos.values():
            g.mover(dt)
        self._regulador(dt)
        self._termohidraulica(dt)
        self._temperaturas(dt)
        self.rho = self._reactividad()
        self._cinetica(dt)
        self._xenon(dt)
        self._calor_residual(dt)
        self._turbina(dt)
        self._protecciones()
        self._danos(dt)

    def _regulador(self, dt: float) -> None:
        """Regulador automático de potencia (AR): velocidad de las barras proporcional al error."""
        ar = self.grupos["AR"]
        if self.scram or not self.regulador_auto:
            self.consigna_rampa = self.potencia_mwt()
            return
        # la consigna efectiva sigue a la pedida en rampa (10 MW/s) para no acortar el periodo
        paso = 10.0 * dt
        d = self.consigna_mwt - self.consigna_rampa
        self.consigna_rampa = self.consigna_mwt if abs(d) <= paso else self.consigna_rampa + math.copysign(paso, d)
        error = (P_NOMINAL * self.n - self.consigna_rampa) / P_NOMINAL    # >0: sobra potencia
        if abs(error) < 0.002:                                             # banda muerta ±0,2 %
            error = 0.0
        velocidad = max(-ar.v, min(ar.v, 0.6 * error))                     # fracción de recorrido por s
        ar.z = max(0.0, min(1.0, ar.z + velocidad * dt))
        ar.objetivo = None
        # reequilibrado: si las AR salen de su zona media, las RR se mueven despacio para
        # devolverlas al centro (lo haría el operador). Solo si no hay una orden manual a las RR.
        rr = self.grupos["RR"]
        if rr.objetivo is None:
            if ar.z < 0.25:
                rr.z = max(0.0, rr.z - 0.0006 * dt)      # extraer RR -> las AR vuelven a entrar
            elif ar.z > 0.75:
                rr.z = min(1.0, rr.z + 0.0006 * dt)

    def _termohidraulica(self, dt: float) -> None:
        bombas = self.bcp
        if self._prueba_inercia and self.bcp > 4:
            bombas = 4 + (self.bcp - 4) * max(0.0, self.rpm_turbina - 1500.0) / 1500.0
        objetivo = CAUDAL_NOM * bombas / 6.0 if not self.danado else 0.0
        self.caudal += (objetivo - self.caudal) * min(1.0, dt / 10.0)
        caudal = max(150.0, self.caudal)
        sub = max(0.0, self.t_entrada_sat() - self.t_entrada)
        q = self.potencia_mwt() * 1e6
        x = max(0.0, (q - caudal * CP * sub) / (caudal * H_FG))
        self.calidad = min(0.98, x)
        alfa = 0.0 if self.calidad <= 0 else 1.0 / (1.0 + (1 - self.calidad) / self.calidad * RHO_G / RHO_L * SLIP)
        objetivo_vacio = 100.0 * alfa * 0.45      # media axial del canal (≈ 29 % a potencia nominal)
        self.vacio += (objetivo_vacio - self.vacio) * min(1.0, dt / 1.5)   # el vapor tarda ~1 s en formarse
        self.vapor = caudal * self.calidad
        # regulación de presión: turbina y, si está disparada, descarga al condensador
        # regulador PI de presión (el término proporcional amortigua el lazo válvula-presión)
        error = self.presion - 7.0
        if self.turbina_disparada:
            self._int_turbina = 0.0
            self.valv_turbina = max(0.0, self.valv_turbina - 100.0 * dt)       # cierre de las válvulas de parada
            self._int_bypass = max(0.0, min(60.0, self._int_bypass + 25.0 * error * dt))
            self.bypass = max(0.0, min(60.0, self._int_bypass + 60.0 * error))
        else:
            self._int_bypass, self.bypass = 0.0, 0.0
            self._int_turbina = max(0.0, min(100.0, self._int_turbina + 25.0 * error * dt))
            self.valv_turbina = max(0.0, min(100.0, self._int_turbina + 60.0 * error))
        salida = 1650.0 * (self.valv_turbina + self.bypass) / 100.0 * self.presion / 7.0
        self.presion = max(0.5, min(9.5, self.presion + (self.vapor - salida) / 900.0 * dt))
        self.alimentacion += ((salida + 25.0 * (50.0 - self.nivel)) - self.alimentacion) * min(1.0, dt / 5.0)
        self.alimentacion = max(0.0, self.alimentacion)
        self.nivel = max(0.0, min(100.0, self.nivel + (self.alimentacion - self.vapor) / 400.0 * dt))
        t_mezcla = (self.t_entrada_sat() * max(0.0, caudal - self.alimentacion) + T_ALIMENTACION * min(caudal, self.alimentacion)) / caudal
        self.t_entrada += (t_mezcla - self.t_entrada) * min(1.0, dt / 20.0)
        self.t_cond = 25.0 + 9.0 * salida / VAPOR_NOM

    def _temperaturas(self, dt: float) -> None:
        t_refrig = self.t_entrada_sat()
        refrigeracion = max(0.05, min(1.0, self.caudal / CAUDAL_NOM)) ** 0.3
        t_eq = t_refrig + 500.0 * (self.n + self.calor_residual) / refrigeracion
        if self.danado:
            t_eq = max(t_eq, 1200.0)             # restos de combustible sin refrigerar entre el grafito ardiendo
        self.t_comb += (t_eq - self.t_comb) * min(1.0, dt / (6.0 if not self.danado else 120.0))
        t_g_eq = t_refrig + 380.0 * (self.n + self.calor_residual) ** 0.8
        self.t_graf += (t_g_eq - self.t_graf) * min(1.0, dt / 900.0)

    def _cinetica(self, dt: float) -> None:
        n0 = self.n
        a = [1.0 + l * dt for l in LAMBDA_I]
        sc = sum(l * ci / ai for l, ci, ai in zip(LAMBDA_I, self.c, a))
        sb = sum(l * b / (LAMBDA_P * ai) for l, b, ai in zip(LAMBDA_I, BETA_I, a)) * dt
        self.n = max(1e-10, (n0 + dt * sc) / (1.0 - dt * (self.rho - BETA) / LAMBDA_P - dt * sb))
        self.c = [(ci + dt * b / LAMBDA_P * self.n) / ai for ci, b, ai in zip(self.c, BETA_I, a)]
        tasa = math.log(self.n / n0) / dt if dt > 0 else 0.0
        self.periodo = 1.0 / tasa if abs(tasa) > 1e-7 else math.inf

    def _xenon(self, dt: float) -> None:
        phi = self.n
        k = LAMBDA_XE + SIGMA_XE
        self.yodo += LAMBDA_I135 * (phi - self.yodo) * dt
        self.xenon += (k * (FRACCION_XE_DIRECTO * phi + (1 - FRACCION_XE_DIRECTO) * self.yodo)
                       - (LAMBDA_XE + SIGMA_XE * phi) * self.xenon) * dt
        self.yodo, self.xenon = max(0.0, self.yodo), max(0.0, self.xenon)

    def _calor_residual(self, dt: float) -> None:
        if self.n > 0.05 and not self.scram:
            self.t_paro, self.calor_residual = None, 0.0
            return
        self.t_paro = (self.t_paro or 0.0) + dt
        self.calor_residual = 0.062 * max(1.0, self.t_paro) ** -0.2 * 0.9

    def _turbina(self, dt: float) -> None:
        vapor_turbina = 1650.0 * self.valv_turbina / 100.0 * self.presion / 7.0
        objetivo = 3000.0 if vapor_turbina > 50 else 0.0
        self.rpm_turbina += (objetivo - self.rpm_turbina) * min(1.0, dt / (5.0 if objetivo else 60.0))
        self.p_electrica = P_ELECTRICA * min(1.1, vapor_turbina / VAPOR_NOM) if self.rpm_turbina > 2900 else 0.0

    def _protecciones(self) -> None:
        if self.scram or not self.protecciones:
            return
        p = self.potencia_mwt()
        if p > 1.1 * P_NOMINAL:
            self.az5("Potencia > 110 %")
        elif 0 < self.periodo < 20.0 and p > 0.02 * P_NOMINAL:
            self.az5("Periodo < 20 s")
        elif self.presion > 8.0:
            self.az5("Presión en separadores > 8 MPa")
        elif self.nivel < 15.0:
            self.az5("Nivel bajo en separadores")

    def _danos(self, dt: float) -> None:
        if self.t_comb > T_FUSION_UO2:
            self.fundido_pct = min(100.0, self.fundido_pct + 40.0 * dt)
        # energía depositada por encima de 3 veces la nominal (en segundos a plena potencia):
        # el vapor generado de golpe no cabe en los canales y los revienta
        if self.n > 3.0:
            self.t_sobrepotencia += (self.n - 3.0) * dt
        else:
            self.t_sobrepotencia = max(0.0, self.t_sobrepotencia - dt)
        if not self.danado and (self.fundido_pct > 5.0 or self.t_sobrepotencia > 2.0):
            # rotura masiva de canales: el vapor levanta la losa superior
            self.danado = True
            self.t_comb = max(self.t_comb, T_FUSION_UO2 + 100.0)   # el combustible fragmentado se funde
            self.fundido_pct = max(self.fundido_pct, 30.0)
            self.scram, self.motivo_scram = True, "Rotura de canales · explosión de vapor"
            self.bcp = 0
        if self.danado:
            self.n = max(1e-6, self.n * math.exp(-dt / 2.0))   # el núcleo queda disperso y subcrítico
            self.liberacion = min(1.0, self.liberacion + 0.05 * dt)
            self.presion = max(0.1, self.presion - 2.0 * dt)
            self.nivel = max(0.0, self.nivel - 10.0 * dt)
            self.t_graf += 2.0 * dt                              # incendio del grafito

    # ---------------------------------------------------------------- radiación
    def dosis(self) -> dict:
        """Tasas de dosis estimadas en mSv/h por zona."""
        p = self.n + self.calor_residual
        fuga = self.liberacion
        return {
            "sala_control": round(2e-4 + 0.2 * fuga, 5),
            "sala_central": round(0.01 + 0.02 * p + 2.0e5 * fuga, 4),     # encima de la losa del reactor
            "sala_turbinas": round(0.002 + 0.03 * (self.valv_turbina / 100.0) * self.n + 50.0 * fuga, 4),  # N-16 en el vapor
            "exterior": round(1.5e-4 + 30.0 * fuga, 5),
        }
