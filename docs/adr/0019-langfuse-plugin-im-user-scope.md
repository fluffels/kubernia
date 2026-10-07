# ADR 0019: Das Langfuse-Plugin bleibt auch im User-Scope aktiv

> Architecture Decision Record. Format: Kontext → Entscheidung → Konsequenzen.
> Status: **akzeptiert** · Datum: 2026-10-07 · Ticket: #1411

## Status

**Akzeptiert.** Ersetzt die Scope-Regel, die #1382 in [docs/model-routing.md](../model-routing.md#langfuse-hook-patch-pflegen-10841122) und [docs/langfuse-hook-patch.md](../langfuse-hook-patch.md) festgehalten hatte (Plugin nur im Projekt-Scope, User-Scope als Datenschutz-Befund). Die Entscheidung der Maintainerin fiel zweimal gleich aus; dieses ADR hält sie fest, damit sie nicht erneut gekippt wird.

## Kontext

Das Plugin `langfuse-observability` erfasst Prompts, Code und Tool-Ausgaben einer Session als Traces. #1382 verlangte, es nur im Projekt-Scope (`enabledPlugins` in `.claude/settings.json`) zu aktivieren, damit der Hook keine fremden Repos miterfasst, und wertete den User-Scope als Datenschutz-Befund.

## Entscheidung

Das Plugin ist **auch im User-Scope aktiv, gewollt**. Gründe:

- Die Langfuse-Instanz läuft **self-hosted lokal**; die Traces verlassen den Rechner nicht (`LANGFUSE_BASE_URL` zeigt auf das lokale Ziel).
- Die Trennung nach Repo läuft über `environment` und Tags, nicht über den Scope.
- Repo-übergreifende Auswertungen brauchen die Erfassung in allen Repos.

Maßgeblich für den Datenschutz ist darum das **Ziel**, nicht der Scope: zeigt `LANGFUSE_BASE_URL` auf einen nicht lokalen Host, ist das ein Datenschutz-Befund.

## Konsequenzen

- Die Prüfung in der Langfuse-Checkliste ([Punkt 2](../model-routing.md#langfuse-status-überprüfen-1293)) wertet das Ziel von `LANGFUSE_BASE_URL`, nicht den Scope von `claude plugin list`.
- Zugangsdaten und Marketplace bleiben im User-Scope; kein Agent ändert User-Einstellungen, und kein Wert (Key, Host) gehört ins Repo.
- Wird die Instanz je extern gehostet, entfällt die Grundlage dieser Entscheidung: dann wäre sie neu zu treffen (neues ADR, dieses nicht umschreiben).
