---
name: review-lenses
description: Gestaffelter Mehr-Perspektiven-Review des kubernia-Diffs: erst `npm run verify:kompakt`, nur bei Grün die Lenses (Code: Architektur, Requirement-Treue, Test-Adäquanz; reines Markdown: eine Doku-Lens). Auslösen bei "Lens-Review", "Mehr-Augen-Review", "Review mit Lenses", "gestaffelter Review".
---

# Mehr-Perspektiven-Review mit Gate-Short-Circuit

Ein **gestaffelter** Review des aktuellen Ticket-Diffs — Vorbild sind produktiv eingesetzte KI-Entwicklungspipelines (#532). Die Idee: **erst die billigen, verlässlichen deterministischen Gates, dann die teuren LLM-Lenses — und die Lenses nur, wenn die Gates grün sind.** Das gibt zuerst das sicherste Feedback und verbrennt keine Tokens auf einem Diff, der schon an einem Gate scheitert.

> Kein Ersatz für die CI-Gates, sondern eine Schicht **davor/darüber** (Feinschliff vor `main`). **Kein Auto-Merge** — der Review liefert Findings, das Mergen bleibt der normale [kubernia](../kubernia/SKILL.md)-Ablauf. Regeln/Begründungen: **[AGENTS.md](../../../AGENTS.md)**; die Harness-Gesamtsicht: [docs/agent-harness.md](../../../docs/agent-harness.md).

## Was ist „der Diff"? — einmal materialisieren, nicht pro Lens erheben (#1034)

Die Änderungen des aktuellen Tickets gegen `origin/main` — im kubernia-Worktree-Ablauf also alles auf dem Feature-Branch. **Der Diff wird EINMAL in eine Patch-Datei geschrieben; die Lenses bekommen den Pfad**, statt jede ihren eigenen `git diff` zu fahren:

```bash
TMP=$(mktemp -d)                                        # Scratch-Ordner der Session
git fetch origin
git status --porcelain                                  # MUSS leer sein — s.u.
git diff origin/main...HEAD --stat                      # Überblick: welche Dateien
git diff origin/main...HEAD > "$TMP/kq-<nr>-r<runde>.patch"   # die EINE Grundlage aller Lenses
git rev-parse HEAD                                      # Frische-Guard, s.u.
```

**Warum Drei-Punkt (`origin/main...HEAD`)** statt `git diff main`: so sieht der Review genau den Slice, den `check:diffsize`/`check:diffcoverage` messen — ein Zwei-Punkt-Diff gegen ein lokal veraltetes `main` zieht fremde Zeilen mit hinein.

⚠️ **Erst committen, sonst reviewt niemand deine letzte Änderung.** Drei-Punkt gegen `HEAD` enthält **nur Committetes**; ein Zwei-Punkt `git diff main` erhöbe auch den Arbeitsbaum („plus noch Uncommittetes") und ist verboten. Der Frische-Guard unten vergleicht nur `HEAD`; die Abweichung „Arbeitsbaum ≠ HEAD" ist für ihn strukturell unsichtbar. Wer den Review mitten in der Arbeit anstößt, bekommt sonst ein „ok" über Code, den keine Lens gesehen hat. Darum `git status --porcelain` **vor** dem Schreiben prüfen. (Im orchestrierten Workflow ist das gesetzt: dort entsteht der Patch **nach** dem Commit.)

**Warum überhaupt eine Datei:** gemessen an #1021 kostete ein Review 878k Tokens, und der dominante Anteil war **Beschaffung, nicht Analyse** — derselbe Diff fünfmal erhoben, die geänderten Dateien fünfmal vollständig gelesen, die Root-Kontextdateien von jeder Lens erneut geöffnet. Das produziert keinen einzigen zusätzlichen Befund.

**Ablage im Temp-/Scratch-Ordner, nicht im Worktree** — eine untracked Datei dort verunreinigt `git status` und könnte mitcommittet werden.

⚠️ **Frische-Guard — der gefährliche Fehlerfall.** Die Patch-Datei trägt die **Runden-Nummer**, und jede Lens prüft mit einem `git rev-parse HEAD`, dass der Stand zu dem passt, bei dem der Patch geschrieben wurde. Ohne das liest Runde 2 der Konvergenzschleife (unten) den Patch aus Runde 1 und attestiert Fixes, die sie nie gesehen hat — ein Review, der von außen grün aussieht und nichts geprüft hat. Weicht der HEAD ab: Patch neu schreiben **und die Abweichung melden**, nicht den alten Stand reviewen.

### Kontext-Diät je Lens (#1034)

Jede Lens bekommt zusätzlich diese drei Regeln — sie kosten keinen Befund:

1. **`AGENTS.md` nicht erneut öffnen.** Unter Claude Code lädt Claude Code sie nativ (#1087), sie liegt also ohnehin vollständig im Kontext; ein `Read` darauf ist reine Duplikation (~30k Tokens pro Lens). Wird eine Regel wörtlich gebraucht: **punktuell greppen**.
2. **Nur den eigenen Regel-Ausschnitt.** Architektur → Schichtregeln + oberste Regel; Requirement-Treue → Doku-Disziplin + Spielstände; Test-Adäquanz → TDD + Red-Green; Doku → SSOT-Kopf + Doku-Disziplin + oberste Regel. Die Ausschnitte der anderen Brillen liest man nicht mit — dafür gibt es ja die anderen Brillen.
3. **Der Patch ist die Primärquelle — genau einmal vollständig lesen** (in den Abschnitten, die `node <Arbeitsverzeichnis>/scripts/patch-abschnitte.mjs <patch>` nennt, bei kleinem Patch einer; jede Zeile einmal, kein größeres `limit`), danach nur gezielt per Grep oder offset/limit, kein zweites Volllesen, auch nicht per `cat`/`Get-Content` (#1265). Eine geänderte Datei nur öffnen, wenn ein konkreter Befund den umgebenden Kontext braucht — und dann gezielt um die Hunk-Zeilen, nicht die ganze Datei.

> **Was die Diät ausdrücklich NICHT trifft:** die **Sabotage-/Red-Green-Prüfung** der Test-Lens (Implementierung testweise verfälschen → wird ein Test rot?). Sie ist der teuerste Schritt und der einzige, der harte Fehler statt Stil-Anmerkungen liefert — in der Messsession fand genau sie den einzigen echten Blocker. Sie bleibt vollständig; sie ist auch die eine erlaubte Ausnahme von „die Lens ändert nichts" (in einem eigenen Lens-Worktree, nie im Feature-Worktree: siehe den ⚠️-Absatz „Die Lenses lesen“).

## Ablauf — Stufe 0 zuerst, dann (nur bei Grün) die Lenses

### Stufe 0 — deterministische Gates (der Short-Circuit)

**Immer zuerst.** Vor der ersten Stufe 0: `git fetch origin`; ist `origin/main` weiter, `git merge origin/main` und Konflikte jetzt lösen (ein Merge nach der Konvergenz kostet Delta-Lens und neuen Nachweis). Dann das SSOT-Aggregat aller Gates (#527):

```bash
npm run verify:kompakt   # Kette aus package.json › scripts.verify, alle Gates, Ausgabe nur bei Rot
```

- **Exit ≠ 0 (rot):** **HIER STOPPEN.** Berichte, welches Gate rot ist, mit der Fehlerausgabe — und **starte KEINEN Lens-Pass** (das ist der Short-Circuit: kein LLM-Token auf einen Diff, der schon deterministisch scheitert). Das gerötete Gate zuerst grün machen (im normalen Ticket-Ablauf), dann den Review erneut anstoßen.
- **Exit == 0 (grün):** weiter zu den Lenses.

> Warum `verify:kompakt` statt einer eigenen Kommandokette: das Skript liest dieselbe **eine** gepflegte Gate-Quelle (#527) — so kann der Review nicht gegen eine veraltete Teilmenge der Gates prüfen — und läuft nach einem Rot weiter, damit ein Fix alle Funde auf einmal behebt. Es ist der **eine** volle Lauf vor dem Review (AGENTS.md § Zwei-Stufen-Prüfung), kein zweiter. Fehlt im Worktree `node_modules`, einmal `npm ci` (#1119).

### Die Lens-Pässe (nur nach grüner Stufe 0)

**Jeder Lens ist ein eigener, fokussierter Pass** — nicht ein vermischter „schau mal drüber"-Blick. Jeweils **nur** durch die eine Brille lesen, dann strukturierte Findings ausgeben (Format unten).

**Welche Lenses laufen — die Review-Staffel (#1265).** Der Sockel je Lens ist fix, gespart wird an der **Zahl** der Lenses. Die Regel ist dieselbe wie `lensPlan` im Workflow:

- **Runde 1:** Listet `git diff --name-only origin/main...HEAD` **nur `*.md`-Dateien** (auch Harness-Markdown), läuft **eine Lens 4 — Doku**. Sonst laufen **Lens 1–3**, ohne Größenschwelle: auch ein kleiner `src`-Diff kann das Save-Format brechen.
- **Ab Runde 2:** nur die Brillen, die in der Vorrunde **blockiert** haben, auf dem **Delta-Patch** des Fixes (`git diff <Vorrunden-HEAD>..HEAD > "$TMP/kq-<nr>-r<runde>-delta.patch"`), mit ihren Vorrunden-Blockern als Prüfliste; der volle Patch bleibt Referenz für gezielte Zugriffe. Ändert der Fix Nicht-Markdown, läuft **Test-Adäquanz immer mit**.
- **Runde 1 ist der erste Lens-Pass** und hat immer den vollen Satz der Diff-Art (Code: alle drei Brillen). Liefert eine Brille keinen Bericht, wird sie einmal auf demselben Stand nachgeholt, bevor gefixt wird; das ist kein eigener Pass. Rote `verify`-Fixe davor zählen nicht als Fix-Runde (eigene Grenze: drei Fix-Versuche, dann Hand-off).
- **Fail-closed:** Fehlt die Dateiliste, gab es keinen Vorrunden-Pass (`verify` war rot), fiel eine Lens aus, hat die Diff-Art gewechselt oder wurde rebased: der volle Satz auf dem vollen Patch.
- **Merge von `main` in den Branch ist kein Fix-Pass.** Konfliktfrei zählt er nicht als Runde; das Delta der nächsten Runde sind nur die Fixes (`git diff <Vorrunden-HEAD>..<M>^1` plus `git diff <M>..HEAD`, `M` = Merge-Commit). Mit Konflikt kommt die Auflösung (`git show --cc <M>`) ins Delta und zählt wie ein Fix, nicht wie ein voller Pass. Rebase mitten in der Schleife vermeiden (er erzwingt den vollen Satz und macht den Nachweis-`head` ungültig): `main` vor Runde 1 einmergen (Stufe 0, erster Punkt); den Nachweis direkt nach der Konvergenz setzen und pushen. Ein Merge von `main` NACH dem Nachweis-Commit: Folgen und Weg in [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd-1064) (ein Konflikt-Merge macht den Check rot).

**Jede Lens läuft als eigener Subagent auf dem starken Tier (#1035)** — nie inline im orchestrierenden Agenten (Hauptagent oder `kubernia-umsetzer`):

```
Agent({
  subagent_type: "kubernia-lens",
  description: "Lens <Architektur|Requirement-Treue|Test-Adäquanz|Doku> R<runde>",   // R<runde> zählt die Messung (token-baseline)
  // kein model/effort am Spawn: beides steht im Frontmatter von .claude/agents/kubernia-lens.md (opus/high, docs/model-routing.md §1)
  prompt: "<Brille WÖRTLICH> · Arbeitsverzeichnis: <worktree> · Patch: <TMP>/kq-<nr>-r<runde>.patch · erwarteter HEAD: <sha> · ab Runde 2: Delta-Patch + Vorrunden-Blocker dieser Brille · <Kontext-Diät WÖRTLICH> · <Findings-Format WÖRTLICH>"
})
```

Ein PreToolUse-Guard (`scripts/lens-auftrag-guard.mjs`) verweigert den Spawn, wenn ein Kopf-Feld noch `<…>` trägt, `erwarteter HEAD:` nicht mit einem Commit-Hash beginnt oder `… WÖRTLICH>` stehen blieb: Werte einsetzen, Blöcke wörtlich kopieren, neu spawnen.

Kennt das Agent-Tool `kubernia-lens` nicht („Agent type 'kubernia-lens' not found“, eine Session, die vor dem Anlegen der Definition gestartet wurde): einmal mit `general-purpose` und `model: "opus"` spawnen, der Prompt beginnt „Lies zuerst `.claude/agents/kubernia-lens.md` im Worktree und befolge deren Rumpf“, und der Bericht vermerkt den Fallback.

⚠️ **Die Lenses lesen, sie schreiben nicht — mit genau einer Ausnahme.** Parallele Subagenten teilen sich **einen** Worktree. Fährt einer Sabotage-Proben (die Red-Green-Prüfung der Test-Lens, s.o.) oder „hilft" mit einem Edit, prüfen die anderen gegen eine veränderte Basis und melden Findings, die gegen den echten Stand nicht reproduzierbar sind — beim Einführungs-PR dieses Umbaus (#1035) genau so passiert. Darum: **jeder Lens-Prompt sagt ausdrücklich „du liest nur, du änderst nichts"**, und die **Sabotage-Proben der Test-Lens laufen nie im Feature-Worktree**, sondern je Runde in einem eigenen **Lens-Worktree** (`git -C <feature-worktree> worktree add --detach <hauptrepo>/.claude/worktrees/kq-<nr>-lens-r<runde> <erwarteter HEAD>`, darin einmal `npm ci`, Tests per `npm --prefix <lens-worktree> test -- <datei>`, danach `git worktree remove --force`). Belegt wird das Entfernen mit `git worktree list` ohne den Pfad und `Test-Path` = `False`, die Unversehrtheit mit leerem `git status --porcelain` im Feature-Worktree. Bleibt ein Lens-Worktree stehen, entfernt ihn der Stop-Hook, sobald `kq-<nr>` weg und er älter als 5 Minuten ist. Das gilt im Workflow genauso (dort sabotiert die Test-Lens ebenfalls). Die Lens-Definition (`kubernia-lens.md`) trägt die Regel; ein Spawn ohne diese Definition (Fallback `general-purpose`) bekommt sie wörtlich im Prompt.

⚠️ **Die Blöcke wörtlich in den Prompt kopieren, nicht referenzieren.** Ein `kubernia-lens`-Subagent liest diese Datei **nicht** — „die Brille unten", „Kontext-Diät oben" oder „Format wie im Skill" sind für ihn leer, und die #1034-Diät fiele still weg. Der Workflow löst dasselbe durch Interpolation (`${KONTEXT_DIAET}`, `lens.auftrag` — bewacht von `test/harness/review-context.test.ts`); auf diesem Pfad ist es Handarbeit des Orchestrators.

Warum überhaupt Subagenten:
- **Der Review darf nicht mit dem Coding-Tier mitrutschen (#1035).** Orchestriert wird der Review auf dem Skill-Pfad vom Umsetzer `kubernia-umsetzer` (Sonnet, der Skill ist dort vorgeladen), ohne ihn vom Hauptagenten auf dem Session-Modell (Stand: [docs/model-routing.md](../../../docs/model-routing.md)). Liefe eine Lens inline in einem von beiden, reviewte der Coding-Tier — die eine Konventionshälfte repariert, die andere still kaputt. Ein Subagent mit eigenem Modell im Frontmatter (`kubernia-lens`) umgeht das vollständig.
- **Kein Self-Grading — schon vorher gefordert (#1012), jetzt auch strukturell erfüllt.** Inline urteilt derselbe Kontext, der den Code gerade geschrieben hat; die Konvergenzschleife unten verlangt ohnehin „frische, unabhängige Kritiker". Der Subagent macht aus der Verhaltensregel eine Eigenschaft des Ablaufs — und ist **billiger**, weil er nur Patch + Auftrag sieht statt der vollen Ticket-Historie.

Damit routet der Skill-Pfad wie der Workflow (`.claude/workflows/kubernia-ticket.js`), der seine Lenses längst so spawnt.

**Lens 1 — Architektur.** Was `dependency-cruiser` (`check:arch`) statisch **nicht** sieht:
- Liegt neue Logik in der **richtigen Schicht**? (pure Domäne ↔ Anwendung ↔ Präsentation — Domäne/Anwendung bleibt Phaser-/DOM-frei und Node-testbar.)
- Schleicht sich **Präsentation in die Domäne** (oder umgekehrt) inhaltlich ein, ohne einen Import zu verletzen?
- **God-Function / zu viel in einer Einheit** (der LOC-Deckel `check:size` sieht nur Dateien, nicht Funktionen)?
- **Duplizierung** einer schon existierenden Fabrik/Abstraktion statt Wiederverwendung?
- **Stardew-Scope (oberste Regel):** trägt der Ansatz noch bei 10× Content/NPCs/Welten, oder reproduziert er dasselbe Problem größer? Content als Daten (nicht als TS-Literal), Granularität mitgedacht?
- **Abfragen und Zählungen:** neue Abfragen oder Zählungen (auch im Delta eines Fixes) auf Standardgrenzen prüfen: `gh issue list` ohne `--limit` liefert nur 30 Treffer, `gh api` ohne `--paginate` nur eine Seite.

**Lens 2 — Requirement-Treue.** Tut der Diff **wirklich, was das Ticket verlangt**?
- Ticket lesen (`gh issue view <nr>`) und den Diff **gegen die Akzeptanzkriterien** halten — jedes Kriterium einzeln: erfüllt / offen / darüber hinausgegangen.
- **Scope-Kriechen:** ändert der Diff mehr als das Ticket (ein Ein-Ticket-Diff bleibt klein — Aufgefallenes wird festgehalten, nicht inline mitgefixt)?
- Betrifft es Spielinhalte/Quests/Steuerung → **README mitgezogen**? Neues `src/`-Modul → Backtick-Pfad-Zeile im passenden **`docs/module/`-Tiefendoc** ergänzt (nicht in die [Repo-Landkarte](../../../docs/referenz/repo-landkarte.md), #907)?
- Berührt es das **Save-Format** → migriert (Version-Bump + Migrationskette), alter Stand bleibt heil?
- Fügt der Diff **Agenten, Subagenten, MCP-Server, Hooks oder Plugins** hinzu oder konfiguriert er sie um → ist die Langfuse-Erfassung im PR belegt (AGENTS.md § Langfuse-Erfassung erhalten)? **Messbehauptungen** in Diff, PR oder Zusammenfassung: gib der Lens die Rohwerte mit (Session-IDs, Zeitfenster, Zählung je Quelle), sie hat keine Langfuse-Tools und prüft sonst nur die Transkript-Seite per `node scripts/token-baseline.mjs --session <id>`; ohne Rohwerte meldet sie „nicht belegt“ (Hinweis).
- **Projekt-Brain:** Brain-Änderungen (`docs/`) wie Code beurteilen: stimmt der Inhalt mit Code und Skripten überein, und liegt jedes Stück nach Wissensart am richtigen Ort (AGENTS.md § Projekt-Brain pflegen)? Eine Fehleinordnung (Regel außerhalb einer `AGENTS.md`, umgeschriebener ADR, laufender Stand oder Tagebuch-Notiz im Brain, neue Seite nicht im Index) ist blockierend; bleibt offensichtlich Übertragbares ungepflegt, ein Hinweis mit dem konkreten Kandidaten.

**Lens 3 — Test-Adäquanz.** Deckt der Test das **Verhalten** ab — und ist er echt?
- Prüft der Test die **öffentliche API / beobachtbares Verhalten** (überlebt Refactoring), nicht Interna?
- **Negativfälle** dabei (kaputter Zustand, falsche Eingabe, „darf nicht passieren"), nicht nur Happy Path? Bei Generatoren jede Kantenart und jeden Sortierschlüssel per Fixture abdecken, Substring-Asserts am Zeilenanfang verankern (`ext_q_a` enthält `q_a`).
- **Kein False Positive (Red-Green):** würde der Test **rot**, wenn man die Logik testweise verfälscht? Wo Zweifel bestehen, den Fix/die Assertion kurz sabotieren → rot sehen → zurücksetzen (vgl. AGENTS.md „Tests gegen False Positives absichern"). Bugfix ⇒ gab es den **fehlschlagenden Repro-Test zuerst**?
- **Echte Gate-Sabotage bei abgeleiteten Regeln:** leitet der Diff Gate-Regeln aus einem Modell ab (z.B. die Schichtregeln von `check:arch` aus `SCHICHT_MODELL`), verlangt die Lens einen Test, der das **echte Gate** laufen lässt (verbotene Kante in eine Temp-Fixture einschleusen, das Gate muss rot werden, eine erlaubte Kante grün bleiben). Ein Nachbau des Matchers im Test genügt nicht: er beweist nur, dass die Ableitung richtig rechnet, nicht, dass das Gate sie anwendet.
- Präsentations-Code (Phaser/DOM) wird **im Browser** verifiziert statt per Unit-Test, ebenso sicht-/spielbare Content-Daten (Quests, Dialoge) — ist das passiert und belegt, wie im Plan vorgesehen (`kqDev.state`-Auszug, Screenshot-Pfad)?

**Lens 4 — Doku** (nur bei reinem Markdown-Diff, dann der **einzige** Pass). Test-Adäquanz entfällt, weil es ohne Code nichts zu sabotieren gibt; die Architektur-Fragen einer Doku stecken in den Punkten 2 und 3:
1. **Requirement-Treue:** der Diff gegen jedes Akzeptanzkriterium einzeln (erfüllt / offen / darüber hinaus), Scope-Kriechen?
2. **SSOT/Drift:** steht eine Regel jetzt doppelt (jede harte Regel genau einmal in `AGENTS.md`, die Langfassung in `docs/`)? Widerspricht der Text einer anderen Stelle, einem ADR oder dem Verhalten von Code/Skripten? Ist-Zustand statt Historie? Lösen neue Links und Anker auf?
3. **Wächter-Kopplung:** ändert der Diff eine Regel, die ein Wächter erzwingt (Regel-Begriff in `test/harness/` und `scripts/` greppen)? Erzwingt er weiter die alte Fassung, ist das **blockierend** — dann fehlt eine Code-Änderung.
4. **⭐ Oberste Regel:** trägt die Regel noch bei 10× Inhalt, Tickets und parallelen Agenten?
5. **Langfuse-Erfassung:** konfiguriert der Diff Agenten, Subagenten, MCP-Server, Hooks oder Plugins um → ist die Erfassung im PR belegt (AGENTS.md § Langfuse-Erfassung erhalten)?
6. **Projekt-Brain:** Brain-Änderungen (`docs/`) wie Code beurteilen: stimmt der Inhalt mit Code und Skripten überein, und liegt jedes Stück nach Wissensart am richtigen Ort (AGENTS.md § Projekt-Brain pflegen)? Eine Fehleinordnung (Regel außerhalb einer `AGENTS.md`, umgeschriebener ADR, laufender Stand oder Tagebuch-Notiz im Brain, neue Seite nicht im Index) ist blockierend; bleibt offensichtlich Übertragbares ungepflegt, ein Hinweis mit dem konkreten Kandidaten.

## Findings-Format (pro Lens)

Je Lens ein kurzer Block. Findings **nach Schwere** sortiert, konkret und belegt — kein „könnte man schöner machen" ohne Ort:

```
## Lens: <Architektur | Requirement-Treue | Test-Adäquanz | Doku>
Verdikt: ✅ ok  |  ⚠️ Hinweise  |  ❌ blockierend

- [❌ blockierend] <Befund> — `datei.ts:zeile` — <warum / Beleg>
- [⚠️ Hinweis]     <Befund> — `datei.ts:zeile` — <warum>
```

Am Ende **ein Gesamt-Verdikt** über alle gelaufenen Lenses (mergefähig ✅ / erst nachbessern ❌) und, falls beim Review etwas **außerhalb des Ticket-Scopes** aufgefallen ist, eine Vorschlagsliste: je Punkt „Spiel-/Inhalts-Befund oder Notfall → Issue, zusammengehörige Befunde gebündelt (AGENTS.md § Oberste Regel)" oder „Harness → Zeile im Sammelticket" (AGENTS.md § Harness-Befunde sind Zeilen, keine Tickets). Nicht inline mitfixen — oberste Regel.

## Als beschränkte Konvergenzschleife im Ticket-Ablauf (#1012)

Im kubernia-Ticket-Ablauf ist dieser Review **Pflicht** vor dem PR — und läuft nicht einmalig, sondern als **beschränkte review↔fix-Konvergenzschleife** (Marktstandard 2026, generator-critic + capped reflexion):

1. Lenses nach der Staffel oben auf den **aktuellen** Stand (frische, unabhängige Kritiker — nicht der Agent, der gefixt hat): Runde 1 der volle Diff, ab Runde 2 die blockierten Brillen auf dem Delta des Fixes.
2. Keine blockierenden Findings mehr ⇒ **konvergiert**, weiter zum PR. Was blockiert, regelt der Blocker-Maßstab (Kurzfassung in `kubernia-lens.md`, Begründung in [docs/agent-harness.md](../../../docs/agent-harness.md#4-die-sichere-autonomie-schleife)): bei Guard-/Parser-Code ist ein neuer Umweg eine „Bekannte Grenze“, kein Blocker.
3. Sonst nachbessern, erst wenn **alle Berichte der Runde da sind** (solange eine Lens läuft, kein Edit und kein Commit im Feature-Worktree; **warten heißt: den Turn mit einer kurzen Statuszeile beenden, ohne `SubagentHandback`**: laufende eigene Subagenten halten den Lauf offen, jeder Lens-Bericht setzt ihn fort. Kein `Monitor`, kein `sleep`, kein Pollen der `.output`-Dateien), dann **zurück zu 1** — mit einem **frischen** Kritiker, damit der finale „OK"-Blick nie ein Self-Grading des eigenen Fixes ist.
4. **Cap 2** Fix-Runden, also höchstens 3 Pässe (unbeschränktes Iterieren ist schlechter, nicht besser — jenseits echter Fehler werden Stil-Nörgeleien erfunden); danach **Hand-off** an die Maintainerin (Festgefahren), kein PR mit bekannten Blockern.

### Nachweis nach Konvergenz (#1270)

Sobald konvergiert ist, setzt der Orchestrator direkt danach einen **leeren Nachweis-Commit** mit den Zeilen `KQ-Plan:` und `KQ-Review:` (Format, Warum und Grenzen: [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd-1064), nicht hier kopieren). `head` ist der zuletzt reviewte Stand, `runden` die Zahl der Pässe, `lenses` die Brillen des vollen Passes (Runde 1), `blocker` je Brille die Zahl ihrer `[❌ blockierend]`-Findings im ersten Pass (Runde 1), auch 0. Lokal prüfen mit `node scripts/check-review-nachweis.mjs` (gibt bei Rot die Vorlage aus); die PR-CI erzwingt es als Required-Check. Danach kein Rebase/Amend mehr, sonst liegt `head` nicht mehr im PR.

Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../../AGENTS.md). Deterministisch verdrahtet ist die Schleife im Workflow [`.claude/workflows/kubernia-ticket.js`](../../workflows/kubernia-ticket.js) (`MAX_REVIEW_RUNDEN`).

## Wichtig

- **Short-Circuit ist hart.** Rote Stufe 0 ⇒ **keine** Lens-Pässe. Der Beweis ist der Exit-Code von `npm run verify:kompakt` (≠ 0), nicht ein Bauchgefühl.
- **Nicht die CI ersetzen.** Die Gates laufen ohnehin vor dem PR lokal (das eine `verify:kompakt` der Stufe 0) und in der CI als Required-Checks nochmal — dieser Skill hängt sich **davor** und ergänzt die LLM-Lenses. **Kein Auto-Merge.**
- **Ablauf-Änderungen** gehören in [docs/agent-harness.md](../../../docs/agent-harness.md) (Harness-Sicht) bzw. [AGENTS.md](../../../AGENTS.md), nicht (nur) in diese Skill-Datei — der Skill ist ein dünner Zeiger auf die Repo-SSOT.
