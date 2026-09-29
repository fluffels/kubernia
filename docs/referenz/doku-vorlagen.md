# 🧩 Doku-Vorlagen: Kopfzeilen für Wiki-Seiten

> 🧭 **Fachlich geprüft am: 2026-09-29.**

> Die Lebenszyklus-Regel für `docs/` steht in [ADR 0013](../adr/0013-docs-als-agentengepflegtes-wiki.md): jede Seite ist entweder **Evergreen** (lebend, im selben PR wie der Code gepflegt) oder ein **Schnappschuss** (datiert, eingefroren). Diese Seite hält nur die zwei Kopfzeilen fest, die das sichtbar machen.
> Autor, Datum und Herkunfts-Ticket stehen schon in `git log` (Commit-Nachricht mit `(#<nr>)`) und werden **nicht** in die Datei kopiert.
> Bewusst **ohne Wächter** (ADR 0013, Trade-offs): eine Konvention, kein Gate.

## Evergreen-Seite

Direkt unter der H1:

```markdown
> 🧭 **Fachlich geprüft am: JJJJ-MM-TT.**
```

- Das Datum geht hoch, wenn jemand den **Inhalt gegen den Code gehalten** hat — nicht bei Tippfehler-, Link- oder Rename-Commits (die liefert `git log`).
- Mehr steht nicht im Kopf. Eine Seite ohne diese Zeile ist nicht falsch, nur ohne Stand-Signal.

## Schnappschuss (Analyse, Audit, Review)

Direkt unter der H1, als erste Zeile vor allen anderen Kopfzeilen:

```markdown
> 📸 **Momentaufnahme vom JJJJ-MM-TT — wird nicht aktualisiert** (Lebenszyklus-Regel: [ADR 0013](adr/0013-docs-als-agentengepflegtes-wiki.md)). Neue Erkenntnisse kommen als datierter Nachtrag dazu, überschreiben den Text aber nicht.
```

- Das Datum ist der **Stand der Analyse**, nicht der letzte Commit.
- Führt die Seite Folge-Tickets mit Status, den Zusatz anhängen: „Der aktuelle Status der genannten Folge-Tickets steht in GitHub, nicht hier." (laufender Stand gehört nach GitHub, nie ins Wiki).
- Der Link-Pfad oben gilt für Seiten direkt unter `docs/`; tiefer liegende Seiten passen ihn an.
