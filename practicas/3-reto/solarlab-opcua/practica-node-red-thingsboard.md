# Práctica 03 · De OPC UA a ThingsBoard con Node-RED

## Ficha de la práctica

| Campo | Valor |
|---|---|
| Asignatura | Monitorización de Máquinas |
| Especialización | Digitalización del Mantenimiento |
| Duración estimada | 3 horas (2 sesiones de 90 minutos) |
| Agrupamiento | Parejas |
| Nivel | Intermedio |
| Protocolos | OPC UA y MQTT |
| Software | Laboratorio Docker: SolarLab, Node-RED y ThingsBoard CE 4.3 |

## Situación profesional

Una empresa explota un parque fotovoltaico. La red de operación utiliza OPC UA para comunicar los equipos de campo, pero el departamento de mantenimiento necesita centralizar datos históricos, cuadros de mando y alarmas en ThingsBoard.

El equipo de integración decide utilizar Node-RED como pasarela *edge*. Node-RED se suscribirá a las variables OPC UA de SolarLab, las transformará a un modelo de telemetría y las publicará en ThingsBoard mediante MQTT.

```text
SolarLab                    Node-RED                         ThingsBoard
┌──────────────┐ OPC UA     ┌──────────────────────┐ MQTT   ┌─────────────────┐
│ Parque FV    │───────────>│ Suscribir y agregar  │───────>│ Histórico       │
│ Puerto 4840  │            │ datos                │        │ Dashboard        │
│ Plant/Zones  │<───────────│ Escribir consignas   │        │ Alarmas          │
└──────────────┘ OPC UA     └──────────────────────┘        └─────────────────┘
```

## Resultados de aprendizaje

Al terminar, el alumnado será capaz de:

1. Identificar los papeles de servidor y cliente en OPC UA.
2. Configurar una suscripción OPC UA con varios `MonitoredItems`.
3. Diferenciar el Namespace URI del índice de namespace.
4. Transformar datos industriales a un mensaje de telemetría JSON.
5. Publicar telemetría en ThingsBoard mediante MQTT y un *access token*.
6. Construir un dashboard con series temporales y estados.
7. Configurar una alarma con condición de creación y de borrado.
8. Escribir una consigna OPC UA desde Node-RED y comprobar su efecto físico simulado.

## Material necesario

- El laboratorio arrancado (`docker compose up -d` o `start_lab.cmd`): SolarLab, Node-RED y ThingsBoard.
- Node-RED en `http://localhost:1880`; la paleta `node-red-contrib-opcua` ya está instalada.
- ThingsBoard en `http://localhost:8080` (`tenant@thingsboard.org` / `tenant` o la cuenta que dé el profesor).
- Flujo inicial [solarlab-starter-flow.json](flows/solarlab-starter-flow.json) (también en **Import → Local → LabMonitorizacion → alumnado**). Solo trae la adquisición OPC UA: la transformación, la publicación y los mandos los construyes tú.

| Parámetro | Valor en el laboratorio |
|---|---|
| Endpoint OPC UA (desde Node-RED) | `opc.tcp://solarlab:4840/solarlab/server/`, *Security* `None` |
| Web de SolarLab | `http://localhost:8000` |
| MQTT de ThingsBoard (desde Node-RED) | host `thingsboard`, puerto `1883` |
| Web de ThingsBoard | `http://localhost:8080` |

> Dentro de Docker cada servicio se llama por su nombre (`solarlab`, `thingsboard`); desde el navegador se usa `localhost`. Desde un cliente instalado en tu ordenador (UaExpert), el endpoint es `opc.tcp://localhost:4840/solarlab/server/`.

## Preparación del docente

1. Comprobar que SolarLab abre en `http://localhost:8000` y que su explorador OPC UA muestra el servidor en marcha.
2. Comprobar que ThingsBoard está instalado (el primer arranque tarda unos minutos) y repartir las cuentas.
3. No facilitar inicialmente el código de la avería que se utilizará en el reto final.

La solución está en [solucion-practica-node-red-thingsboard.md](solucion-practica-node-red-thingsboard.md) y el flujo resuelto en [flows/solarlab-thingsboard-flow.json](flows/solarlab-thingsboard-flow.json).

