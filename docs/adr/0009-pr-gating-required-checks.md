# ADR 0009: PR-Gating mit Required-Checks auf `main` (statt Direkt-Push)

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-07-03 · Ticket: #592

## Status

**Akzeptiert.** Änderungen an `main` laufen ab jetzt **ausschließlich über Pull Requests mit grünen Required-Checks** — kein Direkt-Push mehr. Dieser ADR präzisiert **nur den Integrationsweg** von [ADR 0008](0008-ki-agenten-harness.md); dessen Entwicklungsmodell (Harness, board-getriebener Ein-Ticket-Worktree-Workflow, Fitness-Functions als Leitplanken, Kollisionsschutz) bleibt **unverändert gültig**. 0008 hatte den Umstieg als expliziten Re-Eval-Trigger dokumentiert; mit diesem ADR ist der Trigger eingetreten und umgesetzt.

## Kontext

Der Harness (0008) hielt `main` bisher über **automatische Gates** grün, die **post-hoc** liefen: der Agent pushte direkt auf `main`, die CI-Gates liefen erst *danach*. Der einzige Vorab-Riegel war der lokale **pre-push-Hook** (#528) — der aber per `git push --no-verify` **umgehbar** ist und in flachen CI-Checkouts nicht alle Gates real durchsetzt (`check:diffsize` degradierte dort bewusst zu Grün, `scripts/check-diffsize.mjs`).

Die iSAQB-Analyse 2026-07-02 hat das als Governance-Befund markiert (#592): **die Gates sind exzellent definiert, ihre Durchsetzung war aber post-hoc + lokal umgehbar.** Konkrete Folgen: (1) ein `--no-verify`-Push konnte einen roten oder zu breiten Slice auf `main` bringen; (2) in der Lücke zwischen Push und CI-Grün konnte ein paralleler Agent auf noch-rotem `main` aufbauen.

## Das Problem

Eine Absicherung, die man mit einem Flag umgehen kann, ist bei einem **unzuverlässigen Ausführenden** (LLM-Agent) keine verlässliche Absicherung — sie hängt am Wohlverhalten dessen, dem man gerade nicht blind vertrauen will. Die Durchsetzung muss dorthin, wo sie **nicht umgehbar** ist: server-seitig, vor dem Landen auf `main`.

## Optionen

| Option | Bewertung |
|---|---|
| **Direkt-Push beibehalten + CI nur nachziehen** | Billigste Änderung, ändert aber nichts am Kern: die Durchsetzung bliebe post-hoc und für Admins/Agenten per `--no-verify` umgehbar. Löst #592 nur halb. |
| **PR-Gating mit Required-Checks, `enforce_admins` an (gewählt)** | GitHub blockt den Merge, bis die Required-Checks grün sind — auch für Admins. Nicht umgehbar. Kostet die PR-Zeremonie (Branch pushen → PR → mergen), die aber vollständig per `gh` automatisierbar ist und den Ein-Ticket-Worktree-Fluss nicht bricht. |
| **PR-Gating, aber `enforce_admins` aus** | Weniger disruptiv, aber die Maintainerin/Agenten (Admins) könnten die Checks weiter per Direkt-Push umgehen — genau die „umgehbar"-Sorge aus #592 bliebe für sie bestehen. Verworfen. |

## Entscheidung

**`main` ist server-seitig PR-gegated.** Konkret:

1. **Branch-Protection auf `main`:** Merge nur über einen **Pull Request** mit **grünen Required-Status-Checks** (die CI-Jobs *Tests, Typecheck & Builds* und *Security-Audit (npm audit)*). **`enforce_admins` ist an** — die Regel gilt auch für die Maintainerin und die Agenten (die als Repo-Admin/`fluffels` arbeiten). Kein Direkt-Push, kein `--no-verify`-Schlupf. Kein Pflicht-Review (`required_approving_review_count: 0`), damit der **autonome Selbst-Merge** des Agenten erhalten bleibt: er mergt seinen eigenen PR, sobald die Checks grün sind.
2. **CI setzt `check:diffsize` real durch (#592):** der CI-Checkout holt die **volle Historie** (`fetch-depth: 0`) und setzt `KQ_DIFF_BASE` auf die PR-Basis, sodass der Diff-Größen-Wächter auf PRs den **echten** Slice misst statt zu Grün zu degradieren.
3. **Der pre-push-Hook (#528) bleibt als sekundäres Netz** (schnelle lokale Rückmeldung), ist aber nicht mehr die maßgebliche Durchsetzung. Vor dem PR fährt der Agent `npm run verify` lokal, damit die PR-CI selten rot anläuft.

## Konsequenzen

**Positiv**
- **Nicht umgehbare Durchsetzung:** ein roter oder zu breiter Slice kann `main` nicht mehr erreichen — auch nicht per `--no-verify` oder als Admin.
- **Kein Aufbauen auf rotem `main`:** parallele Agenten sehen `main` immer grün, weil kaputter Code den PR-Gate nicht passiert.
- **Auto-Merge für Dependabot wird möglich** (die Required-Checks waren dessen fehlende Voraussetzung — siehe [CONTRIBUTING.md › PR-Policy](../../CONTRIBUTING.md#pull-requests--abhängigkeits-updates-policy)).

**Negativ / Trade-offs**
- **PR-Overhead pro Ticket:** Branch pushen → PR → mergen statt eines Pushes. Vollständig per `gh` automatisiert, aber ein zusätzlicher Schritt und etwas CI-Wartezeit vor jedem Merge.
- **Auch die Maintainerin braucht für `main` einen PR** (`enforce_admins` an) — bewusst in Kauf genommen, weil sonst die Lücke für Admins offenbliebe.
- **Ein bewusst breiter Slice** (großer God-File-Split) muss den `check:diffsize`-Override (`KQ_DIFFSIZE_OVERRIDE`) tragen, sonst blockt der Required-Check den Merge — dieselbe Slice-Disziplin wie bisher, nur jetzt hart.

## Re-Evaluierungs-Trigger

- **Der PR-Overhead bremst den autonomen Durchsatz spürbar** (z.B. CI-Wartezeiten stauen parallele Agenten) — dann Auto-Merge (`gh pr merge --auto`) breiter einsetzen oder die Check-Laufzeit senken.
- **Ein Required-Check erweist sich als flaky** und blockiert Merges ohne echten Befund — dann den Check stabilisieren, nicht die Protection lockern.
- **Die Solo-Konstellation ändert sich** (mehrere/fremde Beitragende, oder ein Mensch übernimmt Implementierung) — dann Pflicht-Reviews (`required_approving_review_count > 0`) erwägen.

Tritt ein Trigger ein: diesen ADR fortschreiben oder einen ablösenden `0010-…` schreiben.
