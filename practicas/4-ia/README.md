# Serie 4 · Analítica e IA

La serie 4 añade una **capa de IA** a la monitorización: los datos que ya pasan por Node-RED se guardan, se
analizan y se usan para entrenar modelos en **Jupyter**, y esos modelos vuelven a Node-RED para trabajar en
**tiempo real** y generar alarmas en **ThingsBoard**.

La capa es genérica ([`plataforma/ia`](../../plataforma/ia/README.md)): los mismos nodos y cuadernos sirven para
cualquier simulador. Se arranca aparte:

```bash
docker compose --profile ia up -d
```

| Práctica | Simulador | Contenido | Material |
|---|---|---|---|
| [Analítica e IA con AeroLab](aerolab/README.md) · [.docx](aerolab/Practica_AeroLab_IA_ES.docx) | AeroLab (Modbus TCP) | Campaña de datos etiquetados, red neuronal (curva de potencia), detector de anomalías, despliegue en tiempo real, alarmas sobre modelos, aprendizaje continuo y deriva | Flujo de recogida (alumnado), flujo resuelto, panel de ThingsBoard, cuadernos 01–03 |
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
