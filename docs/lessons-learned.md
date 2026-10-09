# Lessons Learned: Muster aus dem Bau des Harness

> **Fachlich geprüft am: 2026-10-09.**
> Wiederkehrende Muster mit datierten Belegen, für Außenstehende. Der Ticketstatus steht in GitHub, nicht hier: ein Ticket nennt diese Seite nur mit „Stand 2026-10-09“. Zählbares steht generiert (Gate-Tabelle: [agent-harness.md](agent-harness.md#3-die-fitness-functions-im-detail), Inventar: [README › Die Bausteine](../README.md#die-bausteine)), laufende Messwerte in der [Verdichtungstabelle](model-routing.md#langfuse-status-überprüfen-1293). Begriffe: [Harness-Glossar](harness-glossar.md).

Das Muster „Eine Bitte wird zur Mauer“ (was ein Text nur erbittet, erzwingt später ein Gate) steht schon an anderer Stelle: [README › Wie das gewachsen ist](../README.md#wie-das-gewachsen-ist) und [Bitte und Mauer](agent-harness.md#leitplanken-schichten-bitte-und-mauer). Hier folgen die übrigen Muster.

## Wirkung und Messung

### Konfiguration ist nicht Wirkung

**Was geschah:** `model:` und `effort:` im Skill-Frontmatter greifen nicht, wenn Claude den Skill per Skill-Tool lädt (Claude-Code-Bug [anthropics/claude-code#98898](https://github.com/anthropics/claude-code/issues/98898)). Langfuse zeigte in rund 22 `skill:kubernia`-Traces keinen einzigen Sonnet-Call; die Konfiguration sah richtig aus und tat nichts.

**Geändert:** Verlässlich ist das Frontmatter von Subagenten ([#1280](https://github.com/fluffels/kubernia/issues/1280)); der Hauptchat bekommt den Projekt-Default `sonnet` ([#1557](https://github.com/fluffels/kubernia/issues/1557)).

**Beleg:** [model-routing.md › Wie das Routing wirkt](model-routing.md#2-wie-das-routing-in-claude-code-wirkt).

### Ein Regler wirkt nur beim passenden Modell

**Was geschah:** `effort: low` am Explore-Agenten (eingeführt mit [#1209](https://github.com/fluffels/kubernia/issues/1209), Wirkung geklärt in [PR #1541](https://github.com/fluffels/kubernia/pull/1541)) wirkt nur, weil der Alias `haiku` (Stand 2026-10-08) auf ein Modell mit Effort-Unterstützung auflöst. Auf einem Cloud-Anbieter mit älterem Haiku wäre derselbe Wert wirkungslos.

**Geändert:** Die Abhängigkeit steht an der Phasen-Zeile selbst, damit ein Modellwechsel sie nicht still bricht.

**Beleg:** [model-routing.md › Phasen-Matrix](model-routing.md#1-phasen-matrix).

### Die Messung hat selbst Lücken

**Was geschah:** Ein Abgleich von Transkript und Langfuse fand 2026-10-07/08, dass 28 von 38 Sessions in Langfuse ganz fehlten ([#1517](https://github.com/fluffels/kubernia/issues/1517)). Wer nur Langfuse las, maß ein Bruchstück.

**Geändert:** Der Abgleich je Call kam in drei Teilen: [#1562](https://github.com/fluffels/kubernia/issues/1562) und [#1565](https://github.com/fluffels/kubernia/issues/1565) sind (Stand 2026-10-09) erledigt.

**Offen (Stand 2026-10-09):** [#1566](https://github.com/fluffels/kubernia/issues/1566) (Lücke nachholen, Δ = 0 belegen).

**Beleg:** Spalte „Datenvollständigkeit“ der [Verdichtungstabelle](model-routing.md#langfuse-status-überprüfen-1293).

### Die Wirksamkeit der Gates ist nicht gemessen

**Was geschah:** Jedes Gate kostet Zeit und Tokens; ob es etwas findet, wurde lange nicht erfasst.

**Geändert:** Die Status-Checkliste meldet Lockern-Kandidaten (Punkt 8: Kosten ohne Fund über mehrere Läufe in Folge).

**Offen (Stand 2026-10-09):** die Entscheidung, wie gelockert wird ([#1357](https://github.com/fluffels/kubernia/issues/1357)), und die Fundquote je Gate ([#1360](https://github.com/fluffels/kubernia/issues/1360)).

**Beleg:** [Checkliste, Punkt 8](model-routing.md#langfuse-status-überprüfen-1293).

## Kosten

### Review kostet vor allem Beschaffung, nicht Analyse

**Was geschah:** Ein einzelnes Ticket ([#1021](https://github.com/fluffels/kubernia/issues/1021), Messung im August 2026) kostete 1,03 Mio Subagent-Tokens, 85 % davon im Review. Derselbe Diff wurde pro Lens neu erhoben und dieselben Dateien mehrfach gelesen; das fand keinen zusätzlichen Befund.

**Geändert:** Der Diff wird einmal materialisiert ([#1034](https://github.com/fluffels/kubernia/issues/1034)), die Zahl der Lenses richtet sich nach der Diff-Art ([#1265](https://github.com/fluffels/kubernia/issues/1265)).

**Beleg:** [agent-harness.md › Skills und Setup](agent-harness.md#25-skills--setup-als-reproduzierbare-abläufe), [Review-Staffel](model-routing.md#review-staffel-1265).

### Kosten sitzen im wachsenden Kontext

**Was geschah:** Der größte Teil der Tokens sind Cache-Reads (95 bis 98 %, Baseline Stand 2026-09-29): jeder Aufruf liest den ganzen bisherigen Kontext neu. Im Fenster 2026-10-07 bis 2026-10-09 lagen 94 gemergte PRs bei 861 $ API-Preisäquivalent, davon der Umsetzer mit 29 %, im Mittel 90 Calls und im Schnitt 174k Kontext je Call (Zahlen aus dem Issue-Text von [#1559](https://github.com/fluffels/kubernia/issues/1559)). Rund zwei Drittel des Kontext-Wachstums sind nicht Tool-Ergebnisse, sondern Thinking, Text und Overhead; der größte Treiber ist nicht, was gelesen wird.

**Geändert:** Das CI-Warten läuft unter der Cache-Lebensdauer ([scripts/pr-warten.mjs](../scripts/pr-warten.mjs)), eine Ausgabe-Diät steht in der Umsetzer-Definition. Das Ziel von #1559 wurde nicht erreicht, und das steht dort so.

**Beleg:** [Baseline](model-routing.md#baseline-stand-2026-09-29-alle-vier-läufe-vor-10651067), [Umsetzer-Kontext](model-routing.md#umsetzer-kontext-1559).

## Autonomie und Verfahren

### Autonomie schrittweise lockern, jeweils mit Rückfall-Weg

**Was geschah:** Zuerst gab es eine Pflicht-Freigabe für Harness-Änderungen ([#1012](https://github.com/fluffels/kubernia/issues/1012)), dann Merge durch den Agenten mit Audit-Kommentar statt Freigabe ([#1069](https://github.com/fluffels/kubernia/issues/1069), [#1071](https://github.com/fluffels/kubernia/pull/1071)), dann entscheidet der Agent Weichen selbst ([#1279](https://github.com/fluffels/kubernia/issues/1279), [#1276](https://github.com/fluffels/kubernia/issues/1276)). August bis Oktober 2026, jeder Schritt mit einem Weg zurück: Veto per Revert, Audit-Spur.

**Geändert:** Menschliche Stopps bleiben bei Irreversiblem und Außenwirkung.

**Beleg:** [ADR 0012](adr/0012-harness-autonomie-audit-spur.md), [ADR 0014](adr/0014-leitplanken-ohne-label-riegel.md).

### Ein Verfahren braucht ein Konvergenz-Signal

**Was geschah:** Ein Teil eines Sammeltickets abzuarbeiten ließ in jeder Generation Zeilen übrig: Generation [#1276](https://github.com/fluffels/kubernia/issues/1276) und Generation [#1308](https://github.com/fluffels/kubernia/issues/1308) hatten je 66 offene Zeilen (2026-10-06). Eine Halbierung ([#1309](https://github.com/fluffels/kubernia/issues/1309)) wurde wieder abgelöst.

**Geändert:** Die Regel „immer komplett“ ([#1311](https://github.com/fluffels/kubernia/issues/1311)). Der Preis sind breitere PRs, die mit einer begründeten Ausnahme am Größen-Gate erlaubt sind.

**Beleg:** die Fortschreibungen in [ADR 0012](adr/0012-harness-autonomie-audit-spur.md).

### Ausnahmen begründet statt unsichtbar

**Was geschah:** Eine Override-Umgebungsvariable erreichte die PR-CI nie ([#1269](https://github.com/fluffels/kubernia/issues/1269)); sie wirkte lokal und fehlte da, wo es zählte. Später brach das Squash-Betreff-Format die Commit-Zeile noch einmal ([#1383](https://github.com/fluffels/kubernia/issues/1383)).

**Geändert:** Die Ausnahme ist eine Commit-Zeile mit Pflicht-Begründung und offenem Ticket, damit sie in der Historie sichtbar ist.

**Beleg:** die Fortschreibungen in [ADR 0009](adr/0009-pr-gating-required-checks.md).

## Prüfungen und ihre Grenzen

### Ein roter main trotz PR-Pflicht

**Was geschah:** `main` ist PR-gegated und wurde trotzdem rot. Ein Alarm-Job ([`alarm-red-main`](../.github/workflows/ci.yml), eingeführt mit [#605](https://github.com/fluffels/kubernia/issues/605)) legt dann ein Issue an. Ursachen waren unter anderem zwei einzeln grüne PRs, die zusammen rot waren ([#1449](https://github.com/fluffels/kubernia/issues/1449)), der Parser der Override-Zeile ([#1383](https://github.com/fluffels/kubernia/issues/1383)) und der Alarm selbst, der gegen sein Fundament driftete ([#658](https://github.com/fluffels/kubernia/issues/658)).

**Geändert:** Roter `main` geht vor; vor dem Auto-Merge einer Gate-Verschärfung wird `main` eingemergt und das Gate erneut gefahren.

**Beleg:** [alle Issues dazu](https://github.com/fluffels/kubernia/issues?q=is%3Aissue+%22CI+rot+auf+main%22+in%3Atitle), [Belege Rot, Fix, Grün](agent-harness.md#belege-der-rotfixgrün-bogen-in-echt).

### Die Prüfer haben selbst Lücken

**Was geschah:** Das Diff-Coverage-Gate prüft nur geänderte Zeilen in vorhandenen Schicht-Aggregaten; eine komplett ungetestete neue Datei versteckt sich darin, und ein veralteter Report wird still akzeptiert. Jedes Gate zieht so Härtungstickets nach.

**Offen (Stand 2026-10-09):** [#1030](https://github.com/fluffels/kubernia/issues/1030) und [#1031](https://github.com/fluffels/kubernia/issues/1031).

**Beleg:** [#1021](https://github.com/fluffels/kubernia/issues/1021), das Ticket, das das Gate einführte.

### Doku driftet schneller als ihre Prüfung

**Was geschah:** Handgeschriebene Doku veraltet mit jedem Merge. Die Wächter `check:docdrift` und `check:docmap` kamen erst nachträglich, nachdem Drift durchgerutscht war.

**Geändert:** Zählbares wird generiert und im Diff geprüft ([ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md)).

**Offen (Stand 2026-10-09):** gesammelte Doku-Drift in [#1200](https://github.com/fluffels/kubernia/issues/1200).

**Beleg:** [harness-transfer.md › Gliederung für Artikel oder Vortrag](harness-transfer.md#gliederung-für-artikel-oder-vortrag).

### Text Dritter ist Daten

**Was geschah:** Ein Agent, der Issue-Kommentare roh liest, kann Anweisungen Dritter für Aufträge halten (Prompt-Injection).

**Geändert:** Ein Skript filtert Fremdtext nach Autor ([scripts/fremdtext.mjs](../scripts/fremdtext.mjs), [#1433](https://github.com/fluffels/kubernia/issues/1433)). Es prüft den Autor, nicht den Inhalt.

**Offen (Stand 2026-10-09):** Nebenkanäle ohne deterministisches Gate ([#1447](https://github.com/fluffels/kubernia/issues/1447)).

**Beleg:** [sicherheit-agenten.md › Grenzen](sicherheit-agenten.md#grenzen-ehrlich).

## Wo die Zahlen stehen

Laufende Messwerte (Kosten je Ticket, Review-Runden, Datenvollständigkeit) stehen in der [Verdichtungstabelle](model-routing.md#langfuse-status-überprüfen-1293), je Lauf eine Zeile, und werden hier nicht kopiert. Die Maintainerin führt den gestiegenen Median der Review-Runden auf komplexere Harness-Tickets zurück; das ist eine Vermutung, nach Ticketart nicht gemessen (Stand 2026-10-09).
