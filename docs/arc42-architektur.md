# KubeQuest — Architektur-Analyse nach arc42

> **Stand: 2026-07-01** (nach #475). Beschreibung + Bewertung der Architektur entlang der arc42-Gliederung (die Vorlage, die iSAQB lehrt).
> Diese Datei ist die aktuelle, versionierte Architektur-Sicht. Sie **ergänzt** die ältere, Infrastruktur-fokussierte [architektur-analyse-2026-06.md](architektur-analyse-2026-06.md) (deren Baustellen #350/#389/#390/#391/#392/#393/#411/#413 inzwischen erledigt sind) um eine strukturierte Gesamtsicht.
> Umsetzungs-Reihenfolge: [ticket-reihenfolge.md](ticket-reihenfolge.md).

## 1. Einführung und Ziele

KubeQuest bringt DevOps-Grundlagen (Docker, Kubernetes, Helm, Terraform, Security) bei, indem Lernende **echte Befehle an einen simulierten Cluster** schicken — sichtbar als Hafenstadt Port Kubernia (Pods = Kisten auf Stegen/Nodes, Services = Laternen, `terraform apply` baut sichtbar neues Land).

**Oberste Qualitätsanforderung (über allen ADRs):** „Trägt jede Entscheidung, wenn KubeQuest so groß wie Stardew Valley wird?" (100+ Quests, 50+ NPCs, viele Welten, jahrelange Entwicklung).

**Top-Qualitätsziele:**
1. **Erweiterbarkeit auf Content-Tiefe** — neuer Inhalt darf den Build nicht verlangsamen und keinen Code-Eingriff erzwingen.
2. **Korrektheit & Testbarkeit der Spiellogik** — die Simulation muss ohne die Engine prüfbar sein; ein falsch simuliertes `kubectl` ist ein didaktischer Fehler.
3. **Portabilität & Datensicherheit** — offline lauffähig, als eine Datei weitergebbar; kein Update darf je einen bestehenden Spielstand brechen.
4. **KI-Entwickel-Effizienz** — Weiterbau ist stark KI-Agenten-getrieben, darum ist „eine KI ändert das billig und sicher" selbst ein Architekturziel (siehe §8, Kontext-Grenzen als Token-Grenzen).

## 2. Randbedingungen

| Kategorie | Randbedingung |
|---|---|
| Technisch | Reiner Client, keine Server-Laufzeit. Genau **eine** Laufzeit-Dep (Phaser 3.90). TypeScript durchgängig `strict`. Node ≥ 22. Browser **und** self-contained Doppelklick-HTML. |
| Organisatorisch | Solo-Maintainerin, KI-Agenten-getriebener Weiterbau. Selbstdokumentierendes Repo (AGENTS.md/CLAUDE.md als SSOT). Board-getriebener Ein-Ticket-Workflow mit Worktrees. |
| Fachlich | Der simulierte Cluster muss sich plausibel wie echtes `kubectl`/`helm`/`docker` verhalten (Lerntransfer). Deutsch in Texten/Kommentaren. |
| Rechtlich | Öffentliches, aber **proprietäres** Repo. Fremdbausteine sauber lizenziert (Phaser MIT, Kenney CC0). |

## 3. Kontextabgrenzung

Der fachliche Kontext ist bewusst schmal:
- **Spieler:in** — einzige menschliche Rolle: tippt Befehle, löst Quests, lernt.
- **Browser-Plattform** — Rendering (Canvas/WebGL via Phaser), Eingabe, WebAudio (Sounds synthetisiert), und **IndexedDB** als einziges externes System.
- **Kein Netzwerk, kein Backend, keine echte Cloud** — der „Cluster" ist vollständig in-process simuliert.

> Das einzige echte Fremdsystem ist der Browser-Speicher. Alles, was in einem echten DevOps-Werkzeug ein Netzwerk-Call wäre, ist hier eine Zustandsänderung in der reinen Domäne — deshalb ist die Domäne vollständig deterministisch testbar.

## 4. Lösungsstrategie

| Qualitätsziel | Ansatz |
|---|---|
| Testbarkeit | Strikte **Schichtung**: pure Domäne Phaser-/DOM-frei; Grenze per `dependency-cruiser` **erzwungen**. |
| Erweiterbarkeit | **Content-as-Data**: Quests/NPCs/Dialoge/Drills als validiertes JSON; Quest-Checks als deklarative DSL; Entities als datengesteuerte Registry. |
| Datensicherheit | **Repository-Kapsel** `SaveStore` über IndexedDB, versionierte Hülle `{v,data}`, Migrationskette, Backup-Slot vor jeder Migration. |
| Portabilität | **Zwei Builds aus einer Quelle**: Multi-File-Host-Build + self-contained Offline-Single-File. |
| KI-Wartbarkeit | **Fitness Functions** als CI-Gates: Lint, Schicht-/Zyklen-/Größen-Wächter, headless Boot-Smoke. |

## 5. Bausteinsicht (Ebene-1-Zerlegung)

Abhängigkeiten zeigen strikt **nach innen** — auf die reine Domäne, die nichts von der Engine weiß.

```
Einstieg/Assets:  main.ts · assets-data.ts   (index.html lädt nur main.ts, Vite bündelt)
────────────────────────────────────────────────────────────────────────────
Präsentation      scenes.ts + scenes/worldscene/* · ui.ts + ui/* · sfx.ts     (Phaser · DOM)
      │  (Abhängigkeit nach unten)
Anwendung         game.ts + game/* (Wirtschaft/XP/Progression/Spaced Repetition) · runtime.ts · devpanel.ts
      │
╌╌╌╌╌╌╌╌╌ dependency-cruiser: Phaser & DOM kommen hier nicht durch ╌╌╌╌╌╌╌╌╌
pure Domäne       sim.ts + sim/* (docker/kubectl/helm/…) · content.ts + content/* (Quests, Checks-DSL, Registry)
                  world · clock · decor · pixelfont …
────────────────────────────────────────────────────────────────────────────
Persistenz (seitlich, von Anwendung genutzt):  store.ts — SaveStore, IndexedDB, sync API via In-Memory-Cache
```

Die gestrichelte Linie ist eine **erzwungene Fitness Function**, keine Konvention. Große Familien sind hinter einer **Fassade/Barrel** gesplittet (`sim.ts`, `ui.ts`, `scenes.ts`, `game.ts` spreaden je ihre `*/`-Bündel): öffentliche API stabil, Innenstruktur skaliert. Ein Datei-Budget (800 LOC) meldet neue God-Files früh.

## 6. Laufzeitsicht — „Self-Healing zum Zugucken"

1. **Eingabe:** Spieler:in tippt `kubectl delete pod kasse-0` (Präsentation).
2. **Dispatch:** UI reicht die rohe Zeile an `Sim.exec()` — kein Phaser-Objekt überquert die Grenze, nur ein String.
3. **Zustandsänderung:** Der Simulator entfernt den Pod aus `ClusterState`, markiert das Deployment unter-repliziert; Rückgabe = reines Ergebnis-Objekt.
4. **Reconcile:** Beim nächsten Tick stellt die Domäne den Soll-Zustand wieder her (deterministisch, testbar).
5. **Darstellung:** `clustersync` liest den Snapshot; die Kiste platscht ins Wasser, der Kran setzt Ersatz. Die Präsentation **folgt** der Domäne.

Diese Einbahn-Kopplung macht Schritt 3–4 in Millisekunden testbar, ganz ohne Schritt 1 und 5.

## 7. Verteilungssicht

Ein Quelltext, über Vite-`mode` konfiguriert → zwei Auslieferungen: **Host-Build** (`dist/`, Multi-File, für Webserver) und **Offline-Build** (`dist-offline/index.html`, self-contained, Doppelklick, offline). Der Boot-Smoke-Test (Playwright, headless) prüft genau den Offline-Pfad per `file://`. Betriebs-Docker gibt es bewusst nicht; ein Dev-Container ist reine Entwickler-Tooling.

## 8. Querschnittliche Konzepte & DDD-Bewertung

Vier Konzepte durchziehen den Code: **Schichtung** (§5), **Content-as-Data**, **versionierte Persistenz** und das **Test-Harness** (geteilte Umgebung in `test/support/`, valide Domänen-Eingaben als Factories in `test/factories/`; Tests prüfen Verhalten über die öffentliche API, nicht Interna — #475).

### DDD — ehrliche Einordnung

**Taktisches DDD lebt das Projekt bereits an der teuersten Stelle:** eine framework-freie, *erzwungene* Domänenschicht + eine Repository-Kapsel (`SaveStore`).

**Kein strategisches DDD mit getrennten Deployables/Packages** — das wäre Over-Engineering. **Aber:** KubeQuest ist ein **modularer Monolith mit ~2–3 Subdomänen**, deren eigene Sprache real ist. Bounded Contexts sind hier vor allem **Grenzen für kognitive Last = Token-Last** bei KI-Entwicklung (explizites Qualitätsziel):

| Subdomäne | Eigene Sprache | Code |
|---|---|---|
| DevOps-Simulation | echtes K8s (Pod/Node/Deployment/Service) | `sim/*` |
| Lern-/Progression | Pädagogik (Quest/XP/Dublonen/Leitner-Box) | `game/*`, Lern-Teile `content/*` |
| Welt/Präsentation | räumlich/Hafen (Kiste/Steg/Laterne) | `world`, `scenes/*` |

Die Modul-Splits + die on-demand-Tiefendocs der CLAUDE.md **sind** bereits solche Token-Grenzen. Was fehlt: die Subdomänen **explizit benennen** und die Übersetzung Hafen↔K8s (eine echte **Anti-Corruption-Layer**) als Glossar festhalten. *Nuance:* mehr Kontexte ≠ automatisch weniger Tokens — zu viele Nähte erzeugen Übersetzungs-Code; Sweet Spot sind die 2–3, nicht zehn. **Contexts benennen, nicht auseinanderreißen.** → #477.

### Der DDD-Hebel — drei gezielte Schritte

| Muster | Heute | Schritt | Ticket |
|---|---|---|---|
| Ubiquitous Language | Übersetzung Hafen↔K8s nur „im Kopf" | Glossar + Kontext-Landkarte | #477 |
| Aggregat & Invarianten | Prüfungen um `ClusterState` verteilt | `ClusterState` als Aggregat, ungültige Zustände un-konstruierbar | #478 |
| Value Objects | Primitive (`string` Pod-Name, `number` Dublonen) | Value Objects, illegale Zustände un-repräsentierbar | #479 |

### Weitere Querschnitts-Konzepte (Status)

- **Sicherheit/Supply-Chain:** Dependabot + zweistufiges `npm audit`-CI-Gate (blockt nur ausgelieferte Deps). Dev-Panel aus Prod-Builds gestrippt + passwortgated. **Abgedeckt.**
- **Determinismus/Zufall:** Tests brauchen Determinismus; Deko ist deterministisch geseedet, Zufallsevents (Piraten/Drills) brauchen eine bewusste Seed-Strategie — **als Konzept nicht dokumentiert** (kleine Schuld).

## 9. Architekturentscheidungen (ADRs)

| ADR | Entscheidung | Status |
|---|---|---|
| 0001 | Engine Phaser 3 (kein Godot/Unity) | bestätigt |
| 0002 | Kein Backend, keine DB — client-only | bestätigt |
| 0003 | Kein Multiplayer / Co-op | bestätigt |
| 0004 | Skalierungs-Fundament (Content-as-Data, Entity-Registry, IndexedDB) | umgesetzt |
| 0005 | Auslieferungsform Web vs. Desktop | **offen gehalten** (ergebnisoffener ADR + Re-Eval-Trigger) |
| 0006 | Persistenz-Präzisierung: Engpass ist Eviction, nicht Kapazität → `storage.persist()` | präzisiert |
| 0007 | Spielsystem-Fundamente (Quest-Modell, Checks-als-Daten, Zeit-Achse) | umgesetzt |

iSAQB-konform: jeder ADR trägt einen expliziten **Re-Evaluierungs-Trigger** — Entscheidungen sind an nachprüfbare Bedingungen geknüpft, nicht „für immer".

## 10. Qualitätsanforderungen (Qualitätsbaum)

Konkrete Szenarien (Reiz → Reaktion) statt vager Adjektive:

| Qualität | Szenario | Status |
|---|---|---|
| Erweiterbarkeit | Neue Quest → eine JSON-Datei + Reihenfolge-Eintrag, kein Code; Loader validiert beim Start | erfüllt |
| Testbarkeit | Sim-Regel ändern → Unit-Test gegen pure Domäne ohne Engine; Suite < 3 s | erfüllt |
| Datensicherheit | Save-Format ändert sich → Migrationskette + Backup-Slot; Alt-Stand bricht nie | erfüllt |
| Portabilität | Spiel weitergeben → ein Doppelklick-HTML, offline | erfüllt |
| Wartbarkeit (KI) | Agent ändert Modul → Lint/Arch/Größe/Smoke fangen Fehler vor dem Merge | erfüllt |
| Performance | Viele Inseln/Sprites → Culling greift, aber Assets werden noch eager geladen | teilweise |

## 11. Risiken und technische Schulden

| Befund | Wirkung bei Stardew-Scope | Schwere | Ticket |
|---|---|---|---|
| Assets eager geladen, kein Lazy-Loading / Texture-Atlas | Lade-/Draw-Call-Problem bei vielen Welten/Sprites | mittel | #198/#339 |
| Ubiquitous Language nur implizit (kein Glossar/ACL-Doku) | Übersetzung Hafen↔K8s driftet mit mehr Beitragenden/Agenten | mittel | #477 |
| Präsentation ohne Regressionsnetz (nur 1 Boot-Smoke + manuell) | Interaktions-Regressionen kommen durch | mittel | #480 |
| Auslieferungsform (ADR 0005) offen | Färbt save-/asset-/build-nahe Entscheidungen | mittel | #355 |
| Barrierefreiheit ungeprüft (Farb-Status, Tastatur, Kontraste) | Lernspiel schließt Nutzer:innen aus | niedrig | #481 |
| Invarianten um `ClusterState` verstreut | Neue Sim-Befehle können Zustandsregeln umgehen | niedrig | #478 |
| Primitive statt Value Objects | Verwechslungs-/Validierungsfehler skalieren mit Befehlszahl | niedrig | #479 |
| Deutsch fest verdrahtet (i18n) | Kein „gratis später" — bewusste Randbedingung | niedrig | — |
| NPC-Routinen (#420) & Inventar (#421) zurückgestellt | Bekannte Scope-Fragen, bewusst geparkt | bekannt | #420/#421 |

**Gesamtverdikt:** Das Infrastruktur-Fundament trägt — Schichtung, Content-as-Data und versionierte Persistenz sind die richtigen, automatisch bewachten Weichen. Die offene Arbeit ist **Politur** (Asset-Skalierung, Präsentations-Tests) und **DDD-Präzisierung** (Sprache/Kontexte, Aggregat, Value Objects), kein Umbau.

## 12. Glossar — die zwei Sprachen von Port Kubernia

Diese Tabelle **ist** die Anti-Corruption-Layer aus §8, explizit gemacht (Kern von #477):

| Hafen-Metapher | DevOps-Domäne | Beispiel |
|---|---|---|
| Kiste auf dem Steg | Pod | Pod löschen → Kiste platscht ins Wasser |
| Steg am Dock | Node | Drei Stege = drei Nodes |
| Laterne | Service | leuchtet, wenn erreichbar |
| Flagge | Helm-Release | Release hissen = Flagge setzen |
| Fass am Dock | Docker-Container | gestoppte Container ins Lager |
| Neues Land im Meer | `terraform apply` | Provisionierung wird sichtbar gebaut |
| Sturm / Piraten-Überfall | Incident | Soll-Zustand unter Zeitdruck wiederherstellen |
| Hacker-Krake | Klartext-Secret-Leak | nur ein schnell angelegtes Secret vertreibt sie |
