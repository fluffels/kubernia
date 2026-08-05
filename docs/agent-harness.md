# Der KI-Agenten-Harness von Kubernia — wie + warum

> **Was ist dieses Dokument?** Die **eine** erklärende Gesamtsicht auf den „Harness": die Maschinerie, mit der autonome KI-Coding-Agenten dieses Repo **billig und sicher** weiterbauen. Der komplette Code von Kubernia entsteht durch solche Agenten — kein Mensch tippt die Implementierung.
>
> **Abgrenzung — was hier NICHT steht.** Dies ist die *erklärende* Sicht (das System als Ganzes, das „warum"), nicht die operative Arbeitsanweisung. Die **harten Regeln + den Schritt-für-Schritt-Ablauf** hat weiterhin die [AGENTS.md](../AGENTS.md) (SSOT für „wie arbeite ich"), die Nachschlage-Tabellen (Befehle, Repo-Landkarte, Schichtregeln, Anlaufstellen) die [CLAUDE.md](../CLAUDE.md) — die zugleich per `@AGENTS.md`-Import die Brücke in die SSOT ist (#992). Dieses Doc **verlinkt** dorthin, statt zu doppeln — driftet etwas, gilt AGENTS.md/CLAUDE.md. Es ist die Tiefenquelle, auf die die [README › Gebaut von KI-Agenten](../README.md#-gebaut-von-ki-agenten) (Marketing-Ebene 3) und [arc42 §8](arc42-architektur.md#8-querschnittliche-konzepte--ddd-bewertung) verweisen.

## 1. Die Kernidee

**Nicht ein einzelner cleverer Prompt macht autonome KI-Entwicklung sicher, sondern die Leitplanken drumherum.** Ein LLM-Agent ist ein unzuverlässiger Ausführender: mal brillant, mal halluziniert er eine API, vergisst eine Migration oder reißt eine Schichtgrenze ein. Der Harness dreht die Verlässlichkeit nicht am Modell, sondern an der **Umgebung**: Er sorgt dafür, dass ein Agent alles Nötige **findet** (SSOT-Doku), sich auf **genau eine** Aufgabe konzentriert (Ein-Ticket-Workflow), anderen Agenten **nicht in die Quere** kommt (Kollisionsschutz) und jeden Fehler **an einer automatischen Grenze** vorgeführt bekommt (Fitness-Functions als Gates), bevor er auf `main` landet.

Das ist selbst ein **Architekturziel** (arc42-Qualitätsziel §1.4: „eine KI ändert das billig **und** sicher"), gleichrangig neben Testbarkeit, Erweiterbarkeit und Datensicherheit — und es steht unter derselben obersten Regel wie alles andere: **„Trägt das noch, wenn Kubernia so groß wie Stardew Valley wird?"** Ein Harness, der bei 10× Content/NPCs/parallelen Agenten zusammenbricht, ist keiner.

## 2. Die fünf Bausteine

Der Harness ist kein einzelnes Tool, sondern das Zusammenspiel von fünf Schichten. Jede fängt eine andere Fehlklasse ab.

### 2.1 Selbstdokumentierendes Repo (SSOT im Code)

Alles, was ein Agent braucht, liegt **im Repo selbst** — versioniert und gepusht, damit auch ein frischer Clone oder ein Cloud-Agent ohne externen Kontext arbeiten kann. Bewusst **kein** externes Notiz-/Wissenssystem als Voraussetzung.

> **Abgrenzung — was „kein externes Notiz-/Wissenssystem" NICHT heißt.** Das gilt für den Harness: kein Schritt im Ticket-Workflow und keine Agenten-Entscheidung hängt an etwas außerhalb von Repo + GitHub, sonst könnten weder ein frischer Clone noch ein Cloud-Agent ohne die Maintainerin loslegen. Die Maintainerin führt daneben **privat** ein Obsidian-Second-Brain (Lernfortschritt, Konzept-Notizen für einen möglichen Weiterbildungstag) — rein additiv für sie als Mensch, kein Teil des Harness und für keinen Agenten-Schritt Voraussetzung. Fiele der Vault weg, liefe der Harness unverändert weiter.

- **[AGENTS.md](../AGENTS.md)** — die **SSOT**: harte Regeln, Board-Workflow, Konventionen, Begründungen. **Jede harte Regel steht genau hier, nur hier** (#992).
- **[CLAUDE.md](../CLAUDE.md)** — die **Brücke** dorthin: eine `@AGENTS.md`-Import-Zeile (Claude Code lädt CLAUDE.md automatisch, AGENTS.md nicht) plus die Nachschlage-Tabellen, deren Heimat sie ist — Befehle, die **eine** Subsystem-Repo-Landkarte, Schichtregeln, Anlaufstellen. Dass der Import nicht still verschwindet, bewacht [`test/claude-bridge.test.ts`](../test/claude-bridge.test.ts).
- **Modul-lokale `AGENTS.md`** (z.B. [`src/content/AGENTS.md`](../src/content/AGENTS.md), #483) — Regeln, die nur gelten, wenn man in *diesem* Verzeichnis arbeitet. **Kontext als Token-Grenze:** ein Agent, der an `src/content/` arbeitet, lädt die Content-Regeln; wer woanders arbeitet, schleppt sie nicht mit.
- **[`docs/module/`](module/)** — on-demand-Tiefendocs je Subsystem (sim/content/world/presentation/app). Nur lesen, wenn man am Bereich arbeitet — die CLAUDE.md-Landkarte bleibt dafür schlank.
- **[README.md](../README.md)** — die spielerseitige Sicht (Story, Steuerung, Lernpfad). Nicht für Agenten, aber Teil der „Doku aktuell halten ist Teil von fertig"-Regel.

**Warum das die erste Leitplanke ist:** Ein Agent, der sich das Nötige zusammensuchen oder raten muss, produziert teure Fehl-Läufe. Die Doku ist bewusst als **Kontext-Selektor** gebaut (schlanker Always-Index + on-demand-Tiefe + modul-lokale Regeln), damit sie bei Stardew-Scope nicht zum unlesbaren Monolithen wird. Dass sie nicht leise veraltet, sichert selbst ein Gate ab (`check:docmap`, siehe §3).

### 2.2 Board-getriebener Ein-Ticket-Workflow

Der Backlog lebt als **GitHub Issues** + Project-Board — **nicht** im Code, nicht in einem externen System. Reihenfolge = manuelle Board-Position (die Maintainerin zieht wie eine Warteschlange, seit #747), Bereiche als `area:`-Labels.

- **Was als Nächstes dran ist,** entscheidet eine rein deterministische Regel: das **oberste freie Item in der Board-Reihenfolge** ([Ticket-Auswahl](ticket-reihenfolge.md)) — genau die Reihenfolge, die `gh project item-list` liefert. Der Agent **wägt nicht ab**, sucht nicht nach Inhalt und sortiert nicht um. Das hält die Auswahl billig, reproduzierbar und Stardew-fest (nichts, was mit dem Backlog mitwächst und driftet).
- **Ein Agent nimmt genau EIN Ticket** und arbeitet es end-to-end ab: umsetzen → alle Gates grün → im Browser verifizieren → über PR nach `main` → Issue schließen → Board pflegen (keine Reihenfolge-Datei mehr, #627). Der enge Fokus ist Absicht: ein kleiner, abgeschlossener Diff ist review- und verifizierbar; ein „ich mach schnell noch fünf Sachen mit"-Lauf ist es nicht.
- **Der Agent managt das Board selbst** (nur in kubernia an ihn delegiert): Issues schließen/kommentieren/labeln und **neue Tickets anlegen, wenn etwas auffällt** (Bug, Lücke, Tech-Debt, Idee) — lieber ein Ticket zu viel als verlorenes Wissen. GitHub ist die SSOT für den Stand.
- **Zu großes Ticket (Epic/Phase) → aufteilen statt umsetzen:** in session-große Kinder zerlegen (ohne Assignee), Übersichts-Kommentar posten, Epic auf `done` schließen. Kein Code.

Operative Details (Auswahl-Befehl, Board-Reihenfolge-Pflege): [AGENTS.md › Wo die TODOs leben](../AGENTS.md#wo-die-todos-leben) + [ticket-reihenfolge.md](ticket-reihenfolge.md).

### 2.3 Kollisionsschutz für parallele Agenten

Mehrere Chats/Agenten können **gleichzeitig** laufen. Damit sich zwei nie dasselbe Ticket oder Arbeitsverzeichnis greifen:

- **Self-assign als „in Arbeit"-Marker:** beim Start sofort `gh issue edit <nr> --add-assignee @me` + mit `gh issue view` **verifizieren** (blockierend — ohne bestätigte Zuweisung kein Implementieren). Der Assignee ist der **einzige** Zustand, den ein paralleler Agent sehen kann; ein nur „im Kopf" gewähltes Ticket ist unsichtbar.
- **Eigener `git worktree` pro Ticket** (`.claude/worktrees/kq-<nr>` auf eigenem Branch `feature/kq-<nr>-<slug>`) — **nicht nur** ein eigener Branch. Zwei Agenten im selben Arbeitsverzeichnis würden sich gegenseitig die Dateien unter den Füßen wegziehen; getrennte Worktrees isolieren das vollständig.
- Am Ende (**ein PR pro Ticket**, #618): Kopf-/Doku-Pflege in denselben Branch → pushen → **PR öffnen** (`gh pr create`, Body `Closes #<nr>`) → **CI abwarten und den PR bis zum Merge bringen** (Auto-Merge + `gh pr checks --watch`; grün → mergt, rot → auf dem Branch fixen bis grün) → Worktree entfernen → Issue schließt via `Closes`, **jeder Schritt verifiziert**. PR-gegated seit #592, kein Direkt-Push auf `main`; **ein Ticket ist erst fertig, wenn sein PR gemergt ist** — kein offener/roter PR bleibt liegen.

Fallstricke (Windows-Cleanup: laufende Dev-Server killen, nicht in den Worktree `cd`en; `node_modules` nicht per Junction verlinken): [AGENTS.md › Kollisionsschutz](../AGENTS.md#wo-die-todos-leben).

### 2.4 Automatische Gates (Fitness-Functions)

Das eigentliche Sicherheitsnetz: eine Reihe von Prüfungen, die **lokal und in der CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) laufen und `main` grün halten. Ein Agent kann keinen Schichtbruch, kein `any`, kein God-File, keine veraltete Doku-Landkarte und keine gebrochene Save-Migration unbemerkt einschleusen — der Build wird rot. Jedes Gate ist einzeln in §3 erklärt.

### 2.5 Skills + Setup als reproduzierbare Abläufe

- **Skills** kodifizieren wiederkehrende Abläufe statt freihändiger Improvisation: der `kubernia`-Skill (der Ticket-Ablauf end-to-end), der `forum`-Skill (GitHub Discussions bearbeiten, mit verbindlichem Freigabe-Stopp vor dem Posten), der `review-lenses`-Skill (gestaffelter Mehr-Perspektiven-Review vor dem Merge, #532 — siehe unten). Der Skill ist ein dünner Zeiger auf die Repo-SSOT (AGENTS.md), damit er auch ohne Skill-Datei funktioniert.
- **Gestaffelter Review vor `main` (`review-lenses`-Skill, #532)** — erst die billigen deterministischen Gates (`npm run verify`), und **nur bei Grün** drei getrennte agentische Lens-Pässe (Architektur / Requirement-Treue / Test-Adäquanz) mit strukturierten Findings. Rote Gates ⇒ **Abbruch ohne Lens-Pass** (Token-Short-Circuit: kein LLM-Aufwand auf einen Diff, der schon deterministisch scheitert). Kein Ersatz für die CI-Gates (hängt sich davor), **kein Auto-Merge** — der Review liefert nur Findings für den normalen Ticket-Abschluss.
- **Orchestrierter Phasen-Workflow als additive Variante ([`.claude/workflows/kubernia-ticket.js`](../.claude/workflows/kubernia-ticket.js), Einstieg [`kubernia-workflow`](../.claude/skills/kubernia-workflow/SKILL.md)).** Derselbe Ticket-Ablauf, aber nicht als Prompt-Anweisung an eine Session, sondern als **Skript, das Phasen-Subagenten orchestriert**: Auswahl+Claim → Plan → Umsetzen → Review → Nachbessern → PR+Merge → Cleanup. Was das gegenüber dem Skill wirklich bringt, ist **nicht** „schöner": es sind vier Dinge, die eine Prompt-Anweisung strukturell nicht leisten kann.
  - **Deterministische Abbruchbedingungen statt Verhaltensregeln.** Die Fix-Versuchsgrenze des Festgefahren-Protokolls (#710) ist im Skript eine `while`-Schleife mit Zähler — nach drei Versuchen ist Schluss, unabhängig davon, ob ein Agent die Regel befolgt. Ebenso der Token-Short-Circuit von `review-lenses` (#532): rotes `verify` ⇒ die Lens-Pässe werden gar nicht gestartet, weil der Code sie überspringt. Das ist dieselbe Verschiebung wie „Verhaltensregel → CI-Gate" bei #904, nur eine Ebene früher.
  - **Parallelität, wo sie unabhängig ist.** Die drei Lenses laufen gleichzeitig (getrennte Brillen auf denselben Diff, keine gemeinsame Datei). Nachbessern bleibt bewusst **ein** Agent — mehrere Fixer im selben Worktree würden sich überschreiben.
  - **Resume statt von vorn.** Bricht ein Lauf ab (hängende CI, geschlossenes Fenster), liefert `resumeFromRunId` alle unveränderten Phasen aus dem Cache; erst ab der ersten geänderten Stelle läuft es live. Beim Skill-Weg ist ein Abbruch mitten im Ticket ein Neuanfang.
  - **Sichtbarer Fortschritt** im Phasen-Baum (`/workflows`) statt im Chat-Verlauf.

  ⚠️ **Bewusst NICHT der Ort für den Ablauf** — und das ist der Kern, nicht eine Randnotiz. Ein Workflow-Skript liegt unter `.claude/`, das eine fremde KI **gar nicht liest**; es taugt darum nur als Optimierung *über* der SSOT, nie als deren Ersatz. Jeder Phasen-Agent bekommt nur einen **Zeiger** auf den zuständigen `AGENTS.md`-Abschnitt statt einer Zusammenfassung der Regeln — sonst gäbe es zwei Wahrheiten, und die im Skript wäre die, die still veraltet. Dieselbe Zweischichtigkeit wie bei der Modellwahl unten: **portabler Kern in `AGENTS.md`, Automatik additiv obendrauf.** Der `kubernia`-Skill bleibt der maßgebliche, tool-neutrale Weg. Der Preis: der Workflow ist **nicht-interaktiv** — Tickets, die laut [AGENTS.md § Immer loslegen](../AGENTS.md#konventionen) eine Rückfrage brauchen (🎨 Optik, ⚠️ riskante Weichen), gehören über den Skill.
- **One-Command-Setup** (`npm run setup`, #387) + **Devcontainer** ([`.devcontainer/`](../.devcontainer/devcontainer.json), #388): ein Agent (oder Mensch) ist mit einem Befehl bzw. `docker compose up` startklar — Node-Check, `npm install`, einmal alle Checks. Reproduzierbare Umgebung statt „bei mir lief's".
- **Modellwahl: planen stark, umsetzen schnell (#741, #910).** Drei Tiers: **Plan + Review** → starkes Modell (Opus, hohes Reasoning), **Umsetzung** → Coding-Tier (Sonnet, per Alias statt Pin), **Explore/Recherche** → günstiges Modell (Haiku). **Wichtige Erkenntnis:** das ist **nicht** tool-übergreifend erzwingbar — welches Modell läuft, steuert immer der Harness/das Tool, keine Repo-Datei; eine fremde KI (Cursor/Codex/Gemini) liest `.claude/` gar nicht. Darum **zweischichtig** umgesetzt:
  - **Portabel (der Kern):** eine werkzeugneutrale **Prosa-Konvention** in [AGENTS.md › Konventionen](../AGENTS.md#konventionen) — von jeder KI lesbar, kein Zwang, jedes Tool setzt sie auf seine Art um. Das ist der einzige Teil, der „mit jeder KI" geht.
  - **Claude-Code-Automatik (additiv):** der Skill [`plan-feature`](../.claude/skills/plan-feature/SKILL.md) trägt `model: claude-opus-5` + `effort: high` im Frontmatter; er ist committet (`.gitignore` nimmt `!.claude/skills/` aus), propagiert in jeden Worktree und greift nur unter Claude Code (danach fällt die Session aufs normale Modell zurück).
  - **Umgesetzt in #745 (Stufe 2):** der **Kern-Workflow** (`kubernia`-Skill) forkt intern einen Opus-Planungs-Subagenten ([`.claude/agents/kubernia-planner.md`](../.claude/agents/kubernia-planner.md), gepinnte ID `claude-opus-5`, `.gitignore`-Ausnahme `!.claude/agents/` analog zu `!.claude/skills/`). Der Subagent wird direkt nach dem Claimen und vor dem Coden aufgerufen — als opt-in Automatik nur unter Claude Code. Schlägt der Agent fehl (Modell nicht im Account), ist der Fehler explizit sichtbar; ein Fallback auf Selbstplanung ist im Skill dokumentiert. Die Fragilitäts-Abwägung aus #741 gilt weiterhin — alle drei Stufen (portabel / plan-feature-Skill / Kern-Automatik) liefern jetzt Planungsnutzen.
  - **Update-SSOT (#910):** Claude Code hat keine Runtime-Aliases — aktuelle Modell-IDs + Checkliste, welche Dateien bei einem Modell-Wechsel anzupassen sind: [docs/model-routing.md](model-routing.md).

## 3. Die Fitness-Functions im Detail

Jedes Gate prüft **eine** Fehlklasse. Für jedes gilt: WAS es prüft · WARUM es existiert · wie es gegen False Positives abgesichert ist. Reihenfolge wie in der CI (nach `npm test` aufsteigend streng).

| Gate | Befehl |
|---|---|
| Tests | `npm test` (Vitest) |
| Typecheck (strict) | `npm run typecheck` |
| Lint | `npm run lint` (`eslint . --max-warnings 0`) |
| Architektur | `npm run check:arch` (dependency-cruiser) |
| Dateigröße | `npm run check:size` |
| Root-Kontextdatei-Größe | `npm run check:contextsize` |
| `any`-Suppression-Ratchet | `npm run check:anysuppress` |
| Doku↔Code-Drift | `npm run check:docmap` |
| Harness-Drift (Kommandos + Links + verify-Kette) | `npm run check:docdrift` |
| Lockfile-Integrität | `npm run check:lockfile` |
| Diff-Größenbudget | `npm run check:diffsize` |
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
- **WAS:** meldet seit #907 jede `src/`-Datei, die in **keinem** [`docs/module/`](module/)-Tiefendoc als Backtick-Pfad auftaucht, sowie jede deklarierte Schicht, die von der dependency-cruiser-Zuordnung abweicht (gemeinsame Schicht-Quelle [`scripts/layers.cjs`](../scripts/layers.cjs)). Auch als `test/docmap.test.ts`.
- **WARUM:** Landkarte (CLAUDE.md, Subsystem-granular) + Tiefendocs sind der **Kontext-Selektor** jeder KI-Session (§2.1). Driftet die Abdeckung leise, führt sie Agenten in die Irre — genau das darf nicht passieren, also ist „die Doku stimmt" selbst maschinell geprüft.

### Harness-Drift-Wächter (`npm run check:docdrift`, #529)
- **WAS:** hält die Doku jenseits der Datei-Landkarte ehrlich: (1) jedes in einem Markdown erwähnte `npm run <x>` (bzw. `npm test`) existiert als Skript in `package.json`; (2) jedes Kern-Skript (außer bewusst ausgenommener Convenience) ist in AGENTS.md/CLAUDE.md/README dokumentiert; (3) jeder interne, repo-relative Markdown-Link zeigt auf eine existierende Datei; (4) jeder `#anker` trifft eine reale Überschrift (GitHub-Slug-Regel). Auch als `test/docdrift.test.ts`.
- **WARUM:** AGENTS.md/CLAUDE.md/README werden von **jeder** KI-Session als Kontext geladen und nennen Kommandos + verweisen quer auf andere Harness-Docs. Ein totes Kommando oder ein toter Link/Anker schickt einen Agenten ins Leere — der Datei-Landkarten-Wächter (#482) deckt genau diese Fehlklasse **nicht** ab.
- **Absicherung:** Code-Fences werden ausgeblendet (ein `#`-Kommentar in einem bash-Block ist keine Überschrift, ein Beispiel-Link keiner); Ausnahmen (undokumentierte Convenience-Skripte) stehen begründet in `DOC_EXEMPT_SCRIPTS`. Red-Green über `test/docdrift.test.ts` (totes Kommando, toter Link, toter Anker werden jeweils erkannt; die Slug-Regel trifft Emoji-/Umlaut-Überschriften).

### Doku-Aktualitäts-Wächter (`npm run check:doctickets`, #610)
- **WAS:** liest die zwischen den Markern `open-harness-tickets:start/end` in §5 als **„offen"** gelistete Roadmap-Tabelle und gleicht jede Nummer gegen den echten `gh issue`-Status ab — ist eine als offen dokumentierte Nummer auf GitHub bereits **CLOSED**, ist die Roadmap stale. Die reine Parse-Logik (`parseOpenHarnessTickets`) testet `test/doctickets.test.ts` offline (Red-Green).
- **WARUM:** `check:docdrift` prüft nur *Kommandos/Links/Anker*, nicht die **inhaltliche Aktualität**. Genau das ließ die „#492 (RNG-Determinismus) ist offen"-Zeile stehen, obwohl das Gate längst existierte (Befund iSAQB-Runde 3). Dieser Wächter fängt diese Fehlklasse.
- **Absicherung / bewusste Sonderstellung:** der gh-Abgleich braucht Netz + Auth und ist nicht deterministisch — er ist darum **NICHT** in der hermetischen `verify`-Kette / der Vitest-Suite, sondern läuft als **eigener, bewusst non-blocking (alarmierender) CI-Job** und lokal beim Pflege-Schritt. Fehlt `gh`/Token (offline, frischer Clone), wird **übersprungen** (exit 0, klare Meldung), nicht fälschlich grün gemeldet; **rot** nur bei einer sicher als CLOSED erkannten Nummer. Non-blocking ist Absicht: ein von einem *parallelen* Agenten geschlossenes Roadmap-Ticket soll keinen fremden PR rot blockieren (das ⚠️-Anti-Pattern aus #395), sondern nur alarmieren.

### Boot-/Interaktions-Smokes (`npm run smoke`, Playwright, #391/#480)
- **WAS:** lädt den **gebauten Offline-Build** (`dist-offline/index.html` per `file://`, genau der Doppelklick-Pfad) headless in Chromium. Boot-Smoke: fährt fehlerfrei hoch (Boot-Flag, Canvas da, keine Konsolen-/Laufzeitfehler). Interaktions-Smokes: `help` ins Terminal → Ausgabe, Overlay auf/zu, Onboarding-Quest annehmen + abschließen — über Tastatur/DOM ohne Test-Hintertür.
- **WARUM:** die Vitest-Unit-Tests fassen die Präsentation (Phaser/DOM) bewusst **nicht** an. Ein Fehler, der erst beim echten Boot auftritt (Phaser-Init, ein werfender Content-Loader, ein kaputtes Asset-Manifest) oder eine Interaktions-Regression (Terminal nimmt keine Eingabe) käme sonst durch.
- **Absicherung:** bewusst **schlank** (kein NPC-Nähe-Overlay, keine Weltbewegung), um flake-frei zu bleiben; Red-Green über sabotierte Tastenkopplung nachgewiesen. Getrennt von Vitest (`test/**` vs. `e2e/**`), damit sich die Test-Welten nicht überschneiden.

### Security-Audit (`npm audit`, #396)
- **WAS:** zweistufig — **blockierend** nur über die ausgelieferten Produktiv-Deps (`npm audit --omit=dev --audit-level=high`), **nur berichtend** über den vollen Baum inkl. Dev.
- **WARUM:** das echte Nutzerrisiko steckt im `dist`-Artefakt (nur `phaser` & Co., kein vite/vitest). Ein hartes high+-Gate über den **ganzen** Baum wäre durch dev-only-Advisories dauerhaft rot — und würde dann abgeschaltet (die ⚠️-Falle aus #395). Die selbstwartende Regel „blocke, was ausgeliefert wird; berichte den Rest" verrottet nicht bei Stardew-Scope, anders als ein hartcodierter Advisory-Allowlist.
- **Ergänzend:** Dependabot ([`.github/dependabot.yml`](../.github/dependabot.yml)) öffnet wöchentlich gebündelte Update-PRs und zieht Security-Advisories automatisch hoch; Umgang damit als Policy in [CONTRIBUTING.md](../CONTRIBUTING.md#pull-requests--abhängigkeits-updates-policy).

> **Nicht auf der Liste, aber Teil des Netzes:** die **Save-nie-brechen-Regel** (jede Format-Änderung migriert, alter Stand vorher in den Backup-Slot, `sanitizeState` härtet kaputte Felder ab) und der **Determinismus-Anspruch** (seedbare Zufälligkeit statt `Math.random` in der Domäne) gehören zum selben Netz. Der Determinismus ist seit **#492** als ESLint-Gate (`no-restricted-properties` gegen `Math.random`) + `test/rng.test.ts` für `src/sim/**`+`src/content/**` **erzwungen**; die Ausweitung auf die übrige als „pur/deterministisch" deklarierte Logik (`game/**`, z.B. `spaced-repetition.ts`) ist mit #591 nachgezogen.

## 4. Die sichere Autonomie-Schleife

So greifen die Bausteine bei **einem** Ticket ineinander — jeder Schritt ist eine Leitplanke, kein Vertrauensvorschuss:

```
   ┌─ Doku (SSOT) ────────────────────────────────────────────────┐
   │  Agent liest CLAUDE.md + AGENTS.md + modul-lokale Regeln       │
   │                          ▼                                     │
   │  Board: oberstes freies Item der Board-Reihenfolge             │  ← kein Abwägen
   │                          ▼                                     │
   │  Kollisionsschutz: self-assign (verifiziert) + eigener Worktree│  ← parallel-sicher
   │                          ▼                                     │
   │  Umsetzen (TDD: rot → grün → aufräumen)                        │
   │                          ▼                                     │
   │  Gates lokal grün:                                              │  ← Fehler an der Grenze
   │  typecheck → lint → check:arch → check:size →                  │
   │  check:contextsize → check:anysuppress → check:docmap →        │
   │  check:docdrift → check:lockfile → check:diffsize → test       │
   │  + smoke · audit + im Browser verifiziert                      │
   │                          ▼                                     │
   │  PR öffnen → CI abwarten → mergt (rot? fixen bis grün)         │  ← blockierende Grenze; fertig erst bei Merge (#618)
   │                          ▼                                     │
   │  Issue schließen (verifiziert) → Worktree/Branch weg → Board   │
   │  (Kopf-/Doku-Pflege im SELBEN PR #618)                         │
   └───────────────────────────────────────────────────────────────┘
```

**Warum das „billig UND sicher" ergibt (arc42-Qualitätsziel §1.4):**
- **Billig,** weil der Agent nichts sucht (SSOT-Doku als Kontext-Selektor), nichts abwägt (Reihenfolge entscheidet), und ein kleiner Ein-Ticket-Diff wenig Kontext braucht.
- **Sicher,** weil jede Fehlklasse ihre eigene Grenze hat: falsche Logik → Tests, Typfehler → tsc, Schichtbruch → check:arch, Landkarten-Drift → check:docmap, totes Kommando/toter Link → check:docdrift, zu breiter Slice → check:diffsize, Boot-Fehler → Smoke, verwundbare Dep → audit. Kein Fehler verlässt sich darauf, dass „der Lauf schon gut war".

**Wo die Grenzen sind (ehrlich):**
- Die Gates prüfen, was sie prüfen können. **Didaktische Richtigkeit** (ist die simulierte Cluster-Mechanik pädagogisch sinnvoll?) und **Spielspaß/Look** bleiben menschliches Urteil — darum der Browser-Verifizierungs-Schritt und die interaktive Optik-Abstimmung per Rückfrage.
- **Seit #592 ist `main` PR-gegated** (Branch-Protection: Merge nur über PR mit grünen Required-Checks, `enforce_admins` an). Die CI-Gates laufen damit **vor** dem Merge und sind server-seitig **nicht umgehbar** — kein `--no-verify`-Schlupf, kein Aufbauen auf noch-rotem `main` mehr. `check:diffsize` misst auf dem PR den echten Slice (CI-Checkout `fetch-depth: 0` + `KQ_DIFF_BASE`). Der frühere Direkt-Push mit post-hoc-CI (und der pre-push-Hook #528 als lokaler Riegel) ist damit abgelöst; der Hook bleibt nur als sekundäres Netz.
- **Least-Privilege-Permissions statt unbegrenztem Shell-Zugriff (#901).** Der Agent läuft seit #901 unter einer `permissions`-Policy in [`.claude/settings.json`](../.claude/settings.json): `deny` blockt die nie-im-Workflow-nötigen katastrophalen Kommandos (`rm -rf`, `git push --force`/`-f`, `sudo`, `npm publish`, `gh repo delete`), `ask` setzt rohen Netz-Zugriff außerhalb des Workflows (`curl`/`wget`/`nc`/`ssh`) auf einen menschlichen Checkpoint, und `allow` ist die kuratierte Allowlist der bekannten Workflow-Kommandos (`npm`/`git`/`gh …`). **Ehrlich zur Reichweite (wie beim CODEOWNERS-Hinweis in AGENTS.md):** `deny` für Bash ist ein PREFIX-Match, kein wasserdichter Zaun — es fängt die dokumentierten Schreibweisen, nicht jede erdenkliche (`rm --recursive --force`, ein Alias). Der Wert ist ein harter Boden gegen das Irreversible + kein Auto-Approve für rohen Netz-Zugriff; die eigentliche Code-Qualitäts-Durchsetzung bleibt das PR-Gate (#592). Ein struktureller Wächter [`test/settings-permissions.test.ts`](../test/settings-permissions.test.ts) hält die `deny`/`ask`-Einträge am Leben (still entfernen ⇒ `npm test` rot). **Bewusste Grenze:** das Schreiben genau dieser Datei wird vom Auto-Mode-Klassifikator als Self-Modification angehalten — der Block selbst ist Absicht (ein Agent soll seine eigenen Leitplanken nicht unbeaufsichtigt aufweichen), die Erst-Einrichtung braucht daher die Maintainerin.
- Der **Forum-Eingang** ist der einzige Pfad, auf dem unvertrauter externer Text (GitHub Discussions) in auto-erzeugte Issues und damit in die Agenten-Queue gelangt — ein Prompt-Injection-Vektor (Härtung geplant: #531).
- Bleibt ein Agent an derselben roten Prüfung auf seinem eigenen Ticket hängen (versteht die Ursache nicht, der Fix greift wiederholt nicht), **gibt es seit #904 einen technisch erzwungenen Stopp.** Das **Festgefahren-Protokoll** (#710, AGENTS.md: nach drei erfolglosen Fix-Versuchen ein konsolidierter Entscheidungs-Kommentar + Label `status:festgefahren`) ist damit nicht mehr nur eine Verhaltensregel, sondern ein echter Gate: [`.github/workflows/festgefahren.yml`](../.github/workflows/festgefahren.yml) zählt via `workflow_run` die distinct Commits mit failed CI auf dem PR-Branch (manuelle Reruns zählen dank SHA-Dedup nicht extra) — nach 4 (= 1 initial + 3 Fix-Versuche) setzt der Workflow selbst das Label und postet den Kommentar, unabhängig vom Agentenverhalten. Graceful degradation: kein Netz/Token überspringt den Wächter statt fälschlich zu blocken.

### Belege: der Rot→Fix→Grün-Bogen in echt

Die Schleife oben ist ein Mechanismus – hier drei echte, verlinkte Vorher/Nachher-Fälle, in denen sie tatsächlich gegriffen hat:

- **Ein Windows-spezifischer Testbruch** ([#399](https://github.com/fluffels/kubernia/issues/399)): `scripts/check-size.mjs` begann mit einem `#!/usr/bin/env node`-Shebang; `test/filesize.test.ts` importierte die Datei direkt, und Nodes Modul-Loader scheiterte daran **nur unter Windows** — `npm test` war rot. Fix in [116ba79](https://github.com/fluffels/kubernia/commit/116ba79e3685c6e8236383e670c2f0ebe6b342a2): Shebang entfernt, alle 797 Tests wieder grün. Zeigt die Testsuite selbst als Leitplanke gegen plattformspezifische Regressionen.
- **Der eigene Alarm-Wächter driftete gegen sein eigenes Fundament** ([#658](https://github.com/fluffels/kubernia/issues/658), gefangen beim Arbeiten an #644): Der CI-Job `alarm-red-main` (§5, aus #605) identifizierte/dedupliziert sein Alarm-Issue über das Label `prio:hoch` — das mit der Umstellung auf Board-`Prio` (#627) bereits entfernt war. Im Ernstfall (rotes `main`) wäre `gh issue create --label prio:hoch` mit „label not found" abgebrochen, **genau in dem Moment, in dem das Netz greifen soll**. Fix in [PR #667](https://github.com/fluffels/kubernia/pull/667): Alarm-Issue über ein bestehendes Label + Board-`Prio` per GraphQL, Dedup über Titel-Präfix statt totem Label. Ein Dogfooding-Beispiel im Kern: der Harness fing eine Drift **in sich selbst**.
- **Eine Schichtverletzung schlich sich unbemerkt ein** (Befund [#292](https://github.com/fluffels/kubernia/issues/292), Fix [#344](https://github.com/fluffels/kubernia/issues/344)): Ein Architektur-Review deckte auf, dass `game.ts` (Anwendung) `sfx.ts` (Präsentation) importierte — für einen einzigen Aufruf `SFX.applyConfig()`. Zu dem Zeitpunkt gab es dafür **keine automatische Grenze**, nur Review-Disziplin. Der Fix löste die Kopplung über einen neuen Audio-Sink in `runtime.ts` und führte `test/layering.test.ts` als Regressions-Guard ein — der wäre vor dem Fix rot gewesen. Der Befund motivierte direkt den dauerhaften Architektur-Wächter `check:arch` (#347, §3): aus einem einmaligen Fund wurde eine permanente, maschinelle Grenze statt eines erneuten Einzelfalls.

Aktuelle Durchsatz-Zahlen (gemergte PRs, offen vs. geschlossen) stehen bewusst **nicht** hier verankert — ein hartcodierter Zählwert würde bei jedem weiteren Ticket sofort veralten (dieselbe Philosophie wie `check:docdrift`/`check:doctickets`, §3). Live nachschlagen: `gh pr list --state merged --limit 1000 | wc -l`, bzw. sobald gelandet über die README-Badges aus [#700](https://github.com/fluffels/kubernia/issues/700).

## 5. Roadmap / bekannte Lücken

Der Harness ist bewusst ein **lebendes System** — seine eigenen Schwachstellen sind als Tickets erfasst (dogfooding: der Harness verbessert sich über denselben Board-Workflow). Noch **offene** Harness-Verbesserungen ([ticket-reihenfolge.md](ticket-reihenfolge.md)):

<!-- Diese Tabelle ist maschinell bewacht (#610, `npm run check:doctickets`): jede hier
     als „offen" gelistete #-Nummer wird gegen den echten gh-issue-Status abgeglichen; ist
     eine davon bereits geschlossen, meldet der Wächter Drift (rot). Beim Schließen eines
     Roadmap-Tickets also seine Zeile hier entfernen (erledigte Punkte gehören in „Schon
     gelandet"). NUR Nummern ZWISCHEN den beiden Markern zählen als „offen dokumentiert" —
     die #-Nummern in Prosa/„erledigt"-Notizen (z.B. das erledigte #492) bleiben außen vor. -->
<!-- open-harness-tickets:start -->
_Aktuell keine offenen Harness-Roadmap-Punkte — die Liste ist vollständig abgearbeitet. Eine neue Lücke kommt als Tabellenzeile mit fett gesetzter Ticketnummer zwischen diese beiden Marker (nur fett gesetzte Nummern zwischen den Markern zählen als „offen dokumentiert")._
<!-- open-harness-tickets:end -->

> **Erledigt & darum aus der Tabelle raus:** **#492** (Determinismus-Gate, siehe §3), **#591** (Determinismus-Scope auf `game/**`), **#604** (`no-explicit-any`-Suppression-Ratchet), **#593** (Lockfile-Sync-Check), **#594** (tsconfig-`target`-Prüfung), **#595** (Phaser-vendor-Byte-Gate), der optionale jscpd-**Duplikations-Detektor #612** (weiches, nicht-blockierendes CI-Artefakt gegen SSOT-/Copy-Paste-Umgehung), das PR-Gating **#592** und die zweite CI-Grenze **#605** (`verify` post-hoc auf `main`) — sowie **#610** selbst: dieser **Doku-Aktualitäts-Wächter** (`npm run check:doctickets`) macht genau diese Tabelle jetzt maschinell ehrlich (der alte stale „#492 ist offen"-Eintrag war der Auslöser). Die Roadmap wird laufend auf die verbleibenden Lücken eingedampft.

**Schon gelandet** (Block „Harness & Vorzeige-Doku", 2026-07-01): das Aggregat-Kommando `npm run verify` (#527), der Git-**pre-push-Hook** (#528, schließt die Post-hoc-CI-Lücke des Direkt-Push, §4), der **Harness-Drift-Wächter** `check:docdrift` (#529, §3), die **Forum-Inbox-Härtung** gegen Prompt-Injection (#531, §4), der **`review-lenses`-Skill** — der gestaffelte Mehr-Perspektiven-Review mit Gate-Short-Circuit (#532, §2.5) — und das **Diff-Größenbudget-Gate** `check:diffsize` (#533, §3): misst den Slice gegen `main` (max. 20 Dateien / 800 Zeilen, Override mit Pflicht-Begründung) und erzwingt so die Slice-Disziplin auf Commit-Ebene; seit **#592** ist der Durchsetzungspunkt der **PR-Required-Check** (CI-Checkout `fetch-depth: 0` + `KQ_DIFF_BASE`), nicht mehr nur der lokale pre-push-Hook. Und das **PR-Gating selbst** (#592, [ADR 0009](adr/0009-pr-gating-required-checks.md)): `main` ist server-seitig geschützt (Merge nur über PR mit grünen Required-Checks, `enforce_admins` an) — die größte Vibe-Coding-Lücke (ein Agent schiebt roten Code auf `main`, ein paralleler baut darauf auf) ist damit geschlossen. **Stufe 2 der Modellwahl-Automatik (#745):** der `kubernia`-Skill forkt jetzt intern einen Opus-Planungs-Subagenten (`.claude/agents/kubernia-planner.md`) direkt nach dem Claimen — opt-in, nur unter Claude Code, mit Fallback auf Selbstplanung. **Modell-Routing-SSOT + Update-Checkliste (#910):** [docs/model-routing.md](model-routing.md) bündelt die zwei Dateien mit gepinnten Modell-IDs und erklärt die Drei-Tier-Strategie (Explore/günstig, Umsetzung/Session-Default, Plan+Review/stark).

Mit **#530** ([ADR 0008](adr/0008-ki-agenten-harness.md)) ist der ADR jetzt die formale Grundsatzentscheidung und dieses Doc die erklärende Tiefe daneben — dieselbe Arbeitsteilung wie AGENTS.md (operativ) ↔ agent-harness.md (erklärend).

**Zuletzt gelandet (#904):** der **Festgefahren-Wächter** als session-externer, erzwungener Stopp: [`.github/workflows/festgefahren.yml`](../.github/workflows/festgefahren.yml) + [`scripts/check-festgefahren.mjs`](../scripts/check-festgefahren.mjs) — schließt die in §4 (Wo die Grenzen sind) dokumentierte letzte Lücke (Verhaltensregel → echter Gate). Die Protokoll-Verhaltensregel (AGENTS.md) bleibt als erster Anker bestehen; der Workflow ist die technische zweite Mauer.

## 6. Verwandte Dokumente

- **[docs/agent-harness-faq.md](agent-harness-faq.md)** — häufig gestellte Einzelfragen zum Harness (CI-Feedback-Mechanismus, Deploybarkeit, Portabilität, Hook vs. PR-Gate), gesammelt statt einzeln neu beantwortet.
- **[AGENTS.md](../AGENTS.md)** — operative Arbeitsanweisung (harte Regeln, Board-Workflow, Konventionen). *Bei Konflikt maßgeblich.*
- **[CLAUDE.md](../CLAUDE.md)** — die Brücke zu AGENTS.md (`@AGENTS.md`-Import) + die Referenz-Tabellen (Befehle, Repo-Landkarte, Schichtregeln, Anlaufstellen).
- **[docs/arc42-architektur.md](arc42-architektur.md)** — Architektur-Gesamtsicht; §1.4 (KI-Entwickel-Effizienz als Qualitätsziel), §8 (Querschnittskonzepte), §9 (ADR-Übersicht inkl. geplantem 0008).
- **[docs/ticket-reihenfolge.md](ticket-reihenfolge.md)** — was als Nächstes dran ist (deterministisch: oberstes freies Item der Board-Reihenfolge).
- **[docs/adr/](adr/)** — die festgehaltenen Grundsatzentscheidungen (Engine, kein Backend/DB, kein Multiplayer, Skalierungs-Fundament, …).
- **[CONTRIBUTING.md](../CONTRIBUTING.md)** — Einstieg für Menschen (`npm run setup`, Devcontainer, PR-/Dependabot-Policy).
