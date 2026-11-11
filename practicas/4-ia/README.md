# Serie 4 · Analítica e IA

La serie 4 añade una **capa de IA** a la monitorización: los datos que ya pasan por Node-RED se guardan, se
analizan y se usan para entrenar modelos en **Jupyter**, y esos modelos vuelven a Node-RED para trabajar en
**tiempo real** y generar alarmas en **ThingsBoard**.

La capa es genérica ([`plataforma/ia`](../../plataforma/ia/README.md)): los mismos nodos y cuadernos sirven para
cualquier simulador. Arranca con el resto del laboratorio (servicios `ia` y `jupyter`).

| Práctica | Simulador | Contenido | Material |
|---|---|---|---|
| [Analítica e IA con AeroLab](aerolab/README.md) · [.docx](aerolab/Practica_AeroLab_IA_ES.docx) | AeroLab (Modbus TCP) | Campaña de datos etiquetados, red neuronal (curva de potencia), detector de anomalías, despliegue en tiempo real, alarmas sobre modelos, aprendizaje continuo y deriva | Flujo de recogida (alumnado), flujo resuelto, panel de ThingsBoard, cuadernos 01–03 |
| [Sensor virtual y diagnóstico con ReactorLab](reactorlab/README.md) · [.docx](reactorlab/Practica_ReactorLab_IA_ES.docx) | ReactorLab (API REST) | Planta con lazos de control que tapan las averías: campaña de consignas, sensor virtual de presión (regresión), indicadores de ventana y clasificador de averías, despliegue en tiempo real y alarmas | Flujo de recogida (alumnado), flujo resuelto, panel de ThingsBoard, cuaderno 06 |
| [Reto: la misma IA con SolarLab](solarlab/README.md) · [.docx](solarlab/Reto_SolarLab_IA_ES.docx) | SolarLab (OPC UA) | Construir la recogida, entrenar con la plantilla y llevarlo a ThingsBoard; proponer otra fuente | Flujo resuelto, cuaderno 04 |

Cuadernos (en Jupyter, carpeta `cuadernos/`):

| Cuaderno | Qué hace |
|---|---|
| `00-bienvenida` | Comprueba el servicio y lista conjuntos y modelos |
| `01-aerolab-explorar` | Curva de potencia por escenario, series temporales, correlaciones |
| `02-aerolab-entrenar` | Recta frente a red neuronal, desviación por escenario, Isolation Forest, matriz de confusión, publicar |
| `03-aerolab-deriva` | Modelo fijo frente a continuo, derivas detectadas |
| `04-plantilla` | El mismo procedimiento para cualquier conjunto (configurado para SolarLab) |
| `05-desde-thingsboard` | Descargar el histórico de ThingsBoard por su API |
| `06-reactorlab` | El control tapa la avería; sensor virtual de presión (lineal, red, bosque), residuo, indicadores de 30 s, clasificador de averías, publicar |
