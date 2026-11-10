"""Servicio de IA del laboratorio (API REST).

No sabe nada de ningún simulador: trabaja con conjuntos de datos y modelos
por nombre. Node-RED le envía lecturas (JSON) para guardarlas, para que un
modelo prediga o para que un modelo continuo aprenda.

Documentación interactiva: http://localhost:8100/docs
"""
from __future__ import annotations

import atexit
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse

import labia
from labia.continuo import AlmacenContinuo

app = FastAPI(title="IA del laboratorio", version="1.0",
              description="Datos, modelos entrenados en Jupyter y aprendizaje continuo para Node-RED.")
continuo = AlmacenContinuo()
atexit.register(continuo.guardar)
_cache: dict[str, tuple[float, Any, dict]] = {}


def _filas(cuerpo: Any) -> tuple[list[dict], bool]:
    if isinstance(cuerpo, dict):
        return [cuerpo], False
    if isinstance(cuerpo, list) and cuerpo and all(isinstance(f, dict) for f in cuerpo):
        return cuerpo, True
    raise HTTPException(422, "El cuerpo debe ser un objeto JSON o una lista de objetos")


def _modelo(nombre: str):
    ruta = labia.MODELOS / f"{nombre}.joblib"
    if not ruta.exists():
        hay = ", ".join(m["nombre"] for m in labia.modelos()) or "ninguno"
        raise HTTPException(404, f"No existe el modelo {nombre!r}. Publicados: {hay}")
    mtime = ruta.stat().st_mtime
    if nombre not in _cache or _cache[nombre][0] != mtime:   # se recarga solo si Jupyter lo vuelve a guardar
        modelo, ficha = labia.cargar(nombre)
        _cache[nombre] = (mtime, modelo, ficha)
    return _cache[nombre][1], _cache[nombre][2]


@app.get("/", include_in_schema=False)
def inicio():
    return RedirectResponse("/docs")


@app.get("/salud", tags=["servicio"])
def salud():
    return {"ok": True, "conjuntos": len(labia.conjuntos()), "modelos": len(labia.modelos()),
            "continuos": len(continuo.modelos)}


# ── Datos ──────────────────────────────────────────────────────────────────

@app.get("/datos", tags=["datos"], summary="Conjuntos de datos")
def listar_datos():
    return labia.conjuntos()


@app.post("/datos/{nombre}", tags=["datos"], summary="Añadir lecturas a un conjunto")
def registrar(nombre: str, cuerpo: Any = Body(..., examples=[{"viento": 9.4, "potencia": 2950, "averia": 0}])):
    filas, _ = _filas(cuerpo)
    try:
        total = labia.registrar(nombre, filas)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return {"conjunto": nombre, "añadidas": len(filas), "filas": total}


@app.get("/datos/{nombre}", tags=["datos"], summary="Últimas filas de un conjunto")
def leer(nombre: str, ultimas: int = Query(20, ge=1, le=10000)):
    try:
        df = labia.datos(nombre, ultimas=ultimas)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))
    df["ts"] = df["ts"].astype(str)
    return df.astype(object).where(df.notna(), None).to_dict(orient="records")


@app.delete("/datos/{nombre}", tags=["datos"], summary="Borrar un conjunto")
def borrar(nombre: str):
    try:
        return {"borrado": labia.borrar_datos(nombre)}
    except ValueError as e:
        raise HTTPException(422, str(e))


# ── Modelos entrenados en Jupyter ──────────────────────────────────────────

@app.get("/modelos", tags=["modelos"], summary="Modelos publicados desde Jupyter")
def listar_modelos():
    return labia.modelos()


@app.post("/modelos/{nombre}/predecir", tags=["modelos"], summary="Predecir con un modelo publicado")
def predecir(nombre: str, cuerpo: Any = Body(..., examples=[{"viento": 9.4}])):
    filas, lista = _filas(cuerpo)
    modelo, ficha = _modelo(nombre)
    try:
        res = labia.predecir(modelo, ficha, filas)
    except KeyError as e:
        raise HTTPException(422, e.args[0])
    except ValueError as e:
        raise HTTPException(422, f"Entradas no numéricas: {e}")
    for r in res:
        r.update({"modelo": nombre, "version": ficha["version"]})
    return res if lista else res[0]


# ── Aprendizaje continuo ───────────────────────────────────────────────────

@app.get("/continuo", tags=["continuo"], summary="Modelos de aprendizaje continuo")
def listar_continuos():
    return [m.ficha() for m in continuo.modelos.values()]


@app.post("/continuo/{nombre}", tags=["continuo"], summary="Predecir y aprender con una lectura")
def paso(nombre: str, cuerpo: Any = Body(..., examples=[{"viento": 9.4, "potencia": 2950}]),
         tipo: str | None = Query(None, description="regresion · clasificacion · anomalias (para crearlo)"),
         objetivo: str | None = Query(None, description="columna que se aprende (regresión / clasificación)"),
         entradas: str | None = Query(None, description="columnas de entrada separadas por comas (vacío: todas)"),
         umbral: float = Query(1.5, description="anomalías: puntuación a partir de la que se avisa (1 = el 1 % más raro de lo normal)"),
         aprender: bool = Query(True, description="false: solo predice")):
    filas, lista = _filas(cuerpo)
    ent = [e.strip() for e in entradas.split(",") if e.strip()] if entradas else None
    try:
        res = [continuo.paso(nombre, f, aprender, tipo=tipo, entradas=ent, objetivo=objetivo, umbral=umbral)
               for f in filas]
    except KeyError as e:
        raise HTTPException(422, e.args[0])
    except ValueError as e:
        raise HTTPException(422, str(e))
    return res if lista else res[0]


@app.delete("/continuo/{nombre}", tags=["continuo"], summary="Olvidar un modelo continuo")
def olvidar(nombre: str):
    return {"borrado": continuo.borrar(nombre)}