---

## Parte 1 · Arranque y reconocimiento del sistema

### 1.1 Reconocer SolarLab

Abrir `http://localhost:8000` y anotar:

- endpoint OPC UA;
- Namespace URI;
- índice de namespace mostrado;
- potencia activa inicial;
- número de zonas del parque.

### 1.2 Identificar los nodos de trabajo

Localizar en el explorador integrado los siguientes nodos:

| Variable | NodeId esperado | Tipo | Acceso |
|---|---|---|---|
| Potencia activa | `ns=2;s=Plant.ActivePower` | Double | Lectura |
| Irradiancia | `ns=2;s=Plant.Irradiance` | Double | Lectura |
| Temperatura de panel | `ns=2;s=Plant.PanelTemperature` | Double | Lectura |
| Frecuencia de red | `ns=2;s=Plant.GridFrequency` | Double | Lectura |
| Performance ratio | `ns=2;s=Plant.PerformanceRatio` | Double | Lectura |
| Disponibilidad | `ns=2;s=Plant.Availability` | Double | Lectura |
| Alarma activa | `ns=2;s=Plant.AlarmActive` | Boolean | Lectura |
| Potencia zona 02 | `ns=2;s=Zone02.ActivePower` | Double | Lectura |
| Consigna de irradiancia | `ns=2;s=Controls.IrradianceSetpoint` | Double | Lectura/Escritura |
| Código de avería | `ns=2;s=Controls.FaultCode` | Int32 | Lectura/Escritura |

El índice `ns=2` es habitual, pero no forma parte de la identidad permanente del modelo. Si SolarLab muestra otro índice, debe sustituirse en todos los nodos del flujo. La identidad estable es el Namespace URI `urn:solarlab:parque-fotovoltaico`.

### Cuestiones 1

1. ¿Por qué una aplicación industrial no debería asumir que el índice siempre será `2`?
2. ¿Qué diferencia hay entre `BrowseName`, `DisplayName` y `NodeId`?
3. ¿Qué nodos pueden modificarse y qué atributo OPC UA informa de ello?

---

## Parte 2 · Crear el dispositivo en ThingsBoard

### 2.1 Acceder a la plataforma

Abrir `http://localhost:8080`. El laboratorio instala ThingsBoard con los datos de demostración; la cuenta habitual es:

```text
Usuario: tenant@thingsboard.org
Contraseña: tenant
```

Estas credenciales son únicamente para laboratorio y deben cambiarse antes de exponer la plataforma a una red.

### 2.2 Crear el dispositivo

1. Ir a **Entities → Devices**.
2. Pulsar **Add device**.
3. Nombre: `Parque Solar SolarLab`.
4. Tipo o perfil: `Parque fotovoltaico` si se ha creado previamente; en caso contrario, utilizar el perfil por defecto.
5. No activar **Is gateway**: para esta práctica SolarLab se representará como un único dispositivo.
6. Guardar el dispositivo.
7. Abrir **Manage credentials** y copiar el `Access token`.

No incluir el token en capturas, informes ni repositorios. ThingsBoard utiliza este token como nombre de usuario MQTT para autenticar el dispositivo.

### 2.3 Prueba de conectividad conceptual

El tema estándar de telemetría que utilizará Node-RED es:

```text
v1/devices/me/telemetry
```

El mensaje que se espera publicar tendrá esta forma:

```json
{
  "ts": 1783958400000,
  "values": {
    "activePowerKw": 3245.7,
    "irradianceWm2": 754.2,
    "panelTemperatureC": 46.1,
    "gridFrequencyHz": 50.01,
    "performanceRatioPct": 87.3,
    "availabilityPct": 100,
    "alarmActive": false,
    "zone02PowerKw": 805.4
  }
}
```

`ts` es tiempo Unix en milisegundos. Al enviarlo, ThingsBoard conserva el instante de adquisición indicado por Node-RED; si se omite, utiliza el instante de recepción en el servidor.

---

## Parte 3 · Configurar Node-RED como pasarela OPC UA

### 3.1 Importar el flujo inicial

