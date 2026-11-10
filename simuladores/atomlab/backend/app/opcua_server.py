"""Servidor OPC UA de AtomLab (asyncua).

Espacio de direcciones (namespace urn:atomlab:rbmk), NodeId de tipo cadena:

  AtomLab/
    Reactor/            Reactor.PotenciaTermica ...  (+ Reactor/Barras/RR.Insercion ...)
    CircuitoPrimario/   Separadores de vapor y bombas de circulación (circuito único)
    Turbina/  Generador/  Condensador/  Refrigeracion/  Radiacion/  Proteccion/
    Mandos/             variables escribibles + métodos (AZ5, Rearmar, ...)
"""

from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Callable

from asyncua import Server, ua
from asyncua.common.methods import uamethod

from .planta import Planta

NAMESPACE_URI = "urn:atomlab:rbmk"


@dataclass(frozen=True)
class Nodo:
    carpeta: str
    nombre: str
    tipo: str            # Double, Int32, Boolean, String
    unidad: str
    ruta: str            # ruta en la instantánea, p. ej. reactor.potencia_mwt
    descripcion: str

    @property
    def node_id(self) -> str:
        return f"{self.carpeta.replace('/', '.')}.{self.nombre}"


LECTURAS: tuple[Nodo, ...] = (
    Nodo("Reactor", "PotenciaTermica", "Double", "MWt", "reactor.potencia_mwt", "Potencia térmica total (incluye calor residual)"),
    Nodo("Reactor", "PotenciaPct", "Double", "%", "reactor.potencia_pct", "Potencia térmica respecto a 3200 MWt"),
    Nodo("Reactor", "CalorResidual", "Double", "MWt", "reactor.calor_residual_mwt", "Calor de desintegración tras la parada"),
    Nodo("Reactor", "Reactividad", "Double", "β", "reactor.reactividad_beta", "Reactividad en dólares (1 β = crítico inmediato)"),
    Nodo("Reactor", "ReactividadPcm", "Double", "pcm", "reactor.reactividad_pcm", "Reactividad en pcm (1 pcm = 1e-5 Δk/k)"),
    Nodo("Reactor", "Periodo", "Double", "s", "reactor.periodo_s", "Periodo del reactor (9999 = estable)"),
    Nodo("Reactor", "ORM", "Double", "barras", "reactor.orm_barras", "Margen operativo de reactividad (mínimo 15, nunca < 8)"),
    Nodo("Reactor", "CoeficienteVacio", "Double", "pcm/%", "reactor.coef_vacio_pcm_pct", "Coeficiente de reactividad por vacío (positivo)"),
    Nodo("Reactor", "TempCombustible", "Double", "°C", "reactor.t_combustible_c", "Temperatura media del UO2"),
    Nodo("Reactor", "TempGrafito", "Double", "°C", "reactor.t_grafito_c", "Temperatura del moderador de grafito"),
    Nodo("Reactor", "Xenon", "Double", "rel", "reactor.xenon_rel", "Xe-135 relativo al equilibrio a potencia nominal"),
    Nodo("Reactor", "Vacio", "Double", "%", "reactor.vacio_pct", "Fracción media de vapor en los canales"),
    Nodo("Reactor", "ConsignaActual", "Double", "MWt", "reactor.consigna_mwt", "Consigna del regulador automático"),
    Nodo("Reactor", "RegulacionAuto", "Boolean", "", "reactor.regulador_auto", "Regulador automático de potencia (AR) conectado"),
    Nodo("Reactor/Barras", "RR", "Double", "%", "reactor.barras.RR.insercion_pct", "Inserción de las 151 barras de regulación manual"),
    Nodo("Reactor/Barras", "AR", "Double", "%", "reactor.barras.AR.insercion_pct", "Inserción de las 12 barras de regulación automática"),
    Nodo("Reactor/Barras", "USP", "Double", "%", "reactor.barras.USP.insercion_pct", "Inserción de las 24 barras cortas (entran por abajo)"),
    Nodo("Reactor/Barras", "AZ", "Double", "%", "reactor.barras.AZ.insercion_pct", "Inserción de las 24 barras de emergencia"),
    Nodo("CircuitoPrimario", "BombasEnMarcha", "Int32", "", "circuito.bombas_en_marcha", "Bombas de circulación principal (de 8)"),
    Nodo("CircuitoPrimario", "Caudal", "Double", "kg/s", "circuito.caudal_kgs", "Caudal de refrigerante por el núcleo"),
    Nodo("CircuitoPrimario", "CaudalPct", "Double", "%", "circuito.caudal_pct", "Caudal respecto al nominal (6 bombas)"),
    Nodo("CircuitoPrimario", "TempEntrada", "Double", "°C", "circuito.t_entrada_c", "Temperatura del agua a la entrada de los canales"),
    Nodo("CircuitoPrimario", "Subenfriamiento", "Double", "°C", "circuito.subenfriamiento_c", "Margen hasta la saturación a la entrada"),
    Nodo("CircuitoPrimario", "CalidadVapor", "Double", "%", "circuito.calidad_pct", "Título de vapor a la salida"),
    Nodo("CircuitoPrimario", "CaudalVapor", "Double", "kg/s", "circuito.vapor_kgs", "Vapor producido"),
    Nodo("CircuitoPrimario", "Presion", "Double", "MPa", "circuito.presion_mpa", "Presión en los separadores de vapor"),
    Nodo("CircuitoPrimario", "NivelSeparadores", "Double", "%", "circuito.nivel_separadores_pct", "Nivel de agua en los separadores"),
    Nodo("CircuitoPrimario", "AguaAlimentacion", "Double", "kg/s", "circuito.agua_alimentacion_kgs", "Caudal de agua de alimentación"),
    Nodo("Turbina", "ValvulaAdmision", "Double", "%", "turbina.valvula_admision_pct", "Apertura de las válvulas de admisión"),
    Nodo("Turbina", "Bypass", "Double", "%", "turbina.bypass_condensador_pct", "Descarga directa al condensador (BRU-K)"),
    Nodo("Turbina", "Velocidad", "Double", "rpm", "turbina.velocidad_rpm", "Velocidad del turbogenerador"),
    Nodo("Turbina", "Disparada", "Boolean", "", "turbina.disparada", "Válvulas de parada cerradas"),
    Nodo("Generador", "PotenciaElectrica", "Double", "MWe", "generador.potencia_mwe", "Potencia entregada a la red"),
    Nodo("Generador", "Frecuencia", "Double", "Hz", "generador.frecuencia_hz", "Frecuencia del generador"),
    Nodo("Generador", "Acoplado", "Boolean", "", "generador.acoplado", "Generador acoplado a la red"),
    Nodo("Generador", "Rendimiento", "Double", "%", "generador.rendimiento_pct", "MWe / MWt"),
    Nodo("Condensador", "Temperatura", "Double", "°C", "condensador.temperatura_c", "Temperatura de condensación"),
    Nodo("Condensador", "Presion", "Double", "kPa", "condensador.presion_kpa", "Presión absoluta (vacío) del condensador"),
    Nodo("Condensador", "CalorEvacuado", "Double", "MW", "condensador.calor_evacuado_mw", "Calor cedido al agua de refrigeración"),
    Nodo("Refrigeracion", "TempAguaFria", "Double", "°C", "refrigeracion.t_agua_fria_c", "Agua que vuelve de la torre"),
    Nodo("Refrigeracion", "TempAguaCaliente", "Double", "°C", "refrigeracion.t_agua_caliente_c", "Agua que sale del condensador"),
    Nodo("Refrigeracion", "Penacho", "Double", "%", "refrigeracion.penacho_pct", "Intensidad del penacho de la torre"),
    Nodo("Radiacion", "SalaControl", "Double", "mSv/h", "radiacion.sala_control_msvh", "Tasa de dosis en la sala de control"),
    Nodo("Radiacion", "SalaCentral", "Double", "mSv/h", "radiacion.sala_central_msvh", "Tasa de dosis sobre la losa del reactor"),
    Nodo("Radiacion", "SalaTurbinas", "Double", "mSv/h", "radiacion.sala_turbinas_msvh", "Tasa de dosis en la sala de turbinas (N-16)"),
    Nodo("Radiacion", "Exterior", "Double", "mSv/h", "radiacion.exterior_msvh", "Tasa de dosis en el vallado"),
    Nodo("Proteccion", "Scram", "Boolean", "", "proteccion.scram", "Parada de emergencia AZ-5 activa"),
    Nodo("Proteccion", "Motivo", "String", "", "proteccion.motivo", "Causa del último disparo"),
    Nodo("Proteccion", "ProteccionesActivas", "Boolean", "", "proteccion.protecciones_activas", "Disparos automáticos habilitados"),
    Nodo("Proteccion", "Danado", "Boolean", "", "proteccion.danado", "Rotura de canales / explosión"),
    Nodo("Proteccion", "CombustibleFundido", "Double", "%", "proteccion.combustible_fundido_pct", "Fracción de combustible fundido"),
    Nodo("Proteccion", "AlarmasActivas", "Int32", "", "proteccion.alarmas_activas", "Número de alarmas activas"),
    Nodo("Proteccion", "Estado", "String", "", "estado", "OPERACION, PARADA, SCRAM o ACCIDENTE"),
)

