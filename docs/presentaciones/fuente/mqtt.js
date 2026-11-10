module.exports = {
  meta: { protocolo: "MQTT", sigla: "MQTT", titulo: "MQTT · Publicar y suscribirse", color1: "6A4C93", color2: "1982C4", archivo: "03_MQTT.pptx" },
  diapositivas: [
    { tipo: "portada", titulo: "MQTT", subtitulo: "Publicar y suscribirse: el mensajero ligero del IoT industrial",
      pie: "En el laboratorio: **OceanLab** (boyas) → **Mosquitto** (1883) y **ThingsBoard** (1883 interno)" },

    { tipo: "cifras", titulo: "Qué es MQTT",
      intro: "*Message Queuing Telemetry Transport*: nació para vigilar **oleoductos por satélite**, con enlaces lentos y caros. Hoy es el estándar de facto del IoT.",
      cifras: [{ valor: "1999", texto: "IBM y Arcom (Andy Stanford-Clark y Arlen Nipper)" }, { valor: "2 B", texto: "cabecera mínima de un mensaje" },
               { valor: "1883", texto: "puerto TCP (8883 con TLS)" }, { valor: "v5.0", texto: "estándar OASIS (2019); 3.1.1 es ISO/IEC 20922" }],
      nota: "MQTT no sabe nada de tu dato: transporta **bytes** con una etiqueta (el *topic*). Qué hay dentro (JSON, binario) lo decides tú." },

    { tipo: "seccion", numero: 1, titulo: "Publicar / suscribir", texto: "Un intermediario desacopla a quien produce de quien consume" },

    { tipo: "flujo", titulo: "El broker en el centro",
      nodos: [{ titulo: "Publicadores", texto: "Boyas de OceanLab, sensores, PLC" }, { titulo: "Broker", texto: "**Mosquitto** reparte cada mensaje a los suscritos", color: "6A4C93" },
              { titulo: "Suscriptores", texto: "Node-RED, la web de OceanLab, ThingsBoard" }],
      flechas: ["PUBLISH topic", "copia a cada suscrito"], hueco: 1.6,
      abajo: ["**Espacio**: el publicador no sabe quién recibe ni cuántos son.", "**Tiempo**: con sesiones persistentes y *retained*, el receptor puede no estar conectado.",
              "**Sincronía**: nadie espera respuesta. Todos los clientes abren la conexión **hacia** el broker (atraviesa bien los cortafuegos)."] },

    { tipo: "arbol", titulo: "Topics y comodines", anchoArbol: 5.8,
      arbol: "oceanlab/\n└─ buoys/\n   ├─ BOY-001/\n   │  └─ telemetry\n   ├─ BOY-002/\n   │  └─ telemetry\n   └─ …\n\nv1/devices/me/telemetry      (ThingsBoard)\nv1/devices/me/rpc/request/+\nv1/gateway/telemetry",
      puntos: ["Un **topic** es una ruta de texto con `/`. No hay que crearlo: existe al publicar.",
               "`+` sustituye **un nivel**: `oceanlab/buoys/+/telemetry` = todas las boyas.",
               "`#` sustituye **el resto**: `oceanlab/#` = todo lo de OceanLab.",
               "Los comodines solo valen para **suscribirse**, nunca para publicar.",
               "Buenas prácticas: de lo general a lo particular, sin espacios ni tildes, sin `/` inicial."] },

    { tipo: "secuencia", titulo: "Calidad de servicio (QoS)", anchoTexto: 4.6,
      actores: ["Publicador", "Broker"],
      mensajes: [{ de: 0, a: 1, texto: "QoS 0 · PUBLISH" }, { de: 0, a: 0, texto: "y se olvida" },
                 { de: 0, a: 1, texto: "QoS 1 · PUBLISH" }, { de: 1, a: 0, texto: "PUBACK", discontinua: true },
                 { de: 0, a: 1, texto: "QoS 2 · PUBLISH" }, { de: 1, a: 0, texto: "PUBREC", discontinua: true },
                 { de: 0, a: 1, texto: "PUBREL" }, { de: 1, a: 0, texto: "PUBCOMP", discontinua: true }],
      puntos: ["**QoS 0**: como mucho una vez. Rápido; se puede perder.", "**QoS 1**: al menos una vez. Puede **duplicarse**.",
               "**QoS 2**: exactamente una vez. Cuatro mensajes; el más lento.", "Se negocia **en cada tramo**: publicador→broker y broker→suscriptor.",
               "Telemetría frecuente: QoS 0 o 1. Órdenes: QoS 1 con identificador."] },

    { tipo: "tarjetas", titulo: "Más allá de publicar", columnas: 2,
      items: [
        { icono: "MdPushPin", titulo: "Retained", texto: "El broker guarda el **último** mensaje del topic y lo entrega al que se suscribe después. Ideal para estados." },
        { icono: "MdHeartBroken", titulo: "Last Will (testamento)", texto: "Mensaje que el broker publica **si el cliente desaparece** sin despedirse: «BOY-001 desconectada»." },
        { icono: "MdTimer", titulo: "Keep alive", texto: "El cliente envía PINGREQ si no tiene nada que decir; así el broker detecta conexiones muertas." },
        { icono: "MdHistory", titulo: "Sesión persistente", texto: "Con *clean session* = false, el broker guarda suscripciones y mensajes QoS 1/2 mientras el cliente está fuera." },
      ] },

    { tipo: "codigo", titulo: "El contenido: JSON (o lo que quieras)", anchoTexto: 5.0,
      puntos: ["El broker **no mira** el contenido.", "OceanLab envía **JSON** con la hora de medida (`timestamp`).",
               "Sin esquema común, cada fabricante inventa el suyo: hay que **traducir** en la pasarela.",
               "**Sparkplug B** (Eclipse) define topics, binario (Protobuf), nacimiento y muerte de dispositivos para la industria."],
      codigo: "Topic: oceanlab/buoys/BOY-001/telemetry\n\n{\n  \"buoy_id\": \"BOY-001\",\n  \"timestamp\": \"2026-11-10T09:40:20Z\",\n  \"sequence\": 1532,\n  \"weather\": {\n    \"water_temperature_c\": 14.2,\n    \"wave_height_m\": 2.7,\n    \"wind_speed_mps\": 11.4,\n    \"pressure_hpa\": 1009.8\n  },\n  \"device\": {\n    \"battery_pct\": 87,\n    \"signal_rssi_dbm\": -71,\n    \"status\": \"OK\"\n  }\n}" },

    { tipo: "seccion", numero: 2, titulo: "MQTT 5, seguridad y plataformas", texto: "Lo que añade la versión 5 y cómo lo usa ThingsBoard" },

    { tipo: "tarjetas", titulo: "Novedades de MQTT 5", columnas: 3,
      items: [
        { icono: "MdLabel", titulo: "Propiedades de usuario", texto: "Pares clave-valor en la cabecera: unidades, origen, versión." },
        { icono: "MdReply", titulo: "Petición-respuesta", texto: "*Response topic* y *correlation data* para órdenes con respuesta." },
        { icono: "MdHourglassBottom", titulo: "Caducidad", texto: "*Message expiry*: un dato viejo no se entrega." },
        { icono: "MdErrorOutline", titulo: "Códigos de motivo", texto: "El broker explica por qué rechaza: sin permiso, topic no válido…" },
        { icono: "MdGroups", titulo: "Suscripciones compartidas", texto: "`$share/grupo/topic`: reparto de carga entre varios consumidores." },
        { icono: "MdCompress", titulo: "Alias de topic", texto: "Un número sustituye a un topic largo: menos bytes." },
      ] },

    { tipo: "compara", titulo: "Seguridad en MQTT",
      columnas: [{ titulo: "Mecanismos", items: ["**Usuario y contraseña** en el CONNECT (ThingsBoard: el *access token*)", "**TLS** (puerto 8883) para cifrar y autenticar el broker", "**Certificados de cliente** X.509", "**ACL** por topic: quién puede publicar o suscribirse a qué"] },
                 { titulo: "En el laboratorio", items: ["Mosquitto **anónimo**, sin TLS: solo dentro de la red Docker", "ThingsBoard: token como *username*; sin él, conexión rechazada", "El token **no** va en los flujos exportados", "En planta: TLS, ACL y un usuario por dispositivo"] }] },

    { tipo: "tabla", titulo: "La API MQTT de ThingsBoard",
      cabecera: ["Topic", "Sentido", "Para qué"], anchos: [4.6, 2.6, 4.8],
      filas: [["`v1/devices/me/telemetry`", "→ ThingsBoard", "Medidas con histórico: `{ts, values}` o lista de ellas"],
              ["`v1/devices/me/attributes`", "→ ThingsBoard", "Datos fijos (ficha del equipo)"],
              ["`v1/devices/me/rpc/request/+`", "ThingsBoard →", "Órdenes desde un panel"],
              ["`v1/devices/me/rpc/response/{id}`", "→ ThingsBoard", "Respuesta a cada orden"],
              ["`v1/gateway/connect` · `telemetry`", "→ ThingsBoard", "Una pasarela que habla por muchos equipos"]],
      nota: "`me` = el dispositivo dueño del token con el que se conecta el cliente.", altoFila: 0.7 },

    { tipo: "seccion", numero: 3, titulo: "MQTT en el laboratorio", texto: "Un broker para todo el aula y Node-RED como pasarela" },

    { tipo: "flujo", titulo: "De la boya al panel",
      nodos: [{ titulo: "OceanLab", texto: "96 boyas publican cada 2 s" }, { titulo: "Mosquitto", texto: "Puerto 1883 y WebSocket 9001", color: "6A4C93" },
              { titulo: "Node-RED", texto: "**mqtt in** → traducir → **mqtt out**" }, { titulo: "ThingsBoard", texto: "Su propio MQTT (1883) con el token", color: "1982C4" }],
      flechas: ["publica", "suscribe", "publica"], hueco: 1.15,
      abajo: ["Hay **dos brokers** distintos: Mosquitto (datos de las boyas) y el MQTT interno de ThingsBoard.",
              "La web de OceanLab usa **MQTT sobre WebSocket** (puerto 9001) para pintar las boyas en el navegador.",
              "En la serie 2, una sola conexión de pasarela (**API de gateway**) crea un dispositivo por boya."] },

    { tipo: "codigo", titulo: "Probar desde la línea de comandos", anchoTexto: 4.6,
      puntos: ["`mosquitto_sub` y `mosquitto_pub` vienen con Mosquitto.", "**MQTT Explorer** muestra el árbol de topics en vivo.",
               "`-v` imprime el topic delante del mensaje.", "Desde fuera de Docker: `localhost:1883`."],
      codigo: "# todo lo que publican las boyas\nmosquitto_sub -h localhost -p 1883 \\\n  -t 'oceanlab/#' -v\n\n# solo la BOY-001\nmosquitto_sub -h localhost \\\n  -t 'oceanlab/buoys/BOY-001/telemetry'\n\n# publicar en ThingsBoard con un token\nmosquitto_pub -h localhost -p 1883 \\\n  -u 'TOKEN_DEL_DISPOSITIVO' \\\n  -t 'v1/devices/me/telemetry' \\\n  -m '{\"temperatura\": 21.5}'" },

    { tipo: "tabla", titulo: "Errores típicos",
      cabecera: ["Síntoma", "Causa probable", "Qué hacer"], anchos: [3.4, 4.2, 4.4],
      filas: [["El nodo se queda en *connecting*", "Host o puerto mal", "`mosquitto:1883` dentro de Docker"],
              ["*connected* pero no llega nada", "Topic mal escrito o comodín mal puesto", "Suscríbete a `oceanlab/#` y afina"],
              ["Llega texto, no objeto", "Salida del **mqtt in** en *auto* o *string*", "*Output*: **a parsed JSON object**"],
              ["ThingsBoard desconecta enseguida", "Token mal copiado o en *Password*", "El token va en **Username**"],
              ["Mensajes duplicados", "QoS 1 y reconexión", "Normal: usa `sequence` o `ts` para descartar"],
              ["Dos clientes se echan uno a otro", "Mismo **Client ID**", "Un Client ID distinto por conexión"]], altoFila: 0.66 },

    { tipo: "cierre", titulo: "Para recordar",
      puntos: ["MQTT es **publicar/suscribir** con un **broker** en medio.", "Los **topics** organizan; `+` y `#` filtran al suscribirse.",
               "**QoS**, *retained* y *last will* resuelven pérdidas y desconexiones.", "El contenido es libre: la pasarela **traduce** y añade la hora."] },
  ],
};
