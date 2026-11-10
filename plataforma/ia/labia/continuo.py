"""Aprendizaje continuo (en línea) con River.

Cada lectura que llega se usa dos veces, en este orden ("prequential"):
  1. el modelo PREDICE con lo que sabe hasta ahora;
  2. si la lectura trae el valor real (objetivo), el modelo APRENDE de ella.
Así el error que se publica es siempre el de datos que el modelo no había visto.

Un detector ADWIN vigila ese error: si EMPEORA de forma significativa, hay
**deriva** (la máquina ya no se comporta como cuando el modelo aprendió).

Para anomalías se usa un detector de vecinos cercanos con ventana: recuerda
las últimas lecturas normales y mide lo lejos que queda cada lectura nueva de
sus vecinas más próximas. La puntuación se expresa respecto a lo habitual:
1 = tan lejos como el 1 % de lecturas normales más raras; > umbral = anomalía.
"""
from __future__ import annotations

import pickle
import threading
from datetime import datetime
from pathlib import Path

from collections import deque

import numpy as np
from river import drift, metrics, preprocessing, tree, utils

from . import CONTINUO, TIPOS, _nombre, aplanar


def _crear(tipo: str):
    if tipo == "regresion":
        return preprocessing.StandardScaler() | tree.HoeffdingAdaptiveTreeRegressor(
            grace_period=50, leaf_prediction="adaptive", seed=1)
    if tipo == "clasificacion":
        return preprocessing.StandardScaler() | tree.HoeffdingAdaptiveTreeClassifier(grace_period=50, seed=1)
    return DetectorVecinos()


class DetectorVecinos:
    """Anomalías por distancia a los k vecinos más cercanos (ventana deslizante)."""

    def __init__(self, k: int = 10, ventana: int = 1000):
        self.k, self.escala = k, preprocessing.StandardScaler()
        self.puntos: deque = deque(maxlen=ventana)
        self.habituales: deque = deque(maxlen=ventana)
        self.claves: list[str] = []

    def _dist(self, x: dict) -> float:
        if len(self.puntos) <= self.k:
            return 0.0
        m, s = self.escala.means, self.escala.vars
        esc = np.array([[(p[c] - m[c]) / (s[c] ** 0.5 or 1.0) for c in self.claves] for p in self.puntos])
        v = np.array([(x[c] - m[c]) / (s[c] ** 0.5 or 1.0) for c in self.claves])
        d = np.sort(np.linalg.norm(esc - v, axis=1))
        return float(d[: self.k].mean())

    def score_one(self, x: dict) -> float:
        d = self._dist(x)
        if len(self.habituales) < 50:
            return 0.0
        ref = float(np.quantile(self.habituales, 0.99)) or 1e-9
        return d / ref

    def learn_one(self, x: dict) -> None:
        if not self.claves:
            self.claves = list(x)
        if len(self.puntos) >= 100:                 # con pocos vecinos las distancias aún no son fiables
            self.habituales.append(self._dist(x))
        self.escala.learn_one(x)
        self.puntos.append(dict(x))


