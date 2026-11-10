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
| Software | SolarLab, Node-RED y ThingsBoard CE/Cloud |

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

- SolarLab funcionando.
- Node-RED 4 o 5.
- El módulo `node-red-contrib-opcua`.
- Una instancia de ThingsBoard CE o ThingsBoard Cloud.
- El flujo importable [solarlab-thingsboard-flow.json](flows/solarlab-thingsboard-flow.json).
- Puertos disponibles: `4840` para OPC UA, `1883` para MQTT y `8080` para ThingsBoard local.

> Para una instalación local, ThingsBoard recomienda al menos 4 GB de RAM para un entorno de desarrollo o prueba de concepto.

## Preparación del docente

1. Comprobar que SolarLab abre en `http://localhost:8000` y publica en:

   ```text
   opc.tcp://localhost:4840/solarlab/server/
   ```

2. Preparar ThingsBoard CE o facilitar las cuentas de ThingsBoard Cloud.
3. Verificar que Node-RED puede alcanzar tanto SolarLab como ThingsBoard.
4. No facilitar inicialmente el código de la avería que se utilizará en el reto final.

Si Node-RED, SolarLab y ThingsBoard están en contenedores o equipos diferentes, `localhost` no identifica el mismo ordenador. Se deberá emplear la IP o nombre DNS correspondiente. En Docker Desktop puede ser necesario usar `host.docker.internal` para acceder desde un contenedor al equipo anfitrión.

---

## Parte 1 · Arranque y reconocimiento del sistema

### 1.1 Iniciar SolarLab

Desde la carpeta del proyecto:

```powershell
.\scripts\run-dev.ps1
```

Abrir la interfaz y anotar:

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

Para ThingsBoard CE local, abrir `http://localhost:8080`. Si la instalación se realizó cargando datos de demostración, la cuenta de laboratorio habitual es:

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

### 3.1 Instalar los nodos OPC UA

1. Abrir Node-RED, normalmente en `http://localhost:1880`.
2. Menú principal → **Manage palette** → **Install**.
3. Buscar `node-red-contrib-opcua`.
4. Instalar el módulo y comprobar que aparecen los nodos `OpcUa-Item` y `OpcUa-Client`.

### 3.2 Importar el flujo

1. Menú principal → **Import**.
2. Seleccionar el archivo `flows/solarlab-thingsboard-flow.json`.
3. Importarlo como una pestaña nueva.
4. Antes de desplegar, revisar todos los nodos marcados con un triángulo rojo.

El flujo está dividido en tres zonas:

- **Adquisición OPC UA:** crea las suscripciones a las variables de SolarLab.
- **Transformación y publicación:** agrega valores, forma el JSON y lo publica por MQTT.
- **Mando OPC UA:** permite escribir consignas y códigos de avería.

### 3.3 Configurar el endpoint OPC UA

Abrir cualquiera de los nodos `OPC UA · Suscribir` o `OPC UA · Escribir` y editar su endpoint:

| Parámetro | Valor |
|---|---|
| Endpoint | `opc.tcp://localhost:4840/solarlab/server/` |
| Security policy | `None` |
| Security mode | `None` |
| Login | Desactivado |
| Keep session alive | Activado, si está disponible |

Mantener un intervalo de suscripción de `1 s`.

### 3.4 Configurar MQTT para ThingsBoard

Abrir el nodo `MQTT → ThingsBoard` y editar el servidor:

| Parámetro | ThingsBoard local | ThingsBoard Cloud |
|---|---|---|
| Servidor | `localhost` | Host indicado por ThingsBoard |
| Puerto | `1883` | `1883` o el puerto TLS indicado |
| TLS | No, solo laboratorio local | Según la plataforma |
| MQTT version | 3.1.1 |
| Username | El `Access token` del dispositivo | El `Access token` |
| Password | Vacío | Vacío |

El tema ya está configurado como `v1/devices/me/telemetry` y se utiliza QoS 1.

### 3.5 Desplegar y comprobar

1. Pulsar **Deploy**.
2. Pulsar una vez `INICIAR SUSCRIPCIONES`.
3. Abrir el panel **Debug**.
4. Comprobar que aparecen mensajes OPC UA y paquetes de telemetría.
5. En ThingsBoard, abrir el dispositivo → **Latest telemetry**.
6. Verificar que aparecen al menos estas claves:

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

Las versiones actuales de ThingsBoard permiten administrar las reglas desde **Alarms → Alarm rules** o desde la pestaña **Alarm Rules** del perfil/dispositivo, según la edición y versión.

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

El flujo contiene tres mandos manuales:

- `ESCRIBIR 900 W/m²` escribe un `Double` en `Controls.IrradianceSetpoint`.
- `AVERÍA INVERSOR Z02` escribe el `Int32` 2 en `Controls.FaultCode`.
- `QUITAR AVERÍA` escribe el `Int32` 0 en `Controls.FaultCode`.

### Procedimiento

1. Abrir simultáneamente SolarLab, Node-RED y el dashboard de ThingsBoard.
2. Pulsar `ESCRIBIR 900 W/m²`.
3. Comprobar en SolarLab que cambia la consigna y que el explorador registra un evento `WRITE`.
4. Comprobar cómo la potencia evoluciona y llega a ThingsBoard.
5. Inyectar y retirar la avería desde Node-RED.
6. Confirmar el ciclo de creación y borrado de la alarma.

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
- [Gestión de la paleta de Node-RED](https://nodered.org/docs/user-guide/editor/palette/manager)
- [node-red-contrib-opcua](https://www.npmjs.com/package/node-red-contrib-opcua)
- [ThingsBoard: primeros pasos](https://thingsboard.io/docs/getting-started/)
- [ThingsBoard MQTT Telemetry API](https://thingsboard.io/docs/reference/mqtt-api/telemetry/)
- [ThingsBoard: dispositivos](https://thingsboard.io/docs/user-guide/devices/)
- [ThingsBoard: alarmas](https://thingsboard.io/docs/user-guide/alarms/)
- [Instalación de ThingsBoard CE con Docker en Windows](https://thingsboard.io/docs/installation/docker-windows/)

