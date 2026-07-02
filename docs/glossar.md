# Glossar & Kontext-Landkarte — die Sprachen von Port Kubernia

> **SSOT für die _ubiquitäre Sprache_ und die _Subdomänen_ von KubeQuest** (#477, aus der [arc42-Analyse › §8 DDD](arc42-architektur.md#8-querschnittliche-konzepte--ddd-bewertung)).
> Warum diese Datei existiert: KubeQuest hat faktisch **mehrere ubiquitäre Sprachen** (echtes K8s, die Hafen-Metapher, die Lern-/Progressions-Begriffe), deren Übersetzung bisher nur „im Kopf" lebte. Explizit gemacht ist sie eine echte **Anti-Corruption-Layer** und — weil der Weiterbau KI-getrieben ist — ein **Token-Effizienz-Hebel**: Wer weiß, welche Sprache in welchem Verzeichnis gilt, lädt kontext-lokal und weniger.
> Verwandt: die Datei-für-Datei-Landkarte steht **einmal** in [CLAUDE.md](../CLAUDE.md), die Schichtungs-Begründung in [AGENTS.md › Architektur](../AGENTS.md#architektur).

## 1. Ubiquitous Language — Glossar Hafen ↔ K8s/DevOps ↔ Code

Die Hafen-Metapher ist die **Anti-Corruption-Layer** zwischen der Spieler:innen-Welt und der echten DevOps-Domäne: der Spieler sieht eine Kiste, der Simulator kennt einen Pod. Die Übersetzung passiert an der Render-Grenze (`scenes/worldscene/clustersync.ts`) und in den Content-Texten (`hud/markup.ts`). Diese Tabelle hält sie fest.

### 1a. Der Cluster als Hafen (DevOps-Simulation)

| Hafen-Metapher | K8s/DevOps-Begriff | Code-Ort (Domäne → Darstellung) | Beispiel |
|---|---|---|---|
| Kiste auf dem Steg | **Pod** | `sim/state.ts` (Typ) → `scenes/worldscene/clustersync.ts` (Kiste) | Pod löschen → Kiste platscht ins Wasser, der Kran setzt Ersatz |
| Steg am Dock | **Node** | `sim/state.ts` → `world.ts` (Steg-Geometrie) | Drei Stege = drei Nodes |
| Laterne | **Service** | `sim/kubectl/ops.ts` (`expose`) → `clustersync.ts` | leuchtet, wenn der Service erreichbar ist |
| Flagge | **Helm-Release** | `sim/helm.ts` | Release hissen = Flagge setzen |
| Fass am Dock | **Docker-Container** | `sim/docker.ts` | gestoppte Container wandern ins Lager (#303) |
| Neues Land im Meer | **`terraform apply`** | `sim/terraform.ts` → Region-Warps | Provisionierung wird als sichtbar wachsendes Land gebaut |
| Sturm / Piraten-Überfall | **Incident** | `scenes/worldscene/events.ts` | Soll-Zustand unter Zeitdruck wiederherstellen (Self-Healing) |
| Hacker-Krake | **Klartext-Secret-Leak** | `sim/kubectl/security.ts` | nur ein sauber angelegtes Secret vertreibt sie |
| Archipel / Leuchtturm / Lager / Wachturm | **GitOps / Monitoring / Storage / RBAC-Regionen** | `scenes/regions.ts`, `sim/argocd.ts`/`observability.ts`/`s3.ts`/`security.ts` | betretbare Regionen je Themengebiet |

### 1b. Lernen als Seefahrer-Karriere (Lern-/Progression)

| Spiel-Begriff | Pädagogik/DevOps-Bezug | Code-Ort | Beispiel |
|---|---|---|---|
| **Quest** | Lernaufgabe mit `accept`/`check` | `content/data/quests/*.json` (Daten), `game/progression.ts` (Fortschritt), `ui/quest.ts` | Fortschritt persistiert per **Quest-ID** (`currentQuestId`), nicht per Index (#353/#354) |
| **Dublonen** | Soft-Currency als Belohnung | `game/economy.ts` | Quests/Übungen zahlen Dublonen, Shop gibt sie aus |
| **XP / Rang** | Erfahrungs-/Fortschrittsstufe | `game/economy.ts` | Rang-Aufstieg = Meilenstein-Feedback |
| **Leitner-Box / Krabben-Quiz** | Spaced Repetition | `game/spaced-repetition.ts`, `content/data/quiz/*`, `ui/quiz.ts` | Schwieriges wird öfter abgefragt (Leitner-Fächer) |
| **Drill / freies Üben** | Wiederholbare Befehls-Übung | `content/drills/*`, `ui/radio.ts` | Übungslauf ohne Story-Zwang |
| **Funkgerät** | In-Welt-Terminal | `ui/radio.ts`, `hud/cmdhistory.ts`, `hud/helptext.ts` | teach/drill/terminal-Modi + gefiltertes `help` (#358) |
| **Logbuch** | Quest-Übersicht/Nachlese | `hud/questlog.ts`, `ui/questlog.ts` | Themen-Accordion (#326) |
| **Sammelalbum** | Glossar/Sticker aus erlerntem Stoff | `hud/album.ts`, `ui/album.ts` | Freischaltung aus `completedQuests`/`review` abgeleitet (#278) |
| **Verdiente Abkürzung** | freigeschaltete Langform↔Kürzel | `content/abbrev.ts`, `game/unlocks.ts` | z.B. `kubectl`→`k` nach genug Nutzung (#313) |

> **Konvention „ändere-mich"-Werte:** variable Platzhalter in Beispielbefehlen werden in Content-Texten als `<token>` in spitzen Klammern geschrieben; `hud/markup.ts` › `fmtCmd` macht daraus ein sichtbares Badge (#311). Wörtliche spitze Klammern (`<none>`, Konfliktmarker) gehören als `&lt;…&gt;` in die Daten.

## 2. Kontext-Landkarte — die Subdomänen

KubeQuest ist ein **modularer Monolith** mit **2–3 Kern-Subdomänen** plus unterstützenden generischen Bausteinen. Die Grenzen sind hier vor allem **Grenzen für kognitive Last = Token-Last** bei KI-Entwicklung (explizites Qualitätsziel §1 der arc42-Analyse) — **Navigationsgrenzen in _einem_ Bundle, keine künftigen Services.** Bewusst nur wenige Nähte: zu viele erzeugen Übersetzungs-Code und kosten mehr Tokens, nicht weniger.

| Subdomäne | Rolle | Was gehört rein | Eigene Sprache | Code-Verzeichnisse | Tiefendoc |
|---|---|---|---|---|---|
| **DevOps-Simulation** | Kern | der simulierte Cluster + alle Befehlsfamilien (docker/kubectl/helm/terraform/git/argocd/glab/aws s3) + Observability/RBAC | echtes K8s/DevOps (Pod, Node, Deployment, Service, Release …) | `src/sim.ts` + `src/sim/*` | [sim.md](module/sim.md) |
| **Lern-/Progression** | Kern (die eigentliche Wertschöpfung des Lernspiels) | Quests, XP/Rang, Dublonen, Spaced Repetition, Drills/Quiz, Fortschritt & Spielstand | Pädagogik (Quest, Dublonen, Leitner-Box, Streak) | `src/game/*` (+ Lern-Content `src/content/data/{quests,drills,quiz}`) | [app.md](module/app.md) |
| **Welt-/Präsentation** | unterstützend | Hafen-Geometrie, Karten/Regionen, Deko, Szenen-/DOM-Rendering, SFX | räumlich/Hafen (Kiste, Steg, Laterne, Insel) | `src/world.ts`/`decor.ts`/`archipel.ts`/… , `src/scenes/*`, `src/ui/*`, `src/sfx.ts` | [world.md](module/world.md) (pure) + [presentation.md](module/presentation.md) (Phaser/DOM) |
| _Persistenz_ | generisch (Repository) | Spielstand laden/speichern/migrieren | `{v,data}`-Hülle, Slot, Migration | `src/store.ts` | [app.md](module/app.md) |
| _Content-Loader_ | **Shared Kernel** (siehe §3) | validiertes Laden aller Daten + Quest-Check-DSL + Entity-Registry | „Content-as-Data" | `src/content.ts` + `src/content/{loader,check-dsl,checks,entities}` | [content.md](module/content.md) |

**Die Anti-Corruption-Layer** zwischen *DevOps-Simulation* und *Welt-/Präsentation* ist die Hafen-Metapher aus §1: sie lebt an genau zwei Stellen — dem Cluster→Welt-Sync (`scenes/worldscene/clustersync.ts`, liest den Sim-Snapshot und zeichnet Kisten/Laternen) und der Content-Render-Grenze (`hud/markup.ts`). Der Simulator selbst kennt **keine** Kisten, die Präsentation kennt **keine** Pod-Regeln — das ist die Schichtung aus §5 der arc42-Analyse, hier als Sprachgrenze gelesen.

## 3. Schneiden die Tiefendocs schon entlang dieser Grenzen? (DoD 3)

Weitgehend **ja** — die on-demand-Tiefendocs der CLAUDE.md waren nach Schichtung/Modul geschnitten und decken die Subdomänen fast 1:1 ab:

| Subdomäne | Tiefendoc | Deckung |
|---|---|---|
| DevOps-Simulation | [sim.md](module/sim.md) | **exakt** — ein Doc, eine Subdomäne |
| Lern-/Progression | [app.md](module/app.md) (game/*, Persistenz) | **gut** — der Lern-*Content* liegt zusätzlich in content.md (siehe unten) |
| Welt-/Präsentation | [world.md](module/world.md) + [presentation.md](module/presentation.md) | **gut** — bewusst in „pure Geometrie" und „Phaser/DOM" getrennt |

**Eine bewusste Ausnahme: `content.md` ist ein _Shared Kernel_, kein eigener Bounded Context.** Die Content-Schicht bedient absichtlich mehrere Subdomänen zugleich:
- Quest-/Drill-/Quiz-Daten → **Lern-/Progression**,
- die Quest-Check-DSL liest den **DevOps-Simulation**-Zustand,
- die Entity-Registry platziert NPCs/Objekte in der **Welt-/Präsentation**.

Das ist **kein Schnittfehler, sondern gewollt**: Content-as-Data ist die eine, validierte Daten-/Übersetzungsschicht (ADR 0004). Sie hier aufzureißen würde genau die Nähte und den Übersetzungs-Code schaffen, vor denen §2 warnt — also **benennen, nicht auseinanderreißen**. Deshalb behält content.md seine Sonderrolle und wird in der Landkarte oben explizit als Shared Kernel geführt.

**Angleichungen aus diesem Ticket:** keine Code-/Doc-Verschiebung nötig — die Grenzen stimmen. Sichtbar gemacht wurde nur die Zuordnung (dieses Glossar + die Verweise aus [arc42 §8/§12](arc42-architektur.md) und [CLAUDE.md](../CLAUDE.md)).
