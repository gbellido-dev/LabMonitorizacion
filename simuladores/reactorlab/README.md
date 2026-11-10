# ReactorLab · Planta química con protocolos web

ReactorLab simula un **reactor químico continuo** y ofrece sus datos y sus mandos **solo con protocolos web**: API REST (JSON), WebSocket, Server-Sent Events y webhooks. Es el quinto simulador del laboratorio de Monitorización de Máquinas, junto a AeroLab (Modbus TCP), OceanLab (MQTT), SolarLab (OPC UA) y la Fundición (OPC UA).

## Origen y licencia

El modelo del proceso es un port a Python del simulador de **GRFICSv3** (Fortiphyd, [github.com/Fortiphyd/GRFICSv3](https://github.com/Fortiphyd/GRFICSv3), `simulation/simulation/TE_process.cc`, commit `8d611b7`), que implementa el *Tennessee Eastman simplificado* de N. L. Ricker (*J. Process Control* 3, 1993, 109-123). La estructura de control reproduce los cuatro lazos del PLC de GRFICS (`plc/st_files`). Del proyecto original **solo se ha tomado el simulador**: no se incluyen el PLC, la HMI, la red ni los escenarios de ciberseguridad.

Como GRFICSv3 se distribuye con licencia **GPL-3.0**, esta carpeta (`simuladores/reactorlab`) también lo hace: ver [LICENSE](LICENSE).

Cambios respecto al original:

- Python en lugar de C++, sin LAPACK (el sistema 3×3 del estado estacionario se resuelve con la regla de Cramer).
- El tiempo de simulación avanza con una **escala configurable** (por defecto ×120: 1 s real = 2 min de proceso).
- Control integrado (los lazos del PLC) con PI sintonizados en unidades de ingeniería.
- Corregidos dos errores del original: el analizador de purga nunca entregaba la muestra retardada y el estado estacionario usaba un índice fuera de rango para la purga.
- Interfaz y API nuevas, en castellano.
- Se conserva la **visualización 3D original de GRFICS** (Unity WebGL) en `http://localhost:8030/3d/`, movida por los datos de ReactorLab a través de un endpoint compatible (`/data/index.php`, mismo JSON que GRFICS).

## El proceso

```
F1 (A + C) ──▶┐                  ┌──▶ PURGA (gas)   ← analizador A/B/C
              │    REACTOR       │
F2 (A)     ──▶┤  A + C → D       │
              │  P ≈ 2700 kPa    │
              └──────────────────┴──▶ PRODUCTO D (líquido)
```

| Lazo | Mide | Mueve | Consigna por defecto |
|---|---|---|---|
| Producción | caudal de producto | válvula F1 | 100 kmol/h (60–110) |
| Presión | presión del reactor | válvula de purga | 2700 kPa (2500–2950) |
| Composición | % de A en la purga | válvula F2 | 47 % (40–55) |
| Nivel | nivel de líquido | válvula de producto | 44 % (20–75) |

Si la presión supera 2900 kPa, el control reduce la producción (*override*). El **paro de emergencia** cierra las alimentaciones y abre purga y producto.

## Protocolos web

Todo en el puerto **8030**. Documentación interactiva (OpenAPI) en `http://localhost:8030/docs`.

| Protocolo | Uso | Dirección |
|---|---|---|
| REST · consulta | El cliente pregunta (*polling*) | `GET /api/v1/proceso`, `/medidas`, `/historico`, `/alarmas`, `/eventos` |
| REST · órdenes | El cliente manda, con clave | `PUT /api/v1/consignas`, `/modo`, `/valvulas` · `POST /api/v1/marcha`, `/paro-emergencia` |
| WebSocket | El servidor empuja el estado | `ws://localhost:8030/ws` (cada 1 s; `?intervalo=2` para cada 2 s) |
| Server-Sent Events | El servidor empuja eventos | `GET /api/v1/stream` (`text/event-stream`) |
| Webhooks | ReactorLab llama a **tu** URL | `POST /api/v1/webhooks` con `{"url": …, "eventos": ["alarma"]}` |

Las **órdenes** (PUT/POST/DELETE) necesitan la cabecera `X-API-Key` (por defecto `reactorlab`, variable `REACTORLAB_API_KEY`). Sin ella la API responde **401**; con una clave incorrecta, **403**; con un valor fuera de rango, **422**; con una válvula en modo automático, **409**.

### Respuesta de `GET /api/v1/proceso`

```json
{
  "planta": "ReactorLab",
  "timestamp": "2026-11-10T02:31:33.326+00:00",
  "secuencia": 1532,
  "tiempo_proceso_h": 1.07,
  "estado": { "modo": "auto", "en_marcha": true, "paro_emergencia": false,
              "override_presion": false, "alarmas_activas": 0 },
  "medidas": {
    "presion_kpa": 2700.0, "nivel_pct": 44.18,
    "caudal_kmolh": { "f1": 201.43, "f2": 5.62, "purga": 7.05, "producto": 100.0 },
    "composicion_purga_pct": { "A": 47.0, "B": 14.29, "C": 38.71 },
    "coste_relativo": 0.2415
  },
  "valvulas": { "f1": { "posicion_pct": 31.45, "consigna_pct": 31.45 }, "…": "…" },
  "consignas": { "caudal_producto_kmolh": 100, "presion_kpa": 2700, "a_purga_pct": 47, "nivel_pct": 44 }
}
```

`GET /api/v1/medidas` devuelve lo mismo en formato plano (`presion_kpa`, `nivel_pct`, `caudal_f1_kmolh`, …, `coste_relativo`), cómodo para enviarlo tal cual a una plataforma IIoT.

### Alarmas y eventos

| Código | Condición | Severidad |
|---|---|---|
| `PRESION_ALTA` | presión > 2850 kPa (se borra < 2800) | MAJOR |
| `PRESION_MUY_ALTA` | presión > 2950 kPa (se borra < 2900) | CRITICAL |
| `NIVEL_ALTO` / `NIVEL_BAJO` | nivel > 80 % / < 15 % | MAJOR |
| `PRODUCCION_BAJA` | producto < 80 kmol/h | WARNING |

Eventos que se envían por SSE y webhooks: `alarma.activada`, `alarma.borrada`, `consigna.cambiada`, `estado.modo`, `estado.marcha`, `estado.paro_emergencia`, `averia.inyectada`, `averia.retirada`, `planta.reiniciada`. Los webhooks se guardan en el volumen `/data` (sobreviven a un reinicio) y registrar dos veces la misma URL la actualiza en lugar de duplicarla (200 en vez de 201). Listarlos (`GET /api/v1/webhooks`) también requiere la clave, y los tokens que vayan en la URL se muestran enmascarados. Un webhook se suscribe por prefijo (`"alarma"`, `"estado"`…). Con `"formato": "plano"` el cuerpo llega sin anidar (`alarma_codigo`, `alarma_valor`…). Con `"secreto"` se firma con HMAC-SHA256 en la cabecera `X-ReactorLab-Firma`.

### Averías (para el profesorado)

`POST /api/v1/averias` (con clave) o desde el panel *Averías* de la web:

| Tipo | Efecto | Ejemplo |
|---|---|---|
| `valvula_sucia` | la válvula pierde capacidad (Cv); el control la abre más | `{"tipo":"valvula_sucia","objetivo":"producto","valor":0.6}` |
| `valvula_atascada` | la válvula no se mueve | `{"tipo":"valvula_atascada","objetivo":"f2"}` |
| `valvula_lenta` | la válvula se mueve como mucho `valor` %/h | `{"tipo":"valvula_lenta","objetivo":"purga","valor":20}` |
| `sensor` | `modo` deriva / congelado / ruido / perdida | `{"tipo":"sensor","objetivo":"presion","modo":"deriva","valor":50}` |

La API siempre entrega los valores **medidos**: con un sensor averiado, el cliente ve el valor falso, igual que en una planta real.

## Vista 3D (GRFICS)

`http://localhost:8030/3d/` carga la escena Unity WebGL original de GRFICSv3 (nave con el reactor, tuberías y las cuatro válvulas con su posición). Se mueve con el ratón y WASD; TAB abre las opciones y ESC devuelve el cursor.

- Sus binarios ocupan unos **230 MB**, demasiado para el repositorio. El `Dockerfile` los descarga del commit fijado de GRFICSv3 y comprueba su SHA-256 ([`vista3d/descargar.py`](vista3d/descargar.py)). Sin Internet, o con `--build-arg VISTA_3D=0`, la imagen se construye sin ellos y la página lo indica; el resto de ReactorLab funciona igual.
- El navegador descarga la escena una vez y la guarda en su caché (IndexedDB).
- La escena consulta `GET /data/index.php`, que devuelve el estado en el formato de GRFICS (`outputs`, `state`, `measured`).

## Puesta en marcha

Con el laboratorio completo: `docker compose up -d reactorlab` desde la raíz del repositorio y abrir `http://localhost:8030`.

Por separado:

```bash
cd simuladores/reactorlab
python -m venv .venv && . .venv/bin/activate
pip install -r backend/requirements-dev.txt
python -m uvicorn app.main:app --app-dir backend --port 8030
python -m pytest backend/tests        # pruebas del modelo, el control y la API
```

## Prácticas

- Serie 1 · Node-RED + Dashboard: [`practicas/1-dashboard/reactorlab`](../../practicas/1-dashboard/reactorlab/README.md)
- Serie 2 · Node-RED + ThingsBoard: [`practicas/2-thingsboard/reactorlab`](../../practicas/2-thingsboard/reactorlab/README.md)
