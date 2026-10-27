# Fortschreibung #1883 (2026-10-27): Die Factory-Items wohnen im Factory-Repo (F10, Teil 10)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F10, Verteilung) und löst die Trennregel „Label `area:harness` ergibt das Factory-Board“ ab: das Factory-Board führt die Issues des Factory-Repos, das Produkt-Board die von kubernia. Die Fortschreibungen [#1881](0022-1881-factory-repo.md) und [#1882](0022-1882-sync-vom-tag-in-kubernia.md) sind die Voraussetzung.

## Ergebnis

- **Labels:** der Label-Satz von kubernia steht im Factory-Repo (`gh label clone --force`, nichts gelöscht; im Factory-Repo kommen die Dependabot-Labels `accessibility`, `javascript`, `github_actions` dazu).
- **Übertragung:** 75 offene `area:harness`-Issues liegen jetzt im Factory-Repo: #4, #5 und #7 bis #79 (#6 ist der Pull Request des Kerns). Nicht übertragen: #1883 (schließt mit diesem PR). Das Mapping alt → neu steht als Kommentar in #1883. Das Board-Item bleibt bei der Übertragung erhalten: gleiche Item-ID, gleicher Status, gleiche Position (Reihenfolge der Board-Liste vor und nach der Übertragung gleich).
- **Verweise:** GitHub schreibt beim Transfer jedes nackte `#N` in Body und Kommentaren zu `fluffels/kubernia#N` um und führt es bei einem späteren Transfer von `N` auf die neue Nummer nach, auch in Issues, die im Quell-Repo bleiben (kubernia#1129 und #1130 zeigen jetzt auf `fluffels/self-improving-agent-harness-and-factory#29`). Alle 45 Blocker-Verweise der übertragenen Issues lösen auf (Skript prüft Existenz und Titel); ein eigenes Zurückschreiben war nicht nötig.
- **Konfigs:** `boards[].repo` (neu, optional) in beiden `.factory/projekt.json`: das Factory-Board von kubernia führt `fluffels/self-improving-agent-harness-and-factory`, das Produkt-Board des Factory-Repos führt `fluffels/kubernia`; ohne Schlüssel gilt das `repo` der Config.
- **Ansichten (F8):** `updateProjectV2View` existiert; „View 1“ beider Boards hat den Filter `-status:Done repo:<Repo des Boards>`.
- **Workflows im Factory-Repo:** `board-takt.yml`, `wiedervorlage.yml`, `dependabot-inbox.yml`, `harness-doctor.yml` sind wieder eingeschaltet und je einmal per `workflow_dispatch` gelaufen: `wiedervorlage` und `harness-doctor` grün, `board-takt` und `dependabot-inbox` rot mit `gh: Bad credentials (HTTP 401)`: der angelegte `PROJECT_TOKEN` wird von GitHub abgelehnt (die Maintainerin legt ihn neu an; nutzereigene Projects v2 erreicht nur ein klassischer Token mit `project` und `repo`).

## Probe (K2)

Es gab zwei Proben. Die erste war `fluffels/kubernia#1719` nach `fluffels/self-improving-agent-harness-and-factory#4` (Kommentar „Probe-Transfer #4 → #4“ in #1883: GitHub schrieb den alten Verweis `fluffels/kubernia#1719` nach dem Transfer selbst auf die neue Nummer um, darum steht dort zweimal die #4). Die zweite war `fluffels/kubernia#1090` nach `…#5` (Kommentar mit der Tabelle unten).

| Prüfpunkt | Ergebnis |
| --- | --- |
| Labels, Kommentare | bleiben (Label nur bei gleichnamigem Label im Ziel); Assignees: nicht geprüft, kein übertragenes Issue hatte einen |
| Board-Item | gleiche Item-ID, Status Todo, gleiche Nachbarn |
| `content.repository_url` | REST zeigt das neue Repo sofort |
| Verweise | nackte `#N` wurden zu `fluffels/kubernia#N` |
| Alte Nummer | per API weitergeleitet, `gh issue view` löst sie nicht mehr auf |

## Entscheidungen

- **Eigene Zählung je Repo (Entscheidung):** ein Board führt die Issues eines Repos (`boards[].repo`), die Auswahl filtert Items nach `content.repository_url`, weil Nummern verschiedener Repos kollidieren; ein Board eines anderen Repos liefert keine Items und meldet das (Negativfall: `naechstes-ticket --bereich agentic` in kubernia liefert kein kubernia-Issue und nennt das Factory-Repo, im Factory-Repo liefert es ein Factory-Issue).
- **Notfälle bleiben bereichsübergreifend (Entscheidung):** ein 🚨 oder 🔒 des eigenen Repos zählt auch bei fremdem Board der Seite, weil „Roter `main` geht vor“.
- **Blocker über Repo-Grenzen (Entscheidung):** `blockiert durch owner/name#<nr>` wird per REST geprüft, nicht prüfbar sperrt (fail-closed); `blockerNummern` zählt nur unqualifizierte Verweise.
- **Verwaistes Item (Entscheidung):** Issue #39 (früher kubernia#1360) stand per GraphQL auf dem Produkt-Board (die REST-Liste hinkte): auf das Factory-Board gehoben (Status Todo, am Ende), das Produkt-Item archiviert.

## Grenzen

- Bis die Schreibwege (`addToBoardTodo`, `sammelticket-anlegen harness`, `spezifikation anlegen` mit `area:harness`, Inbox-Läufe) das Ziel-Repo kennen, landen neue Harness-Befunde aus kubernia als „verwaist“ auf dem Factory-Board: Befunde bis dahin von Hand als Kommentar ins Sammelticket des Factory-Repos (#78). Folgeticket: fluffels/self-improving-agent-harness-and-factory#76.
- Die übrigen Board-Skripte schlagen Items weiter nur über die Nummer nach; der Repo-Filter gilt bisher nur in der Auswahl.
- Das Messfenster `nach #<nr>` kennt keine Repo-Grenzen (#48 bleibt fail-closed).
