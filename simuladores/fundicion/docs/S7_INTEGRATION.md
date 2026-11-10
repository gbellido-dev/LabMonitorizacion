# Integración Siemens S7 del gemelo digital

El simulador calcula sus señales con un motor de proceso (`opcua/motor.mjs`) y publica en cada activo, bajo `TagsS7`, el valor que tendría cada dirección de su PLC (por ejemplo `IF-01.TagsS7.Metal.Temp` = `DB10.DBD0`). Su modelo de datos está preparado para sustituir la simulación por señales reales sin cambiar la interfaz 3D.

## El PLC S7 simulado del laboratorio

El servicio `fundicion-s7` ([`s7/plc_s7.py`](../s7/plc_s7.py), puerto **102**, rack 0, slot 1) es un PLC S7 simulado
(protocolo S7comm, librería `python-snap7`). Lee el proceso del servidor OPC UA y escribe cada señal de las carpetas
`TagsS7` en el bloque de datos y la dirección de su propiedad `DireccionS7`:

| Formato | Tipo S7 | Bytes | Ejemplo | Señal |
|---|---|---|---|---|
| `DBn.DBDx` | `REAL` (IEEE 754, big-endian) | 4 | `DB10.DBD0` | IF-01 `Metal.Temp` |
| `DBn.DBWx` | `WORD` | 2 | `DB90.DBW4` | IF-02 `Alarm.Word` (bit 0 sobrepresión, bit 1 sobretemperatura) |
| `DBn.DBXx.y` | `BOOL` (bit *y* del byte *x*) | — | `DB11.DBX12.0` | IF-01 `ReadyToPour` |

Mapa completo (44 señales en 25 DB):

| Activo | Señales |
|---|---|
| IF-01 | `Metal.Temp` DB10.DBD0 · `Coil.Power` DB10.DBD8 · `Tilt.Angle` DB11.DBD4 · `ReadyToPour` DB11.DBX12.0 |
| IF-02 | `Metal.Temp` DB10.DBD20 · `Coil.Power` DB10.DBD28 · `Cooling.Flow` DB12.DBD0 · `Alarm.Word` DB90.DBW4 |
| MP-01 | `Cycle.Time` DB20.DBD0 · `Press.Force` DB20.DBD8 · `Sand.Moisture` DB21.DBD4 · `Mould.OK` DB22.DBX0.2 |
| MP-02 | `Cycle.Time` DB20.DBD20 · `Press.Force` DB20.DBD28 · `Sand.Density` DB21.DBD16 · `Mould.OK` DB22.DBX0.3 |
| ROB-03 | `Axis.J1..J6` DB25.DBD0 · `Grip.Closed` DB25.DBX28.0 · `Core.Present` DB25.DBX28.1 · `Cell.Safe` DB26.DBX0.0 |
| COL-01 | `Ladle.Weight` DB30.DBD0 · `Pour.Temp` DB30.DBD8 · `Flow.Rate` DB31.DBD0 · `Safety.Zone` DB32.DBX1.0 |
| ROB-01 | `Axis.J1..J6` DB35.DBD0 · `TCP.Speed` DB35.DBD24 · `Program.No` DB35.DBW30 · `Cell.Safe` DB36.DBX0.0 |
| ENF-01 | `Mould.Temp` DB40.DBD0 · `Residence.Time` DB40.DBD8 · `Fan.Speed` DB41.DBD0 · `Exit.Ready` DB42.DBX0.0 |
| DES-01 | `Vib.Frequency` DB50.DBD0 · `Motor.Current` DB50.DBD8 · `Dust.FilterDP` DB51.DBD4 · `Part.Present` DB52.DBX0.0 |
| ROB-02 | `Axis.J1..J6` DB55.DBD0 · `Payload.Kg` DB55.DBD24 · `Pick.Count` DB55.DBD28 · `Cell.Safe` DB56.DBX0.0 |
| QC-01 | `Scan.Deviation` DB60.DBD0 · `Part.Weight` DB60.DBD8 · `Defect.Class` DB61.DBW0 · `Part.Accepted` DB62.DBX0.0 |

