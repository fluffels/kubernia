# Entscheidungsprotokoll für Hand-offs und Weichen

> Wissensart: Verfahren (Evergreen). Gilt für jede Entscheidung, bei der ein Agent sonst eine Optionsfrage an die Maintainerin stellen würde: Hand-off nach `festgefahren`, Zusatzpass, Override, Auslagern, Plan-Weichen. Repo, Labels, Board und Namen kommen aus der Projekt-Config (`.factory/projekt.json`), diese Seite nennt keine. Der Name der Factory wird ein Config-Wert, sobald er feststeht; bis dahin heißt sie „Factory“.

## Grundsatz

Der Hauptchat entscheidet Ermessensfragen **fundiert selbst** und schreibt im PR „Entscheidung: X, weil Y“ (Veto per Revert). **Rückfrage nur bei Irreversiblem oder Außenwirkung** (AGENTS.md › Human-in-the-Loop-Checkpoints). Eine Optionsliste an die Maintainerin ist kein Ergebnis dieses Protokolls.

## Ablauf

1. **Reversibilität und Kosten klären.** Lässt sich die Entscheidung per Revert zurücknehmen, und was kostet der falsche Zweig (Token, Zeit, Wirkung nach außen)? Irreversibel oder mit Außenwirkung: Pre-Flight-Rückfrage, das Protokoll endet hier.
2. **Hohe Konfidenz: handeln.** Ist die Antwort aus Regeln, ADRs und Evidenz klar, wird sie umgesetzt und begründet, ohne weitere Methode.
3. **Echte Unsicherheit: die billigste passende Methode wählen**, in dieser Reihenfolge der Kosten:
   - **Messen oder Probelauf vor Meinung.** Ein Befehl, ein Lauf, ein Lese-Zugriff auf Langfuse oder `lauf-ergebnis` schlägt jede Vermutung.
   - **Recherche:** wie löst ein Projekt dieser Größe das Problem (Leitfrage des Projekts in der Root-Kontextdatei).
   - **A/B**, nur wenn beide Zweige billig und reversibel sind.
   - **Kritischer Gegen-Review durch einen frischen Agenten** bei teuren oder riskanten Weichen.
4. **Token-Deckel: eine Runde je Methode.** Kein Nachschleifen. Danach wird entschieden und, was offen blieb, als „Bekannte Grenze“ im PR dokumentiert.
5. **Ratchet in beide Richtungen.** Regeln werden strenger, wo Fehler durchrutschen, und lockerer, wo Prüfungen nachweislich nichts finden (Messung über `lauf-ergebnis`; Lockern ohne Rot nach [ADR 0027](../adr/0027-regeln-lockern.md), nicht nach diesem Protokoll). Ein neues, stärkeres Modell ist ein Anlass, die Überwachungsdichte neu zu messen; die Methoden-Liste wird quartalsweise aktualisiert.

## Methoden laufen in Subagenten

- Recherche, Probelauf, A/B und Gegen-Review laufen in **Subagenten**. Der Hauptchat bekommt nur die Zeile „Entscheidung: X, weil Y“, **höchstens 10 Zeilen**, keine Rohdaten.
- Jede Methode hat ein **Budget**: eine Runde und einen Token-Deckel, im Auftrag an den Subagenten genannt.
- **Modell** nach [model-routing.md](../model-routing.md), **billigste Methode zuerst**; das stärkste Modell nur für riskante Weichen.

## Hand-offs

Hand-off-Entscheidungen im Rahmen dieses Protokolls (zum Beispiel ein Delta-Pass statt Override, Auslagern in ein Folgeticket) trifft der Hauptchat selbst und schreibt „Entscheidung: X, weil Y“ in den PR. Er fragt die Maintainerin nur bei Irreversiblem oder Außenwirkung.

### Werkzeug-Abbruch der Abnahme

Bricht die Abnahme wegen eines fehlenden oder ausgefallenen Werkzeugs ab (`FESTGEFAHREN: abnahme`), entscheidet der Hauptchat nach diesem Protokoll: das Kriterium per Hand belegen (zum Beispiel Langfuse-Abfrage über den MCP-Server) und im PR „Entscheidung: X, weil Y“ samt Beleg schreiben, dann die Override-Zeile der Abnahme (`<praefixe.commitZeile>Abnahme-Override:`) setzen; vorgelegt wird nur bei Irreversiblem oder Außenwirkung. Bei einem Spezifikationsmangel („nicht prüfbar“) präzisiert weiter die Maintainerin das Kriterium im Ticket-Body. Das ist keine Lockerung nach ADR 0027: die Abnahme bleibt Pflicht, der Override bleibt ein Druckventil mit Pflicht-Begründung, nur der Entscheider ist an AGENTS.md › Human-in-the-Loop-Checkpoints angeglichen.

## Grenzen

- Kein Grün-durch-Aufweichen: das Protokoll ersetzt kein rotes Gate und keinen Review; es entscheidet nur, **wie** weitergemacht wird.
- Eine Entscheidung, die eine Regel lockert, folgt ADR 0027 samt Ledger-Zeile.