# Mandos escribibles: (nodo, función que aplica el valor escrito)
MANDOS: tuple[Nodo, ...] = (
    Nodo("Mandos", "ConsignaPotencia", "Double", "MWt", "reactor.consigna_mwt", "Consigna del regulador automático (0-3200)"),
    Nodo("Mandos", "RegulacionAuto", "Boolean", "", "reactor.regulador_auto", "Conectar/desconectar el regulador automático"),
    Nodo("Mandos", "InsercionRR", "Double", "%", "reactor.barras.RR.insercion_pct", "Orden de posición para las RR"),
    Nodo("Mandos", "InsercionUSP", "Double", "%", "reactor.barras.USP.insercion_pct", "Orden de posición para las USP"),
    Nodo("Mandos", "InsercionAR", "Double", "%", "reactor.barras.AR.insercion_pct", "Orden de posición para las AR (solo en manual)"),
    Nodo("Mandos", "Bombas", "Int32", "", "circuito.bombas_en_marcha", "Bombas de circulación en marcha (0-8)"),
    Nodo("Mandos", "Protecciones", "Boolean", "", "proteccion.protecciones_activas", "Habilitar los disparos automáticos"),
    Nodo("Mandos", "AZ5", "Boolean", "", "", "Escribir true = pulsar AZ-5 (vuelve a false)"),
    Nodo("Mandos", "DispararTurbina", "Boolean", "", "", "Escribir true = disparar la turbina"),
)

