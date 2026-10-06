# ADR 0014: Leitplanken ohne Label-Riegel — Audit-Kommentar und Verhaltensregel statt CI-Job

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-06 · Tickets: #1303 (Umsetzung und dieser ADR), Wunsch der Maintainerin im Kommentar vom 2026-10-06 zu #1276

## Status

**Akzeptiert.** Löst den Label-/Guard-Teil von [ADR 0012](0012-harness-autonomie-audit-spur.md) ab (dort Entscheidung 1 „Label selbst setzen“, 2 „Label-Reihenfolge“ und 5 „`gate-change-guard` + CODEOWNERS bleiben“). Unverändert bleiben aus ADR 0012: der Selbst-Merge von Leitplanken-Änderungen, der Audit-Kommentar „🛡️ Leitplanken-Änderung selbst gemergt“ und die Goodhart-Verhaltensregel (AGENTS.md › Kein Grün-durch-Aufweichen). Die operative Regel steht in [AGENTS.md › Human-in-the-Loop-Checkpoints](../../AGENTS.md).

## Kontext

Der CI-Job `gate-change-guard` hielt jeden PR rot, der einen Pfad der Liste in `.github/protected-paths.json` anfasste, bis das Label `maintainer-approved` gesetzt war. Seit ADR 0012 setzt der Agent das Label **selbst**: erst wenn alle anderen Checks grün sind, und vor jedem weiteren Fix-Push wieder entfernt. Im Single-Account-Modell (Agent und Maintainerin sind derselbe GitHub-Account) schützt das nichts, was die Verhaltensregel und der Audit-Kommentar nicht schon leisten.

Die Kosten fielen bei **jedem** Harness-PR an: Wartezeit auf ein erwartet rotes Gate, ein zusätzlicher CI-Lauf nach dem Label, Token für die Label-Reihenfolge in Umsetzer-, Workflow- und Merge-Prompts, dazu ein eigener Workflow mit sicherheitskritischen `pull_request_target`-Regeln samt rund 600 Zeilen Wächter-Tests. Die Maintainerin hat deshalb am 2026-10-06 entschieden, den Riegel ersatzlos zu entfernen, und im Ruleset `main-schutz` den Required-Check „Gate-Config-Aenderungsschutz“ ausgetragen; „PR-Text interne Bezuege pruefen“ ist dort neu Required.

## Optionen

| Option | Bewertung |
|---|---|
| **Status quo** (Guard + Label) | Sichtbarer Marker im PR-Log, aber selbst setzbar; die Kosten je PR bleiben. |
| **Nur automatisch markieren, nicht blockierend** | Ein Workflow setzt oder kommentiert ohne zu blockieren. Behält einen Workflow mit Schreibrechten unter `pull_request_target` für wenig Gewinn. |
| **Guard behalten, aber nicht Required** | Dauerhaftes rotes Rauschen in `gh pr checks --watch` ohne Wirkung. |
| **Ersatzlos entfernen (gewählt)** | Wunsch der Maintainerin. Die Audit-Spur und die Verhaltensregel bleiben, der Riegel entfällt. |

## Entscheidung

1. `.github/workflows/gate-change-guard.yml` und das Label als Mechanik entfallen. Es gibt keinen CI-Job und keinen Sonder-Schritt für Leitplanken-Diffs; der Agent mergt bei grüner CI und bestandenem Review wie sonst auch.
2. `.github/protected-paths.json` bleibt die eine Quelle der Leitplanken-Pfade: der Workflow-Auftrag `beruehrtHarness` gleicht den Diff per Substring gegen sie ab und löst den Audit-Kommentar aus; die Regel für Wächter-Tests (Ordner `test/harness/` samt Marker `@harness-waechter`) hängt an ihr. `.github/CODEOWNERS` bleibt, ist aber nur noch informativ. `test/harness/harness-approval.test.ts` gleicht beide weiter ab.
3. Die Required-Checks im Ruleset sind „Tests, Typecheck & Builds“, „Security-Audit (npm audit)“ und „PR-Text interne Bezuege pruefen“. `test/harness/required-check-shadowing.test.ts` führt sie wortgleich.
4. Ein Wächter in `harness-approval.test.ts` hält fest, dass die abgelöste Label-Mechanik außerhalb der ADRs nirgends zurückkehrt.
5. Das Label `maintainer-approved` bleibt in GitHub bestehen (Löschen wäre ein Eingriff in Repo-Einstellungen und entfernte den Marker an alten PRs). Es wird nur nicht mehr gesetzt.

## Konsequenzen

**Positiv:** schnellerer Merge von Harness-PRs, weniger Prompt-Text und Token, ein Workflow mit besonderen Sicherheitsregeln weniger, rund 600 Zeilen Wächter-Test weniger.

**Negativ / Trade-offs**
- Gate-Config-Änderungen (Lint-, Arch-, Coverage-Config, `scripts/check-*.mjs`, CI-Workflows) tragen keinen maschinellen Marker mehr im PR-Log. Sichtbar bleibt der Audit-Kommentar nach dem Merge.
- Die Erkennung bleibt Selbstauskunft des Umsetzers (`beruehrtHarness`); fehlt der Audit-Kommentar, merkt das nur die Maintainerin beim Gegenlesen.
- Die Sicherheitstests für `pull_request_target` entfallen, weil kein solcher Workflow mehr existiert.

## Re-Evaluierung

- **Weitere Beitragende** neben der Maintainerin: einen echten CODEOWNERS-Pflichtreview erwägen.
- **Audit-Kommentare fehlen** wiederholt: einen nicht blockierenden Auto-Kommentar erwägen.
- **Aufweichung eines Gates entdeckt**, die der Riegel verhindert hätte: einen technischen Riegel wie in ADR 0012 neu bewerten.
