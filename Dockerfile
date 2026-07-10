# syntax=docker/dockerfile:1
# Kubernia – Produktions-Image der Spiel-App (#752).
#
# Baut das statische Vite-Bundle (`npm run build` → `dist/`) und serviert es über
# ein schlankes nginx-alpine. KEIN Laufzeit-Node im ausgelieferten Image.
#
# ⚠️  Das ist das reale Web-App-Image – NICHT das devpanel-Image
#     (Dockerfile.devpanel) und NICHT die Dev-Umgebung (docker-compose.yml).
#
# Lokaler Schnellstart:
#   docker build -t kubernia .
#   docker run --rm -p 8080:80 kubernia
#   → http://localhost:8080

# --- Stage 1: Build (Node-Toolchain, erzeugt dist/) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
# package*.json zuerst kopieren → Schicht wird bei reinen Code-Änderungen gecacht
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Stage 2: Serve (schlankes nginx, nur statische Assets + nginx-Binary) ---
FROM nginx:1.27-alpine AS serve
# Eigene nginx-Konfig: SPA-Fallback + Cache-Header
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 80
# ENTRYPOINT/CMD vom nginx-Basisimage (nginx im Vordergrund, PID 1).
