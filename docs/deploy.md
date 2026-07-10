# Kubernia deployen

Reproduzierbarer Weg, um die Spiel-App in einem Container oder einem Kubernetes-Cluster zu betreiben – lokal zum Entwickeln und Lernen, oder öffentlich im Internet.

> **Abgrenzung:** Diese Doku beschreibt das Deployen der echten App-Infrastruktur. Das ausgelieferte Spiel selbst bleibt die offline-fähige Single-File-Web-App (`npm run build:offline`) – kein Server, kein Docker im normalen Spielbetrieb (ADR 0002). Schöner Dogfooding-Effekt: Kubernia hosten = genau das üben, was das Spiel lehrt.

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

## Slice 4 – Öffentliches Hosting via Managed K8s (#755)

> *Setzt Slice 1 (Image) und Slice 2 (Manifeste) voraus.*

### Ziel

Das Spiel unter einer öffentlichen URL erreichbar machen – z.B. über **IONOS Managed Kubernetes** oder einen anderen Anbieter. TLS via cert-manager + Let's Encrypt.

### Schritt 1 – Image in die Registry pushen

Das Repository nutzt **GitHub Container Registry** (ghcr.io). Der Workflow `.github/workflows/release.yml` baut und pushed automatisch bei einem neuen Version-Tag:

```bash
git tag v1.0.0
git push --tags
```

Das Image landet unter `ghcr.io/fluffels/kubernia:v1.0.0` und `:latest`.

**Kein separates Registry-Secret nötig** – der Workflow nutzt das automatische `GITHUB_TOKEN`.

> Sichtbarkeit: Unter `https://github.com/fluffels/kubernia/settings → Packages` das Package ggf. auf **Public** stellen, damit der Cluster es ohne Pull-Secret ziehen kann.

### Schritt 2 – Deployment-Image auf die Registry-URL umstellen

In `deploy/deployment.yaml` das `image:`-Feld auf die öffentliche Registry-URL anpassen:

```yaml
image: ghcr.io/fluffels/kubernia:latest
imagePullPolicy: Always
```

### Schritt 3 – Managed-K8s-Cluster bereitstellen

Beispiel IONOS:

1. Im IONOS-DCD einen Managed-K8s-Cluster anlegen (Kubernetes-Version ≥ 1.28).
2. `kubeconfig` herunterladen und als `KUBECONFIG` exportieren:

   ```bash
   export KUBECONFIG=~/downloads/kubernia-ionos.yaml
   kubectl get nodes
   ```

3. Ingress-Controller installieren (falls nicht vom Anbieter bereitgestellt):

   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
     --namespace ingress-nginx --create-namespace
   ```

4. cert-manager installieren:

   ```bash
   helm repo add jetstack https://charts.jetstack.io
   helm upgrade --install cert-manager jetstack/cert-manager \
     --namespace cert-manager --create-namespace \
     --set installCRDs=true
   ```

### Schritt 4 – DNS + TLS konfigurieren

1. Die externe IP des Ingress-Controllers ermitteln:

   ```bash
   kubectl -n ingress-nginx get svc ingress-nginx-controller
   # → EXTERNAL-IP: 203.0.113.42 (Beispiel)
   ```

2. Bei eurem DNS-Anbieter einen A-Record anlegen:
   - Name: `kubernia.example.com` (eigene Domain eintragen)
   - Ziel: die ermittelte EXTERNAL-IP

3. In `deploy/cert-issuer.yaml` die eigene E-Mail-Adresse eintragen, dann anwenden:

   ```bash
   kubectl apply -f deploy/cert-issuer.yaml
   ```

4. In `deploy/ingress-tls.yaml` die eigene Domain eintragen (`kubernia.example.com`), dann anwenden:

   ```bash
   kubectl apply -f deploy/deployment.yaml
   kubectl apply -f deploy/service.yaml
   kubectl apply -f deploy/ingress-tls.yaml
   ```

   cert-manager beantragt das TLS-Zertifikat automatisch über den HTTP01-Challenge-Weg.

5. Zertifikat-Status prüfen:

   ```bash
   kubectl get certificate
   # READY=True → Zertifikat ausgestellt
   ```

6. Spiel im Browser öffnen: `https://kubernia.example.com`

### Abgrenzung

- **Kein Save-Sync-Backend** – das Spiel speichert alles lokal im Browser (IndexedDB). Ein serverseitiger Save-Sync ist Phase 10, opt-in, separates Thema (#163).
- **Secrets** (Registry-Zugangsdaten, E-Mail für Let's Encrypt) trägt die Maintainerin selbst ein – nie im Klartext im Repo.