**Bloque de órdenes DB100** (escribible desde un cliente S7):

| Dirección | Tipo | Orden |
|---|---|---|
| `DB100.DBW0` | `INT` | código de avería (0–7) → `ns=1;s=Mantenimiento.Averia` |
| `DB100.DBW2` | `INT` | velocidad de simulación (1–20) → `ns=1;s=Simulacion.Velocidad` |

Desde Node-RED (paleta `node-red-contrib-s7`, ya instalada): **s7 endpoint** con dirección `fundicion-s7`, puerto 102,
rack 0, slot 1, y variables con la sintaxis de la paleta, por ejemplo `DB10,REAL0`, `DB11,X12.0`, `DB90,WORD4`.

> Un `REAL` S7 tiene 32 bits: `1475,8` llega como `1475.800048828125`. Por OPC UA la misma variable es un `Double`
> con nombre y unidad. Es una de las diferencias que se ven en la práctica.

En una planta real habría un PLC por célula (`PLC-FUS-01`, `PLC-MOL-01`…, ver la variable `PLC` de cada activo);
aquí un único PLC simulado contiene los DB de todos. La dirección de los datos también está invertida respecto a una
planta real (allí el PLC es la fuente y el servidor OPC UA, el que publica): el simulador calcula el proceso una sola
vez y lo ofrece por los dos protocolos.

## Arquitectura recomendada

```text
PLC S7-1500 / ET200SP
  │  S7comm Plus u OPC UA (red OT)
  ▼
Gateway industrial en DMZ
  │  normalización, buffer, control de acceso y TLS
  ├── WebSocket → telemetría rápida para la escena 3D
  ├── MQTT Sparkplug B → estados, eventos y alarmas
  └── API/Historiador → tendencias, lotes, OEE y trazabilidad
```

El navegador no debe abrir una conexión S7 directa al PLC. El gateway puede ejecutarse en Siemens Industrial Edge, IPC industrial, Node-RED o un servicio propio con `snap7`/`nodes7`. Para proyectos nuevos es preferible OPC UA cuando la CPU y la licencia lo permiten; S7 nativo es válido dentro de la red OT cuando ya existe ese estándar.

## Contrato mínimo de datos

Cada lectura enviada al gemelo digital debe incluir:

```json
{
  "assetId": "if-01",
  "tag": "Metal.Temp",
  "value": 1487.2,
  "unit": "°C",
  "quality": "GOOD",
  "sourceTimestamp": "2026-07-13T14:32:18.084Z",
  "sequence": 842109
}
```

Frecuencias sugeridas:

- movimiento, posición y estados rápidos: 100–250 ms;
- variables de proceso: 1 s;
- energía y mantenimiento: 5–10 s;
- alarmas y cambios de estado: por evento;
- recetas, lotes y resultados de calidad: por transacción.

## Seguridad y escritura

- Segmentar OT/IT según IEC 62443 y situar el gateway en una DMZ industrial.
- Empezar en modo de solo lectura.
- Separar cualquier escritura en un servicio autorizado con lista permitida, límites, confirmación y auditoría.
- No exponer direcciones IP, rack/slot ni credenciales del PLC al cliente web.
- Mantener un buffer local de al menos 24 horas y reenviar los datos al recuperar la conexión.

## Puesta en marcha

1. Validar el listado de activos y tags con automatización.
2. Crear bloques DB optimizados para intercambio o publicar nodos OPC UA.
3. Configurar el gateway y verificar escalas, unidades, calidad y timestamp.
4. Conectar primero un PLC de pruebas o PLCSIM Advanced.
5. Comparar durante un turno los valores del SCADA y del gemelo digital.
6. Activar producción en solo lectura y después, si es imprescindible, diseñar las escrituras seguras.
