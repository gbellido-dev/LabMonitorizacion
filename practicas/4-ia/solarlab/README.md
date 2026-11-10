# Serie 4 · Reto: la misma IA con otra fuente (SolarLab)

**¿Es de verdad genérica la capa de IA?**

| | |
|---|---|
| **Simulador** | SolarLab (parque fotovoltaico, OPC UA) |
| **Duración orientativa** | 2 h |
| **Requisitos** | Práctica de la serie 4 con AeroLab |

En AeroLab el modelo aprendía «cuánto debería producir con este viento». En un parque solar la pregunta es la
misma con otra causa: **¿cuánto debería producir con esta irradiancia y esta temperatura de panel?**
Los nodos de IA, el servicio y los cuadernos son **los mismos**: solo cambian la fuente y los nombres.

## Lo que hay que construir

### 1. Recogida (conjunto `solarlab`)

Construye tú el flujo (o parte del de la serie 2 de SolarLab):

| Paso | Pista |
|---|---|
| Suscripción OPC UA | `ns=2;s=Plant.ActivePower`, `Plant.Irradiance`, `Plant.PanelTemperature`, `Plant.AmbientTemperature`, `Plant.PerformanceRatio` y la etiqueta `ns=2;s=Controls.FaultCode` |
| Filtrar | Solo los mensajes con `msg.topic` que empieza por `ns=` (el nodo OPC UA envía también avisos de la suscripción) |
| Agrupar | Como en la serie 2 (función *Agrupar*), y como máximo **una fila por segundo** (nodo *delay*, modo *rate*, descartando los intermedios) |
| Fila plana | `irradiancia`, `temp_panel`, `temp_ambiente`, `potencia`, `pr`, `averia` |
| **ia registrar** | Conjunto `solarlab` |
| Campaña | Cada 30 s, una irradiancia aleatoria entre 100 y 1100 W/m² escrita en `ns=2;s=Controls.IrradianceSetpoint` (`Double`) |
| Escenarios | Botones que escriben `ns=2;s=Controls.FaultCode` (`Int32`): 0 sin avería, 1 suciedad, 2 disparo de inversor |

Recoge al menos **10 minutos normales** y unos 3 minutos de cada avería.

### 2. Entrenamiento con la plantilla

Abre **cuadernos → 04-plantilla.ipynb**. Ya está configurada para este conjunto:

```python
CONJUNTO = "solarlab"
OBJETIVO = "potencia"
ENTRADAS = ["irradiancia", "temp_panel"]
ETIQUETA = "averia"
NORMAL = 0
```

Ejecuta todo. Publica `solarlab-curva` y `solarlab-anomalias`.

Resultados obtenidos con una campaña de 892 filas (596 normales, 151 con suciedad y 145 con disparo de inversor):

| | Sin avería | Suciedad | Disparo de inversor |
|---|---|---|---|
| Rendimiento medio respecto a la curva | 1,00 | 0,71 | 0,75 |
| Filas con rendimiento < 0,9 | 1 % | **100 %** | **100 %** |
| Filas marcadas por el Isolation Forest | 1 % | 3 % | 18 % |

La curva aprendida (MAE ≈ 32 kW, R² = 0,998) detecta las dos averías; el detector de anomalías **sobre los datos en bruto** casi no las ve, porque una potencia baja es habitual… con otra irradiancia. Es la pregunta 1 del cuaderno.

### 3. Tiempo real y ThingsBoard

Con dos **ia predecir** (prefijos distintos, por ejemplo `esperada_`), calcula la desviación y el rendimiento
respecto a lo esperado y envíalos a un dispositivo `Parque-IA` de ThingsBoard con una regla de alarma propia.

### 4. Otra fuente más

Elige otro simulador (OceanLab, ReactorLab, AtomLab o la Fundición) y responde **sin programar todavía**:
¿qué columnas recogerías?, ¿cuál sería el objetivo?, ¿tendrías etiqueta?, ¿qué tipo de modelo usarías?
Después, recoge 10 minutos y pásalos por la plantilla.

## Entrega

- [ ] Flujo exportado (sin tokens) y cuaderno 04 con resultados.
- [ ] Tabla: avería → ¿la ve la curva? ¿la ve el detector de anomalías? ¿la ve la alarma de la planta?
- [ ] La propuesta del punto 4 con sus resultados.

## Criterios de evaluación

| Criterio | Peso |
|---|---|
| Flujo de recogida completo y limpio (filtro, agrupado, una fila por segundo, etiqueta) | 30 % |
| Modelos entrenados y evaluados por avería | 25 % |
| Tiempo real y alarma en ThingsBoard | 25 % |
| Propuesta razonada para otra fuente | 20 % |

> Solución para el profesorado: flujo [flows/ia-solarlab-solucion.json](flows/ia-solarlab-solucion.json).
