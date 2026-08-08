---
name: review-lenses
description: Gestaffelter Mehr-Perspektiven-Review des aktuellen kubernia-Diffs. Fährt ZUERST die billigen deterministischen Gates (`npm run verify`) und macht NUR bei Grün drei getrennte agentische Lens-Pässe — Architektur, Requirement-Treue, Test-Adäquanz — mit strukturierten Findings. Rote Gates ⇒ Abbruch mit den Gate-Findings, KEINE Lens-Pässe (Token-Short-Circuit). Ersetzt die CI-Gates nicht (hängt sich davor), kein Auto-Merge. Auslösen bei "Lens-Review", "Mehr-Augen-Review", "Viewpoint-Review", "Review mit Lenses", "gestaffelter Review", "review den Diff gründlich vor dem Merge", oder wenn der aktuelle Ticket-Diff aus mehreren Perspektiven geprüft werden soll.
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

⚠️ **Erst committen, sonst reviewt niemand deine letzte Änderung.** Drei-Punkt gegen `HEAD` enthält **nur Committetes** — die frühere Fassung erhob per Zwei-Punkt `git diff main` auch den Arbeitsbaum („plus noch Uncommittetes"). Der Frische-Guard unten vergleicht nur `HEAD`; die Abweichung „Arbeitsbaum ≠ HEAD" ist für ihn strukturell unsichtbar. Wer den Review mitten in der Arbeit anstößt, bekommt sonst ein „ok" über Code, den keine Lens gesehen hat. Darum `git status --porcelain` **vor** dem Schreiben prüfen. (Im orchestrierten Workflow ist das gesetzt: dort entsteht der Patch **nach** dem Commit.)

**Warum überhaupt eine Datei:** gemessen an #1021 kostete ein Review 878k Tokens, und der dominante Anteil war **Beschaffung, nicht Analyse** — derselbe Diff fünfmal erhoben, die geänderten Dateien fünfmal vollständig gelesen, `AGENTS.md`/`CLAUDE.md` von jeder Lens erneut geöffnet. Das produziert keinen einzigen zusätzlichen Befund.

**Ablage im Temp-/Scratch-Ordner, nicht im Worktree** — eine untracked Datei dort verunreinigt `git status` und könnte mitcommittet werden.

⚠️ **Frische-Guard — der gefährliche Fehlerfall.** Die Patch-Datei trägt die **Runden-Nummer**, und jede Lens prüft mit einem `git rev-parse HEAD`, dass der Stand zu dem passt, bei dem der Patch geschrieben wurde. Ohne das liest Runde 2 der Konvergenzschleife (unten) den Patch aus Runde 1 und attestiert Fixes, die sie nie gesehen hat — ein Review, der von außen grün aussieht und nichts geprüft hat. Weicht der HEAD ab: Patch neu schreiben **und die Abweichung melden**, nicht den alten Stand reviewen.

### Kontext-Diät je Lens (#1034)

Jede Lens bekommt zusätzlich diese drei Regeln — sie kosten keinen Befund:

1. **`AGENTS.md`/`CLAUDE.md` nicht erneut öffnen.** Unter Claude Code liegen sie durch den `@AGENTS.md`-Import ohnehin vollständig im Kontext; ein `Read` darauf ist reine Duplikation (~30k Tokens pro Lens). Wird eine Regel wörtlich gebraucht: **punktuell greppen**.
2. **Nur den eigenen Regel-Ausschnitt.** Architektur → Schichtregeln + oberste Regel; Requirement-Treue → Doku-Disziplin + Spielstände; Test-Adäquanz → TDD + Red-Green. Die Ausschnitte der anderen Brillen liest man nicht mit — dafür gibt es ja die anderen Brillen.
3. **Der Patch ist die Primärquelle.** Eine geänderte Datei nur öffnen, wenn ein konkreter Befund den umgebenden Kontext braucht — und dann gezielt um die Hunk-Zeilen, nicht die ganze Datei.

> **Was die Diät ausdrücklich NICHT trifft:** die **Sabotage-/Red-Green-Prüfung** der Test-Lens (Implementierung testweise verfälschen → wird ein Test rot?). Sie ist der teuerste Schritt und der einzige, der harte Fehler statt Stil-Anmerkungen liefert — in der Messsession fand genau sie den einzigen echten Blocker. Sie bleibt vollständig; sie ist auch die eine erlaubte Ausnahme von „die Lens ändert nichts" (danach zurücksetzen und mit leerem `git status --porcelain` belegen).

## Ablauf — Stufe 0 zuerst, dann (nur bei Grün) die drei Lenses

### Stufe 0 — deterministische Gates (der Short-Circuit)

**Immer zuerst.** Fahre das SSOT-Aggregat aller Gates (#527):

```bash
npm run verify   # typecheck → lint → check:arch → check:size → check:contextsize → check:anysuppress → check:docmap → check:docdrift → check:lockfile → check:diffsize → test
```

- **Exit ≠ 0 (rot):** **HIER STOPPEN.** Berichte, welches Gate rot ist, mit der Fehlerausgabe — und **starte KEINEN Lens-Pass** (das ist der Short-Circuit: kein LLM-Token auf einen Diff, der schon deterministisch scheitert). Das gerötete Gate zuerst grün machen (im normalen Ticket-Ablauf), dann den Review erneut anstoßen.
- **Exit == 0 (grün):** weiter zu den Lenses.

> Warum `npm run verify` statt einer eigenen Kommandokette: es ist die **eine** gepflegte Gate-Quelle (#527) — so kann der Review nicht gegen eine veraltete Teilmenge der Gates prüfen. Fehlt im Worktree `node_modules`, einmal `npm install`.

### Die drei Lens-Pässe (nur nach grüner Stufe 0)

**Jeder Lens ist ein eigener, fokussierter Pass** — nicht ein vermischter „schau mal drüber"-Blick. Jeweils **nur** durch die eine Brille lesen, dann strukturierte Findings ausgeben (Format unten). Reihenfolge ist egal, aber alle drei laufen.

**Jede Lens läuft als eigener Subagent auf dem starken Tier (#1035)** — nicht inline im Hauptagenten:

```
Agent({
  subagent_type: "general-purpose",
  description: "Lens <n>: <Architektur|Requirement-Treue|Test-Adäquanz>",
  model: "opus", effort: "high",
  prompt: "<Brille WÖRTLICH> · Arbeitsverzeichnis: <worktree> · Patch: <TMP>/kq-<nr>-r<runde>.patch · erwarteter HEAD: <sha> · <Kontext-Diät WÖRTLICH> · <Findings-Format WÖRTLICH>"
})
```

⚠️ **Die Blöcke wörtlich in den Prompt kopieren, nicht referenzieren.** Ein `general-purpose`-Subagent liest diese Datei **nicht** — „die Brille unten", „Kontext-Diät oben" oder „Format wie im Skill" sind für ihn leer, und die #1034-Diät fiele still weg. Der Workflow löst dasselbe durch Interpolation (`${KONTEXT_DIAET}`, `lens.auftrag` — bewacht von `test/review-context.test.ts`); auf diesem Pfad ist es Handarbeit des Orchestrators.

Warum überhaupt Subagenten:
- **Der Review darf nicht mit dem Coding-Tier mitrutschen (#1035).** Der [kubernia](../kubernia/SKILL.md)-Skill setzt per Frontmatter `model: sonnet` für die **Umsetzung**, und dieser Override gilt (nach bisheriger Beobachtung, siehe [docs/model-routing.md](../../../docs/model-routing.md)) für den **Rest des Turns**. Liefe eine Lens inline im Hauptagenten, reviewte Sonnet — die eine Konventionshälfte repariert, die andere still kaputt. Ein Subagent mit eigenem `model:` umgeht das vollständig.
- **Kein Self-Grading — schon vorher gefordert (#1012), jetzt auch strukturell erfüllt.** Inline urteilt derselbe Kontext, der den Code gerade geschrieben hat; die Konvergenzschleife unten verlangt ohnehin „frische, unabhängige Kritiker". Der Subagent macht aus der Verhaltensregel eine Eigenschaft des Ablaufs — und ist **billiger**, weil er nur Patch + Auftrag sieht statt der vollen Ticket-Historie.

Damit routet der Skill-Pfad wie der Workflow (`.claude/workflows/kubernia-ticket.js`), der seine Lenses längst so spawnt.

**Lens 1 — Architektur.** Was `dependency-cruiser` (`check:arch`) statisch **nicht** sieht:
- Liegt neue Logik in der **richtigen Schicht**? (pure Domäne ↔ Anwendung ↔ Präsentation — Domäne/Anwendung bleibt Phaser-/DOM-frei und Node-testbar.)
- Schleicht sich **Präsentation in die Domäne** (oder umgekehrt) inhaltlich ein, ohne einen Import zu verletzen?
- **God-Function / zu viel in einer Einheit** (der LOC-Deckel `check:size` sieht nur Dateien, nicht Funktionen)?
- **Duplizierung** einer schon existierenden Fabrik/Abstraktion statt Wiederverwendung?
- **Stardew-Scope (oberste Regel):** trägt der Ansatz noch bei 10× Content/NPCs/Welten, oder reproduziert er dasselbe Problem größer? Content als Daten (nicht als TS-Literal), Granularität mitgedacht?

**Lens 2 — Requirement-Treue.** Tut der Diff **wirklich, was das Ticket verlangt**?
- Ticket lesen (`gh issue view <nr>`) und den Diff **gegen die Akzeptanzkriterien** halten — jedes Kriterium einzeln: erfüllt / offen / darüber hinausgegangen.
- **Scope-Kriechen:** ändert der Diff mehr als das Ticket (ein Ein-Ticket-Diff bleibt klein — Aufgefallenes gehört in ein neues Issue, nicht inline mitgefixt)?
- Betrifft es Spielinhalte/Quests/Steuerung → **README mitgezogen**? Neues `src/`-Modul → Backtick-Pfad-Zeile im passenden **`docs/module/`-Tiefendoc** ergänzt (nicht in die CLAUDE.md-Übersicht, #907)?
- Berührt es das **Save-Format** → migriert (Version-Bump + Migrationskette), alter Stand bleibt heil?

**Lens 3 — Test-Adäquanz.** Deckt der Test das **Verhalten** ab — und ist er echt?
- Prüft der Test die **öffentliche API / beobachtbares Verhalten** (überlebt Refactoring), nicht Interna?
- **Negativfälle** dabei (kaputter Zustand, falsche Eingabe, „darf nicht passieren"), nicht nur Happy Path?
- **Kein False Positive (Red-Green):** würde der Test **rot**, wenn man die Logik testweise verfälscht? Wo Zweifel bestehen, den Fix/die Assertion kurz sabotieren → rot sehen → zurücksetzen (vgl. AGENTS.md „Tests gegen False Positives absichern"). Bugfix ⇒ gab es den **fehlschlagenden Repro-Test zuerst**?
- Präsentations-Code (Phaser/DOM) wird **im Browser** verifiziert statt per Unit-Test — ist das passiert und belegt?

## Findings-Format (pro Lens)

Je Lens ein kurzer Block. Findings **nach Schwere** sortiert, konkret und belegt — kein „könnte man schöner machen" ohne Ort:

```
## Lens: <Architektur | Requirement-Treue | Test-Adäquanz>
Verdikt: ✅ ok  |  ⚠️ Hinweise  |  ❌ blockierend

- [❌ blockierend] <Befund> — `datei.ts:zeile` — <warum / Beleg>
- [⚠️ Hinweis]     <Befund> — `datei.ts:zeile` — <warum>
```

Am Ende **ein Gesamt-Verdikt** über alle drei Lenses (mergefähig ✅ / erst nachbessern ❌) und, falls beim Review etwas **außerhalb des Ticket-Scopes** aufgefallen ist, den Vorschlag, dafür ein neues Issue anzulegen (nicht inline mitfixen — oberste Regel).

## Als beschränkte Konvergenzschleife im Ticket-Ablauf (#1012)

Im kubernia-Ticket-Ablauf ist dieser Review **Pflicht** vor dem PR — und läuft nicht einmalig, sondern als **beschränkte review↔fix-Konvergenzschleife** (Marktstandard 2026, generator-critic + capped reflexion):

1. Lenses auf den **aktuellen** Diff (frische, unabhängige Kritiker — nicht der Agent, der gefixt hat).
2. Keine blockierenden Findings mehr ⇒ **konvergiert**, weiter zum PR.
3. Sonst nachbessern, dann **zurück zu 1** — mit einem **frischen** Kritiker, damit der finale „OK"-Blick nie ein Self-Grading des eigenen Fixes ist.
4. **Cap 2** Fix-Runden (unbeschränktes Iterieren ist schlechter, nicht besser — jenseits echter Fehler werden Stil-Nörgeleien erfunden); danach **Hand-off** an die Maintainerin (Festgefahren), kein PR mit bekannten Blockern.

Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../../AGENTS.md). Deterministisch verdrahtet ist die Schleife im Workflow [`.claude/workflows/kubernia-ticket.js`](../../workflows/kubernia-ticket.js) (`MAX_REVIEW_RUNDEN`).

## Wichtig

- **Short-Circuit ist hart.** Rote Stufe 0 ⇒ **keine** Lens-Pässe. Der Beweis ist der Exit-Code von `npm run verify` (≠ 0), nicht ein Bauchgefühl.
- **Nicht die CI ersetzen.** Die Gates laufen ohnehin lokal (pre-push #528) und in der CI nochmal — dieser Skill hängt sich **davor** und ergänzt die drei LLM-Lenses. **Kein Auto-Merge.**
- **Ablauf-Änderungen** gehören in [docs/agent-harness.md](../../../docs/agent-harness.md) (Harness-Sicht) bzw. [AGENTS.md](../../../AGENTS.md), nicht (nur) in diese Skill-Datei — der Skill ist ein dünner Zeiger auf die Repo-SSOT.
