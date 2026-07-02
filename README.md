# ⚓ Kubernia – Das Hafen-Abenteuer

[![CI](https://github.com/fluffels/kubequest/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/fluffels/kubequest/actions/workflows/ci.yml)

> **🚧 Work in Progress** – Kubernia ist in aktiver Entwicklung. Bugs und unfertige Ecken sind möglich.
> Hast du etwas gefunden oder eine Idee? Meld dich gern in den **[GitHub Discussions](https://github.com/fluffels/kubequest/discussions)** – einfach lostippen (GitHub-Login nötig).

Ein **2D-Lernspiel** (gebaut mit **Phaser 3**) für Docker, Kubernetes, Helm, Terraform und Security-Grundlagen – von „Helm? Das setzt man doch auf den Kopf?" bis zum souveränen Umgang mit den Profi-Werkzeugen. Du läufst durch die Hafenstadt **Port Kubernia**, löst Quests und schickst echte Befehle an den Cluster.

**Die Spielwelt IST der Cluster:**

- Die drei Stege am Dock = **Nodes**, jede Kiste darauf = ein **Pod** (live!)
- Pod löschen → Kiste platscht ins Wasser, der Kran stellt sofort Ersatz hin (**Self-Healing zum Zugucken**)
- Helm-Releases hissen **Flaggen**, Services leuchten als **Laternen**, Docker-Container stehen als **Fässer** am Dock
- `terraform apply` baut **sichtbar neues Land** ins Meer

---

## ✨ Was dieses Projekt besonders macht

Kubernia ist mehr als ein Lernspiel – es ist ein **Vorzeigeprojekt in drei Dimensionen**. Wer hier reinschaut, findet:

1. **🎮 Ein echtes Lernspiel** – Docker/K8s/Helm/Terraform hands-on, mit Story, Spaced Repetition und 10 aufeinander aufbauenden Lern-Phasen. → [Das Spiel](#-das-spiel)
2. **🏛️ Architektur & Code-Qualität als Verkaufsargument** – erzwungene Schichtung, Content-as-Data, versionierte Persistenz (Save bricht nie), `strict` TypeScript ohne `any`, taktisches DDD und Fitness-Functions als CI-Gates. → [Architektur & Qualität](#-architektur--qualität)
3. **🤖 Vollständig von KI-Coding-Agenten gebaut – und abgesichert** – der komplette Code entsteht durch autonome Agenten. Was das sicher und billig macht, sind die Leitplanken: selbstdokumentierendes Repo, Board-Workflow mit Kollisionsschutz und ein Netz aus automatischen Gates. → [Gebaut von KI-Agenten](#-gebaut-von-ki-agenten)

Die drei Abschnitte darunter erzählen jeden dieser Punkte im Detail.

---

## 🎮 Das Spiel

### Spielstart

**Entwickeln:** einmalig `npm install`, dann `npm run dev` – startet den lokalen Vite-Server. Im Browser unter der angezeigten Adresse öffnen. CSS-Änderungen werden live übernommen; nach Code-Änderungen kurz mit **F5** neu laden (ein Toast erinnert daran, Spielstand bleibt erhalten).

**Offline spielen / weitergeben:** `npm run build:offline` erzeugt **eine einzige, in sich geschlossene Datei** `dist-offline/index.html` (Code, Grafiken und Engine sind eingebettet). Die kann man **doppelklicken** – läuft komplett offline, ohne Server.

**Hosten / auf einen Webserver legen:** `npm run build` erzeugt das normale Bündel nach `dist/` (Grafiken als eigene, einzeln cachebare Dateien). Das ist der Standard-Build zum Ausliefern über einen Server; lokal ansehen mit `npm run preview`.

Spielstand speichert automatisch im Browser.

| Taste | Aktion |
|---|---|
| WASD / Pfeile | Laufen |
| E | Reden / Benutzen / im Dialog weiter |
| ← / Backspace | Im Dialog eine Zeile zurück (nachlesen) |
| T | 💻 Terminal |
| J | 📜 Logbuch (Questlog) |
| B | 📖 Sammelalbum (Glossar) |
| Esc | Fenster schließen |

Im 📜 **Logbuch (J)** blätterst du durch alle Quests: abgeschlossene zum **Nachlesen** (Dialoge & Hinweise), deine aktuelle Quest, und noch **gesperrte** als Vorschau (kein Vorausspringen). Es wird freigeschaltet, sobald du deine erste Quest abgeschlossen hast. Eine abgeschlossene Quest kannst du dort auch **🔁 erneut spielen** – in einer Sandbox, die deinen echten Fortschritt nicht anrührt; über **„↩️ Zur aktuellen Quest“** landest du jederzeit wieder genau dort, wo du warst.

Im 📖 **Sammelalbum (B)** sammelst du wie in einem Sticker-Album alles, was du lernst: **jeden Befehl** (z.B. `docker pull`, `kubectl get`) und **jedes Wissens-Stück** aus den Quiz-Karten. Einträge starten **verdeckt** und werden freigeschaltet, sobald du sie im Spiel kennengelernt hast – mit Fortschrittsanzeige „X von Y gesammelt“, gruppiert nach Themen-Seiten (Docker, Kubernetes, Helm …). Auch das Album wird nach deiner ersten abgeschlossenen Quest frei.

### Lernen in kleinen Schritten

Jeder Befehl wird **einzeln** eingeführt und sofort geübt:

1. **🆕 Vormachen** – ein NPC erklärt EINEN neuen Befehl (kurz!)
2. **⌨️ Nachtippen** – du tippst ihn selbst im Terminal
3. **🏋️ Drills** – Zufalls-Varianten („anderes Image, anderer Name, andere Zahl") bis es sitzt
4. **🤔 Verständnisfrage** – ins Gespräch eingebaut, keine Quiz-Wände
5. **🦀 Krabbe Kralle** – tägliche Karteikarten (Spaced Repetition), falsch Beantwortetes kommt öfter; bei Befehls-Karten darfst du nach einem Fehler den Befehl **erneut eintippen** (Lösung gibt's auf Wunsch oder nach ein paar Versuchen)

Dazu kannst du **jederzeit bei jedem NPC üben** (ansprechen → „Üben") – gibt Dublonen!

**65 Quests:** Einstieg (1) → Docker (8) → Kubernetes-Grundlagen (4) → YAML (1) → Helm (3) → Terraform (2) → Security/Secrets (2) → **Sturm-Saison: Troubleshooting (3)** → **Git (3)** → **CI/CD: Pipeline-Passage (1)** → **Werft-Ausbau: eigenes Helm-Chart & Vorlagen-Logik (2)** → **Hafenmauer: NetworkPolicy (1)** → **Hafentor: Ingress/TLS (1)** → **DNS im Cluster: CoreDNS, Service-Discovery & ExternalName (1)** → **Service-Endpoints-Debugging (1)** → **Resource-Management: requests/limits & OOMKilled (1)** → **GitOps-Archipel: GitOps-Prinzip → Argo CD Application & Sync → Self-Heal & Drift → App-of-Apps (4)** → **Monitoring-Leuchtturm: Metriken scrapen — Prometheus & kubectl top (1); Grafana-Dashboard — Datasource & Panels lesen (1); Logs lesen — kubectl logs, -f, --previous (1); Alerts & PrometheusRule — feuern, verstehen, auflösen (1)** → **Lagerhallen-Viertel: StatefulSet & stabile Identität (1); PVC/PV & StorageClass — Speicher anfordern (1); Flüchtiger Speicher — emptyDir, Node-Disk & Eviction (1); initContainer — emptyDir vorbereiten & der Peak beim Befüllen (1); Backup & Restore — VolumeSnapshot, Datenverlust & Wiederherstellung (1); Object Storage & Buckets — wann S3 statt Volume (1); Backup ins Object Storage (S3) — off-cluster sichern, 3-2-1 (1); Prod-DB im Cluster: ja oder nein? — Urteil & Trade-offs (1)** → **Wachturm-Quartier: ServiceAccounts — Identität für Pods (1); RBAC — Role & RoleBinding, Least Privilege (1); RBAC — ClusterRole & auth can-i, cluster-weite Rechte (1); Pod-Security — SecurityContext & Pod Security Standards, gehärtete Pods (1)** → **Expeditions-Flotte: Terraform-Module — wiederverwendbare Bausteine (1); Remote State — gemeinsames State-Backend & Locking (1); Provider & Cloud — Multi-Cloud mit mehreren Providern (1); Variablen & Outputs — Konfiguration sauber durchreichen (1)** → **Heimat-Werft: Meister-Abschluss — eigenen Dienst containerisieren, deployen & erreichbar machen (1)** → **Cluster selbst aufbauen: der große Sturm zerstört Port Kubernia — Wiederaufbau-Bogen, narrativer Einstieg (1); Control-Plane hochziehen — kubeadm init, apiserver/etcd/scheduler/controller-manager (1); Worker-Knoten anschließen — kubeadm join, kubelet & Join-Token, Kapazität/Ausfallsicherheit (1); Dienste wieder ausbringen — kubectl apply, Pod für Pod aus geretteten Manifesten, Service als feste Adresse (1); Cluster als Code — Capstone: terraform apply provisioniert Control-Plane + Worker reproduzierbar, manuell ↔ als Code (1)**.

Die **Hafenmauer** (bei Sturmwache Juno) führt **NetworkPolicies** ein: Kubernetes ist von Haus aus offen – jeder Pod erreicht jeden. Eine NetworkPolicy schaltet die per Label gewählten Pods auf **default-deny** und lässt nur erlaubte Quellen durch (`kubectl get/describe/apply/delete networkpolicy`). Genau so sichert man im Job z.B. Datenbanken ab.

Das **Adressbuch des Hafens** (bei Ada) führt **DNS im Cluster** ein: Pod-IPs wechseln ständig (Neustart, Self-Healing, Skalierung), darum redet man über **Namen**. **CoreDNS** löst jeden Service-Namen `<service>.<namespace>.svc.cluster.local` zur stabilen ClusterIP auf (`nslookup`), und ein **ExternalName**-Service verweist per CNAME auf einen Dienst außerhalb des Clusters.

Die **Pipeline-Passage** (bei Ada, direkt nach den Git-Quests) führt **CI/CD** ein: Eine `.gitlab-ci.yml` im Repo macht aus `git push` Automatik – ein Runner arbeitet die Stages **build → test → deploy** ab, und die deploy-Stage rollt den Dienst **ohne Handarbeit** in den Cluster (`glab ci status` zeigt das Ergebnis). Job-Bezug: genau die GitLab-CI-Deploy-Pipelines aus `roads-deployment`.

Die **Git-Quests** (bei Ada im Kartenhaus, „versioniere deine Seekarten") führen den Versionierungs-Alltag ein: `git init`/`status`/`add`/`commit`/`log` (ändern → vormerken → festhalten) und dann Zweige: `checkout -b`, `merge`, `push`. Echter Job-Bezug (Feature-Branch + Review-/Forward-Merge-Workflow) und Grundlage der späteren CI/CD-„Pipeline-Passage".

Die **Sturm-Saison** (bei Sturmwache Juno am Leuchtturm) lehrt das Debugging-Handwerk wie im echten Betrieb: `ImagePullBackOff` diagnostizieren und mit `kubectl set image` heilen, `CrashLoopBackOff` über die **Logs** verstehen und mit Secret + `rollout restart` beheben, `Pending`-Pods durch neue Nodes (Terraform!) einplanen. Das Mantra: **get pods → describe → logs.** Danach ziehen zufällige **Stürme mit Regen und Donner** auf, die live Deployments kaputtmachen – kaputte Dienste verdienen nichts, bis du sie reparierst!

### Spielsysteme

- **🪙 Hafen-Wirtschaft** – laufende Pods und Services verdienen passiv Dublonen (auch offline, gedeckelt). Gesunder Cluster = volle Kasse!
- **🏴‍☠️ Piraten-Überfälle** – Zufalls-Events: Piraten klauen Pod-Kisten, du stellst den Soll-Zustand unter Zeitdruck wieder her (Incident-Response!). Die Hafen-Kanone aus dem Shop erhöht das Kopfgeld.
- **🐙 Hacker-Krake** – schnüffelt nach Klartext-Daten; nur ein schnell angelegtes Secret vertreibt sie (Security!)
- **🎮 Bos Stapel-Spiel** – Docker-Image-Schichten in der richtigen Reihenfolge stapeln (lehrt Layer & Build-Cache)
- **XP & Ränge** (Landratte → Moses → … → Admiral), Shop mit Haustieren 🐀🦇👻, Schiffsflaggen, Hinweis-Items, 🔥 Tages-Streak

Die volle Einordnung des Lernpfads (Phasen 1–10, „Von 0 zu Senior DevOps") steht weiter unten in **[Lernpfad](#lernpfad-von-0-zu-senior-devops-ehrliche-einordnung)**.

---

## 🏛️ Architektur & Qualität

Kubernia ist bewusst so gebaut, dass es **so groß wie Stardew Valley** werden könnte (100+ Quests, 50+ NPCs, viele Welten) – ohne dass die Struktur bricht. Das ist die **oberste Regel** über allen Einzelentscheidungen. Was das konkret heißt:

- **🧱 Erzwungene Schichtung.** Der Code ist streng geschichtet – **pure Domäne → Anwendung → Präsentation** – damit die komplette Spiellogik (Cluster-Simulator, Wirtschaft, Content) **ohne Phaser** im Node-Test läuft. Diese Grenze ist nicht nur Konvention, sondern wird von **`dependency-cruiser`** erzwungen: importiert die Domäne versehentlich die Engine, schlägt der Build fehl. Dazu verbietet der Wächter **Import-Zyklen** und **toten Code**.
- **📦 Content-as-Data + Check-DSL.** Quests, Dialoge, NPCs und Quiz-Karten sind **Daten** (JSON), kein hartcodiertes TypeScript – pro Region/NPC eine Datei statt eines Monolithen. Quest-Bedingungen werden über eine deklarative **Check-DSL** ausgedrückt. So kostet neuer Inhalt keinen Code-Eingriff und der Build bleibt schnell.
- **💾 Versionierte Persistenz – der Save bricht nie.** Spielstände laufen über eine SaveStore-Schicht auf **IndexedDB** (kein 5-MB-localStorage-Limit mehr). Jede Formatänderung bekommt einen `version`-Bump + Migrationskette; Quest-Fortschritt persistiert per **sprechender ID**, nicht per Index, sodass eingeschobene oder umsortierte Quests keinen bestehenden Stand verschieben. „Was live geht, darf nie einen Spielstand kaputtmachen" ist eine harte Regel.
- **🔒 `strict` TypeScript, kein `any`.** Die ganze Codebasis (inkl. Tests und Build-Config) steht auf `"strict": true`; `@typescript-eslint/no-explicit-any` ist ein **Fehler**, der den Build blockt. Die wenigen bewusst nötigen Ausnahmen tragen eine begründete Disable-Zeile.
- **🎯 Taktisches DDD.** Fehlbare Konzepte werden **un-repräsentierbar** gemacht: Value Objects für Ressourcen-Namen (DNS-1123-Regel an einer Stelle) und für Dublonen (nicht-negativ + ganzzahlig by construction), dazu **Cluster-Invarianten** als SSOT für einen legalen Zustand, die der Simulator an der Aggregat-Grenze prüft.
- **✅ Fitness-Functions als CI-Gates.** Statt auf Review-Disziplin zu vertrauen, hält ein Netz aus automatischen Prüfungen die Architektur ehrlich – jede läuft lokal **und** als CI-Gate:

  | Gate | Was es sichert |
  |---|---|
  | `npm test` (Vitest) | Verhalten der Domäne/Sim/Wirtschaft, inkl. Negativ-/Grenzfälle (Red-Green-abgesichert) |
  | `npm run typecheck` | voll `strict`, ganzes Projekt |
  | `npm run lint` | ESLint typbewusst, `--max-warnings 0`, `any` blockt |
  | `npm run check:arch` | Schichtung + keine Zyklen + kein toter Code (dependency-cruiser) |
  | `npm run check:size` | God-File-Frühwarnung (Zeilen-Budget je Modul) |
  | `npm run check:docmap` | die Datei-Landkarte in CLAUDE.md kann nicht leise veralten |
  | `npm run check:docdrift` | dokumentierte `npm run`-Kommandos + interne Doku-Links/Anker können nicht leise veralten |
  | `npm run smoke` | Boot- & Interaktions-Smokes headless gegen den echten Offline-Build (Playwright) |
  | `npm audit --omit=dev` | Security-Gate über die ausgelieferten Produktiv-Deps |

**Mehr Tiefe:** die vollständige Architektur-Gesamtsicht nach **arc42** steht in [docs/arc42-architektur.md](docs/arc42-architektur.md); die frische, doku-unabhängige **iSAQB-Analyse** (fünf Durchläufe je Schicht) in [docs/architektur-analyse-2026-07-iSAQB.md](docs/architektur-analyse-2026-07-iSAQB.md). Die bewusst festgehaltenen Grundsatzentscheidungen liegen als **ADRs** unter [docs/adr/](docs/adr/) (Engine Phaser, kein Backend/DB, kein Multiplayer, Skalierungs-Fundament).

---

## 🤖 Gebaut von KI-Agenten

Der komplette Code von Kubernia entsteht durch **autonome KI-Coding-Agenten** – kein Mensch tippt die Implementierung. Das ist nur deshalb sicher und billig, weil das Repo als **Harness** um die Agenten herum gebaut ist: klare Leitplanken, an denen ein Agent nicht vorbeikommt, statt Vertrauen in einen einzelnen guten Lauf. Die Bausteine:

- **📖 Selbstdokumentierendes Repo (SSOT im Code).** Ein Agent findet alles, was er braucht, im Repo selbst – auch ohne externes Wissen (frischer Clone, Cloud-Agent). [CLAUDE.md](CLAUDE.md) ist der Schnellstart + die Datei-für-Datei-Landkarte, [AGENTS.md](AGENTS.md) die ausführliche Arbeitsanweisung (harte Regeln, Board-Workflow, Konventionen), dazu **modul-lokale** `AGENTS.md` (z.B. in `src/content/`), die nur gelesen werden, wenn man im jeweiligen Bereich arbeitet (Kontext als Token-Grenze).
- **🗂️ Board-getriebener Ein-Ticket-Workflow.** Der Backlog lebt als **GitHub Issues** + Project-Board; eine [deterministische Auswahl-Regel](docs/ticket-reihenfolge.md) (Prio → niedrigste Nummer) sagt, was als Nächstes dran ist. Ein Agent nimmt **genau ein** Ticket, arbeitet es end-to-end ab (umsetzen → Gates grün → im Browser verifizieren → nach `main` → Issue schließen) und pflegt danach das Board.
- **🚦 Kollisionsschutz für parallele Agenten.** Mehrere Agenten können gleichzeitig laufen, ohne sich in die Quere zu kommen: Ein Ticket wird per **Assignee** als „in Arbeit" markiert (der einzige Zustand, den ein paralleler Agent sieht) und in einem **eigenen `git worktree`** auf eigenem Branch bearbeitet – so teilen sich zwei Chats nie dasselbe Arbeitsverzeichnis.
- **🛡️ Automatische Gates als Sicherheitsnetz.** Genau die [Fitness-Functions oben](#-architektur--qualität) (typecheck/lint/arch/size/docmap/test/smoke/audit) sind das, was autonome Entwicklung absichert: Ein Agent kann keinen Schichtbruch, keinen `any`, kein God-File, keine veraltete Doku-Landkarte und keine gebrochene Save-Migration unbemerkt einschleusen – der Build wird rot. **Determinismus** (seedbare Zufälligkeit statt `Math.random` in der Domäne) und die **Save-nie-brechen-Regel** gehören zum selben Netz.
- **🧩 Skills für wiederkehrende Abläufe.** Der immer gleiche Ticket-Ablauf ist als **Skill** kodifiziert (`kubequest`), ebenso das Bearbeiten des Forums (`forum`, GitHub Discussions mit Freigabe-Stopp vor dem Posten) – reproduzierbare Abläufe statt freihändiger Improvisation.

**Warum das funktioniert:** Nicht ein einzelner cleverer Prompt macht autonome KI-Entwicklung sicher, sondern die **Leitplanken drumherum** – SSOT-Doku, ein enger Ticket-Fokus, Kollisionsschutz und ein Gate-Netz, das jeden Fehler an der Grenze abfängt. Genau diese Kombination ist selbst ein Architekturziel (siehe [arc42 §8](docs/arc42-architektur.md)).

> 📝 Die **kanonische Harness-Tiefendoku** — der KI-Agenten-Harness als System, „wie + warum" an einer Stelle — steht in **[docs/agent-harness.md](docs/agent-harness.md)**. Sie ist die erklärende Gesamtsicht; die operative Arbeitsanweisung bleibt [AGENTS.md](AGENTS.md), der Schnellstart + die Datei-Landkarte [CLAUDE.md](CLAUDE.md).

---

## Projektstruktur

Gebaut mit **Vite** + **TypeScript** (ES-Module) und **Phaser 3** (als npm-Paket, nicht mehr als Datei im Repo). `index.html` lädt nur `src/main.ts`; Vite bündelt den Rest. Es gibt zwei Build-Wege aus derselben Quelle: den Standard-Build (`npm run build` → `dist/`, gehostet, Assets als eigene Dateien) und den Offline-Export (`npm run build:offline` → self-contained `dist-offline/index.html` für den Doppelklick). Der Code ist in Schichten geordnet (pure Domäne → Anwendung → Präsentation), damit die Spiellogik ohne Phaser testbar bleibt.

Grobe Aufteilung:

```
kubequest/
├── index.html        Dev-Einstieg (lädt src/main.ts; braucht den Vite-Server)
├── style.css         UI (HUD, Dialoge, Terminal, Shop, Alarm, Minispiel)
├── src/              Spielcode
│   ├── sim.ts         Cluster-Simulator (docker, kubectl, helm, terraform, secrets, git)
│   ├── content.ts     Fassade über src/content/ (Quests, Drills, Quiz, NPCs, Minispiel …)
│   ├── game.ts        Spielstand, XP, Wirtschaft, Spaced Repetition
│   ├── scenes.ts      Phaser-Welt: Karte, Cluster-Sync, Piraten, Krake
│   └── …              ui, world, decor, clock, runtime, store, sfx, types, assets-data
├── test/             Test-Suite (Vitest) – Simulator, Inhalte, kompletter Story-Durchlauf u.a.
├── e2e/              Boot- & Interaktions-Smokes (Playwright, gegen den Offline-Build)
├── assets/           Kenney- & PixelLab-Grafiken (CC0) + Lizenzen
├── docs/             Konzept-, Architektur- & Harness-Doku (arc42, ADRs, Analysen, Reihenfolge)
├── dist/             Host-Build von `npm run build` (Multi-File, nicht eingecheckt)
└── dist-offline/     Offline-Build von `npm run build:offline` (eine self-contained index.html, nicht eingecheckt)
```

> **Datei-für-Datei-Landkarte** (welches Modul macht was, Schicht für Schicht) steht in **[CLAUDE.md › Repo-Landkarte](CLAUDE.md)**, die Agenten-Regeln & Konventionen in **[AGENTS.md](AGENTS.md)**. Diese Listen werden dort gepflegt – hier bewusst nicht doppelt.

Tests ausführen: `npm test` (Vitest). Typen prüfen: `npm run typecheck` (voll strict, ganzes Projekt).

**TS-Strenge:** Der schrittweise Strenge-Ratchet ist **abgeschlossen** – die Basis-`tsconfig.json` steht selbst auf `"strict": true` und deckt das **ganze Projekt** ab: alle `src`-Module (inkl. `scenes`, `ui`, `main`, `sfx`), die Tests und `vite.config`. Echte Parameter-/Feld-Typen statt `any`, durchgängige Null-Prüfung; die Cluster-Interfaces Pod/Deployment/Service … liegen in `src/sim.ts`. So können weder Null-/Typ- noch versteckte `any`-Fehler mehr einschleichen. `npm run typecheck` prüft das; `npm run typecheck:strict` ist nur noch ein Alias darauf (siehe `tsconfig.strict.json`).

## Lizenzen

**Kubernia selbst ist proprietär:** © 2026 [fluffels](https://github.com/fluffels) – **alle Rechte vorbehalten**. Den Quellcode hier ansehen und das Spiel über die bereitgestellten Kanäle spielen ist ausdrücklich erlaubt; Forken/Klonen zur eigenständigen Weiterführung sowie jede kommerzielle Nutzung sind **nicht** gestattet. Verbindlich ist die [`LICENSE`](LICENSE) im Repo-Root. Beiträge per Pull Request sind weiterhin willkommen – siehe [CONTRIBUTING.md](CONTRIBUTING.md).

Verwendete Fremd-Bausteine mit eigener Lizenz:

- **Phaser 3** – MIT-Lizenz (kostenlos, auch kommerziell): https://phaser.io
- **Grafiken (eigener Pixel-Art-Stil)** – mit **[PixelLab AI](https://pixellab.ai)** im Top-down-Pixel-Art-Look erzeugt; sie ersetzen nach und nach die ursprünglichen Platzhalter. Asset-Liste, IDs & Workflow: [`assets/pixellab/README.md`](assets/pixellab/README.md).
- **Grafiken (Platzhalter)** – „Tiny Town" & „Tiny Dungeon" von [Kenney](https://kenney.nl), **CC0** (public domain), noch für einzelne Tiles im Einsatz, bis der PixelLab-Ersatz steht. Danke, Kenney! 💛
- Sounds werden zur Laufzeit synthetisiert (WebAudio) – keine Audio-Dateien nötig.

## Spielstand

Wird **automatisch alle 5 Sekunden** im Browser gespeichert (IndexedDB). Im 📜 Logbuch (Taste J) gibt es zusätzlich **„Spielstand sichern“** (lädt eine JSON-Datei herunter) und **„Spielstand laden“** – für Backups oder den Umzug auf einen anderen Rechner/Browser.

**Mehrere Spielstände:** Im ⚓ Menü (Taste Esc) kannst du unter **„Spielstände“** mehrere Stände nebeneinander halten und zwischen ihnen wechseln – z.B. einen eigenen zum Weiterspielen und einen frischen zum Ausprobieren/Vorführen, oder pro Person ein Profil. Neue Stände anlegen, umbenennen und löschen geht dort ebenfalls; ein bereits vorhandener Einzel-Spielstand wird automatisch zum ersten Slot.

## Mitentwickeln (Entwickler:innen & KI-Agenten)

Voraussetzung: **Node ≥ 22** (siehe [`.nvmrc`](.nvmrc)). In **einem** Befehl startklar:

```
npm run setup   # prüft Node, installiert, lässt Tests + Typecheck + Architektur-Wächter einmal laufen
npm run dev     # Dev-Server – angezeigte Adresse im Browser öffnen
```

Voller Einstieg (Voraussetzungen, Alltags-Befehle, „wo finde ich was"): **[CONTRIBUTING.md](CONTRIBUTING.md)**.

- **Wo liegt was?** Datei-für-Datei-Landkarte: [CLAUDE.md](CLAUDE.md).
- **Wie wird hier gearbeitet** (Regeln, Board-Workflow, Konventionen): [AGENTS.md](AGENTS.md).
- **Wie KI-Agenten hier bauen** (der Harness): siehe [Gebaut von KI-Agenten](#-gebaut-von-ki-agenten) oben.
- **Architektur-Stand & Ticket-Auswahl** (Stardew-Scope): [docs/arc42-architektur.md](docs/arc42-architektur.md) + [docs/ticket-reihenfolge.md](docs/ticket-reihenfolge.md).

> Eine **containerisierte Dev-Umgebung** (devcontainer/`docker compose`) ist in Arbeit (#388) und macht den Einstieg künftig noch reproduzierbarer.

## Dev-/Test-Modus (nur für Entwickler:innen)

Für die Entwicklung gibt es ein **Dev-/Test-Panel**, mit dem man gezielt zu einem beliebigen Quest-/Story-Stand springen und Erststart vs. Zurücksetzen testen kann – statt sich jedes Mal von vorn durchzuspielen. Es ist **bewusst nicht für Spieler:innen gedacht** und doppelt abgesichert: Der Code fällt aus den ausgelieferten Builds (`build`/`build:offline`) komplett heraus und ist **nur im Dev-Server** vorhanden, und dort ist der Einstieg zusätzlich **passwortgeschützt**. Das Passwort liegt ausschließlich lokal (in einer nicht eingecheckten `.env`, Vorlage: [`.env.example`](.env.example)) und steht **nicht** im Repo – wer das Projekt klont, kann das Panel ohne eigenen Passwort-Eintrag nicht öffnen.

Zusätzlich gibt es einen **verteilbaren Spezial-Build** (`npm run build:devpanel` → eine self-contained `dist-devpanel/index.html`), der das Panel **mit** ausliefert – z.B. um einen Stand auf einem anderen Rechner zu testen, ohne dort den Dev-Server zu starten. Das Passwort wird dabei **zur Build-Zeit** aus der Umgebungsvariable `VITE_KQ_DEVPANEL_PW` injiziert; in der CI kommt sie aus einem GitHub-Actions-**Secret** (serverseitig, überlebt einen lokalen Rechner-Ausfall – der Wert steht weiterhin nirgends im Repo). Der normale `build`/`build:offline` enthält das Panel weiterhin **nicht**.

## Lernpfad: Von 0 zu Senior DevOps (ehrliche Einordnung)

Das Spiel deckt aktuell die **Phasen 1–10** ab – vom Fundament über Terraform im Großen bis zum Meister-Abschluss, bei dem du einen eigenen Dienst von Grund auf baust, deployst und erreichbar machst. Senior wird man durch Wissen **plus Betriebserfahrung**; das Spiel baut Wissen und Muskelgedächtnis auf, echte Projekte bauen die Erfahrung.

| Phase | Thema | Status |
|---|---|---|
| 1 | Container, Kubernetes-Basics, YAML, Helm, Terraform, Secrets | ✅ im Spiel (18 Quests, inkl. Warenkunde gängiger Images, eigenes Docker-Image bauen & eigenes Helm-Chart „Werft-Ausbau“) |
| 2 | Git & Branching-Workflows + CI/CD-Pipelines | ✅ im Spiel (Git: 3 Quests bei Ada; CI/CD: „Pipeline-Passage“) |
| 3 | Ingress, DNS, TLS, NetworkPolicies | ✅ im Spiel: Ingress + TLS („verschlüsseltes Hafentor“ bei Ada) + NetworkPolicies („Hafenmauer“ bei Juno) + DNS/Service-Discovery & ExternalName („Adressbuch des Hafens“ bei Ada, CoreDNS & `nslookup`) |
| 4 | GitOps (Argo CD), App-of-Apps, Pull-Prinzip | ✅ im Spiel: Insel „GitOps-Archipel“ (Anleger/Warp per Steg) mit GitOps-Lotsin Argo – 4 Quests: GitOps-Prinzip & Single Source of Truth → Argo-CD-Application anlegen & syncen (Pull) → Self-Heal & Drift → App-of-Apps |
| 5 | Observability: Prometheus, Grafana, Logs, Alerts | ✅ im Spiel: Klippe „Monitoring-Leuchtturm“ (Aufgang/Warp am Turmfuß, Dashboard-Tafel & Alarm-Glocke) mit Leuchtturmwärterin Lumi – 4 Quests: Metriken scrapen (Prometheus & `kubectl top`, ServiceMonitor) → Grafana-Dashboard (Datasource & Panels lesen) → Logs lesen (`kubectl logs`, `-f`, `--previous`) → Alerts & PrometheusRule (feuern, verstehen, auflösen); dazu Observability-Drills & Quiz-Karten |
| 6 | RBAC, ServiceAccounts, Pod-Security | ✅ im Spiel: „Wachturm-Quartier“ (befestigter Hof mit Wachturm, Holz-Anleger/Warp an der Südost-Ecke des Hafenkais) mit Wachveteran **Vidar** – 4 Quests: ServiceAccounts (Identität für Pods) → RBAC: Role & RoleBinding (Least Privilege) → RBAC: ClusterRole & auth can-i (cluster-weite Rechte) → Pod-Security: SecurityContext & Pod Security Standards (gehärtete Pods); dazu RBAC/Security-Drills & Quiz-Karten |
| 7 | StatefulSets, Volumes, Backups, Datenbanken im Cluster | ✅ im Spiel: Hafenkai „Lagerhallen-Viertel“ (Holz-Anleger am Westkai, Verladekräne, Frachtcontainer-Stapel) mit Speicher-Verwalter **Knut** – 5 Quests: StatefulSet & stabile Identität → PVC/PV & StorageClass (Speicher anfordern) → Flüchtiger Speicher (emptyDir, Node-Disk & Eviction) → initContainer (emptyDir vorbereiten & der Peak beim Befüllen) → Backup & Restore (VolumeSnapshot, Datenverlust & Wiederherstellung) → Prod-DB im Cluster: ja oder nein? (Urteil & Trade-offs); dazu Storage-Drills & Quiz-Karten |
| 8 | Troubleshooting-Methodik (CrashLoop, ImagePull, Pending, Service-Endpoints, OOMKilled …) | ✅ im Spiel („Sturm-Saison“ + Service-Debugging + Resource-Management: 5 Quests + Zufalls-Stürme) |
| 9 | Terraform-Module, Remote State, Cloud-Provider | ✅ im Spiel: „Expeditions-Flotte“ (Flaggschiff-Deck mit Anleger/Warp per Steg im Süden des Hafens, ringsum vertäute Flotten-Schiffe) mit Flottenkommandantin **Saga** – 4 Quests: Terraform-Module (wiederverwendbare Bausteine) → Remote State (gemeinsames State-Backend & Locking) → Provider & Cloud (Multi-Cloud mit mehreren Providern) → Variablen & Outputs (Konfiguration sauber durchreichen); dazu Terraform-Drills & Quiz-Karten |
| 10 | Capstone-Meisterstück: eigenen Dienst containerisieren, deployen & erreichbar machen | ✅ im Spiel: „Heimat-Werft“ (eigener Werft-Hof mit Helling & Anleger/Warp) mit Werftmeisterin **Greta** – Meister-Abschluss in einer Quest, die die ganze Kette an einem Stück verlangt: Dockerfile lesen → `docker build` (eigenes Image) → `kubectl apply` (Deployment, hängt erst im ImagePullBackOff) → Image bauen & `rollout restart` → `Service` davor → `curl` bestätigt die 200; dazu Capstone-Drills bei Greta & Quiz-Karten |

## Roadmap (nächste Ausbaustufen)

- Weitere Lernpfad-Inseln (siehe Tabelle oben) – die nächsten Ausbaustufen jenseits der bisherigen Phasen 1–10, je Insel eigene NPCs, Quests und Drills
- Mehr Grafik: weitere CC0-Packs, z.B. Innenräume für betretbare Gebäude
</content>