1. Menú principal → **Import** → `flows/solarlab-starter-flow.json` (o **Local → LabMonitorizacion → alumnado → Reto SolarLab OPC UA - inicial**).
2. Importarlo como una pestaña nueva.

Trae la zona **1 · Adquisición OPC UA** completa: un **inject** `INICIAR SUSCRIPCIONES`, ocho **OpcUa-Item** (los de la tabla 1.2 que empiezan por `Plant` y `Zone02`), un **OpcUa-Client** `OPC UA · Suscribir` y un **debug**.

### 3.2 Comprobar el endpoint OPC UA

Abrir el nodo `OPC UA · Suscribir` y revisar su endpoint:

| Parámetro | Valor |
|---|---|
| Endpoint | `opc.tcp://solarlab:4840/solarlab/server/` |
| Security policy | `None` |
| Security mode | `None` |
| Login | Desactivado |
| Action | `SUBSCRIBE`, intervalo `1 s` |

**Deploy**, pulsar `INICIAR SUSCRIPCIONES` y comprobar en **Debug** que llega un mensaje por cada variable que cambia: `msg.topic` es el NodeId y `msg.payload` el valor.

### 3.3 Transformar a telemetría

Crear en la zona **2** un nodo `function` llamado `OPC UA → Telemetría`, conectado al cliente. Requisitos:

1. Traducir el NodeId a estas claves de ThingsBoard:

   | NodeId | Clave |
   |---|---|
   | `Plant.ActivePower` | `activePowerKw` |
   | `Plant.Irradiance` | `irradianceWm2` |
   | `Plant.PanelTemperature` | `panelTemperatureC` |
   | `Plant.GridFrequency` | `gridFrequencyHz` |
   | `Plant.PerformanceRatio` | `performanceRatioPct` |
   | `Plant.Availability` | `availabilityPct` |
   | `Plant.AlarmActive` | `alarmActive` |
   | `Zone02.ActivePower` | `zone02PowerKw` |

2. Ignorar los mensajes cuyo NodeId no esté en la tabla (el cliente también emite avisos propios, por ejemplo `subscriptionId`).
3. Si el valor llega envuelto (`{ value: … }`), extraer el número o booleano.
4. Guardar el último valor de cada clave en el contexto del flujo y emitir **todas** las claves conocidas en un mensaje `{ ts, values }`, con `ts` = `Date.now()`.
5. No convertir números en cadenas ni añadir unidades al valor.

Después, un nodo `delay` en modo *Rate Limit*: **1 mensaje por segundo**, descartando los intermedios.

### 3.4 Publicar en ThingsBoard

Un nodo `mqtt out` conectado al `delay`, con un servidor nuevo:

| Parámetro | Valor |
|---|---|
| Servidor | `thingsboard` |
| Puerto | `1883` |
| MQTT version | 3.1.1 |
| Username | El `Access token` del dispositivo |
| Password | Vacío |
| Topic | `v1/devices/me/telemetry` |
| QoS | 1 |

### 3.5 Desplegar y comprobar

1. Pulsar **Deploy** y después `INICIAR SUSCRIPCIONES`.
2. En ThingsBoard, abrir el dispositivo → **Latest telemetry**.
3. Verificar que aparecen las ocho claves:

   ```text
   activePowerKw
   irradianceWm2
   panelTemperatureC
   gridFrequencyHz
   performanceRatioPct
   availabilityPct
   alarmActive
   zone02PowerKw
   ```

### Cuestiones 2

1. ¿Qué diferencia existe entre leer cada segundo y crear una suscripción con intervalo de 1 segundo?
2. ¿Cuál es la función del `OpcUa-Item` y cuál la del `OpcUa-Client`?
3. ¿Por qué se limita la salida MQTT a un mensaje por segundo aunque lleguen varios cambios OPC UA?
4. ¿Qué información semántica de OPC UA se pierde al publicar únicamente pares clave-valor por MQTT?

---

## Parte 4 · Construir el dashboard

### 4.1 Crear el dashboard

1. Ir a **Dashboards** → **Add dashboard**.
2. Nombre: `Operación Parque Solar`.
3. Abrir el dashboard y activar el modo edición.
4. Añadir un alias de entidad llamado `SolarLab` que apunte al dispositivo `Parque Solar SolarLab`.

