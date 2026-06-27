# Dev-Panel als Docker-Image – Passwort zur Laufzeit (#334)

Das passwortgegatete **Dev-/Test-Panel** (#325) lässt sich als schlankes
Docker-Image ausliefern, in das das Passwort erst **beim Containerstart** injiziert
wird – statt es wie beim verteilbaren Build (#331) zur **Build-Zeit** einzubacken.

**Vorteil:** ein Image, viele Passwörter, **kein Rebuild** pro Passwortwechsel; läuft
überall (lokal, Server, Cluster) ohne lokale `.env`. Das Passwort steckt **nie** im
Image, sondern kommt zur Laufzeit aus der Umgebungsvariable.

> ⚠️ **Abgrenzung.** Das ist ein zusätzlicher **Distributionsweg fürs Dev-Panel**,
> kein Betrieb des Spiels. Das ausgelieferte Spiel bleibt die offline-fähige
> Single-File-Web-App (`npm run build:offline`) – kein Server, kein Docker im Betrieb
> (siehe [ADR 0002](adr/0002-kein-backend-keine-db.md)). Steht **neben** #331, ersetzt
> es nicht.

## Bauen & starten

```bash
# 1) Image bauen (enthält KEIN Passwort)
docker build -f Dockerfile.devpanel -t kubequest-devpanel .

# 2) Mit Laufzeit-Passwort starten (Port 80 im Container → 8080 lokal)
docker run --rm -p 8080:80 -e VITE_KQ_DEVPANEL_PW=meinGeheimes kubequest-devpanel
```

Dann **http://localhost:8080** öffnen, im Spiel **F9** drücken und das via
`-e VITE_KQ_DEVPANEL_PW=…` gesetzte Passwort eingeben. Ohne gesetzte Variable bleibt
das Panel gesperrt (wie ein normaler Build ohne `.env`).

## Wie die Laufzeit-Injektion funktioniert (der „Haken")

KubeQuest ist eine **statische SPA**: `import.meta.env.VITE_*` wird zur **Build-Zeit**
ersetzt und ist danach fest im Bundle – eine Env-Var allein erreicht den fertigen
JS-Code nicht mehr. Deshalb gibt es einen kleinen Runtime-Config-Hook:

1. **Build (Dockerfile.devpanel, Stage 1):** `npm run build:devpanel` baut das Panel-
   Bundle **ohne** `VITE_KQ_DEVPANEL_PW` → der Build-Zeit-Wert bleibt leer (Fallback).
2. **Serve (Stage 2, nginx):** Das offizielle nginx-Image führt beim Start alle
   `/docker-entrypoint.d/*.sh` aus. Unser
   [`docker/devpanel-entrypoint.sh`](../docker/devpanel-entrypoint.sh) liest
   `$VITE_KQ_DEVPANEL_PW` und schreibt es **base64-kodiert** als
   `<script>window.__KQ_CONFIG__={devPanelPwB64:"…"}</script>` direkt hinter das
   öffnende `<head>` der `index.html` – also **vor** dem gebündelten Spielcode.
3. **Laufzeit (Browser):** [`src/devpanel.ts`](../src/devpanel.ts) liest
   `window.__KQ_CONFIG__`, dekodiert das Passwort (`decodeBase64Utf8`) und gibt dem
   Laufzeitwert **Vorrang** vor dem Build-Zeit-Wert (`resolveDevPanelPassword`).

**Warum Base64?** So kann der Entrypoint ein **beliebiges** Passwort ohne HTML-/JS-
Escaping-Fallen einbetten: kein `</script>`-Ausbruch, kein Anführungszeichen-Bruch,
und sed-sicher (Base64-Alphabet `A–Z a–z 0–9 + / =` enthält nie das Trennzeichen).

## Sicherheitshinweise

- Das Passwort ist eine **weiche Sperre** gegen versehentliches Reinrutschen, **kein
  Krypto-Schutz** – bei einem Client-Spiel ist mehr nicht möglich (siehe #325). Wer
  die Browser-Konsole hat, kommt ohnehin an alles.
- Das **Image enthält kein Secret**: das Passwort lebt nur in der Laufzeit-Env-Var.
  Den Wert nie ins Repo, nie ins Image, nie in ein Compose-File mit Klartext committen.
- Optional (nicht Teil dieses Tickets): das Image in der CI bauen und nach GHCR pushen –
  Passwort **niemals** ins Image, immer nur per `-e` zur Laufzeit.
