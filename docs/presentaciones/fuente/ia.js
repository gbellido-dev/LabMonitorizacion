module.exports = {
  meta: { protocolo: "IA en planta", sigla: "IA", titulo: "IA en planta · De los datos al modelo y del modelo a la planta", color1: "5B3E96", color2: "2E8B57",
          archivo: "07_IA_en_planta.pptx" },
  diapositivas: [
    { tipo: "portada", titulo: "IA en planta", subtitulo: "De los datos al modelo y del modelo a la planta: la serie 4 del laboratorio",
      pie: "Servicio **ia** (`http://ia:8000`) · **Jupyter** (`localhost:8888`) · nodos **IA** de Node-RED",
      notas: "Presentación de apoyo para la serie 4. Conviene darla antes de la práctica de AeroLab y retomarla en cada simulador." },

    { tipo: "flujo", titulo: "El recorrido",
      nodos: [{ titulo: "① Recoger", texto: "Node-RED · **ia registrar** → `datos/x.csv`" },
              { titulo: "② Entrenar", texto: "Jupyter · `datos(\"x\")`, scikit-learn", color: "5B3E96" },
              { titulo: "③ Publicar", texto: "`guardar(modelo, \"x-curva\", …)` con su ficha" },
              { titulo: "④ Usar", texto: "Node-RED · **ia predecir** cada segundo → ThingsBoard" }],
      hueco: 0.5, alto: 2.1,
      abajo: ["**Jupyter no se conecta a la máquina**: trabaja con lo que Node-RED ha guardado, como se analiza un histórico.",
              "El modelo publicado tiene **nombre, entradas y versión**: Node-RED usa la nueva sin desplegar nada.",
              "Sin Jupyter: **ia aprender** entrena mientras llegan los datos (aprendizaje continuo) y avisa de **deriva**."] },

    { tipo: "tarjetas", titulo: "Qué puede responder un modelo", columnas: 3,
      items: [
        { icono: "MdShowChart", titulo: "Regresión", texto: "**¿Cuánto?** La potencia que debería dar el viento (AeroLab), la presión según las demás medidas (ReactorLab), la ola de dentro de 10 min (OceanLab)." },
        { icono: "MdCategory", titulo: "Clasificación", texto: "**¿Qué es?** La avería más probable (ReactorLab), si una pieza saldrá mal (Fundición), si el AZ-5 rompería canales (AtomLab)." },
        { icono: "MdCrisisAlert", titulo: "Anomalías", texto: "**¿Es raro?** Combinaciones de valores que no se han visto en funcionamiento normal (AeroLab, SolarLab)." },
      ] },

    { tipo: "seccion", numero: 1, titulo: "Los datos", texto: "Etiquetas, excitación y retrasos" },

    { tipo: "lista", titulo: "Antes de entrenar: los datos",
      puntos: ["**Etiqueta**: lo que pasaba de verdad. El simulador la conoce; en una planta casi nunca es segura.",
               "**Transiciones**: justo después de un cambio la máquina aún no ha llegado a su estado. Quítalas.",
               "**Excitación**: con los lazos de control, las medidas están quietas en la consigna. Sin cambios no hay nada que aprender (campaña de consignas en ReactorLab).",
               "**Retrasos**: en la Fundición una pieza se cuela 47 minutos antes de inspeccionarse; la avería «activa» al inspeccionar no es la que la estropeó.",
               "**Volumen**: 96 boyas cada 2 s son 2880 filas por minuto. Submuestrea lo que no aporta."],
      destacado: { icono: "MdWarning", titulo: "Lo más caro", texto: "Un modelo aprende **lo que hay en los datos**: si la etiqueta o la campaña están mal, aprende mal, y bien entrenado." } },

    { tipo: "compara", titulo: "¿Cómo separar los datos de prueba?",
      columnas: [
        { titulo: "En el tiempo", items: ["Series temporales: oleaje, temperaturas, la curva de una máquina", "Lo de hace un segundo se parece mucho a lo de ahora", "Separar al azar **engaña**: el modelo «ve» la respuesta", "Se entrena con el pasado y se prueba con el futuro"] },
        { titulo: "Al azar", items: ["Casos independientes: piezas, simulaciones de AtomLab", "El resultado de uno no depende del anterior", "Por tiempo, una avería del último tramo solo estaría en la prueba", "Mejor **estratificado**: la misma proporción de rechazos en cada parte"] },
      ],
      conclusion: "La pregunta es siempre la misma: ¿la prueba se parece a lo que el modelo verá **de verdad**?" },

    { tipo: "seccion", numero: 2, titulo: "Evaluar", texto: "Errores, umbrales y con qué comparar" },

    { tipo: "tabla", titulo: "Las métricas de la serie 4",
      cabecera: ["Métrica", "Qué dice", "Dónde"], anchos: [2.8, 6.0, 3.6],
      filas: [["MAE", "Error medio en las unidades del problema (kW, kPa, m)", "AeroLab, ReactorLab, OceanLab"],
              ["Precisión", "De los avisos, cuántos eran de verdad (si es baja: falsas alarmas)", "Fundición, AtomLab"],
              ["Detección (recall)", "De los problemas reales, cuántos se avisaron", "Fundición, AtomLab"],
              ["AUC", "Lo bien que ordena por riesgo, sea cual sea el umbral (0,5 = azar, 1 = perfecto)", "AtomLab"],
              ["Matriz de confusión", "Qué se confunde con qué", "AeroLab, ReactorLab"]], altoFila: 0.8 },

    { tipo: "cuadricula", titulo: "Comparar siempre con algo sencillo",
      celdas: [
        { icono: "MdWaves", titulo: "Persistencia", sub: "OceanLab", etiqueta: "0,55 → 0,44 m", texto: "«Dentro de 10 min, la misma ola». Error 0,55 m; el modelo, 0,44 m. Gana sobre todo cuando el mar **cambia**." },
        { icono: "MdRule", titulo: "Reglas del experto", sub: "Fundición", etiqueta: "≈ empate", texto: "Colada ≥ 1405 °C, humedad ≤ 4,3 %, inoculada. El árbol aprende **casi los mismos límites**, sin el experto." },
        { icono: "MdGavel", titulo: "El reglamento", sub: "AtomLab", etiqueta: "ORM ≥ 15", texto: "ORM ≥ 15 barras: detecta todo con muchas falsas alarmas. Es **conservador a propósito**." },
        { icono: "MdShowChart", titulo: "Una recta", sub: "AeroLab", etiqueta: "516 → 223 kW", texto: "La curva de potencia no es una recta: la red neuronal reduce el error de 516 a 223 kW." },
      ] },

    { tipo: "lista", titulo: "El umbral lo decide la planta, no el modelo",
      puntos: ["Un clasificador da una **probabilidad**; el aviso sale de compararla con un umbral.",
               "Umbral bajo: más detección y más falsas alarmas. Alto: lo contrario.",
               "Se elige con los **costes**: retener un molde (8 €) frente a tirar una pieza (100 €); parar una turbina frente a romperla.",
               "En seguridad (AtomLab) se acepta avisar de más; en calidad, depende del coste."],
      destacado: { icono: "MdBalance", titulo: "Ejercicio", texto: "Calcula el coste total para cada umbral y elige el más barato. Cambia los costes y vuelve a elegir." } },

    { tipo: "seccion", numero: 3, titulo: "Patrones", texto: "Lo que se repite en los cinco simuladores" },

    { tipo: "tabla", titulo: "La serie 4 en el laboratorio",
      cabecera: ["Simulador", "Patrón", "Modelo", "Lección"], anchos: [2.0, 3.0, 3.2, 4.4],
      filas: [["AeroLab", "Comportamiento esperado", "Red neuronal + Isolation Forest", "La máquina no avisa de una góndola desalineada; el modelo sí"],
              ["ReactorLab", "Sensor virtual + diagnóstico", "Regresión lineal + bosque", "El control tapa la avería; la mediana separa deriva y válvula"],
              ["Fundición", "Riesgo al colar", "Árbol de decisión", "Las reglas del experto ya eran buenas; el árbol las redescubre"],
              ["AtomLab", "Modelo sustituto", "Bosque (datos simulados)", "500 veces más rápido que el simulador; no sustituye al reglamento"],
              ["OceanLab", "Previsión", "Regresión lineal", "La persistencia es difícil de batir"]], altoFila: 0.85 },

    { tipo: "tarjetas", titulo: "Llevarlo a la planta", columnas: 3,
      items: [
        { icono: "MdTune", titulo: "Mismas entradas", texto: "Node-RED debe calcular las entradas **igual** que el cuaderno (ventanas, tendencias): si no, el modelo recibe otra cosa." },
        { icono: "MdVerified", titulo: "Comprobar en producción", texto: "Guardar cada predicción y compararla cuando llega la verdad (la pieza en el escáner, la ola 10 min después)." },
        { icono: "MdTrendingDown", titulo: "Deriva", texto: "La planta cambia (desgaste, proveedor, estación): un modelo fijo empeora. Vigila su error." },
        { icono: "MdLayers", titulo: "Fuera de lo visto", texto: "Un modelo solo sabe de los estados que vio. AtomLab: un escenario poco representado y el modelo avisa tarde." },
        { icono: "MdShield", titulo: "No sustituye a la protección", texto: "Las protecciones y reglamentos se quedan. La IA **complementa**: avisa antes, prioriza, explica." },
        { icono: "MdHistoryEdu", titulo: "Versiones", texto: "Cada `guardar` crea una versión con su ficha (entradas, métricas): se puede volver atrás." },
      ] },

    { tipo: "cierre", titulo: "Para recordar",
      puntos: ["El trabajo de verdad está en los **datos**: etiqueta, transiciones, excitación y retrasos.",
               "Evalúa como se usará: separación honesta y comparación con algo **sencillo**.",
               "El **umbral** es una decisión de la planta, con sus costes.",
               "En producción: mismas entradas, comprobar, vigilar la deriva y no quitar las protecciones."] },
  ],
};
