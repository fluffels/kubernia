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

Das Deployment referenziert das Image als `kubernia:latest`. Beim Bauen in Slice 1 diesen Tag verwenden:

```bash
docker build -t kubernia .
```

Dann in den Cluster laden:

**kind:**

```bash
kind load docker-image kubernia:latest --name <cluster-name>
```

**minikube:**

```bash
minikube image load kubernia:latest
```

### Ingress-Controller installieren (kind)

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
kubectl -n ingress-nginx wait --for=condition=Ready pod -l app.kubernetes.io/component=controller --timeout=90s
```

### Manifeste anwenden

```bash
kubectl apply -f deploy/deployment.yaml
kubectl apply -f deploy/service.yaml
kubectl apply -f deploy/ingress.yaml
```

Das Verzeichnis `deploy/` enthält:

| Datei | Inhalt |
|---|---|
| `deployment.yaml` | Deployment (1 Replica, Ressourcen-Limits, readiness/liveness-Probe) |
| `service.yaml` | ClusterIP-Service (Port 80) |
| `ingress.yaml` | Ingress für `kubequest.localtest.me` (lokaler Cluster) |
| `ingress-tls.yaml` | Ingress mit TLS für öffentliches Hosting (Domain eintragen, s. Slice 4) |
| `cert-issuer.yaml` | Let's-Encrypt-ClusterIssuer für cert-manager (öffentliches Hosting) |

### Spiel im Browser öffnen

Das Spiel ist unter <http://kubequest.localtest.me> erreichbar. Die Domain `.localtest.me` löst per öffentlichem DNS immer zu `127.0.0.1` auf – kein `/etc/hosts`-Eintrag nötig.

### Verifizierung

```bash
# Pod muss Running sein und Probes grün
kubectl get pods -l app=kubernia

# Smoke gegen den Ingress
curl -s -o /dev/null -w "%{http_code}" http://kubequest.localtest.me
# erwartet: 200
```

---

## Slice 3 – Helm-Chart (optional): deploy/chart/ (#754)

Alternativ zu den rohen Manifesten aus Slice 2 lässt sich das Spiel über das
Helm-Chart in `deploy/chart/` installieren. Das bündelt Deployment + Service +
Ingress als Helm-Templates und macht alle Konfig-Werte über `values.yaml`
steuerbar.

> *Voraussetzung: Image aus Slice 1, Cluster + Ingress-Controller aus Slice 2.*

### Helm installieren

```bash
helm install kubernia ./deploy/chart \
  --set image.repository=kubequest \
  --set image.tag=latest \
  --set ingress.host=kubequest.localtest.me
```

Danach ist das Spiel unter **http://kubequest.localtest.me** erreichbar
(Port-Forward-Alternative: `kubectl port-forward svc/kubernia 8080:80`).

### Häufige Konfig-Änderungen

```bash
# Anderen Image-Tag deployen
helm upgrade kubernia ./deploy/chart --set image.tag=1.2.3

# Anderen Hostnamen + mehr Replicas
helm upgrade kubernia ./deploy/chart \
  --set ingress.host=spiel.example.com \
  --set replicaCount=2

# Ingress deaktivieren (reines Port-Forward)
helm upgrade kubernia ./deploy/chart --set ingress.enabled=false
```

### Chart-Verifikation (ohne echten Cluster)

```bash
# Lint: Chart-Struktur + Values prüfen
helm lint deploy/chart

# Template: generierten YAML-Output inspizieren
helm template kubernia deploy/chart
```

### Chart-Struktur

```
deploy/chart/
├── Chart.yaml            # Name, Version, appVersion
├── values.yaml           # Standardwerte (image, ingress, resources …)
└── templates/
    ├── _helpers.tpl      # Namens-/Label-Helfer
    ├── deployment.yaml   # 1 nginx-Replica, Liveness-/Readiness-Probe
    ├── service.yaml      # ClusterIP, Port 80
    └── ingress.yaml      # nginx-Ingress, host + optionales TLS
```

Für TLS-Betrieb (z.B. mit cert-manager) die `tls`-Sektion in `values.yaml`
aktivieren und den gewünschten `secretName` eintragen.

---

## Weitere Slices

- **Slice 4/4** (#755): öffentliches Hosting / Registry-Push / Managed K8s / DNS / TLS
