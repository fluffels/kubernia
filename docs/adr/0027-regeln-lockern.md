# ADR 0027: Regeln, Gates und Lenses evidenzbasiert lockern

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-16 · Ticket: #1357

## Status

**Akzeptiert.** Präzisiert AGENTS.md › „Kein Grün-durch-Aufweichen“ um die Gegenrichtung und [ADR 0016](0016-langfuse-takt-woechentlich.md) (Status-Lauf, Checkliste Punkt 8). Bezug: [ADR 0012](0012-harness-autonomie-audit-spur.md) (Kreislauf aus Härtung gegen Hypothetisches), [ADR 0014](0014-leitplanken-ohne-label-riegel.md) (Audit-Kommentar statt Riegel). Teil von #1350 (Baustein 4).

## Kontext

Das Harness wächst nur in eine Richtung: Ratchets kennen nur die strenge Richtung, jede Härtung kommt dazu, nichts geht. Die Checkliste des Status-Laufs (Punkt 8, [model-routing.md](../model-routing.md)) meldet Lockern-Kandidaten, aber keine Regel sagt, wann und wie gelockert wird. Ohne Verfahren bleibt der Kandidat eine Zeile, oder jemand lockert nach Gefühl, und das ist von „Grün durch Aufweichen“ nicht zu unterscheiden.

Zahlen aus [model-routing.md › Lens-Kostenstruktur (c)](../model-routing.md) (Schnappschuss 2026-10-09, Fenster `lauf-ergebnis.mjs --von 2026-10-07T16:37:12Z --bis 2026-10-09T13:50:00Z`): 72 gemergte PRs mit Runde-1-Blockerangabe; die 225,80 $ Lens-Kosten stammen aus dem Fenster der Kostenmessung (siehe (c)). Architektur oder Requirement-Treue blockierten bei Diffs unter 100 Zeilen nie (0/7), bei 100–400 Zeilen in 7/23, über 400 in 26/42. Eine kombinierte Arch+Req-Lens spart 4–15 % der Lens-Kosten; Opus fand in der Gegenprobe nur 6 von 12 historischen Blockern (darum ist `blocker=` kein bestätigter Fund). Eine Folgerunde mit Delta ist 43–53 % billiger, `omitClaudeMd` spart 8–21 % je Lens. Grenzen: kleine Zellen, Größe des gemergten PR, `blocker=` nur Runde 1. Offene Messbausteine: #1360 (Fundquote je Gate), #1362 (Release-Abgleich).

## Optionen

| Option | Bewertung |
|---|---|
| Nie lockern | Das Harness wächst monoton, der Kreislauf aus ADR 0012 setzt sich fort. |
| Lockern nach Ermessen im Feature-PR | Goodhart; verwischt die Grenze zu „Grün durch Aufweichen“. |
| Wächter-Test fürs Verfahren | Verworfen: Härtung gegen Hypothetisches (ADR 0012). |
| Ledger auf eigener Brain-Seite | Verworfen: Regel und Anwendungen gehören zusammen. |
| **Evidenzregel, Verfahren und Ledger im ADR** | **Gewählt.** |

## Entscheidung

