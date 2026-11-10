# Integración Siemens S7 del gemelo digital

El simulador trabaja ahora con telemetría sintética, pero su modelo de datos está preparado para sustituirla por señales reales sin cambiar la interfaz 3D.

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