class ModeloContinuo:
    def __init__(self, nombre: str, tipo: str, entradas: list[str] | None, objetivo: str | None,
                 umbral: float = 1.5):
        if tipo not in TIPOS:
            raise ValueError(f"tipo debe ser uno de {TIPOS}")
        if tipo != "anomalias" and not objetivo:
            raise ValueError("Para regresión o clasificación indica el objetivo (la columna que se aprende)")
        self.nombre, self.tipo, self.objetivo, self.umbral = nombre, tipo, objetivo, umbral
        self.entradas = list(entradas or [])
        self.modelo = _crear(tipo)
        self.metrica = utils.Rolling(metrics.MAE() if tipo == "regresion" else metrics.Accuracy(), window_size=200)
        self.adwin = drift.ADWIN(delta=0.002)
        self.n = 0
        self.derivas = 0
        self.ultima_deriva: str | None = None
        self.creado = datetime.now().isoformat(timespec="seconds")

    def _x(self, fila: dict) -> dict:
        if not self.entradas:                      # todas las numéricas salvo objetivo y ts
            self.entradas = [k for k, v in fila.items()
                             if k not in (self.objetivo, "ts") and isinstance(v, (int, float))]
        faltan = [c for c in self.entradas if fila.get(c) is None]
        if faltan:
            raise KeyError(f"Faltan entradas del modelo {self.nombre!r}: {', '.join(faltan)}")
        return {c: float(fila[c]) for c in self.entradas}

    def paso(self, fila: dict, aprender: bool = True) -> dict:
        fila = aplanar(fila)
        x = self._x(fila)
        res: dict = {}
        deriva = False
        if self.tipo == "anomalias":
            p = self.modelo.score_one(x) if self.n >= 150 else 0.0
            anomala = bool(self.n >= 150 and p > self.umbral)
            res = {"puntuacion": round(float(p), 4), "anomalia": anomala}
            if aprender and not anomala:            # solo aprende lo que considera normal
                self.modelo.learn_one(x)
                self.n += 1
        else:
            y = fila.get(self.objetivo)
            pred = self.modelo.predict_one(x)
            if self.tipo == "regresion":
                res["prediccion"] = None if pred is None else round(float(pred), 4)
            else:
                res["clase"] = pred
            if y is not None:
                if pred is not None and self.n >= 20:
                    self.metrica.update(y, pred)
                    error = abs(float(y) - float(pred)) if self.tipo == "regresion" else float(y != pred)
                    if self.tipo == "regresion":
                        res["error"] = round(error, 4)
                    antes = self.adwin.estimation
                    self.adwin.update(error)
                    # deriva = el error EMPEORA, y solo cuando el modelo ya ha aprendido lo básico
                    if self.adwin.drift_detected and self.n >= 300 and self.adwin.estimation > antes:
                        deriva = True
                        self.derivas += 1
                        self.ultima_deriva = datetime.now().isoformat(timespec="seconds")
                if aprender:
                    self.modelo.learn_one(x, y)
                    self.n += 1
            res["mae" if self.tipo == "regresion" else "acierto"] = round(float(self.metrica.get()), 4)
        res.update({"deriva": deriva, "derivas": self.derivas, "aprendidas": self.n})
        return res

    def ficha(self) -> dict:
        return {"nombre": self.nombre, "tipo": self.tipo, "entradas": self.entradas, "objetivo": self.objetivo,
                "aprendidas": self.n, "derivas": self.derivas, "ultima_deriva": self.ultima_deriva,
                ("mae" if self.tipo == "regresion" else "acierto"): round(float(self.metrica.get()), 4)
                if self.tipo != "anomalias" else None, "creado": self.creado}


class AlmacenContinuo:
    """Los modelos continuos en memoria, guardados en disco de vez en cuando."""

    def __init__(self, carpeta: Path = CONTINUO):
        self.carpeta = carpeta
        self.modelos: dict[str, ModeloContinuo] = {}
        self.cambios: dict[str, int] = {}
        self.cerrojo = threading.Lock()
        carpeta.mkdir(parents=True, exist_ok=True)
        for p in carpeta.glob("*.pkl"):
            try:
                self.modelos[p.stem] = pickle.loads(p.read_bytes())
            except Exception:                       # fichero de otra versión: se ignora
                pass

    def obtener(self, nombre: str, tipo: str | None, entradas, objetivo, umbral: float = 1.5) -> ModeloContinuo:
        _nombre(nombre)
        m = self.modelos.get(nombre)
        if m is None:
            if not tipo:
                raise KeyError(f"No existe el modelo continuo {nombre!r}: indica su tipo para crearlo")
            m = self.modelos[nombre] = ModeloContinuo(nombre, tipo, entradas, objetivo, umbral)
        return m

    def paso(self, nombre: str, fila: dict, aprender: bool, **crear) -> dict:
        with self.cerrojo:
            m = self.obtener(nombre, **crear)
            res = m.paso(fila, aprender)
            self.cambios[nombre] = self.cambios.get(nombre, 0) + 1
            if self.cambios[nombre] >= 100:
                self.guardar(nombre)
            return res

    def guardar(self, nombre: str | None = None) -> None:
        for n in [nombre] if nombre else list(self.modelos):
            (self.carpeta / f"{n}.pkl").write_bytes(pickle.dumps(self.modelos[n]))
            self.cambios[n] = 0

    def borrar(self, nombre: str) -> bool:
        with self.cerrojo:
            existia = self.modelos.pop(nombre, None) is not None
            (self.carpeta / f"{nombre}.pkl").unlink(missing_ok=True)
            return existia
