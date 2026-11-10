# ThingsBoard CE con instalación automática en el primer arranque.
#
# La imagen oficial necesita un paso manual (INSTALL_TB=true) para crear la
# base de datos. Este envoltorio lo hace solo: si la base de datos está vacía
# instala ThingsBoard (con las cuentas de demostración) y después lo arranca.
FROM thingsboard/tb-node:4.3.1.8

USER root
# Driver JDBC de PostgreSQL (ya viene dentro de thingsboard.jar) para comprobar
# el estado de la base de datos sin instalar paquetes adicionales.
RUN mkdir -p /opt/lab && cd /opt/lab \
 && driver="$(jar tf /usr/share/thingsboard/bin/thingsboard.jar | grep -m1 'BOOT-INF/lib/postgresql-.*\.jar')" \
 && jar xf /usr/share/thingsboard/bin/thingsboard.jar "$driver" \
 && mv "$driver" /opt/lab/postgresql.jar && rm -rf /opt/lab/BOOT-INF
COPY ComprobarBD.java /opt/lab/ComprobarBD.java
COPY --chmod=755 start-lab.sh /usr/bin/start-lab.sh
USER thingsboard

CMD ["start-lab.sh"]
