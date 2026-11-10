# Capa de IA del laboratorio

Una capa **genérica** de analítica e IA: no sabe nada de ningún simulador. Trabaja con **conjuntos de datos** y
**modelos** por nombre, así que sirve para AeroLab, SolarLab, la Fundición o cualquier dato que pase por Node-RED.

Arranca con el resto del laboratorio (`docker compose up -d`). Para levantar solo esta parte:

```bash
docker compose up -d ia jupyter nodered
```

| Servicio | Dirección | Qué hace |
|---|---|---|
| `ia` | <http://localhost:8100/docs> (desde Node-RED, `http://ia:8000`) | API REST: guarda datos, predice con los modelos publicados, aprendizaje continuo |
| `jupyter` | <http://localhost:8888/?token=lab> | JupyterLab con los cuadernos de la serie 4 |

Los dos comparten el volumen `ia-lab`, montado en `/lab`:

```
/lab/datos/<conjunto>.csv       lo que Node-RED registra (una fila por lectura)
/lab/modelos/<modelo>.joblib    los modelos publicados desde Jupyter
/lab/modelos/<modelo>.json      su ficha: tipo, entradas, métricas, versión
/lab/modelos/historial/         versiones anteriores
/lab/continuo/<modelo>.pkl      modelos de aprendizaje continuo
/lab/cuadernos/                 los cuadernos (el trabajo del alumnado no se sobrescribe)
```

## El recorrido

```
 ① Recoger            ② Entrenar                 ③ Publicar               ④ Usar en tiempo real
 Node-RED             Jupyter                    guardar(modelo, ...)     Node-RED
 ia registrar ──►  datos/x.csv ──► datos("x") ──► modelos/x-curva ──────► ia predecir ──► ThingsBoard
```

Y, sin pasar por Jupyter, **ia aprender**: un modelo que aprende de cada lectura y avisa de deriva.

## Nodos de Node-RED (categoría **IA**)

Vienen preinstalados en la imagen de Node-RED del laboratorio (`plataforma/node-red/nodos/node-red-contrib-labia`).

| Nodo | Entrada | Resultado |
|---|---|---|
| **ia registrar** | `msg.payload` = objeto (o lista) con las lecturas | Añade filas a `datos/<conjunto>.csv`; `msg.ia` = filas totales |
| **ia predecir** | `msg.payload` con las entradas del modelo | regresión: `prediccion` · clasificación: `clase`, `probabilidad` · anomalías: `anomalia`, `puntuacion` |
| **ia aprender** | `msg.payload` con entradas y, si lo hay, el objetivo | `prediccion` / `clase` / `anomalia`, más `error`, `mae`, `deriva`, `derivas`, `aprendidas` |

Las claves anidadas se aplanan (`{"a": {"b": 1}}` → `a.b`). `msg.conjunto` y `msg.modelo` sustituyen a lo
configurado en el nodo.

## Librería `labia` (Jupyter)

```python
from labia import datos, conjuntos, guardar, cargar, modelos, predecir, desde_thingsboard

df = datos("aerolab")                      # DataFrame, la columna ts como fecha
guardar(modelo, "aerolab-curva",           # cualquier modelo de scikit-learn (o un Pipeline)
        entradas=["viento"], tipo="regresion", salida="potencia", metricas={"mae_kw": 85})
tb = desde_thingsboard("Aerogenerador-Aula", ["viento_mps", "potencia_kw"], horas=2)
```

Tipos de modelo: `regresion`, `clasificacion` y `anomalias` (convenio de scikit-learn: `predict` devuelve −1
para lo anómalo). Al guardar con un nombre que ya existe se crea una **versión nueva** y la anterior pasa al
historial; el servicio carga la nueva en la siguiente petición, sin reiniciar.

## API REST

| Método y ruta | Qué hace |
|---|---|
| `GET /salud` | Estado y número de conjuntos y modelos |
| `GET /datos` · `POST /datos/{conjunto}` · `GET /datos/{conjunto}?ultimas=20` · `DELETE /datos/{conjunto}` | Conjuntos de datos |
| `GET /modelos` · `POST /modelos/{modelo}/predecir` | Modelos publicados |
| `GET /continuo` · `POST /continuo/{modelo}?tipo=&objetivo=&entradas=&umbral=&aprender=` · `DELETE /continuo/{modelo}` | Aprendizaje continuo |

Errores: `404` si el modelo o el conjunto no existen (con la lista de los que hay) y `422` si faltan entradas.

## Aprendizaje continuo

- **Regresión y clasificación**: árboles de Hoeffding adaptativos (River). Cada lectura se usa primero para
  **predecir** y después para **aprender**, así el error publicado (`mae`, media de las últimas 200) es siempre sobre
  datos nuevos.
- **Deriva**: un detector ADWIN vigila el error. En regresión, el error **con signo** (real − predicho): avisa
  (`deriva: true` en esa lectura) cuando la máquina empieza a producir sistemáticamente más o menos de lo esperado,
  aunque el error absoluto medio apenas cambie. En clasificación, cuando la tasa de fallos sube. Solo a partir de
  600 lecturas aprendidas (antes el modelo aún está aprendiendo lo básico).
- **Anomalías**: distancia a los 10 vecinos más cercanos entre las últimas 1000 lecturas normales. La
  `puntuacion` se expresa respecto a lo habitual (1 = como el 1 % más raro de lo normal) y avisa por encima del
  `umbral` (1,5). Solo aprende de lo que considera normal.

## Versiones

`requirements.txt` fija las mismas versiones para el servicio y para Jupyter (un modelo guardado con joblib se
carga con la misma versión de scikit-learn). La imagen pesa ≈ 1,1 GB y funciona solo con CPU.
