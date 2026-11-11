module.exports = {
  meta: { protocolo: "OPC UA avanzado", sigla: "OPC UA+", titulo: "OPC UA avanzado · Alarmas, métodos e histórico", color1: "0E7C86", color2: "B5462F",
          archivo: "06_OPC_UA_avanzado.pptx" },
  diapositivas: [
    { tipo: "portada", titulo: "OPC UA avanzado", subtitulo: "Más allá de leer variables: alarmas, métodos, histórico y modelos de información",
      pie: "En el laboratorio: **Fundición** (`opc.tcp://fundicion-opcua:4841/UA/Fundicion`)",
      notas: "Continuación de 01_OPC_UA. Apoyo para las prácticas de la Fundición y el reto de trazabilidad." },

    { tipo: "tarjetas", titulo: "Lo que OPC UA ofrece además de leer", columnas: 3,
      items: [
        { icono: "MdNotificationsActive", titulo: "Alarmas y condiciones", texto: "El servidor **decide** cuándo hay una alarma, con su severidad, y la mantiene hasta que se reconoce (A&C)." },
        { icono: "MdPlayCircle", titulo: "Métodos", texto: "Funciones con **argumentos** y resultado: `ConsultarPieza(Id)` devuelve la historia de una pieza." },
        { icono: "MdHistory", titulo: "Histórico", texto: "**HistoryRead**: pedir al servidor los valores de la última hora, sin haberlos guardado tú." },
        { icono: "MdSchema", titulo: "Tipos de objeto", texto: "Un `HornoType` describe **todos** los hornos: el cliente sabe qué esperar de cada uno." },
        { icono: "MdEvent", titulo: "Eventos", texto: "Mensajes con hora y origen (una avería, un cambio de lote) a los que el cliente se **suscribe**." },
        { icono: "MdHub", titulo: "Companion Specs", texto: "Modelos estándar por sector: EUROMAP (inyectoras), MTConnect/umati (máquina herramienta), PackML…" },
      ] },

    { tipo: "seccion", numero: 1, titulo: "Alarmas y condiciones", texto: "Que sea el servidor quien sepa cuándo algo va mal" },

    { tipo: "arbol", titulo: "Una alarma en el espacio de direcciones",
      arbol: "IF-01\n├─ TemperaturaMetal       1297 °C\n└─ AlarmaTemperatura  (ExclusiveLimitAlarmType)\n   ├─ ActiveState      false\n   ├─ AckedState       true\n   ├─ Severity\n   ├─ Message\n   ├─ LowLimit         1100\n   ├─ HighLimit        1530\n   ├─ HighHighLimit    1550\n   └─ Acknowledge(…)   método",
      puntos: ["Una **condición** tiene estado: activa o no, reconocida o no, con **severidad** (1–1000).",
               "La Fundición tiene seis: temperatura de IF-01, sobrepresión de IF-02, colada fría, vibración de DES-01, desviación del escáner y OEE.",
               "`ExclusiveLimitAlarm`: un valor frente a límites `Low`, `High`, `HighHigh`…: solo un estado a la vez.",
               "El cliente recibe un **evento** cada vez que cambia y puede **reconocerla** (`Acknowledge`) con un comentario.",
               "Así las reglas viven **en la máquina**: todos los clientes ven la misma alarma."] },

    { tipo: "compara", titulo: "¿Dónde poner las reglas de alarma?",
      columnas: [
        { titulo: "En el servidor (OPC UA A&C)", items: ["El fabricante conoce la máquina", "**Una** definición para todos los clientes", "Reconocimiento centralizado", "Cambiar un límite = cambiar el servidor"] },
        { titulo: "En la plataforma (ThingsBoard)", items: ["Se configuran sin tocar la máquina", "Combinan varias máquinas y reglas de negocio", "Propagación por la jerarquía de activos", "Cada plataforma las define a su manera"] },
      ],
      conclusion: "Lo habitual: las alarmas de **protección** en la máquina; las de **negocio** (OEE, calidad, mantenimiento) en la plataforma." },

    { tipo: "seccion", numero: 2, titulo: "Métodos", texto: "Llamar a una función del servidor desde Node-RED" },

    { tipo: "codigo", titulo: "Llamar a un método", anchoTexto: 5.0,
      puntos: ["Un método pertenece a un **objeto**: hay que dar los dos NodeId.",
               "Los argumentos van con su **tipo** (`String`, `Int32`…).",
               "La respuesta es una lista con los argumentos de **salida**.",
               "En el nodo de Node-RED, la acción **METHOD** necesita además un `msg.topic` no vacío."],
      codigo: "// function → OpcUa-Client (METHOD)\nmsg.topic    = \"ns=1;s=Trazabilidad\";\nmsg.objectId = \"ns=1;s=Trazabilidad\";\nmsg.methodId = \"ns=1;s=Trazabilidad.PiezasDelLote\";\nmsg.inputArguments = [\n    { dataType: \"String\", value: \"FE-261110-084\" }\n];\nreturn msg;\n\n// respuesta:\n// msg.payload = [ [\"P-004335\", …], 3 ]\n//                 piezas            rechazadas" },

    { tipo: "tabla", titulo: "Métodos de la Fundición",
      cabecera: ["Método", "Entrada", "Salida", "Para qué"], anchos: [3.4, 2.4, 3.2, 3.6],
      filas: [["`Trazabilidad.ConsultarPieza`", "Id de pieza", "Historia (JSON)", "Auditoría de una pieza"],
              ["`Trazabilidad.PiezasDelLote`", "Lote", "Piezas y rechazadas", "Cuarentena de una colada"],
              ["`Mantenimiento.InyectarAveria`", "Código (0–7)", "Nombre de la avería", "Prácticas (el profesor)"],
              ["`Mantenimiento.Reparar`", "—", "—", "Quitar la avería"]],
      nota: "Frente a escribir en una variable, un método puede **validar**, hacer varias cosas a la vez y devolver un resultado.", altoFila: 0.8 },

    { tipo: "seccion", numero: 3, titulo: "Histórico y modelado", texto: "El pasado sin base de datos propia y los tipos de objeto" },

    { tipo: "lista", titulo: "HistoryRead: el servidor recuerda",
      puntos: ["Una variable con **Historizing = true** guarda sus valores en el servidor.",
               "El cliente pide un intervalo: `HistoryReadRawModified(desde, hasta)`; también hay **agregados** (media, mínimo, máximo por intervalo).",
               "Sirve para recuperar lo que pasó **mientras el cliente estaba desconectado**.",
               "La Fundición guarda **2 horas** de sus variables principales (OEE, energía, temperaturas…); un historiador industrial, años."],
      destacado: { icono: "MdStorage", titulo: "¿Y ThingsBoard?", texto: "ThingsBoard guarda **lo que le llega**. Si la pasarela se cae, ese hueco solo lo puede rellenar el histórico del servidor." } },

    { tipo: "flujo", titulo: "Modelos de información",
      nodos: [{ titulo: "Tipo base", texto: "`BaseObjectType`" }, { titulo: "Tipo de equipo", texto: "Por ejemplo `HornoInduccionType`: Temperatura, Potencia, Alarma…", color: "0E7C86" },
              { titulo: "Instancias", texto: "`IF-01`, `IF-02`: el mismo «molde»" }, { titulo: "Cliente", texto: "Descubre los hornos **por su tipo**" }],
      hueco: 0.55, alto: 2.1,
      abajo: ["Un cliente que conoce el tipo sabe qué variables tendrá cualquier horno, aunque se instale mañana.",
              "Las **Companion Specifications** son tipos acordados por un sector: la base de la interoperabilidad.",
              "En ThingsBoard pasa algo parecido con los **perfiles de dispositivo**.",
              "La Fundición del laboratorio no define tipos propios: sus activos son objetos con variables (un buen ejercicio de diseño)."] },

    { tipo: "tabla", titulo: "Errores típicos",
      cabecera: ["Síntoma", "Causa probable", "Qué hacer"], anchos: [3.4, 4.2, 4.4],
      filas: [["El método no hace nada", "Falta `msg.topic` en el nodo de Node-RED", "Pon `msg.topic` (cualquier NodeId)"],
              ["`BadArgumentsMissing`", "Faltan argumentos o tipo distinto", "`inputArguments` con `dataType` correcto"],
              ["`BadTooManySessions`", "Demasiados clientes abiertos", "Reutiliza el endpoint; el servidor limita las sesiones"],
              ["No llegan eventos de alarma", "Suscrito al valor, no a los eventos", "Monitoriza el **EventNotifier** del objeto"],
              ["HistoryRead vacío", "La variable no historiza o el intervalo es otro", "Comprueba `Historizing` y las horas (UTC)"]], altoFila: 0.75 },

    { tipo: "cierre", titulo: "Para recordar",
      puntos: ["Las **alarmas** de OPC UA tienen estado, severidad y reconocimiento.",
               "Los **métodos** son órdenes con argumentos y respuesta, validadas por el servidor.",
               "El **histórico** rellena los huecos que deja una pasarela caída.",
               "Los **tipos** hacen que muchas máquinas se integren igual."] },
  ],
};