TIPOS = {"Double": ua.VariantType.Double, "Int32": ua.VariantType.Int32,
         "Boolean": ua.VariantType.Boolean, "String": ua.VariantType.String}


def _valor(instantanea: dict, ruta: str, tipo: str) -> Any:
    v: Any = instantanea
    for parte in ruta.split("."):
        v = v[parte]
    if tipo == "Double":
        return float(v)
    if tipo == "Int32":
        return int(v)
    if tipo == "Boolean":
        return bool(v)
    return str(v)


class ServidorOpcUa:
    def __init__(self, planta: Planta, host: str = "0.0.0.0", puerto: int = 4842, nombre_publico: str = "localhost") -> None:
        self.planta = planta
        self.endpoint = f"opc.tcp://{host}:{puerto}/atomlab/"
        self.endpoint_publico = f"opc.tcp://{nombre_publico}:{puerto}/atomlab/"
        self.server = Server()
        self.ns = 0
        self.nodos: dict[str, Any] = {}
        self._ultimo_mando: dict[str, Any] = {}
        self.registro: deque = deque(maxlen=60)
        self.en_marcha = False
        self.error: str | None = None

    # ------------------------------------------------------------------ montaje
    async def montar(self) -> None:
        await self.server.init()
        self.server.set_endpoint(self.endpoint)
        self.server.set_server_name("AtomLab · Central RBMK didáctica")
        self.server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
        self.ns = await self.server.register_namespace(NAMESPACE_URI)
        raiz = await self.server.nodes.objects.add_object(ua.NodeId("AtomLab", self.ns), ua.QualifiedName("AtomLab", self.ns))
        carpetas: dict[str, Any] = {}

        async def carpeta(ruta: str):
            if ruta not in carpetas:
                padre = raiz
                if "/" in ruta:
                    padre = await carpeta(ruta.rsplit("/", 1)[0])
                carpetas[ruta] = await padre.add_object(ua.NodeId(ruta.replace("/", "."), self.ns), ua.QualifiedName(ruta.rsplit("/", 1)[-1], self.ns))
            return carpetas[ruta]

        s = self.planta.instantanea()
        for d in LECTURAS:
            await self._variable(await carpeta(d.carpeta), d, _valor(s, d.ruta, d.tipo) if d.ruta else False)
        for d in MANDOS:
            valor = _valor(s, d.ruta, d.tipo) if d.ruta else False
            nodo = await self._variable(await carpeta(d.carpeta), d, valor)
            await nodo.set_writable()
            self._ultimo_mando[d.node_id] = valor

        mandos = carpetas["Mandos"]
        metodos: tuple[tuple[str, Callable[[], None], str], ...] = (
            ("AZ5Pulsar", lambda: self.planta.az5("AZ-5 (OPC UA)"), "Parada de emergencia"),
            ("Rearmar", self.planta.rearmar, "Rearme tras el SCRAM (barras dentro)"),
            ("DispararTurbinaMetodo", lambda: self.planta.turbina(True), "Disparo de turbina"),
            ("RearmarTurbina", lambda: self.planta.turbina(False), "Rearme de turbina"),
            ("PruebaTurbina", self.planta.prueba_turbina, "Prueba de inercia del turbogenerador"),
            ("EscenarioNormal", lambda: self.planta.reiniciar("normal"), "Reinicia a plena potencia"),
            ("EscenarioChernobil", lambda: self.planta.reiniciar("chernobil"), "Condiciones del 26-04-1986, 01:22"),
        )
        for nombre, funcion, _desc in metodos:
            await mandos.add_method(ua.NodeId(f"Mandos.{nombre}", self.ns), ua.QualifiedName(nombre, self.ns), self._metodo(nombre, funcion), [], [ua.VariantType.String])

    async def _variable(self, padre: Any, d: Nodo, valor: Any):
        nodo = await padre.add_variable(ua.NodeId(d.node_id, self.ns), ua.QualifiedName(d.nombre, self.ns), ua.Variant(valor, TIPOS[d.tipo]))
        await nodo.write_attribute(ua.AttributeIds.Description, ua.DataValue(ua.Variant(
            ua.LocalizedText(f"{d.descripcion}{f' [{d.unidad}]' if d.unidad else ''}"), ua.VariantType.LocalizedText)))
        self.nodos[d.node_id] = nodo
        return nodo

    def _metodo(self, nombre: str, funcion: Callable[[], None]):
        @uamethod
        def manejador(_padre):
            try:
                funcion()
                self._anotar("METODO", nombre, "ok")
                return "ok"
            except (ValueError, RuntimeError, PermissionError) as e:
                self._anotar("METODO", nombre, f"rechazado: {e}")
                return f"rechazado: {e}"
        return manejador

    # ------------------------------------------------------------------ ciclo
    def _anotar(self, tipo: str, nodo: str, valor: Any) -> None:
        self.registro.appendleft({"timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
                                  "tipo": tipo, "nodo": nodo, "valor": valor})

    async def ejecutar(self) -> None:
        try:
            if not self.nodos:
                await self.montar()
            async with self.server:
                self.en_marcha = True
                self._anotar("SERVIDOR", self.endpoint_publico, "iniciado")
                while True:
                    await self.sincronizar()
                    await asyncio.sleep(0.25)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            self.error = str(e)
            raise
        finally:
            self.en_marcha = False

    def _real(self, s: dict, d: Nodo) -> Any:
        """Valor que debe mostrar un mando: el estado actual de la planta (o False si es un pulsador)."""
        if not d.ruta:
            return False
        if d.ruta.startswith("reactor.barras."):
            g = s["reactor"]["barras"][d.ruta.split(".")[2]]
            return float(g["objetivo_pct"] if g["objetivo_pct"] is not None else g["insercion_pct"])
        return _valor(s, d.ruta, d.tipo)

    async def sincronizar(self) -> None:
        # 1) mandos escritos por los clientes
        for d in MANDOS:
            valor = await self.nodos[d.node_id].read_value()
            if valor == self._ultimo_mando[d.node_id]:
                continue
            try:
                self._aplicar(d, valor)
                self._anotar("ESCRITURA", d.node_id, valor)
            except (ValueError, RuntimeError, PermissionError) as e:
                self._anotar("RECHAZO", d.node_id, f"{valor} · {e}")
        # 2) publicar el estado (también refleja en los mandos lo hecho desde la web o la API)
        s = self.planta.instantanea()
        for d in LECTURAS:
            await self.nodos[d.node_id].write_value(ua.Variant(_valor(s, d.ruta, d.tipo), TIPOS[d.tipo]))
        for d in MANDOS:
            real = self._real(s, d)
            if real != await self.nodos[d.node_id].read_value() or real != self._ultimo_mando[d.node_id]:
                await self.nodos[d.node_id].write_value(ua.Variant(real, TIPOS[d.tipo]))
            self._ultimo_mando[d.node_id] = real

    def _aplicar(self, d: Nodo, valor: Any) -> None:
        p = self.planta
        match d.nombre:
            case "ConsignaPotencia":
                p.fijar_potencia(float(valor))
            case "RegulacionAuto":
                p.fijar_regulador(bool(valor))
            case "InsercionRR" | "InsercionUSP" | "InsercionAR":
                p.mover_barras(d.nombre.removeprefix("Insercion"), float(valor))
            case "Bombas":
                p.fijar_bombas(int(valor))
            case "Protecciones":
                p.fijar_protecciones(bool(valor))
            case "AZ5":
                if valor:
                    p.az5("AZ-5 (OPC UA)")
            case "DispararTurbina":
                if valor:
                    p.turbina(True)

    def espacio(self) -> list[dict]:
        filas = []
        for d, acceso in [(d, "Lectura") for d in LECTURAS] + [(d, "Lectura/Escritura") for d in MANDOS]:
            filas.append({"node_id": f"ns={self.ns};s={d.node_id}", "ruta": f"AtomLab/{d.carpeta}/{d.nombre}",
                          "tipo": d.tipo, "unidad": d.unidad, "acceso": acceso, "descripcion": d.descripcion})
        for m in ("AZ5Pulsar", "Rearmar", "DispararTurbinaMetodo", "RearmarTurbina", "PruebaTurbina", "EscenarioNormal", "EscenarioChernobil"):
            filas.append({"node_id": f"ns={self.ns};s=Mandos.{m}", "ruta": f"AtomLab/Mandos/{m}", "tipo": "Método",
                          "unidad": "", "acceso": "Llamada", "descripcion": "Devuelve 'ok' o 'rechazado: motivo'"})
        return filas
