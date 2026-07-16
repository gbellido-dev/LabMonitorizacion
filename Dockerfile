# Imagen unica para el dashboard web y el servidor OPC UA de la fundicion.
# Se usa desde compose.yaml, que arranca cada servicio con su comando.
#
# Nota: imagen Debian (no Alpine) porque el build/preview usa workerd
# (Cloudflare), que necesita glibc.
FROM node:22-bookworm-slim

WORKDIR /app

# Dependencias primero para aprovechar la cache de capas
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Codigo y build de produccion (descarga las fuentes de Google en el build)
COPY . .
RUN npm run build

EXPOSE 3000 4840

# Por defecto arranca el dashboard; compose sobreescribe el comando por servicio
CMD ["npm", "run", "start", "--", "--host", "0.0.0.0"]
