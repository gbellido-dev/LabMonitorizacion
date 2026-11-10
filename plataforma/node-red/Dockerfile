# Node-RED del laboratorio con las paletas que usan las prácticas ya instaladas:
#   - node-red-contrib-modbus        (práctica 01, AeroLab Modbus TCP)
#   - node-red-contrib-opcua         (prácticas 03 y 04, SolarLab / Fundición OPC UA)
#   - @flowfuse/node-red-dashboard   (práctica 04, Dashboard 2.0)
# Los nodos MQTT (práctica 02) vienen de serie.
FROM nodered/node-red:5.0.9

RUN npm install --no-audit --no-fund --omit=dev \
        node-red-contrib-modbus@5.62.1 \
        node-red-contrib-opcua@0.2.355 \
        @flowfuse/node-red-dashboard@1.36.0

# Biblioteca de flujos (Menú → Import → Local) con los hosts del compose
COPY --chown=node-red:node-red biblioteca /opt/lab/biblioteca
COPY --chown=node-red:node-red settings.js /opt/lab/settings.js
COPY --chown=node-red:node-red --chmod=755 entrypoint-lab.sh /opt/lab/entrypoint-lab.sh

ENTRYPOINT ["/opt/lab/entrypoint-lab.sh"]
