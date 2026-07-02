# Der KI-Agenten-Harness von KubeQuest — wie + warum

> **Was ist dieses Dokument?** Die **eine** erklärende Gesamtsicht auf den „Harness": die Maschinerie, mit der autonome KI-Coding-Agenten dieses Repo **billig und sicher** weiterbauen. Der komplette Code von KubeQuest entsteht durch solche Agenten — kein Mensch tippt die Implementierung.
>
> **Abgrenzung — was hier NICHT steht.** Dies ist die *erklärende* Sicht (das System als Ganzes, das „warum"), nicht die operative Arbeitsanweisung. Die **harten Regeln + den Schritt-für-Schritt-Ablauf** hat weiterhin die [AGENTS.md](../AGENTS.md) (SSOT für „wie arbeite ich"), den Schnellstart + die Datei-Landkarte die [CLAUDE.md](../CLAUDE.md). Dieses Doc **verlinkt** dorthin, statt zu doppeln — driftet etwas, gilt AGENTS.md/CLAUDE.md. Es ist die Tiefenquelle, auf die die [README › Gebaut von KI-Agenten](../README.md#-gebaut-von-ki-agenten) (Marketing-Ebene 3) und [arc42 §8](arc42-architektur.md#8-querschnittliche-konzepte--ddd-bewertung) verweisen.

## 1. Die Kernidee

**Nicht ein einzelner cleverer Prompt macht autonome KI-Entwicklung sicher, sondern die Leitplanken drumherum.** Ein LLM-Agent ist ein unzuverlässiger Ausführender: mal brillant, mal halluziniert er eine API, vergisst eine Migration oder reißt eine Schichtgrenze ein. Der Harness dreht die Verlässlichkeit nicht am Modell, sondern an der **Umgebung**: Er sorgt dafür, dass ein Agent alles Nötige **findet** (SSOT-Doku), sich auf **genau eine** Aufgabe konzentriert (Ein-Ticket-Workflow), anderen Agenten **nicht in die Quere** kommt (Kollisionsschutz) und jeden Fehler **an einer automatischen Grenze** vorgeführt bekommt (Fitness-Functions als Gates), bevor er auf `main` landet.

Das ist selbst ein **Architekturziel** (arc42-Qualitätsziel §1.4: „eine KI ändert das billig **und** sicher"), gleichrangig neben Testbarkeit, Erweiterbarkeit und Datensicherheit — und es steht unter derselben obersten Regel wie alles andere: **„Trägt das noch, wenn KubeQuest so groß wie Stardew Valley wird?"** Ein Harness, der bei 10× Content/NPCs/parallelen Agenten zusammenbricht, ist keiner.

## 2. Die fünf Bausteine

Der Harness ist kein einzelnes Tool, sondern das Zusammenspiel von fünf Schichten. Jede fängt eine andere Fehlklasse ab.

### 2.1 Selbstdokumentierendes Repo (SSOT im Code)

Alles, was ein Agent braucht, liegt **im Repo selbst** — versioniert und gepusht, damit auch ein frischer Clone oder ein Cloud-Agent ohne externen Kontext arbeiten kann. Bewusst **kein** externes Notiz-/Wissenssystem als Voraussetzung.

- **[CLAUDE.md](../CLAUDE.md)** — Schnellstart (10-Schritte-Checkliste) + die **eine** Datei-für-Datei-Repo-Landkarte (Datei · Schicht · ein Satz Zweck).
- **[AGENTS.md](../AGENTS.md)** — die ausführliche Arbeitsanweisung: harte Regeln, Board-Workflow, Konventionen, Begründungen.
- **Modul-lokale `AGENTS.md`** (z.B. [`src/content/AGENTS.md`](../src/content/AGENTS.md), #483) — Regeln, die nur gelten, wenn man in *diesem* Verzeichnis arbeitet. **Kontext als Token-Grenze:** ein Agent, der an `src/content/` arbeitet, lädt die Content-Regeln; wer woanders arbeitet, schleppt sie nicht mit.
- **[`docs/module/`](module/)** — on-demand-Tiefendocs je Subsystem (sim/content/world/presentation/app). Nur lesen, wenn man am Bereich arbeitet — die CLAUDE.md-Landkarte bleibt dafür schlank.
- **[README.md](../README.md)** — die spielerseitige Sicht (Story, Steuerung, Lernpfad). Nicht für Agenten, aber Teil der „Doku aktuell halten ist Teil von fertig"-Regel.

**Warum das die erste Leitplanke ist:** Ein Agent, der sich das Nötige zusammensuchen oder raten muss, produziert teure Fehl-Läufe. Die Doku ist bewusst als **Kontext-Selektor** gebaut (schlanker Always-Index + on-demand-Tiefe + modul-lokale Regeln), damit sie bei Stardew-Scope nicht zum unlesbaren Monolithen wird. Dass sie nicht leise veraltet, sichert selbst ein Gate ab (`check:docmap`, siehe §3).

### 2.2 Board-getriebener Ein-Ticket-Workflow

Der Backlog lebt als **GitHub Issues** + Project-Board — **nicht** im Code, nicht in einem externen System. Prioritäten als Labels (`prio:hoch`/`mittel`/`niedrig`), Bereiche als `area:`-Labels.

- **Was als Nächstes dran ist,** entscheidet eine rein deterministische Regel (keine handgepflegte Reihenfolge): das **oberste freie Ticket nach Prio → niedrigste Nummer** ([Ticket-Auswahl](ticket-reihenfolge.md)). Der Agent **wägt nicht ab** und sucht nicht nach Inhalt — Prio-Label + Nummer entscheiden. Das hält die Auswahl billig, reproduzierbar und Stardew-fest (nichts, was mit dem Backlog mitwächst und driftet).
- **Ein Agent nimmt genau EIN Ticket** und arbeitet es end-to-end ab: umsetzen → alle Gates grün → im Browser verifizieren → nach `main` → Issue schließen → Board + Reihenfolge pflegen. Der enge Fokus ist Absicht: ein kleiner, abgeschlossener Diff ist review- und verifizierbar; ein „ich mach schnell noch fünf Sachen mit"-Lauf ist es nicht.
- **Der Agent managt das Board selbst** (nur in kubequest an ihn delegiert): Issues schließen/kommentieren/labeln und **neue Tickets anlegen, wenn etwas auffällt** (Bug, Lücke, Tech-Debt, Idee) — lieber ein Ticket zu viel als verlorenes Wissen. GitHub ist die SSOT für den Stand.
- **Zu großes Ticket (Epic/Phase) → aufteilen statt umsetzen:** in session-große Kinder zerlegen (ohne Assignee), Übersichts-Kommentar posten, Epic auf `done` schließen. Kein Code.

Operative Details (Auswahl-Befehl, Pflege-Schritt): [AGENTS.md › Wo die TODOs leben](../AGENTS.md#wo-die-todos-leben) + [ticket-reihenfolge.md](ticket-reihenfolge.md).

### 2.3 Kollisionsschutz für parallele Agenten

Mehrere Chats/Agenten können **gleichzeitig** laufen. Damit sich zwei nie dasselbe Ticket oder Arbeitsverzeichnis greifen:

- **Self-assign als „in Arbeit"-Marker:** beim Start sofort `gh issue edit <nr> --add-assignee @me` + mit `gh issue view` **verifizieren** (blockierend — ohne bestätigte Zuweisung kein Implementieren). Der Assignee ist der **einzige** Zustand, den ein paralleler Agent sehen kann; ein nur „im Kopf" gewähltes Ticket ist unsichtbar.
- **Eigener `git worktree` pro Ticket** (`.claude/worktrees/kq-<nr>` auf eigenem Branch `feature/kq-<nr>-<slug>`) — **nicht nur** ein eigener Branch. Zwei Agenten im selben Arbeitsverzeichnis würden sich gegenseitig die Dateien unter den Füßen wegziehen; getrennte Worktrees isolieren das vollständig.
- Am Ende: nach `main` mergen → `git push origin main` → Worktree + Branch entfernen → Issue schließen, **jeder Schritt verifiziert**.

Fallstricke (Windows-Cleanup: laufende Dev-Server killen, nicht in den Worktree `cd`en; `node_modules` nicht per Junction verlinken): [AGENTS.md › Kollisionsschutz](../AGENTS.md#wo-die-todos-leben).

### 2.4 Automatische Gates (Fitness-Functions)

Das eigentliche Sicherheitsnetz: eine Reihe von Prüfungen, die **lokal und in der CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) laufen und `main` grün halten. Ein Agent kann keinen Schichtbruch, kein `any`, kein God-File, keine veraltete Doku-Landkarte und keine gebrochene Save-Migration unbemerkt einschleusen — der Build wird rot. Jedes Gate ist einzeln in §3 erklärt.

### 2.5 Skills + Setup als reproduzierbare Abläufe

- **Skills** kodifizieren wiederkehrende Abläufe statt freihändiger Improvisation: der `kubequest`-Skill (der Ticket-Ablauf end-to-end), der `forum`-Skill (GitHub Discussions bearbeiten, mit verbindlichem Freigabe-Stopp vor dem Posten), der `review-lenses`-Skill (gestaffelter Mehr-Perspektiven-Review vor dem Merge, #532 — siehe unten). Der Skill ist ein dünner Zeiger auf die Repo-SSOT (AGENTS.md), damit er auch ohne Skill-Datei funktioniert.
- **Gestaffelter Review vor `main` (`review-lenses`-Skill, #532)** — Vorbild WPS-KI-Fabrik: erst die billigen deterministischen Gates (`npm run verify`), und **nur bei Grün** drei getrennte agentische Lens-Pässe (Architektur / Requirement-Treue / Test-Adäquanz) mit strukturierten Findings. Rote Gates ⇒ **Abbruch ohne Lens-Pass** (Token-Short-Circuit: kein LLM-Aufwand auf einen Diff, der schon deterministisch scheitert). Kein Ersatz für die CI-Gates (hängt sich davor), **kein Auto-Merge** — der Review liefert nur Findings für den normalen Ticket-Abschluss.
- **One-Command-Setup** (`npm run setup`, #387) + **Devcontainer** ([`.devcontainer/`](../.devcontainer/devcontainer.json), #388): ein Agent (oder Mensch) ist mit einem Befehl bzw. `docker compose up` startklar — Node-Check, `npm install`, einmal alle Checks. Reproduzierbare Umgebung statt „bei mir lief's".

## 3. Die Fitness-Functions im Detail

Jedes Gate prüft **eine** Fehlklasse. Für jedes gilt: WAS es prüft · WARUM es existiert · wie es gegen False Positives abgesichert ist. Reihenfolge wie in der CI (nach `npm test` aufsteigend streng).

| Gate | Befehl |
|---|---|
| Tests | `npm test` (Vitest) |
| Typecheck (strict) | `npm run typecheck` |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) |
| Architektur | `npm run check:arch` (dependency-cruiser) |
| Dateigröße | `npm run check:size` |
| Doku↔Code-Drift | `npm run check:docmap` |
| Harness-Drift (Kommandos + Links) | `npm run check:docdrift` |
| Boot-/Interaktions-Smoke | `npm run smoke` (Playwright, headless) |
| Security-Audit | `npm audit --omit=dev --audit-level=high` |

### Tests (`npm test`, Vitest)
- **WAS:** die pure Domäne + Anwendung (Sim, Content, Wirtschaft, Progression, Spaced Repetition) über die öffentliche API; spielt die ganze Story + alle Drills durch (`quests.test.ts`), prüft die Konsistenz aller Inhalte (`content.test.ts`).
- **WARUM:** die Simulation muss **ohne die Engine** stimmen — ein falsch simuliertes `kubectl` ist ein didaktischer Fehler. Deshalb ist die Domäne bewusst Phaser-frei und im Node-Test prüfbar.
- **Red-Green:** neue/geänderte Logik entsteht **test-first** (TDD ist der Default, nicht nur bei Bugfixes): erst der rote Repro-Test, dann der Fix. Ein Test, der auch bei kaputtem Code grün bleibt, ist wertlos — die Rot-Phase beweist, dass er den Bug fängt. Es werden **auch Negativfälle** abgedeckt (kaputter Zustand, falsche Eingabe, „darf nicht passieren").
- **Harness-Trennung (#475):** Querschnitts-Umgebung (window/localStorage-Stub) liegt in [`test/support/`](../test/support/), valide Domänen-Eingaben als Factories in [`test/factories/`](../test/factories/). Tests prüfen **Verhalten, nicht Interna** — damit sie Refactorings überleben.

### Typecheck (`npm run typecheck`, `tsc --noEmit`)
- **WAS:** das ganze Projekt voll `strict` (alle `src`-Module, Tests, `vite.config`).
- **WARUM:** fängt die große Klasse von Tippfehlern/Null-/Typfehlern, bevor sie Laufzeitfehler werden. Der Ratchet ist abgeschlossen — neuer Code muss strict-tauglich bleiben.

### Lint (`npm run lint`, ESLint flat config, typbewusst, #389)
- **WAS:** was `tsc` nicht sieht — ungenutzte Variablen/Imports, leere Blöcke, `prefer-const` und v.a. **schwebende Promises** (seit der async-IndexedDB-Persistenz #350).
- **WARUM:** `--max-warnings 0`, Errors blocken. `@typescript-eslint/no-explicit-any` ist seit #423 ein **Fehler** — der `any`-Altbestand ist auf 0 gebracht, damit kein neues `any` unbemerkt reinrutscht (das würde die Typprüfung lokal aushebeln).
- **Absicherung:** bewusstes fire-and-forget wird mit `void` markiert, bewusst ignorierte Bindings mit `_`-Präfix; die wenigen echten `any`-Ausnahmen (ThisType-Escape-Hatches, ein bewusster Struktur-Seam, Korruptions-Fixtures) tragen ein **begründetes** `eslint-disable-next-line`. Formatierung ist bewusst **nicht** Sache des Linters.

### Architektur-Wächter (`npm run check:arch`, dependency-cruiser, #347/#390)
- **WAS:** die Schichtung (pure Domäne ↔ Anwendung ↔ Präsentation) — die Domäne/Anwendung darf `phaser`/`scenes`/`ui`/`sfx` **nicht** importieren. Zusätzlich verboten: **Import-Zyklen** und **verwaiste Module** (toter Code), Typ-Importe zählen mit.
- **WARUM:** die Schichtgrenze ist das, was die Domäne testbar hält (§2.1 Testbarkeit). Der Befund #292 (`game.ts → sfx.ts` hatte sich unbemerkt eingeschlichen) zeigte: Review-Disziplin allein hält die Grenze nicht — sie muss **erzwungen** sein.
- **Kein Grün-durch-Aufweichen:** einen Zyklus löst man auf (geteilten Zustand nach `runtime.ts`/`sim/state.ts` ziehen), toten Code löscht man, eine Ausnahme kommt nur mit offenem Split-Ticket + Begründung in die `pathNot`-Allowlist.

### Dateigröße-Wächter (`npm run check:size`, #390)
- **WAS:** jedes `src`-Modul über dem **Zeilen-Budget (800 LOC)** als God-File-Frühwarnung. Dieselbe Logik testet `test/filesize.test.ts` (also auch im `npm test`-Gate).
- **WARUM:** God-Files sind bei Stardew-Scope die schleichende Wartungsschuld. Große Familien werden hinter einer Fassade/Barrel gesplittet (öffentliche API stabil, Innenstruktur skaliert).
- **Absicherung:** eine Überschreitung ist nur mit offenem Split-Ticket in der `ALLOWLIST` erlaubt; fällt eine Datei wieder unter Budget, meldet der Wächter den Eintrag als **stale** (die Ausnahme kann nicht faul liegenbleiben).

### Doku↔Code-Drift-Wächter (`npm run check:docmap`, #482)
- **WAS:** meldet jede `src/`-Datei ohne Landkarten-Zeile in CLAUDE.md, jede Zeile ohne Datei und jede deklarierte Schicht, die von der dependency-cruiser-Zuordnung abweicht (gemeinsame Schicht-Quelle [`scripts/layers.cjs`](../scripts/layers.cjs)). Auch als `test/docmap.test.ts`.
- **WARUM:** die CLAUDE.md-Landkarte ist der **Kontext-Selektor** jeder KI-Session (§2.1). Driftet sie leise, führt sie Agenten in die Irre — genau das darf nicht passieren, also ist „die Doku stimmt" selbst maschinell geprüft.

### Harness-Drift-Wächter (`npm run check:docdrift`, #529)
- **WAS:** hält die Doku jenseits der Datei-Landkarte ehrlich: (1) jedes in einem Markdown erwähnte `npm run <x>` (bzw. `npm test`) existiert als Skript in `package.json`; (2) jedes Kern-Skript (außer bewusst ausgenommener Convenience) ist in AGENTS.md/CLAUDE.md/README dokumentiert; (3) jeder interne, repo-relative Markdown-Link zeigt auf eine existierende Datei; (4) jeder `#anker` trifft eine reale Überschrift (GitHub-Slug-Regel). Auch als `test/docdrift.test.ts`.
- **WARUM:** AGENTS.md/CLAUDE.md/README werden von **jeder** KI-Session als Kontext geladen und nennen Kommandos + verweisen quer auf andere Harness-Docs. Ein totes Kommando oder ein toter Link/Anker schickt einen Agenten ins Leere — der Datei-Landkarten-Wächter (#482) deckt genau diese Fehlklasse **nicht** ab.
- **Absicherung:** Code-Fences werden ausgeblendet (ein `#`-Kommentar in einem bash-Block ist keine Überschrift, ein Beispiel-Link keiner); Ausnahmen (undokumentierte Convenience-Skripte) stehen begründet in `DOC_EXEMPT_SCRIPTS`. Red-Green über `test/docdrift.test.ts` (totes Kommando, toter Link, toter Anker werden jeweils erkannt; die Slug-Regel trifft Emoji-/Umlaut-Überschriften).

### Boot-/Interaktions-Smokes (`npm run smoke`, Playwright, #391/#480)
- **WAS:** lädt den **gebauten Offline-Build** (`dist-offline/index.html` per `file://`, genau der Doppelklick-Pfad) headless in Chromium. Boot-Smoke: fährt fehlerfrei hoch (Boot-Flag, Canvas da, keine Konsolen-/Laufzeitfehler). Interaktions-Smokes: `help` ins Terminal → Ausgabe, Overlay auf/zu, Onboarding-Quest annehmen + abschließen — über Tastatur/DOM ohne Test-Hintertür.
- **WARUM:** die Vitest-Unit-Tests fassen die Präsentation (Phaser/DOM) bewusst **nicht** an. Ein Fehler, der erst beim echten Boot auftritt (Phaser-Init, ein werfender Content-Loader, ein kaputtes Asset-Manifest) oder eine Interaktions-Regression (Terminal nimmt keine Eingabe) käme sonst durch.
- **Absicherung:** bewusst **schlank** (kein NPC-Nähe-Overlay, keine Weltbewegung), um flake-frei zu bleiben; Red-Green über sabotierte Tastenkopplung nachgewiesen. Getrennt von Vitest (`test/**` vs. `e2e/**`), damit sich die Test-Welten nicht überschneiden.

### Security-Audit (`npm audit`, #396)
- **WAS:** zweistufig — **blockierend** nur über die ausgelieferten Produktiv-Deps (`npm audit --omit=dev --audit-level=high`), **nur berichtend** über den vollen Baum inkl. Dev.
- **WARUM:** das echte Nutzerrisiko steckt im `dist`-Artefakt (nur `phaser` & Co., kein vite/vitest). Ein hartes high+-Gate über den **ganzen** Baum wäre durch dev-only-Advisories dauerhaft rot — und würde dann abgeschaltet (die ⚠️-Falle aus #395). Die selbstwartende Regel „blocke, was ausgeliefert wird; berichte den Rest" verrottet nicht bei Stardew-Scope, anders als ein hartcodierter Advisory-Allowlist.
- **Ergänzend:** Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) öffnet wöchentlich gebündelte Update-PRs und zieht Security-Advisories automatisch hoch; Umgang damit als Policy in [CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests--abhängigkeits-updates-policy).

> **Nicht auf der Liste, aber Teil des Netzes:** die **Save-nie-brechen-Regel** (jede Format-Änderung migriert, alter Stand vorher in den Backup-Slot, `sanitizeState` härtet kaputte Felder ab) und der **Determinismus-Anspruch** (seedbare Zufälligkeit statt `Math.random` in der Domäne) gehören zum selben Netz. Der Determinismus ist heute noch nicht als Gate erzwungen — das ist eine bekannte Lücke (#492, siehe §5).

## 4. Die sichere Autonomie-Schleife

So greifen die Bausteine bei **einem** Ticket ineinander — jeder Schritt ist eine Leitplanke, kein Vertrauensvorschuss:

```
   ┌─ Doku (SSOT) ────────────────────────────────────────────────┐
   │  Agent liest CLAUDE.md + AGENTS.md + modul-lokale Regeln       │
   │                          ▼                                     │
   │  Board: oberstes freies Ticket nach Prio→Nummer                │  ← kein Abwägen
   │                          ▼                                     │
   │  Kollisionsschutz: self-assign (verifiziert) + eigener Worktree│  ← parallel-sicher
   │                          ▼                                     │
   │  Umsetzen (TDD: rot → grün → aufräumen)                        │
   │                          ▼                                     │
   │  Gates lokal grün: test · typecheck · lint · arch · size ·     │  ← Fehler an der Grenze
   │  docmap · docdrift · smoke · audit + im Browser verifiziert    │
   │                          ▼                                     │
   │  nach main mergen → push → CI läuft dieselben Gates nochmal    │  ← zweite Grenze
   │                          ▼                                     │
   │  Issue schließen (verifiziert) → Worktree/Branch weg → Board   │
   │  + Reihenfolge pflegen ("puh, fertig")                         │
   └───────────────────────────────────────────────────────────────┘
```

**Warum das „billig UND sicher" ergibt (arc42-Qualitätsziel §1.4):**
- **Billig,** weil der Agent nichts sucht (SSOT-Doku als Kontext-Selektor), nichts abwägt (Reihenfolge entscheidet), und ein kleiner Ein-Ticket-Diff wenig Kontext braucht.
- **Sicher,** weil jede Fehlklasse ihre eigene Grenze hat: falsche Logik → Tests, Typfehler → tsc, Schichtbruch → check:arch, Landkarten-Drift → check:docmap, totes Kommando/toter Link → check:docdrift, zu breiter Slice → check:diffsize, Boot-Fehler → Smoke, verwundbare Dep → audit. Kein Fehler verlässt sich darauf, dass „der Lauf schon gut war".

**Wo die Grenzen sind (ehrlich):**
- Die Gates prüfen, was sie prüfen können. **Didaktische Richtigkeit** (ist die simulierte Cluster-Mechanik pädagogisch sinnvoll?) und **Spielspaß/Look** bleiben menschliches Urteil — darum der Browser-Verifizierungs-Schritt und die interaktive Optik-Abstimmung per Rückfrage.
- Der **Direkt-Push auf `main`** bedeutet: die CI-Gates laufen *nach* dem Push (post-hoc). Die lokalen Gates sind die eigentliche Vorab-Prüfung — ein vergessener lokaler Lauf ist die reale Netzlücke (Gegenmittel geplant: pre-push-Hook #528, siehe §5).
- Der **Forum-Eingang** ist der einzige Pfad, auf dem unvertrauter externer Text (GitHub Discussions) in auto-erzeugte Issues und damit in die Agenten-Queue gelangt — ein Prompt-Injection-Vektor (Härtung geplant: #531).

## 5. Roadmap / bekannte Lücken

Der Harness ist bewusst ein **lebendes System** — seine eigenen Schwachstellen sind als Tickets erfasst (dogfooding: der Harness verbessert sich über denselben Board-Workflow). Noch **offene** Harness-Verbesserungen ([ticket-reihenfolge.md](ticket-reihenfolge.md)):

| Ticket | Was es schließt |
|---|---|
| **#492** | Zentrale **seedbare RNG** + Fitness-Function gegen `Math.random` in Domäne/Content — macht den Determinismus-Anspruch zu einem echten Gate. |

**Schon gelandet** (Block „Harness & Vorzeige-Doku", 2026-07-01): das Aggregat-Kommando `npm run verify` (#527), der Git-**pre-push-Hook** (#528, schließt die Post-hoc-CI-Lücke des Direkt-Push, §4), der **Harness-Drift-Wächter** `check:docdrift` (#529, §3), die **Forum-Inbox-Härtung** gegen Prompt-Injection (#531, §4), der **`review-lenses`-Skill** — der gestaffelte Mehr-Perspektiven-Review mit Gate-Short-Circuit (#532, §2.5) — und das **Diff-Größenbudget-Gate** `check:diffsize` (#533, §3): misst den Slice gegen `main` (max. 20 Dateien / 800 Zeilen, Override mit Pflicht-Begründung) und erzwingt so die Slice-Disziplin der KI-Fabrik auf Commit-Ebene; Durchsetzungspunkt ist der pre-push-Hook (im flachen CI-Checkout degradiert es bewusst zu grün).

Mit **#530** ([ADR 0008](adr/0008-ki-agenten-harness.md)) ist der ADR jetzt die formale Grundsatzentscheidung und dieses Doc die erklärende Tiefe daneben — dieselbe Arbeitsteilung wie AGENTS.md (operativ) ↔ agent-harness.md (erklärend).

## 6. Verwandte Dokumente

- **[AGENTS.md](../AGENTS.md)** — operative Arbeitsanweisung (harte Regeln, Board-Workflow, Konventionen). *Bei Konflikt maßgeblich.*
- **[CLAUDE.md](../CLAUDE.md)** — Schnellstart + Datei-Landkarte.
- **[docs/arc42-architektur.md](arc42-architektur.md)** — Architektur-Gesamtsicht; §1.4 (KI-Entwickel-Effizienz als Qualitätsziel), §8 (Querschnittskonzepte), §9 (ADR-Übersicht inkl. geplantem 0008).
- **[docs/ticket-reihenfolge.md](ticket-reihenfolge.md)** — was als Nächstes dran ist (deterministisch Prio→Nummer + Reaktivierungs-Pool).
- **[docs/adr/](adr/)** — die festgehaltenen Grundsatzentscheidungen (Engine, kein Backend/DB, kein Multiplayer, Skalierungs-Fundament, …).
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — Einstieg für Menschen (`npm run setup`, Devcontainer, PR-/Dependabot-Policy).
