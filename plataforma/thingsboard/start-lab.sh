#!/bin/bash
# Arranque de ThingsBoard para LabMonitorizacion: instala la base de datos si
# todavía no existe y después inicia el servidor.
set -e

estado="$(java -cp /opt/lab/postgresql.jar /opt/lab/ComprobarBD.java)"

case "$estado" in
    VACIA)
        echo "================================================================"
        echo " Primer arranque: instalando ThingsBoard (tarda 1-3 minutos)..."
        echo "================================================================"
        INSTALL_TB=true LOAD_DEMO="${TB_LOAD_DEMO:-true}" start-tb-node.sh
        ;;
    INCOMPLETA)
        echo "La base de datos de ThingsBoard está a medio instalar (sin usuarios)."
        echo "Bórrala y vuelve a arrancar:  docker compose down -v && docker compose up -d"
        exit 1
        ;;
esac

exec start-tb-node.sh
