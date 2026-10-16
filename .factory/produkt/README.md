# Self-Improving Agent Harness and Factory

Ein selbstoptimierender Harness für Coding-Agenten mit Claude Code.

> Entwurf. Diese Datei wird die README des Factory-Repos, sobald es angelegt ist (ADR 0022, F10). Bis dahin liegt sie hier.

## Was der Harness ist

Ein Regelwerk samt Werkzeugen, mit dem Coding-Agenten Tickets von der Auswahl bis zum Merge bearbeiten, ohne dass ein Mensch jeden Schritt begleitet:

- **Gates:** Prüfungen (Lint, Typen, Architektur, Größe, Abdeckung), die jeder Pull Request bestehen muss. Ein rotes Gate wird durch Beheben der Ursache grün, nie durch Aufweichen.
- **Wächter-Tests:** Tests, die Regeln des Harness selbst erzwingen und deren Änderung eine Audit-Spur hinterlässt.
- **Hooks und Skills:** Claude-Code-Hooks, Agenten-Definitionen und Skills für Planung, Umsetzung und Review.
- **Ticket-Ablauf:** Auswahl nach Board-Position, Claim, Plan, Umsetzung im eigenen Worktree, Mehr-Perspektiven-Review, Pull Request mit Auto-Merge.

Menschliche Stopps gibt es nur bei Irreversiblem und bei Außenwirkung. Das Zielbild heißt Dark Factory; der Harness strebt sie an und ist noch keine: die Abnahme gegen verborgene Testfälle (Holdout) fehlt noch.

## Voraussetzungen

- Claude Code als Agenten-Laufzeit.
- GitHub mit Issues, Projects und Rulesets.
- Deutschsprachige Kern-Texte (Regeln, Prompts, Dokumentation).

## Status

Inkubation: kein eigenes Repository, kein Release, keine Version.

## Lizenz

source-available: der Quelltext ist einsehbar, alle Rechte bleiben vorbehalten. Nutzung, Kopie und Ableitung sind nur mit Erlaubnis der Rechteinhaberin gestattet. Der Harness ist nicht Open Source. Der Lizenzentwurf steht in der Datei LICENSE neben dieser README.

## Beiträge

Externe Pull Requests werden nicht angenommen. Rückmeldungen laufen über Discussions.
