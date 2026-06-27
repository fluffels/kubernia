#!/bin/sh
# KubeQuest Dev-Panel-Image (#334) – Laufzeit-Passwort-Injektion.
#
# Hintergrund: KubeQuest ist eine STATISCHE SPA (Vite → fertiges HTML/JS).
# `import.meta.env.VITE_*` wird zur BUILD-Zeit ersetzt (#331), lässt sich also zur
# Laufzeit nicht mehr ändern. Damit EIN Image mit VIELEN Passwörtern laufen kann
# (`docker run -e VITE_KQ_DEVPANEL_PW=…`, ohne Rebuild), schreibt dieser
# Entrypoint das Passwort beim Containerstart als `window.__KQ_CONFIG__` in die
# index.html – BEVOR nginx startet. devpanel.ts liest es dann über
# resolveDevPanelPassword() (Laufzeit schlägt Build-Zeit, mit Build-Wert-Fallback).
#
# Liegt unter /docker-entrypoint.d/ – das offizielle nginx-Image führt alle dort
# liegenden *.sh vor dem nginx-Start aus (kein eigenes ENTRYPOINT nötig).
#
# Sicher gegen Escaping-Fallen: das Passwort wird Base64-kodiert eingebettet
# (Alphabet A–Z a–z 0–9 + / =) – kein </script>-Ausbruch, kein Quote-Bruch, und
# sed-sicher mit '#' als Trennzeichen. Die JS-Seite dekodiert per atob+TextDecoder.
set -eu

HTML=/usr/share/nginx/html/index.html
PW="${VITE_KQ_DEVPANEL_PW:-}"

if [ -z "$PW" ]; then
  echo "[kq-devpanel] kein VITE_KQ_DEVPANEL_PW gesetzt – das Panel bleibt gesperrt."
  exit 0
fi

if [ ! -f "$HTML" ]; then
  echo "[kq-devpanel] WARN: $HTML nicht gefunden – nichts injiziert."
  exit 0
fi

# Idempotent: bei einem Container-Neustart (gleicher Writable-Layer) nicht erneut
# injizieren – die Config steht dann schon drin.
if grep -q "__KQ_CONFIG__" "$HTML"; then
  echo "[kq-devpanel] Laufzeit-Config bereits vorhanden – übersprungen."
  exit 0
fi

B64=$(printf '%s' "$PW" | base64 | tr -d '\n')
SNIPPET="<script>window.__KQ_CONFIG__={devPanelPwB64:\"${B64}\"};</script>"

# Direkt nach dem öffnenden <head> einfügen → läuft vor dem (im Body inline
# gebündelten) Spielcode. '#' als sed-Trennzeichen, da Base64 niemals '#' enthält.
sed -i "s#<head>#<head>${SNIPPET}#" "$HTML"
echo "[kq-devpanel] Laufzeit-Passwort injiziert (Panel per F9 erreichbar)."