### 4.2 Añadir widgets

Crear como mínimo:

| Widget | Clave | Configuración sugerida |
|---|---|---|
| Tarjeta de valor | `activePowerKw` | Título `Potencia activa`, unidad `kW`, 1 decimal |
| Tarjeta de valor | `irradianceWm2` | Unidad `W/m²` |
| Serie temporal | `activePowerKw`, `irradianceWm2` | Ventana de 15 minutos, dos ejes si está disponible |
| Serie temporal | `panelTemperatureC` | Unidad `°C` |
| Indicador | `performanceRatioPct` | Rango 0–100 % |
| Indicador | `availabilityPct` | Rango 0–100 % |
| Estado booleano | `alarmActive` | Verde para `false`, rojo para `true` |
| Comparación | `activePowerKw`, `zone02PowerKw` | Ventana de 15 minutos |

Organizar los widgets para que un técnico pueda responder en menos de 30 segundos:

- ¿Cuánto produce la planta?
- ¿Existe alguna alarma?
- ¿La pérdida de producción se debe al recurso solar o a una indisponibilidad?
- ¿La zona 02 se comporta igual que el conjunto?

### 4.3 Experimentar con el proceso

Desde SolarLab:

1. Cambiar la irradiancia de 760 a 1.000 W/m².
2. Aumentar la nubosidad al 70 %.
3. Aumentar la suciedad al 25 %.
4. Observar cada cambio en Node-RED y ThingsBoard.

Registrar para cada caso el tiempo aproximado transcurrido entre el cambio en SolarLab y su visualización en ThingsBoard.

---

## Parte 5 · Alarmas de mantenimiento

### 5.1 Crear una alarma de indisponibilidad

En ThingsBoard, crear una regla de alarma para el dispositivo o, preferiblemente, para su perfil:

| Parámetro | Valor |
|---|---|
| Nombre/tipo | `Indisponibilidad FV` |
| Severidad | Major |
| Clave | `availabilityPct` |
| Condición de creación | valor menor que `100` |
| Condición de borrado | valor igual o mayor que `100` |

En ThingsBoard 4.3 las reglas se crean en **Alarms → Alarm rules** o en la pestaña **Alarm rules** del dispositivo o de su perfil. El argumento es de tipo **Latest telemetry**.

### 5.2 Verificar el ciclo de vida

1. En SolarLab, inyectar `Disparo inversor Z02`.
2. Confirmar que `availabilityPct` baja a 75 %.
3. Comprobar que ThingsBoard crea la alarma.
4. Reconocer la alarma como si se tratase de un operador.
5. Quitar la avería.
6. Verificar que la alarma pasa a estado borrado cuando la disponibilidad vuelve al 100 %.

### 5.3 Alarma complementaria

Crear otra regla a elección del grupo:

- `Temperatura de panel alta` cuando `panelTemperatureC > 60` °C;
- `Frecuencia de red anómala` fuera del intervalo 49,9–50,1 Hz;
- `PR bajo` cuando `performanceRatioPct < 70` % y `irradianceWm2 > 500` W/m².

La tercera opción es más representativa del mantenimiento basado en condición porque combina contexto operativo y rendimiento.

---

## Parte 6 · Escritura OPC UA desde Node-RED

Construir en la zona **3** del flujo tres mandos manuales:

| Botón (**inject**) | NodeId | Tipo | Valor |
|---|---|---|---|
| `ESCRIBIR 900 W/m²` | `ns=2;s=Controls.IrradianceSetpoint` | `Double` | `900` |
| `AVERÍA INVERSOR Z02` | `ns=2;s=Controls.FaultCode` | `Int32` | `2` |
| `QUITAR AVERÍA` | `ns=2;s=Controls.FaultCode` | `Int32` | `0` |

Cada **inject** envía el valor como `msg.payload` (número) a un **OpcUa-Item** con el NodeId y el tipo de la tabla; los items van a un **OpcUa-Client** nuevo con **Action** `WRITE` y el mismo endpoint, seguido de un **debug**.

