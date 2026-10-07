# Architekturentscheidungen (ADRs)

> Index und Vorlage. Die Tabelle unten wird aus den ADR-Köpfen erzeugt (`npm run docs:gen`, Generator `adr-liste`, [ADR 0017](0017-lebende-doku-generierte-abschnitte.md)); die Zeitleiste in der [README](../../README.md) nutzt dieselben Köpfe. **Wann welcher ADR zu lesen ist:** [Anlaufstellen](../referenz/anlaufstellen.md).

<!-- GEN:adr-liste START -->
<!-- Generiert von npm run docs:gen – nicht von Hand ändern. -->

| ADR | Titel | Status | Datum |
|---|---|---|---|
| [0001](/docs/adr/0001-engine-phaser.md) | Engine-Wahl – Phaser (vs. Godot/Unity/MonoGame) | aktualisiert | 10.07.2026 |
| [0002](/docs/adr/0002-kein-backend-keine-db.md) | Kein Backend, keine Datenbank, keine Service-Aufteilung fürs Kern-Spiel | akzeptiert | 16.06.2026 |
| [0003](/docs/adr/0003-multiplayer-coop-out-of-scope.md) | Multiplayer/Co-op – aktuell außerhalb Scope | akzeptiert | 16.06.2026 |
| [0004](/docs/adr/0004-skalierungs-fundament.md) | Langfristige Skalierungs-Architektur – Fundament für ein großes Spiel | akzeptiert | 19.06.2026 |
| [0005](/docs/adr/0005-auslieferungsform.md) | Auslieferungsform bei Stardew-Scope — Web-App vs. Desktop-Download (bewusst offen gehalten) | akzeptiert als ergebnisoffener Grundsatz-ADR | 03.07.2026 |
| [0006](/docs/adr/0006-backend-und-skalierung.md) | Braucht Kubernia bei Stardew-Scope ein Backend? — Skalierungs-Review | akzeptiert | 21.06.2026 |
| [0007](/docs/adr/0007-spielsystem-fundamente.md) | Spielsystem-Fundamente für Content-Skalierung (Quest-Modell, Checks, Zeit) | akzeptiert | 21.06.2026 |
| [0008](/docs/adr/0008-ki-agenten-harness.md) | KI-Agenten-Harness als Entwicklungsmodell | akzeptiert | 01.07.2026 |
| [0009](/docs/adr/0009-pr-gating-required-checks.md) | PR-Gating mit Required-Checks auf `main` (statt Direkt-Push) | akzeptiert | 03.07.2026 |
| [0010](/docs/adr/0010-karten-modell-tiled-vs-code-builder.md) | Zwei Karten-Modelle bewusst nebeneinander (Tiled-Daten vs. Code-Builder) | akzeptiert | 23.07.2026 |
| [0011](/docs/adr/0011-npc-system-fundament.md) | NPC-System-Fundament — Datenmodell für lebendige NPCs (Zustand, Routinen, Beziehungen) | akzeptiert | 24.07.2026 |
| [0012](/docs/adr/0012-harness-autonomie-audit-spur.md) | Harness-Autonomie — Audit-Spur statt Merge-Freigabe, Fokus der Harness-Phase | akzeptiert | 28.09.2026 |
| [0013](/docs/adr/0013-docs-als-agentengepflegtes-wiki.md) | `docs/` als agentengepflegtes Wiki — kein zweiter Wissensspeicher, kein externes Brain | akzeptiert | 29.09.2026 |
| [0014](/docs/adr/0014-leitplanken-ohne-label-riegel.md) | Leitplanken ohne Label-Riegel — Audit-Kommentar und Verhaltensregel statt CI-Job | akzeptiert | 06.10.2026 |
| [0015](/docs/adr/0015-projekt-brain.md) | Projekt-Brain — `docs/` nach Second-Brain-Prinzipien, token-sparsam und messbar | akzeptiert | 07.10.2026 |
| [0016](/docs/adr/0016-langfuse-takt-woechentlich.md) | Langfuse-Takt — wöchentlicher Workflow statt Board-Position | akzeptiert | 07.10.2026 |
| [0017](/docs/adr/0017-lebende-doku-generierte-abschnitte.md) | Lebende Doku — generierte Abschnitte, und ein Diagramm ist eine Regel | akzeptiert | 07.10.2026 |
| [0018](/docs/adr/0018-content-chunks-je-datei.md) | Content-Chunks je Datei — der Spielcode-Chunk wächst nicht mehr mit dem Inhalt | akzeptiert | 07.10.2026 |
| [0019](/docs/adr/0019-langfuse-plugin-im-user-scope.md) | Das Langfuse-Plugin bleibt auch im User-Scope aktiv | akzeptiert | 07.10.2026 |
| [0020](/docs/adr/0020-architekturmodell-likec4.md) | Architekturmodell LikeC4 — zweite Ableitung derselben SSOTs | akzeptiert | 08.10.2026 |

<!-- GEN:adr-liste END -->

## Format

- **Historisch:** ein ADR wird nie umgeschrieben, sondern verknüpft; die Regel steht in AGENTS.md › Projekt-Brain pflegen. Ein Nachtrag zu einer laufenden Entscheidung hat die Form `## Fortschreibung #<Ticket> (JJJJ-MM-TT): <Thema>` am Ende desselben ADR.
- **Dateiname** `NNNN-kurzer-slug.md` (ASCII, vierstellig fortlaufend), **erste Zeile** `# ADR NNNN: Titel` (die Nummer muss zum Dateinamen passen).
- **Kopf-Format** (vom Generator erzwungen, sonst ist `check:docgen` rot): vor der ersten `##`-Überschrift die Zeile `> Status: **<Status>** · Datum: JJJJ-MM-TT · Ticket: #<nr>`. Das Datum ist ein gültiges Kalenderdatum und hat nichts dahinter hängen. Das ältere Listenformat `- **Status:** <Status> (JJJJ-MM-TT)` wird weiter gelesen, für neue ADRs gilt das Blockquote-Format.
- **Abschnittsfolge:** Status, Kontext, Optionen (mit Bewertung), Entscheidung („Entscheidung: X, weil Y“), Konsequenzen, Re-Evaluierung (nachprüfbarer Auslöser statt „für immer“).
- **Index:** die Tabelle oben zieht `npm run docs:gen` nach; die „wann lesen“-Zeile steht in [Anlaufstellen](../referenz/anlaufstellen.md).

## Vorlage

```markdown
# ADR NNNN: Titel

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: JJJJ-MM-TT · Ticket: #<nr>

## Status

**Akzeptiert.** Präzisiert/löst ab: [ADR MMMM](MMMM-slug.md) (falls zutreffend).

## Kontext

Welches Problem, welche Zwänge, was wurde gemessen?

## Optionen

| Option | Bewertung |
|---|---|
| **A** | … |
| **B (gewählt)** | … |

## Entscheidung

Entscheidung: **X**, weil Y.

## Konsequenzen

Was folgt daraus, was wird schwerer?

## Re-Evaluierung

Unter welcher nachprüfbaren Bedingung wird neu entschieden?
```
