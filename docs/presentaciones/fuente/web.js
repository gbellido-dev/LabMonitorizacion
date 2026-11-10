module.exports = {
  meta: { protocolo: "Protocolos web", sigla: "HTTP", titulo: "Protocolos web en la industria: REST, WebSocket, SSE y webhooks", color1: "1F5F8B", color2: "E76F51",
          archivo: "04_Protocolos_web.pptx" },
  diapositivas: [
    { tipo: "portada", titulo: "Protocolos web en la industria", subtitulo: "REST, WebSocket, Server-Sent Events y webhooks: las máquinas que hablan como una aplicación",
      pie: "En el laboratorio: **ReactorLab** (8030) · API HTTP de **ThingsBoard** · puente WebSocket de la **Fundición** (8081)" },

    { tipo: "tarjetas", titulo: "Por qué la web llega a la planta", columnas: 3,
      items: [
        { icono: "MdSync", titulo: "Convergencia IT/OT", texto: "Los mismos equipos y personas gestionan oficina y planta. HTTP y JSON los conoce todo el mundo." },
        { icono: "MdApi", titulo: "Equipos con API", texto: "Robots, analizadores, inversores y PLC modernos ofrecen una **API REST** además de sus protocolos de campo." },
        { icono: "MdCloud", titulo: "Nube y móvil", texto: "Las plataformas IIoT (ThingsBoard, AWS, Azure) reciben datos por HTTP y avisan por webhooks." },
      ],
      nota: "Lo que cambia respecto a Modbus u OPC UA no es el cable, sino **quién inicia** la comunicación y **cómo se protege**: de eso trata esta presentación." },

    { tipo: "seccion", numero: 1, titulo: "HTTP y REST", texto: "Peticiones, respuestas, recursos y códigos de estado" },

    { tipo: "compara", titulo: "Una petición y su respuesta",
      columnas: [{ titulo: "Petición del cliente", items: ["**Método**: `GET`, `PUT`, `POST`, `DELETE`", "**URL**: `http://reactorlab:8030/api/v1/consignas`", "**Cabeceras**: `Content-Type: application/json`, `X-API-Key: …`", "**Cuerpo** (opcional): `{ \"presion_kpa\": 2750 }`"] },
                 { titulo: "Respuesta del servidor", items: ["**Código de estado**: `200`, `401`, `422`…", "**Cabeceras**: tipo de contenido, tamaño, caché", "**Cuerpo**: el JSON con los datos o el motivo del error", "La conexión puede reutilizarse (*keep-alive*)"] }],
      conclusion: "HTTP es **sin estado**: cada petición lleva todo lo necesario (incluida la clave)." },

    { tipo: "tabla", titulo: "REST: recursos y métodos",
      intro: "En REST cada cosa es un **recurso** con su URL y se manipula con los métodos de HTTP:",
      cabecera: ["Método", "Significado", "Ejemplo en ReactorLab", "¿Idempotente?"], anchos: [1.4, 3, 5, 2],
      filas: [["`GET`", "Leer", "`GET /api/v1/proceso`", "Sí"], ["`PUT`", "Sustituir o fijar un valor", "`PUT /api/v1/consignas`", "Sí"],
              ["`POST`", "Crear o ejecutar", "`POST /api/v1/paro-emergencia`", "No (en general)"], ["`DELETE`", "Borrar", "`DELETE /api/v1/averias`", "Sí"]],
      nota: "Idempotente: repetir la petición deja el sistema igual. Por eso el alta de webhooks de ReactorLab devuelve 200 si ya existía.", altoFila: 0.65 },

    { tipo: "tabla", titulo: "Códigos de estado",
      cabecera: ["Código", "Significa", "Cuándo lo verás en el laboratorio"], anchos: [1.4, 4, 6.6],
      filas: [["`200` / `201`", "Correcto / creado", "Lectura de ReactorLab, alta de un webhook nuevo"], ["`401`", "Falta la credencial", "Orden sin cabecera `X-API-Key`"],
              ["`403`", "Credencial no válida", "Clave incorrecta"], ["`404`", "No existe", "URL mal escrita"],
              ["`409`", "Conflicto con el estado", "Mover una válvula que está en automático; barras AR en automático (AtomLab)"],
              ["`422`", "Datos no válidos", "Consigna fuera de rango, JSON mal formado"], ["`408` / `5xx`", "Tiempo agotado / error del servidor", "Long polling de ThingsBoard sin órdenes / fallo interno"]],
      altoFila: 0.56 },

    { tipo: "lista", titulo: "Autenticación y protección",
      puntos: ["**Clave de API** en una cabecera: `X-API-Key: reactorlab` (ReactorLab).", "**Token en la URL**: `/api/v1/{TOKEN}/telemetry` (API de dispositivos de ThingsBoard).",
               "**Bearer / JWT**: `Authorization: Bearer eyJ…` (API REST de ThingsBoard para usuarios).",
               "Siempre **HTTPS** fuera del laboratorio: si no, la clave viaja en claro.", "Una clave en un flujo exportado es una clave **publicada**: usa credenciales o variables de entorno."],
      destacado: { icono: "MdKey", titulo: "Leer es libre, mandar no", texto: "En ReactorLab, `GET` no pide clave; `PUT`, `POST` y `DELETE` sí. Separar lectura y escritura es el primer nivel de protección." } },

    { tipo: "seccion", numero: 2, titulo: "Del polling al push", texto: "Cuatro formas de recibir datos por la web" },

    { tipo: "tabla", titulo: "¿Quién inicia la comunicación?",
      cabecera: ["Patrón", "Cómo funciona", "Ventaja", "Inconveniente"], anchos: [2.2, 4.3, 2.8, 2.8],
      filas: [["Polling", "El cliente pide cada X segundos", "Sencillo, sin estado", "Retraso y tráfico inútil"],
              ["Long polling", "La petición espera hasta que hay algo (o caduca)", "Casi tiempo real con HTTP normal", "Una conexión abierta por cliente"],
              ["SSE", "El servidor envía eventos por una respuesta que no termina", "Simple, reconecta solo", "Solo servidor → cliente"],
              ["WebSocket", "Canal bidireccional permanente", "Tiempo real en los dos sentidos", "Hay que gestionar la conexión"],
              ["Webhook", "El servidor hace un `POST` a **tu** URL", "Sin conexión abierta", "Tú tienes que ser servidor y estar accesible"]],
      altoFila: 0.7 },

    { tipo: "secuencia", titulo: "WebSocket", anchoTexto: 4.8,
      actores: ["Node-RED", "ReactorLab"],
      mensajes: [{ de: 0, a: 1, texto: "GET /ws · Upgrade: websocket" }, { de: 1, a: 0, texto: "101 Switching Protocols", discontinua: true },
                 { de: 1, a: 0, texto: "{estado…} (cada 1 s)", discontinua: true }, { de: 1, a: 0, texto: "{estado…}", discontinua: true },
                 { de: 1, a: 0, texto: "{estado…}", discontinua: true }, { de: 0, a: 1, texto: "(podría enviar también)" }],
      puntos: ["Empieza como HTTP y se **convierte** (`101`).", "URL `ws://` o `wss://` (con TLS).", "Los mensajes son **texto**: en Node-RED hay que pasarlos por un nodo **json**.",
               "Lo usan la web de ReactorLab, la de AtomLab (`/ws`) y el puente de la Fundición."] },

    { tipo: "codigo", titulo: "Server-Sent Events", anchoTexto: 5.2,
      puntos: ["Una respuesta HTTP con `Content-Type: text/event-stream` que **no se cierra**.", "Cada evento: una línea `event:`, una `data:` y una línea en blanco.",
               "`retry:` dice al navegador cuánto esperar para reconectar; las líneas `:` son comentarios (latido).", "ReactorLab: `GET /api/v1/stream` emite alarmas, consignas y cambios de estado."],
      codigo: "$ curl -N http://localhost:8030/api/v1/stream\n\nretry: 3000\n\nevent: alarma.activada\ndata: {\"evento\": \"alarma.activada\",\n       \"timestamp\": \"2026-11-10T09:41:02Z\",\n       \"planta\": \"ReactorLab\",\n       \"alarma\": {\"codigo\": \"PRESION_ALTA\", …}}\n\nevent: consigna.cambiada\ndata: {\"evento\": \"consigna.cambiada\", …}\n\n: latido" },

    { tipo: "flujo", titulo: "Webhooks: que te avisen",
      nodos: [{ titulo: "1 · Alta", texto: "`POST /api/v1/webhooks` con la URL de Node-RED y los eventos" }, { titulo: "2 · Algo pasa", texto: "Salta una alarma en ReactorLab", color: "1F5F8B" },
              { titulo: "3 · Aviso", texto: "ReactorLab hace un `POST` a la URL registrada de Node-RED" }, { titulo: "4 · Recibido", texto: "Node-RED responde `200` (**http in** + **http response**)" }],
      flechas: ["", "", ""], hueco: 0.55,
      abajo: ["El receptor tiene que ser **servidor** y ser **alcanzable** desde quien avisa.", "**Firma HMAC** (`X-ReactorLab-Firma`): demuestra que el aviso es auténtico.",
              "Responder rápido; si falla, el emisor puede **reintentar**. El alta debe ser **idempotente**."] },

    { tipo: "seccion", numero: 3, titulo: "En el laboratorio", texto: "Quién usa qué, y cómo se hace en Node-RED" },

    { tipo: "tabla", titulo: "Protocolos web del laboratorio",
      cabecera: ["Dónde", "Qué ofrece", "Práctica"], anchos: [2.6, 5.6, 3.8],
      filas: [["ReactorLab · 8030", "REST con clave, WebSocket `/ws`, SSE `/api/v1/stream`, webhooks, OpenAPI en `/docs`", "Series 1 y 2 de ReactorLab"],
              ["ThingsBoard · 8080", "API HTTP de dispositivos: `POST /api/v1/{token}/telemetry`, RPC por long polling", "Serie 2 de ReactorLab"],
              ["Fundición · 8081", "Puente WebSocket con el gemelo digital 3D", "Ampliación"],
              ["AtomLab · 8040", "REST y WebSocket para su sala de control (su protocolo de práctica es OPC UA)", "Series 1 y 2 de AtomLab"],
              ["Copias · 8090", "Web de snapshots de Node-RED y ThingsBoard", "Entregas"]], altoFila: 0.75 },

    { tipo: "tarjetas", titulo: "Los nodos web de Node-RED", columnas: 2,
      items: [
        { icono: "MdCallMade", titulo: "http request", texto: "Hace peticiones. *Method* fijo o `- set by msg.method -`; `msg.url`, `msg.headers` y `msg.payload` vienen del flujo. *Return*: **parsed JSON**." },
        { icono: "MdCallReceived", titulo: "http in + http response", texto: "Node-RED como **servidor**: recibe webhooks en `/ruta`. Siempre con su **http response**." },
        { icono: "MdSwapHoriz", titulo: "websocket in / out", texto: "*Connect to* `ws://reactorlab:8030/ws`. Llega texto: añade un nodo **json**." },
        { icono: "MdCode", titulo: "json y function", texto: "Convertir texto ↔ objeto y comprobar `msg.statusCode` antes de usar los datos." },
      ] },

    { tipo: "tabla", titulo: "Errores típicos",
      cabecera: ["Síntoma", "Causa probable", "Qué hacer"], anchos: [3.4, 4.2, 4.4],
      filas: [["`ECONNREFUSED`", "Host o puerto mal", "Dentro de Docker: `reactorlab`, no `localhost`"],
              ["`Cannot read properties of undefined`", "Llega texto, no objeto", "*Return*: **a parsed JSON object**, o un nodo **json**"],
              ["`401` en las órdenes", "Falta la cabecera de la clave", "`msg.headers = { \"X-API-Key\": … }`"],
              ["`422`", "Valor fuera de rango o JSON mal formado", "Revisa la documentación en `/docs`"],
              ["No llegan webhooks", "La URL apunta a `localhost`", "La URL la usa el **servidor**: `http://nodered:1880/…`"],
              ["WebSocket en *connecting*", "URL con `http://`", "Debe empezar por `ws://`"]], altoFila: 0.66 },

    { tipo: "cierre", titulo: "Para recordar",
      puntos: ["HTTP es **petición-respuesta**: método, URL, cabeceras, cuerpo y **código**.", "**REST** para consultar y mandar; las órdenes, con **clave** y validadas.",
               "Para tiempo real: **WebSocket** o **SSE**; para avisos, **webhooks**.", "Comprueba siempre el **código de estado** antes de usar los datos."] },
  ],
};
