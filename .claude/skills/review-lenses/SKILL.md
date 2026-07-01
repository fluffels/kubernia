---
name: review-lenses
description: Gestaffelter Mehr-Perspektiven-Review des aktuellen kubequest-Diffs (Vorbild WPS-KI-Fabrik). Fährt ZUERST die billigen deterministischen Gates (`npm run verify`) und macht NUR bei Grün drei getrennte agentische Lens-Pässe — Architektur, Requirement-Treue, Test-Adäquanz — mit strukturierten Findings. Rote Gates ⇒ Abbruch mit den Gate-Findings, KEINE Lens-Pässe (Token-Short-Circuit). Ersetzt die CI-Gates nicht (hängt sich davor), kein Auto-Merge. Auslösen bei "Lens-Review", "Mehr-Augen-Review", "Viewpoint-Review", "Review mit Lenses", "gestaffelter Review", "review den Diff gründlich vor dem Merge", oder wenn der aktuelle Ticket-Diff aus mehreren Perspektiven geprüft werden soll.
---

# Mehr-Perspektiven-Review mit Gate-Short-Circuit

Ein **gestaffelter** Review des aktuellen Ticket-Diffs — Vorbild ist die WPS-`roads/ki-fabrik`-Pipeline (#532). Die Idee: **erst die billigen, verlässlichen deterministischen Gates, dann die teuren LLM-Lenses — und die Lenses nur, wenn die Gates grün sind.** Das gibt zuerst das sicherste Feedback und verbrennt keine Tokens auf einem Diff, der schon an einem Gate scheitert.

> Kein Ersatz für die CI-Gates, sondern eine Schicht **davor/darüber** (Feinschliff vor `main`). **Kein Auto-Merge** — der Review liefert Findings, das Mergen bleibt der normale [kubequest](../kubequest/SKILL.md)-Ablauf. Regeln/Begründungen: **[AGENTS.md](../../../AGENTS.md)**; die Harness-Gesamtsicht: [docs/agent-harness.md](../../../docs/agent-harness.md).

## Was ist „der Diff"?

Die Änderungen des aktuellen Tickets gegen `main` — im kubequest-Worktree-Ablauf also alles auf dem Feature-Branch plus noch Uncommittetes:

```bash
git diff main --stat        # Überblick: welche Dateien
git diff main               # der volle Diff (Grundlage aller Lenses)
```

## Ablauf — Stufe 0 zuerst, dann (nur bei Grün) die drei Lenses

### Stufe 0 — deterministische Gates (der Short-Circuit)

**Immer zuerst.** Fahre das SSOT-Aggregat aller Gates (#527):

```bash
npm run verify   # typecheck → lint → check:arch → check:size → check:docmap → check:docdrift → test
```

- **Exit ≠ 0 (rot):** **HIER STOPPEN.** Berichte, welches Gate rot ist, mit der Fehlerausgabe — und **starte KEINEN Lens-Pass** (das ist der Short-Circuit: kein LLM-Token auf einen Diff, der schon deterministisch scheitert). Das gerötete Gate zuerst grün machen (im normalen Ticket-Ablauf), dann den Review erneut anstoßen.
- **Exit == 0 (grün):** weiter zu den Lenses.

> Warum `npm run verify` statt einer eigenen Kommandokette: es ist die **eine** gepflegte Gate-Quelle (#527) — so kann der Review nicht gegen eine veraltete Teilmenge der Gates prüfen. Fehlt im Worktree `node_modules`, einmal `npm install`.

### Die drei Lens-Pässe (nur nach grüner Stufe 0)

**Jeder Lens ist ein eigener, fokussierter Pass** — nicht ein vermischter „schau mal drüber"-Blick. Jeweils **nur** durch die eine Brille lesen, dann strukturierte Findings ausgeben (Format unten). Reihenfolge ist egal, aber alle drei laufen.

**Lens 1 — Architektur.** Was `dependency-cruiser` (`check:arch`) statisch **nicht** sieht:
- Liegt neue Logik in der **richtigen Schicht**? (pure Domäne ↔ Anwendung ↔ Präsentation — Domäne/Anwendung bleibt Phaser-/DOM-frei und Node-testbar.)
- Schleicht sich **Präsentation in die Domäne** (oder umgekehrt) inhaltlich ein, ohne einen Import zu verletzen?
- **God-Function / zu viel in einer Einheit** (der LOC-Deckel `check:size` sieht nur Dateien, nicht Funktionen)?
- **Duplizierung** einer schon existierenden Fabrik/Abstraktion statt Wiederverwendung?
- **Stardew-Scope (oberste Regel):** trägt der Ansatz noch bei 10× Content/NPCs/Welten, oder reproduziert er dasselbe Problem größer? Content als Daten (nicht als TS-Literal), Granularität mitgedacht?

**Lens 2 — Requirement-Treue.** Tut der Diff **wirklich, was das Ticket verlangt**?
- Ticket lesen (`gh issue view <nr>`) und den Diff **gegen die Akzeptanzkriterien** halten — jedes Kriterium einzeln: erfüllt / offen / darüber hinausgegangen.
- **Scope-Kriechen:** ändert der Diff mehr als das Ticket (ein Ein-Ticket-Diff bleibt klein — Aufgefallenes gehört in ein neues Issue, nicht inline mitgefixt)?
- Betrifft es Spielinhalte/Quests/Steuerung → **README mitgezogen**? Neues `src/`-Modul → **CLAUDE.md-Landkarte** ergänzt?
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

## Wichtig

- **Short-Circuit ist hart.** Rote Stufe 0 ⇒ **keine** Lens-Pässe. Der Beweis ist der Exit-Code von `npm run verify` (≠ 0), nicht ein Bauchgefühl.
- **Nicht die CI ersetzen.** Die Gates laufen ohnehin lokal (pre-push #528) und in der CI nochmal — dieser Skill hängt sich **davor** und ergänzt die drei LLM-Lenses. **Kein Auto-Merge.**
- **Ablauf-Änderungen** gehören in [docs/agent-harness.md](../../../docs/agent-harness.md) (Harness-Sicht) bzw. [AGENTS.md](../../../AGENTS.md), nicht (nur) in diese Skill-Datei — der Skill ist ein dünner Zeiger auf die Repo-SSOT.
