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
2. **CI setzt `check:diffsize` real durch (#592):** der CI-Checkout holt die **volle Historie** (`fetch-depth: 0`) und setzt `KQ_DIFF_BASE` auf den Kopf der PR-Basis (HEAD^1 des Merge-Checkouts), sodass der Diff-Größen-Wächter auf PRs den **echten** Slice misst statt zu Grün zu degradieren.
3. **Der pre-push-Hook (#528) bleibt als sekundäres Netz** (schnelle lokale Rückmeldung), ist aber nicht mehr die maßgebliche Durchsetzung. Vor dem PR fährt der Agent `npm run verify` lokal, damit die PR-CI selten rot anläuft.

## Konsequenzen

**Positiv**
- **Nicht umgehbare Durchsetzung:** ein roter oder zu breiter Slice kann `main` nicht mehr erreichen — auch nicht per `--no-verify` oder als Admin.
- **Kein Aufbauen auf rotem `main`:** parallele Agenten sehen `main` immer grün, weil kaputter Code den PR-Gate nicht passiert.
- **Zweite Grenze als Netz (#605):** falls doch je ein roter `main` trotz grüner PR-Checks entsteht (semantischer Merge zweier grüner PRs, fehlkonfigurierter Required Check, Admin-/Force-Push), fährt die CI auf `push:main` die volle `verify`-Kette weiter (jetzt inkl. `check:diffsize` gegen den Vorgänger-Commit) und öffnet bei Rot automatisch ein dedupliziertes Alarm-Issue (`alarm-red-main`) — mit existierendem Label + an die **oberste** Board-Position geschoben per GraphQL (#658/#747; das `prio:hoch`-Label ist seit #627, das Board-`Prio`-Feld seit #747 entfernt), ohne den Workflow zu blockieren.
- **Auto-Merge für Dependabot wird möglich** (die Required-Checks waren dessen fehlende Voraussetzung — siehe [CONTRIBUTING.md › PR-Policy](../../CONTRIBUTING.md#pull-requests--abhängigkeits-updates-policy)).

**Negativ / Trade-offs**
- **PR-Overhead pro Ticket:** Branch pushen → PR → mergen statt eines Pushes. Vollständig per `gh` automatisiert, aber ein zusätzlicher Schritt und etwas CI-Wartezeit vor jedem Merge.
- **Auch die Maintainerin braucht für `main` einen PR** (`enforce_admins` an) — bewusst in Kauf genommen, weil sonst die Lücke für Admins offenbliebe.
- **Ein bewusst breiter Slice** (großer God-File-Split) muss den `check:diffsize`-Override (Commit-Zeile `KQ-Diffsize-Override: #<nr> warum` im Slice, siehe Fortschreibung #1269) tragen, sonst blockt der Required-Check den Merge — dieselbe Slice-Disziplin wie bisher, nur jetzt hart.

## Re-Evaluierungs-Trigger

- **Der PR-Overhead bremst den autonomen Durchsatz spürbar** (z.B. CI-Wartezeiten stauen parallele Agenten) — dann Auto-Merge (`gh pr merge --auto`) breiter einsetzen oder die Check-Laufzeit senken.
- **Ein Required-Check erweist sich als flaky** und blockiert Merges ohne echten Befund — dann den Check stabilisieren, nicht die Protection lockern.
- **Die Solo-Konstellation ändert sich** (mehrere/fremde Beitragende, oder ein Mensch übernimmt Implementierung) — dann Pflicht-Reviews (`required_approving_review_count > 0`) erwägen.

Tritt ein Trigger ein: diesen ADR fortschreiben oder einen ablösenden `0010-…` schreiben.

## Fortschreibung #1269 (2026-10-06): Override als Commit-Zeile statt Umgebungsvariable

Das Druckventil war eine Umgebungsvariable (`KQ_DIFFSIZE_OVERRIDE`, analog `KQ_DIFFCOV_OVERRIDE`). Die erreichte die PR-CI nie: ein bewusst breiter Slice war lokal grün und als Required Check immer rot, der Konsequenz-Punkt oben lief also ins Leere. Jetzt trägt eine Zeile `KQ-Diffsize-Override: #<nr> warum` (bzw. `KQ-Diffcov-Override:`) am Zeilenanfang einer Commit-Message des Slices die Begründung. Die Wächter lesen `git log <basis>..HEAD` mit derselben Basis wie den Diff, so wirkt derselbe Mechanismus lokal, im PR und im Nachlauf auf `push:main`, ohne Änderung an `ci.yml`.

- **Verworfen: Zeile im PR-Body.** Bräuchte den Trigger `pull_request: edited` (jeder Titel-Edit fährt die volle Kette; ein `if:`-Filter wäre ein Bypass, weil ein übersprungener Required Check als bestanden zählt), auf `push:main` einen API-Lookup, und lokal sähe `verify` den Body nicht.
- **Verworfen: Label.** Trägt keine Begründung.
- **Abhängigkeit:** Der Nachlauf auf `main` setzt `squash_merge_commit_message = COMMIT_MESSAGES` voraus (der Squash-Commit enthält die Branch-Messages). Wird die Einstellung geändert, schlägt nach einem Override-Merge der Alarm-Job an.
- **Audit:** Jede Ausnahme steht dauerhaft in `git log` von `main` (`git log --grep '^KQ-Diffsize-Override:'`), Override-Inflation ist so messbar.

## Fortschreibung #1309 (2026-10-06): ein gemeinsames Modul, neueste Zeile, Stale auch bei „nichts zu messen“

Seit drei Wächter (`check:diffsize`, `check:diffcoverage`, `check-review-nachweis`) den Override lesen, liegen Parser, Slice-Lesen und Ausgabe-Texte in `scripts/slice-override.mjs` (Gate-Pfad in `.github/protected-paths.json`). Gelesen wird `git log --reverse`: die **neueste** gültige Zeile zählt, im lokalen Log wie im Squash-Body auf `main`. Ein `KQ-Diffcov-Override` in einem Slice ohne gemessenen Spielcode ist stale (rot), weil dort nichts durchzulassen ist. Eine fremde stale Zeile im eigenen Slice darf durch Umschreiben des eigenen Feature-Branches vor dem Nachweis-Commit entfernt werden.

## Fortschreibung #1383 (2026-10-07): Betreff-Zeilen im Squash-Commit

PR #1381 war grün, der Nachlauf auf `main` (913cf17) rot: die Override-Zeile war der Betreff ihres Commits, und GitHub schreibt jeden Betreff im Squash als `* <betreff>`; der Parser las nur den Zeilenanfang ohne Präfix. Entscheidung: genau `* ` (Stern plus ein Leerzeichen) wird toleriert, über einen Regex für Override und Nachweis (`KQ-Plan`/`KQ-Review`); Einrückung, andere Aufzählungszeichen und Prosa zählen weiter nicht. Verworfen: den Override im Betreff verbieten (nicht erzwingbar) bzw. nur den Body lesen (`%b`, verliert die Form im lokalen Log). Ein Paritätstest hält fest, dass PR-Log und Squash dasselbe lesen. Audit-Grep ab jetzt `git log -E --grep '^(\* )?KQ-Diffsize-Override:'`; der Grep aus #1269 bleibt für die Body-Form gültig.
