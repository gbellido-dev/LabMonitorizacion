from fastapi.testclient import TestClient
import pytest

from app.planta import Planta
from app.process import Proceso

CLAVE = {"X-API-Key": "reactorlab"}


def test_estado_estacionario_estable():
    p = Proceso(semilla=1)
    for _ in range(2000):
        p.step(0.002)
    assert p.presion == pytest.approx(2700, abs=1)
    assert p.caudal["producto"] == pytest.approx(100, abs=0.5)
    assert p.y_purga[0] == pytest.approx(0.47, abs=0.002)


def _planta():
    return Planta(escala_tiempo=120, semilla=1)


def avanzar(pl, segundos):
    eventos = []
    for _ in range(int(segundos * 4)):
        eventos += pl.avanzar(0.25)
    return eventos


def test_lazos_siguen_consigna_de_presion():
    pl = _planta()
    pl.fijar_consignas({"presion_kpa": 2800})
    avanzar(pl, 300)                 # 10 h de proceso
    assert pl.medidas_planas()["presion_kpa"] == pytest.approx(2800, abs=15)
    assert pl.medidas_planas()["nivel_pct"] == pytest.approx(44, abs=2)


def test_alarma_presion_alta_y_borrado():
    pl = _planta()
    pl.fijar_consignas({"presion_kpa": 2950})
    eventos = avanzar(pl, 400)
    assert any(e["evento"] == "alarma.activada" and e["alarma"]["codigo"] == "PRESION_ALTA" for e in eventos)
    pl.fijar_consignas({"presion_kpa": 2700})
    eventos = avanzar(pl, 400)
    assert any(e["evento"] == "alarma.borrada" and e["alarma"]["codigo"] == "PRESION_ALTA" for e in eventos)


def test_valvula_sucia_la_compensa_el_lazo():
    pl = _planta()
    antes = pl.proceso.valvulas["producto"].pos
    pl.inyectar("valvula_sucia", "producto", 0.6)
    avanzar(pl, 120)
    assert pl.proceso.valvulas["producto"].pos > antes + 20       # el control abre más la válvula
    assert pl.medidas_planas()["nivel_pct"] == pytest.approx(44, abs=2)


def test_sensor_en_deriva_engana_al_control():
    pl = _planta()
    pl.inyectar("sensor", "presion", 50, "deriva")
    avanzar(pl, 120)
    assert pl.medidas_planas()["presion_kpa"] == pytest.approx(2700, abs=20)   # lo que se mide
    assert pl.proceso.presion < 2650                                          # lo que hay de verdad


def test_paro_de_emergencia_posicion_segura():
    pl = _planta()
    pl.fijar_paro(True)
    avanzar(pl, 30)
    v = pl.proceso.valvulas
    assert v["f1"].pos == 0 and v["f2"].pos == 0 and v["purga"].pos == 100
    assert pl.medidas_planas()["caudal_f1_kmolh"] == 0


def test_consigna_fuera_de_rango():
    with pytest.raises(ValueError):
        _planta().fijar_consignas({"presion_kpa": 3500})


def test_api_lectura_y_ordenes():
    from app.main import app
    with TestClient(app) as c:
        s = c.get("/api/v1/proceso").json()
        assert s["planta"] == "ReactorLab" and "presion_kpa" in s["medidas"]
        assert "caudal_producto_kmolh" in c.get("/api/v1/medidas").json()
        assert c.get("/api/v1/medidas/no_existe").status_code == 404
        # órdenes sin clave / con clave mala / con clave
        assert c.put("/api/v1/consignas", json={"presion_kpa": 2750}).status_code == 401
        assert c.put("/api/v1/consignas", json={"presion_kpa": 2750}, headers={"X-API-Key": "x"}).status_code == 403
        r = c.put("/api/v1/consignas", json={"presion_kpa": 2750}, headers=CLAVE)
        assert r.status_code == 200 and r.json()["presion_kpa"] == 2750
        assert c.put("/api/v1/consignas", json={"presion_kpa": 9000}, headers=CLAVE).status_code == 422
        # válvulas solo en manual
        assert c.put("/api/v1/valvulas", json={"f1": 30}, headers=CLAVE).status_code == 409
        c.put("/api/v1/modo", json={"modo": "manual"}, headers=CLAVE)
        assert c.put("/api/v1/valvulas", json={"f1": 30}, headers=CLAVE).status_code == 200
        c.put("/api/v1/modo", json={"modo": "auto"}, headers=CLAVE)
        # webhooks
        wh = c.post("/api/v1/webhooks", json={"url": "http://127.0.0.1:9/x"}, headers=CLAVE)
        assert wh.status_code == 201
        otra = c.post("/api/v1/webhooks", json={"url": "http://127.0.0.1:9/x", "eventos": ["estado"]}, headers=CLAVE)
        assert otra.status_code == 200 and otra.json()["id"] == wh.json()["id"]      # idempotente
        assert c.get("/api/v1/webhooks").status_code == 401
        assert c.delete(f"/api/v1/webhooks/{wh.json()['id']}", headers=CLAVE).status_code == 204
        # websocket
        with c.websocket_connect("/ws") as ws:
            assert ws.receive_json()["planta"] == "ReactorLab"


def test_reiniciar_borra_las_alarmas_activas():
    pl = _planta()
    pl.fijar_modo("manual")
    pl.fijar_valvulas({"f1": 45})
    avanzar(pl, 5)
    assert pl.activas
    pl.reiniciar()
    borradas = [e for e in pl.eventos if e["evento"] == "alarma.borrada"]
    assert borradas and not pl.activas