### Procedimiento

1. Abrir simultáneamente SolarLab, Node-RED y el dashboard de ThingsBoard.
2. Pulsar `ESCRIBIR 900 W/m²`.
3. Comprobar en SolarLab que cambia la consigna y que el explorador registra un evento `WRITE`.
4. Comprobar cómo la potencia evoluciona y llega a ThingsBoard.
5. Inyectar y retirar la avería desde Node-RED.
6. Confirmar el ciclo de creación y borrado de la alarma.
7. Al terminar, dejar la irradiancia en `760 W/m²` y sin avería.

### Cuestiones 3

1. ¿Qué ocurriría al intentar escribir una cadena de texto en un nodo `Double`?
2. ¿Por qué `Plant.ActivePower` no admite escritura?
3. ¿Qué controles de seguridad y autorización serían necesarios antes de permitir esta orden en una instalación real?
4. ¿Qué diferencias existen entre la orden, el estado confirmado y la variable de proceso resultante?

---

## Reto final · Diagnóstico sin información previa

El docente inyectará una avería sin indicar cuál es. Cada pareja deberá:

1. Detectar la anomalía desde ThingsBoard, sin mirar inicialmente SolarLab.
2. Determinar si el problema afecta al recurso solar, a toda la planta o a una zona.
3. Identificar la causa probable utilizando al menos tres variables.
4. Documentar el recorrido del dato desde el nodo OPC UA hasta el widget.
5. Proponer una orden de trabajo de mantenimiento.

## Entregables

1. Captura del flujo Node-RED desplegado y sin errores.
2. Captura de `Latest telemetry` con las ocho claves solicitadas.
3. Captura del dashboard en operación normal y con avería.
4. Captura de una alarma activa y posteriormente borrada.
5. Exportación del flujo Node-RED del grupo.
6. Informe breve, máximo cuatro páginas, con respuestas y diagnóstico final.

El token del dispositivo debe ocultarse en todas las capturas y eliminarse de cualquier exportación compartida.

## Rúbrica de evaluación

| Criterio | Peso | Excelente | Suficiente | Insuficiente |
|---|---:|---|---|---|
| Conexión y modelo OPC UA | 20 % | Justifica endpoint, namespace, tipos y accesos | Conecta y localiza los nodos | Confunde NodeIds o no conecta |
| Flujo Node-RED | 25 % | Suscripción, transformación y control robustos | Publica la mayoría de variables | Flujo incompleto o basado solo en lecturas manuales |
| ThingsBoard | 20 % | Telemetría correcta y dashboard operativo | Recibe datos y muestra widgets básicos | No persiste o no visualiza datos |
| Alarmas | 15 % | Creación, reconocimiento y borrado verificados | La alarma se activa | Regla sin funcionamiento demostrable |
| Diagnóstico | 15 % | Argumentado con contexto y tres o más variables | Identifica razonablemente la avería | Conclusión sin evidencias |
| Documentación y seguridad | 5 % | Clara, reproducible y sin secretos expuestos | Entrega comprensible | Faltan evidencias o se expone el token |

## Preguntas de ampliación

1. Diseñar una solución para no depender de que el namespace sea `ns=2`.
2. Comparar MQTT QoS 0, 1 y 2 para este caso de mantenimiento.
3. Proponer cómo representar cada zona como un dispositivo independiente usando la Gateway API de ThingsBoard.
4. Añadir un indicador de calidad OPC UA y evitar publicar valores con `StatusCode` incorrecto.
5. Comparar la pasarela Node-RED con ThingsBoard IoT Gateway.

## Referencias

- [Documentación de Node-RED](https://nodered.org/docs/)
- [node-red-contrib-opcua](https://www.npmjs.com/package/node-red-contrib-opcua)
- [ThingsBoard: primeros pasos](https://thingsboard.io/docs/getting-started/)
- [ThingsBoard MQTT Telemetry API](https://thingsboard.io/docs/reference/mqtt-api/telemetry/)
- [ThingsBoard: dispositivos](https://thingsboard.io/docs/user-guide/devices/)
- [ThingsBoard: alarmas](https://thingsboard.io/docs/user-guide/alarms/)

