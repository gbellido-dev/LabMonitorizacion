"""Pruebas de la capa de IA:  LABIA_DIR=/tmp/x PYTHONPATH=plataforma/ia pytest plataforma/ia/tests"""
import importlib
import random

import pytest


@pytest.fixture()
def lab(tmp_path, monkeypatch):
    monkeypatch.setenv("LABIA_DIR", str(tmp_path))
    import labia
    import labia.continuo
    importlib.reload(labia)
    importlib.reload(labia.continuo)
    return labia


def curva(v):
    return 0.0 if v < 3 else (5000.0 if v >= 12 else 5000 * (v ** 3 - 27) / (1728 - 27))


def test_registrar_aplana_y_amplia_columnas(lab):
    lab.registrar("x", {"a": 1, "b": {"c": 2}, "ok": True})
    assert lab.registrar("x", [{"a": 3, "nueva": 4}]) == 2
    df = lab.datos("x")
    assert list(df.columns) == ["ts", "a", "b.c", "ok", "nueva"]
    assert df["ok"].iloc[0] == 1 and df["nueva"].iloc[1] == 4


def test_nombre_no_valido(lab):
    with pytest.raises(ValueError):
        lab.registrar("../fuera", {"a": 1})


def test_guardar_versiones_y_predecir(lab):
    from sklearn.ensemble import IsolationForest
    from sklearn.linear_model import LinearRegression
    import pandas as pd

    X = pd.DataFrame({"v": [1.0, 2.0, 3.0, 4.0]})
    m = LinearRegression().fit(X, [2.0, 4.0, 6.0, 8.0])
    assert lab.guardar(m, "r", ["v"], "regresion")["version"] == 1
    assert lab.guardar(m, "r", ["v"], "regresion")["version"] == 2
    assert (lab.MODELOS / "historial" / "r.v1.joblib").exists()
    modelo, ficha = lab.cargar("r")
    assert lab.predecir(modelo, ficha, [{"v": 5}])[0]["prediccion"] == pytest.approx(10)
    with pytest.raises(KeyError):
        lab.predecir(modelo, ficha, [{"otra": 1}])
    rng = random.Random(0)
    datos = pd.DataFrame({"v": [rng.gauss(0, 1) for _ in range(300)]})
    iso = IsolationForest(random_state=0).fit(datos)
    lab.guardar(iso, "a", ["v"], "anomalias")
    r = lab.predecir(*lab.cargar("a"), [{"v": 0.0}, {"v": 9.0}])
    assert r[0]["anomalia"] is False and r[1]["anomalia"] is True


def test_continuo_detecta_deriva_al_limitar(lab):
    from labia.continuo import AlmacenContinuo

    rng = random.Random(1)
    a = AlmacenContinuo()
    primera = None
    for i in range(3500):
        lim = 2500 if i >= 2500 else 5000
        v = rng.uniform(2, 16)
        r = a.paso("c", {"viento": v, "potencia": min(lim, curva(v)) + rng.gauss(0, 40)}, True,
                   tipo="regresion", entradas=["viento"], objetivo="potencia")
        if i >= 2500 and r["deriva"] and primera is None:
            primera = i
    assert primera is not None and primera < 2600       # se detecta en menos de 100 lecturas
    assert r["mae"] < 150                               # y el modelo se adapta


def test_continuo_anomalias(lab):
    from labia.continuo import AlmacenContinuo

    rng = random.Random(2)
    a = AlmacenContinuo()
    for _ in range(1000):
        v = rng.uniform(2, 16)
        a.paso("an", {"viento": v, "potencia": curva(v) + rng.gauss(0, 40)}, True,
               tipo="anomalias", entradas=None, objetivo=None)
    normal = a.paso("an", {"viento": 14, "potencia": 5000}, False, tipo=None, entradas=None, objetivo=None)
    rara = a.paso("an", {"viento": 14, "potencia": 2500}, False, tipo=None, entradas=None, objetivo=None)
    assert normal["anomalia"] is False and rara["anomalia"] is True


def test_api(lab):
    from fastapi.testclient import TestClient
    import servicio.app as app_mod

    importlib.reload(app_mod)
    c = TestClient(app_mod.app)
    assert c.post("/datos/d", json={"x": 1}).json()["filas"] == 1
    assert c.post("/modelos/noexiste/predecir", json={"x": 1}).status_code == 404
    assert c.post("/continuo/k", json={"x": 1}).status_code == 422          # sin tipo
    r = c.post("/continuo/k?tipo=regresion&objetivo=y", json={"x": 1, "y": 2})
    assert r.status_code == 200 and r.json()["aprendidas"] == 1
