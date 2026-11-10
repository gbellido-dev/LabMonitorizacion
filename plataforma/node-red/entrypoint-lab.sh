#!/bin/sh
# Copia la biblioteca de flujos del laboratorio al directorio de usuario de
# Node-RED (/data, volumen persistente) y arranca Node-RED con normalidad.
set -e
DEST=/data/lib/flows/LabMonitorizacion
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r /opt/lab/biblioteca/alumnado "$DEST/alumnado"
if [ "${NODE_RED_INCLUIR_SOLUCIONES:-false}" = "true" ]; then
    cp -r /opt/lab/biblioteca/soluciones "$DEST/soluciones"
fi
exec /usr/src/node-red/entrypoint.sh "$@"
