"""PLC Siemens S7 simulado de la Fundición (protocolo S7comm, puerto 102).

Publica en bloques de datos (DB) las mismas señales que el servidor OPC UA expone
en las carpetas ``TagsS7`` de cada activo, en la dirección que indica su propiedad
``DireccionS7``:

    DB10.DBD0      REAL (4 bytes, big-endian)   IF-01 Metal.Temp
    DB90.DBW4      WORD (2 bytes)                IF-02 Alarm.Word
    DB11.DBX12.0   bit 0 del byte 12             IF-01 ReadyToPour

Así el mismo dato se puede leer por los dos caminos: por OPC UA, con nombre,
unidad y tipo; por S7, como bytes en una dirección que hay que conocer.

Además, el bloque de órdenes DB100 se puede escribir desde un cliente S7:

    DB100.DBW0   INT   código de avería (0-7)  → ns=1;s=Mantenimiento.Averia
    DB100.DBW2   INT   velocidad de simulación (1-20) → ns=1;s=Simulacion.Velocidad

En una planta real habría un PLC por célula (PLC-FUS-01, PLC-MOL-01…, ver la
variable PLC de cada activo); aquí un único PLC simulado contiene los DB de todos.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import struct

from asyncua import Client, ua
from snap7.server import Server, SrvArea

ENDPOINT = os.environ.get("OPCUA_ENDPOINT", "opc.tcp://localhost:4841/UA/Fundicion")
PUERTO = int(os.environ.get("S7_PORT", "102"))
DIR = re.compile(r"^DB(\d+)\.DB([XBWD])(\d+)(?:\.(\d))?$")
DB_ORDENES = 100

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger("plc-s7")
logging.getLogger("asyncua").setLevel(logging.WARNING)
logging.getLogger("snap7").setLevel(logging.WARNING)


def analizar(direccion: str) -> tuple[int, str, int, int]:
    """'DB11.DBX12.0' → (11, 'X', 12, 0)."""
    m = DIR.match(direccion.replace(" ", ""))
    if not m:
        raise ValueError(f"dirección S7 no válida: {direccion}")
    return int(m[1]), m[2], int(m[3]), int(m[4] or 0)


def escribir(db: bytearray, tipo: str, byte: int, bit: int, valor) -> None:
    if tipo == "D":
        struct.pack_into(">f", db, byte, float(valor or 0))
    elif tipo == "W":
        struct.pack_into(">H", db, byte, max(0, min(65535, int(valor or 0))))
    elif tipo == "B":
        db[byte] = max(0, min(255, int(valor or 0)))
    else:
        db[byte] = (db[byte] | (1 << bit)) if valor else (db[byte] & ~(1 << bit))


async def descubrir(cliente: Client) -> list[dict]:
    """Recorre PlantaNorte y devuelve cada señal de las carpetas TagsS7 con su dirección."""
    señales, vistos = [], set()
    planta = cliente.get_node("ns=1;s=PlantaNorte")
    for zona in await planta.get_children():
        for activo in await zona.get_children():
            nombre = (await activo.read_browse_name()).Name
            # los activos aparecen también como fuentes de eventos: cada uno solo una vez
            if nombre == "KPIs" or nombre in vistos:
                continue
            vistos.add(nombre)
            try:
                tags = cliente.get_node(f"ns=1;s={nombre}.TagsS7")
                hijos = await tags.get_children()
            except Exception:
                continue
            for t in hijos:
                simbolo = (await t.read_browse_name()).Name
                direccion = await cliente.get_node(f"ns=1;s={nombre}.TagsS7.{simbolo}.Direccion").read_value()
                db, tipo, byte, bit = analizar(direccion)
                señales.append({"activo": nombre, "simbolo": simbolo, "direccion": direccion, "nodo": t,
                                "db": db, "tipo": tipo, "byte": byte, "bit": bit})
    return señales


class Manejador:
    def __init__(self, porNodo: dict, dbs: dict):
        self.porNodo, self.dbs = porNodo, dbs

    def datachange_notification(self, node, val, data):
        s = self.porNodo.get(node.nodeid.to_string())
        if s:
            escribir(self.dbs[s["db"]], s["tipo"], s["byte"], s["bit"], val)


async def principal() -> None:
    servidor = Server(log=False)
    dbs: dict[int, bytearray] = {}
    while True:
        try:
            async with Client(ENDPOINT) as cliente:
                señales = await descubrir(cliente)
                # tamaño de cada DB: hasta el último byte usado (+4)
                for s in señales:
                    tam = s["byte"] + 4
                    if s["db"] not in dbs:
                        dbs[s["db"]] = bytearray(max(tam, 16))
                    elif len(dbs[s["db"]]) < tam:
                        dbs[s["db"]].extend(bytearray(tam - len(dbs[s["db"]])))
                dbs.setdefault(DB_ORDENES, bytearray(16))
                if not getattr(servidor, "_arrancado", False):
                    for n, buf in sorted(dbs.items()):
                        servidor.register_area(SrvArea.DB, n, buf)
                    servidor.start(tcp_port=PUERTO)
                    servidor._arrancado = True
                    log.info("PLC S7 en el puerto %s · DB %s · %d señales", PUERTO,
                             ", ".join(str(n) for n in sorted(dbs)), len(señales))
                    for s in señales:
                        log.info("  %-7s %-16s %s", s["activo"], s["simbolo"], s["direccion"])
                porNodo = {s["nodo"].nodeid.to_string(): s for s in señales}
                sub = await cliente.create_subscription(500, Manejador(porNodo, dbs))
                await sub.subscribe_data_change([s["nodo"] for s in señales])

                # órdenes por S7 (DB100) → OPC UA
                averia = cliente.get_node("ns=1;s=Mantenimiento.Averia")
                velocidad = cliente.get_node("ns=1;s=Simulacion.Velocidad")
                ordenes = dbs[DB_ORDENES]
                struct.pack_into(">hh", ordenes, 0, await averia.read_value(), int(await velocidad.read_value()))
                previo = bytes(ordenes[:4])
                reloj = cliente.get_node("ns=1;s=Simulacion.TiempoSimulado")
                vueltas = 0
                while True:
                    await asyncio.sleep(0.5)
                    vueltas += 1
                    if vueltas % 10 == 0:          # latido: si el servidor OPC UA ha caído, esto falla y se reconecta
                        await asyncio.wait_for(reloj.read_value(), 3)
                    if bytes(ordenes[:4]) != previo:
                        a, v = struct.unpack_from(">hh", ordenes, 0)
                        for nodo, valor, tipo in ((averia, a, ua.VariantType.Int32), (velocidad, float(v), ua.VariantType.Double)):
                            try:
                                await nodo.write_value(ua.DataValue(ua.Variant(valor, tipo)))
                            except Exception as e:  # valor fuera de rango: se rechaza
                                log.warning("orden S7 rechazada (%s = %s): %s", nodo.nodeid.to_string(), valor, e)
                        struct.pack_into(">hh", ordenes, 0, await averia.read_value(), int(await velocidad.read_value()))
                        log.info("orden S7: avería %s, velocidad %s", a, v)
                        previo = bytes(ordenes[:4])
        except Exception as e:  # servidor OPC UA caído o reiniciándose: se reintenta
            log.warning("OPC UA no disponible (%s), reintento en 5 s", e or type(e).__name__)
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(principal())
