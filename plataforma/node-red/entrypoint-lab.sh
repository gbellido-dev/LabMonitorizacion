#!/bin/sh
# Prepara /data (volumen persistente de Node-RED) y arranca Node-RED.
#  - settings.js del laboratorio (clave de credenciales fija -> snapshots portables)
#  - biblioteca de flujos de las prácticas en Import -> Local
set -e
cp /opt/lab/settings.js /data/settings.js
DEST=/data/lib/flows/LabMonitorizacion
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r /opt/lab/biblioteca/alumnado "$DEST/alumnado"
if [ "${NODE_RED_INCLUIR_SOLUCIONES:-false}" = "true" ]; then
    cp -r /opt/lab/biblioteca/soluciones "$DEST/soluciones"
fi
exec /usr/src/node-red/entrypoint.sh "$@"
