# Kubernia lokal deployen

Reproduzierbarer Weg, um die Spiel-App in einem Container oder einem lokalen K8s-Cluster zu starten.

> **Abgrenzung:** Diese Doku beschreibt einen lokalen Infra-Weg zur Entwicklung und zum Weiterlernen. Das ausgelieferte Spiel bleibt die offline-fähige Single-File-Web-App (`npm run build:offline`) – kein Server, kein Docker im normalen Betrieb (ADR 0002).

---

## Slice 1 – Container-Image bauen und lokal starten (#752)

### Voraussetzungen

- Docker (oder Podman kompatibel)
- Node 22 ist **nicht** nötig – der Build läuft im Container

### Image bauen

```bash
docker build -t kubequest .
```

Der Multi-Stage-Build (Dockerfile im Repo-Root) tut:
1. **Build-Stage** (`node:22-bookworm-slim`): `npm ci` + `npm run build` → `dist/`
2. **Serve-Stage** (`nginx:1.27-alpine`): serviert `dist/` über Port 80 mit SPA-Fallback

Das fertige Image enthält keinen Node-Laufzeit-Layer, nur nginx + statische Assets.

### Container starten

```bash
docker run --rm -p 8080:80 kubequest
```

Dann im Browser öffnen: <http://localhost:8080>

### Schnell-Smoke

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080
# erwartet: 200
```

---

## Slice 2 – Lokaler K8s-Cluster: Deployment + Service + Ingress (#753)

> *Setzt das Image aus Slice 1 voraus.*

### Voraussetzungen

- `kind` (oder `minikube`) + `kubectl`
- Image aus Slice 1 lokal gebaut

### Image in den Cluster laden

**kind:**

```bash
kind load docker-image kubequest:latest --name <cluster-name>
```

**minikube:**

```bash
minikube image load kubequest:latest
```

### Manifeste anwenden

```bash
kubectl apply -f deploy/
```

### Ingress-Controller installieren (kind)

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=Ready pod -l app.kubernetes.io/component=controller --timeout=90s
```

### Spiel im Browser öffnen

Das Spiel ist unter `http://kubequest.localtest.me` erreichbar (`.localtest.me` löst immer zu `127.0.0.1` auf, kein `/etc/hosts`-Eintrag nötig).

### Verifizierung

```bash
# Pod muss Running sein und Probes grün
kubectl get pods -l app=kubequest

# Smoke gegen den Ingress
curl -s -o /dev/null -w "%{http_code}" http://kubequest.localtest.me
# erwartet: 200
```

---

## Weitere Slices

- **Slice 3/4** (#754): optionale Helm-Bündelung
- **Slice 4/4** (#755): öffentliches Hosting / Registry / DNS / TLS
