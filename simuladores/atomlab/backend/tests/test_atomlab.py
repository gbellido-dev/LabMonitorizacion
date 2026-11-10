import asyncio
import socket

import pytest
from asyncua import Client
from fastapi.testclient import TestClient

from app.fisica import BETA, P_NOMINAL, Central
from app.planta import Planta


def correr(c, segundos, dt=0.05):
    for _ in range(int(round(segundos / dt))):
        c.paso(dt)


def test_estacionario_nominal_estable():
    c = Central()
    correr(c, 1200, 0.5)
    assert abs(c.potencia_mwt() - P_NOMINAL) < 30
    assert abs(c.presion - 7.0) < 0.05 and 45 < c.nivel < 55
    assert 900 < c.p_electrica < 1100 and not c.scram


def test_cambio_de_potencia_en_rampa_sin_disparo():
    c = Central()
    c.consigna_mwt = 1600
    correr(c, 1800, 0.5)
    assert abs(c.potencia_mwt() - 1600) < 40
    c.consigna_mwt = 3200
    correr(c, 1200, 0.5)
    assert not c.scram and abs(c.potencia_mwt() - 3200) < 60


def test_scram_desde_potencia_nominal_apaga_sin_danos():
    c = Central()
    correr(c, 30, 0.1)
    c.az5()
    correr(c, 20, 0.005)
    assert c.potencia_mwt() < 0.1 * P_NOMINAL      # solo queda el calor residual
    assert c.calor_residual > 0.02 and not c.danado


def test_desplazadores_dan_reactividad_positiva_al_empezar_el_scram():
    c = Central()
    c.escenario_chernobil()
    rho0 = c._reactividad()
    for g in c.grupos.values():
        g.z = min(1.0, g.z + 0.08) if g.por_arriba else g.z
    assert c._reactividad() > rho0


def test_escenario_chernobil_acaba_en_excursion_y_rotura():
    c = Central()
    c.escenario_chernobil()
    correr(c, 60, 0.1)
    c.prueba_turbina()
    correr(c, 36, 0.05)
    c.az5()
    pico, pico_rho = 0.0, 0.0
    for _ in range(4000):
        c.paso(0.002)
        pico, pico_rho = max(pico, c.potencia_mwt()), max(pico_rho, c.rho)
    assert pico_rho > BETA                       # supercrítico inmediato
    assert pico > 10 * P_NOMINAL and c.danado
    assert c.dosis()["sala_central"] > 1000


def test_planta_alarmas_y_eventos():
    p = Planta()
    p.reiniciar("chernobil")
    p.avanzar(2)
    assert {"ORM_MUY_BAJO", "PROTECCIONES_ANULADAS", "BAJA_POTENCIA"} <= set(p.activas)
    p.az5()
    p.avanzar(1)
    assert "SCRAM" in p.activas
    assert any(e["tipo"] == "proteccion.scram" for e in p.eventos)
    with pytest.raises(RuntimeError):
        p.rearmar()                     # las barras aún no han terminado de entrar


def test_api_rest():
    from app.main import app
    import app.main as m
    m.OPCUA_ACTIVO = False
    with TestClient(app) as cli:
        s = cli.get("/api/v1/planta").json()
        assert s["planta"] == "AtomLab" and s["estado"] == "OPERACION"
        assert "reactor_potencia_mwt" in cli.get("/api/v1/medidas").json()
        assert cli.put("/api/v1/mandos/potencia", json={"mwt": 5000}).status_code == 422
        assert cli.put("/api/v1/mandos/barras/AR", json={"insercion_pct": 40}).status_code == 409
        assert cli.put("/api/v1/mandos/potencia", json={"mwt": 2000}).json()["ok"]
        assert cli.post("/api/v1/mandos/az5").json()["estado"] == "SCRAM"
        assert cli.post("/api/v1/mandos/escenario", json={"nombre": "chernobil"}).json()["ok"]
        assert cli.get("/api/v1/planta").json()["escenario"] == "chernobil"
        with cli.websocket_connect("/ws") as w:
            assert w.receive_json()["planta"] == "AtomLab"


def _puerto_libre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_servidor_opcua_lectura_escritura_y_metodos():
    from app.opcua_server import NAMESPACE_URI, ServidorOpcUa

    async def prueba():
        p = Planta()
        puerto = _puerto_libre()
        srv = ServidorOpcUa(p, host="127.0.0.1", puerto=puerto)
        tarea = asyncio.create_task(srv.ejecutar())
        for _ in range(100):
            if srv.en_marcha:
                break
            await asyncio.sleep(0.05)
        try:
            async with Client(f"opc.tcp://127.0.0.1:{puerto}/atomlab/") as cli:
                ns = await cli.get_namespace_index(NAMESPACE_URI)
                pot = await cli.get_node(f"ns={ns};s=Reactor.PotenciaTermica").read_value()
                assert abs(pot - P_NOMINAL) < 50
                await cli.get_node(f"ns={ns};s=Mandos.ConsignaPotencia").write_value(2500.0)
                await asyncio.sleep(0.6)
                assert p.c.consigna_mwt == 2500.0
                mandos = cli.get_node(f"ns={ns};s=Mandos")
                hijos = await cli.nodes.objects.get_child([f"{ns}:AtomLab"])
                nombres = {(await h.read_browse_name()).Name for h in await hijos.get_children()}
                assert {"Reactor", "CircuitoPrimario", "Turbina", "Generador", "Condensador", "Refrigeracion", "Radiacion", "Proteccion", "Mandos", "Servidor"} <= nombres
                r = await mandos.call_method(f"{ns}:AZ5Pulsar")
                assert r == "ok" and p.c.scram
                await asyncio.sleep(0.6)
                assert await cli.get_node(f"ns={ns};s=Proteccion.Scram").read_value() is True
                assert await cli.get_node(f"ns={ns};s=Proteccion.Estado").read_value() == "SCRAM"
                r = await mandos.call_method(cli.get_node(f"ns={ns};s=Mandos.Rearmar"))
                assert r.startswith("rechazado")       # las barras aún están entrando
        finally:
            tarea.cancel()
            await asyncio.gather(tarea, return_exceptions=True)

    asyncio.run(prueba())