1. **Geltungsbereich:** Regel (AGENTS.md, modul-lokale AGENTS.md, Brain-Regel), Gate (`check:*`, Required-Check, Wächter-Test), Lens, Hook, Workflow-Schritt (Skill- oder Workflow-Phase), Prompt-Text (Agenten- und Skill-Definitionen). Lockern heißt: entfernen, zusammenlegen, für eine benannte Klasse (z.B. Diff-Art) entfallen lassen oder Text kürzen.
2. **Evidenz, beides nötig:** (a) gemessene Kosten (Tokens bzw. $, Laufzeit oder Sockel-Zeichen) mit Rohwerten (Quelle, Fenster, Zählung); (b) keine echten Funde in drei Status-Läufen in Folge (drei aufeinanderfolgende Tickets „Langfuse-Status überprüfen“ nach Punkt 8). „Echt“ heißt als Defekt bestätigt, nicht nur `blocker=`, nicht Flake oder Infrastruktur. Quellen: Lens-Trefferquote aus `lauf-ergebnis.mjs`, Gegenprobe, rote Checks je Name; bis #1360 gebaut ist, ordnet der Status-Lauf jedes Rot von Hand als Fund oder Flake ein. Bei Prompt-Regeln ersetzt eines von beidem die Bedingung (b): belegtes natives Verhalten (Release-Abgleich #1362, Changelog- oder Doku-Zitat mit Datum) oder eine Gegenprobe mit fester Basismenge.
3. **Verfahren:** (1) Zeile ins jüngste ungeclaimte Sammelticket „Langfuse-Befunde (gesammelt)“ mit Was, Kosten, Funden je Lauf und Rückfall-Trigger. (2) Der PR, der das Sammelticket abarbeitet, setzt um und misst vorher (die Evidenz) und nachher (derselbe Messwert auf dem PR-Stand, wo im PR messbar, z.B. Sockel-Zeichen; sonst misst der nächste Status-Lauf nach, das steht in der Ledger-Zeile). (3) Die Ledger-Zeile steht im selben PR. (4) Nach dem Merge folgt ein Audit-Kommentar auf dem PR mit der Titelzeile „Gelockert nach ADR 0027“: Was, Evidenz vorher und nachher, Rückfall-Trigger, Revert per `git revert <squash-sha>` als PR; trifft der PR einen Leitplanken-Pfad, steht das in **einem** Kommentar zusammen mit „🛡️ Leitplanken-Änderung selbst gemergt“. (5) Eine Lockerung, die allein über Session-Größe geht, wird ein eigenes Issue.
4. **Rückfall-Trigger:** Jede Ledger-Zeile nennt ihn vorab und nachprüfbar. Standardfall: ein Defekt rutscht durch, den die entfernte Regel gefangen hätte (Beleg z.B. `Folge #`-Commit, späterer Lens-Fund, CI-Rot desselben Fehlertyps). Folge: Revert per PR; die Ledger-Zeile bleibt und bekommt den Vermerk „ausgelöst <Datum>, Revert #<pr>, Anlass“; dieselbe Sache wird erst mit neuer Evidenz wieder gelockert (wieder drei Läufe).
5. **Abgrenzung (Negativfall):** Ein Rot löst nie ein Lockern aus. Ein Gate wird nie im selben PR gelockert, der dieses Gate fixt, und nie in einem Branch, in dem es rot ist. Kein Lockern über `ALLOWLIST` oder `KQ-*-Override` (Druckventile bleiben Druckventile). Ratchet-Schwellen (Floors, Baselines, Budgets, Deckel) bleiben einseitig; gelockert werden nur ganze Regeln, Gates, Lenses und Schritte.
6. **Ausnahme:** Regeln gegen seltene, schwere Schäden sind über Fundfreiheit nie lockerbar: Sicherheit, Fremdtext, Anonymität, interne Bezüge, Save-Migration und Datenverlust, Irreversibles und Außenwirkung, deny-/ask-Listen. Dort ist „keine Funde“ der Normalfall und kein Beleg. Lockerbar nur durch Ersatz mit mindestens gleicher Garantie; bestehende Pre-Flight-Pflichten gelten weiter.
7. **Kandidaten-Klassen:** **K1 Sockeltext für bereits mechanisch erzwungene Regeln:** Text in AGENTS.md oder Agenten-/Skill-Prompts, der Schwelle und Abhilfe eines Gates wiederholt, die das Gate in seiner eigenen Meldung trägt. Lockern heißt Kürzen auf einen Einzeiler aus Gate-Name und Befehl; die Regel bleibt als Zeile in AGENTS.md (SSOT). Rückfall-Trigger: die roten Läufe dieses Checks je PR steigen in den drei Status-Läufen danach über den Wert der drei davor. **K2 Ausgleich einer Modellschwäche:** die Zellen „Lockern-Kandidat“ in [harness-inventar.md](../harness-inventar.md); Evidenzweg: natives Verhalten (#1362) oder Gegenprobe bei neuem Modell-Release (Wiedervorlage aus Punkt 8).
8. **Ledger:** Die Tabelle „Gelockert“ ist der **einzige** fortgeschriebene Teil dieses ADR; Zeilen werden nur angehängt, eine ausgelöste Zeile bekommt nur ihren Vermerk. Der übrige ADR bleibt historisch; Regeländerungen kommen als `## Fortschreibung #<nr> (JJJJ-MM-TT): …`.

## Konsequenzen

- Punkt 8 liefert Zeilen statt Prosa. Für Gates bleibt die Evidenz Handarbeit bis #1360, für Prompt-Regeln hängt sie an #1362.
- Der Lens-Kandidat „Arch+Req als eine Lens bei Code-Diffs unter 100 Zeilen ohne Save-Bezug“ wird **kein** Kandidat: die Ersparnis liegt im Fenster bei höchstens ~0,8 $, die nötige Gegenprobe (mindestens 12 Patches × 2 Brillen, Medianpass Architektur 0,51 $ laut (c)) kostet ein Vielfaches. Wiedervorlage über Punkt 8, wenn der Anteil kleiner Code-PRs steigt.
- Kein neuer Wächter-Test: das Verfahren steht im ADR, die Prüfung leistet die Doku-Lens.

## Re-Evaluierung

Lösen zwei Rückfall-Trigger binnen 3 Monaten aus, wird die Evidenzschwelle verschärft. Melden 8 Status-Läufe Kandidaten, aber keiner erreicht den Ledger, wird geprüft, ob die Hürde zu hoch ist oder die Messung fehlt (#1360). Sobald #1360 und #1362 gebaut sind, präzisiert eine Fortschreibung die Evidenzquellen.

## Fortschreibung #1775 (2026-10-21): Fehlertyp beim Zählen roter Läufe

Präzisiert Punkt 4, lockert kein Gate: Für einen K1-Rückfall-Trigger zählt ein roter Lauf nur, wenn der Check an dem scheitert, was die gekürzte Regel beschreibt („CI-Rot desselben Fehlertyps“), belegt mit Lauf-ID und Logzeile. Ein Testfehler oder Zeitlimit im selben Job ist Test-Rot; ist im selben Lauf beides rot, zählt der Lauf als Gate-Rot.
Erste Anwendung: #1694, Status-Lauf 1, Lauf 39044049165 (Zeitlimit in `test/abnahme.test.ts`, behoben in #1801) zählt nicht, der Rückfall-Zähler steht bei 0. Die Ledger-Zeile bleibt unverändert (Punkt 8 erlaubt nur den Vermerk „ausgelöst“).

Weitere Fortschreibungen stehen als Dateien unter [`fortschreibungen/`](fortschreibungen/0027-1942-pass-limit-freigabe.md) (Konvention: [README](README.md#format)): [#1942](fortschreibungen/0027-1942-pass-limit-freigabe.md).

## Gelockert

| Datum | Was | Evidenz | PR | Rückfall-Trigger |
|---|---|---|---|---|
| 2026-10-16 | Fünf Gate-Bullets in AGENTS.md › Gates (Dateigröße, AGENTS.md-Größe, Slice-Größe, Testabdeckung, Bundle) auf Einzeiler gekürzt (Gate-Name, Befehl, Kernschwelle wo einzeilig); Regel und Gate bleiben. Ausgenommen: Schichtung (trägt die Entwurfsregel) und Komplexität (die ESLint-Meldung nennt keinen Abhilfeweg). | (a) AGENTS.md 27.230 → 26.196 Zeichen auf dem PR-Stand (−1.034, ≈ −246 Tokens je Session und Subagent, gemessen mit `check:contextsize`). (b) Gegenprobe mit fester Basismenge je Gate, die Meldung nennt Schwelle und Abhilfe: `check:size`, `check:contextsize` lokal rot belegt; `check:diffsize` und `check:bundle` echte CI-Auszüge (Läufe 37668167840, 37839470452); Testabdeckung statisch zitiert (`check-diffcoverage.mjs`). Vergleichswert je Gate: rote Läufe in W1–W3 zusammen (2026-10-07 bis 10-15, 97 gemergte PRs): `check:diffsize` 2/97, `check:bundle` 1/97, `check:size`, `check:contextsize`, Coverage und Diff-Coverage je 0/97; Rohwerte und Zählverfahren im PR-Text. | #1694 | Je Gate: die roten Läufe je gemergtem PR in den Status-Läufen 1–3 zusammen über dem Wert dieses Gates in W1–W3 zusammen (bei 0/97 löst jeder rote Lauf aus) → Revert per PR. Offen bis Status-Lauf 3. |
| 2026-10-21 | Zusatzpässe nach dem Review-Cap (Cap 2 Fix-Runden, ≤ 3 Pässe) brauchen keine Rückfrage mehr: der Umsetzer fährt sie, solange jeder nur belegte Test- oder Doku-Funde behebt und die Blockerzahl sinkt (höchstens 3, Ursache im PR); strittige Blocker (und vor dem Festgefahren-Abbruch) entscheidet er ausgewogen (A/B-Vergleich, Nachrecherche, frischer kritischer Subagent) mit „Entscheidung: X, weil Y“. Die Schwellen (dritter Fix-Versuch, `festgefahren.yml` nach 4 roten Commits) bleiben. | Änderungswunsch der Maintainerin (Zeile in #1808, 2026-10-21) statt Evidenz; Wiedervorlage `review-verfahren-anpassen` (2027-01-21) prüft das Verfahren an neuen Modellen und der Lens-Trefferquote. | #1808 | Ein Folge-#-Commit auf einem Ticket-PR mit Zusatzpass ohne Rückfrage, oder mehr als 6 Pässe in einem PR → Revert per PR. |
| 2026-10-21 | Ein Abnahme-Fix (Urteil `fix` der Holdout-Abnahme) hat ein eigenes Budget von einer Delta-Lens-Runde (nur Test-Adäquanz und Requirement-Treue, bei reiner Doku die Doku-Brille) neben dem Review-Cap, ohne Rückfrage; Review-Zeile `abnahmefix=1`, die Rundengrenze der Review-Schleife (Cap 2) bleibt. Vorher blieb der Abnahme-Fix ohne Lens-Gegenprüfung oder führte nach verbrauchtem Cap in den Hand-off. | Änderungswunsch der Maintainerin (Zeile in #1808, 2026-10-21) statt Evidenz; die Kennzahl „Abnahme-Fix mit Hand-off“ in `lauf-ergebnis` belegt die Wirkung. | #1808 | Ein Folge-#-Commit auf einem Ticket-PR nach Abnahme-Fix ohne Lens-Pass → Revert per PR. |
