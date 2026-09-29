# ADR 0013: `docs/` als agentengepflegtes Wiki — kein zweiter Wissensspeicher, kein externes Brain

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-09-29 · Tickets: #1083 (Recherche + dieser ADR)

## Status

**Akzeptiert.** Präzisiert [ADR 0012](0012-harness-autonomie-audit-spur.md) an einer Stelle: ADR 0012 hielt fest, dass kein separates „Projekt-Brain“ neben dem Repo angelegt wird und das Repo selbst der Wissensspeicher ist. Dieser ADR bleibt dabei, schließt aber die Lücke, die das offen ließ: **wie** das Repo als Wissensspeicher gepflegt wird, nachdem die repo-externe Brain-Pflege entfallen ist. Die Umsetzung läuft über Folgetickets (siehe unten); dieser ADR selbst ändert noch keine Regel in [AGENTS.md](../../AGENTS.md).

## Kontext

Bis Ende September 2026 lief nach gemergten kubernia-Tickets eine „Brain-Pflege“: übertragbares Wissen wurde in ein **privates, repo-externes** Notiz-System der Maintainerin geschrieben. Die Maintainerin möchte das nicht mehr — Wissen über kubernia soll **im Repo** leben und von den Agenten gepflegt werden, die ohnehin darin arbeiten. Die Brain-Pflege war nie Teil des Repos (sie lag als persönlicher Skill außerhalb, vgl. [docs/agent-harness.md](../agent-harness.md), Abgrenzung zum privaten Vault) und ist bereits entfernt.

Bestandsaufnahme zum Zeitpunkt der Entscheidung:

- `docs/` ist faktisch schon ein Wiki: rund 35 Markdown-Dateien — arc42, Glossar, fünf `docs/module/`-Tiefendocs, `docs/referenz/` (seit #1085), zwölf ADRs, Audits und Analysen.
- Es fehlt ein **Index**: `docs/` hat keine Einstiegsseite. Zwei Dokumente ([barrierefreiheit-audit.md](../barrierefreiheit-audit.md), [spielkonzept-review.md](../spielkonzept-review.md)) sind von keiner anderen Datei verlinkt.
- Es fehlt eine **Lebenszyklus-Regel**: fünf `architektur-analyse-*`-Schnappschüsse und mehrere Audits stehen gleichrangig neben lebender Doku, ohne Kennzeichnung, was gepflegt und was eingefroren ist.
- Drift-Schutz existiert teilweise: `check:docdrift` prüft, dass interne Links und Anker **auflösen**, aber nicht, dass jede Datei **erreichbar** ist. `check:internalrefs` scannt alle getrackten Dateien. `check:docmap` deckt nur `src/` → `docs/module/` ab.

## Das Problem

Ein agentengepflegtes Wiki kann auf zwei Arten scheitern: es **veraltet**, weil niemand es pflegt, oder es **verwässert**, weil Agenten ungeprüft Prosa hineinschreiben, die das Repo schon an anderer Stelle sagt. Beides ist bei Stardew-Scope (viele Welten, NPCs, Quests, parallele Agenten) teuer. Gesucht ist eine Form, die Wissen aus Tickets festhält, ohne eine zweite Quelle der Wahrheit neben AGENTS.md, ADRs und `docs/` zu schaffen und ohne das Always-Load-Budget jeder Session zu belasten.

## Recherche (Quellen)

- **Gloaguen et al., „Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?“** ([arXiv:2602.11988](https://arxiv.org/abs/2602.11988), Feb./Jun. 2026): Kontextdateien verbesserten die Erfolgsrate nicht generell, erhöhten die Inferenzkosten aber um mehr als 20 %. Repository-Übersichten brachten keinen messbaren Nutzen; hilfreich sind sie vor allem für **nicht aus dem Code ableitbare** Konventionen. Gemessen wurden Dateien, die **in jeder Session** geladen werden.
- **Claude-Code-Doku, „How Claude remembers your project“** ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)): Kontextdateien in Unterordnern laden erst, wenn dort eine Datei gelesen wird; `@`-Imports sparen keinen Kontext (sie laden beim Start); `.claude/rules/` mit `paths:` lädt nur bei passenden Dateien; **Auto Memory ist maschinenlokal** und wird Subagenten nicht mitgegeben — für geteiltes Projektwissen also ungeeignet. Die Doku empfiehlt selbst, aus dem Code ableitbare Übersichten aus Always-Load-Dateien herauszuhalten.
- **Cline Memory Bank** ([docs.cline.bot](https://docs.cline.bot/prompting/cline-memory-bank)): das bekannteste Muster — feste Kerndateien (Projekt-Brief, Kontext, Muster, Fortschritt), gepflegt auf Zuruf. Mischt evergreen Wissen und laufenden Stand in denselben Dateien.
- **Starter-Kit-Modell der Maintainerin** (privates Vorlagen-Repo für ein KI-gepflegtes Wissens-Vault, nicht verlinkt): trennt **Evergreen-Wissen**, **laufenden Stand** und **abgeschlossene Arbeitseinheiten**; kuratierte Landkarten (MOCs) statt generierter Listen; Links in Standard-Markdown mit Kontext-Halbsatz; Schreiben nur nach **Vorschau**; Selbstpflege über vier Routinen (Input am Session-Ende, Einzel-Notiz auf Zuruf, regelmäßiges Bereinigen je Datei, mechanischer Gesundheitscheck); bei mehreren Schreibern zusätzlich **Herkunfts-/Stand-Kennzeichnung** pro Notiz.

Die Studie spricht gegen **always-geladene, ungeprüfte** Agenten-Prosa, nicht gegen ein **on-demand gelesenes, kuratiertes** Wiki. Genau diese Unterscheidung trägt die Entscheidung.

## Optionen

| Option | Bewertung |
|---|---|
| **A — Neuer `docs/wiki/`-Ordner im Memory-Bank-Stil** | Verworfen. Die festen Kerndateien doppeln README, arc42 und `docs/module/` (zweite SSOT = Drift-Bug), mischen Wissen mit laufendem Stand, und Dateien wie „Fortschritt“ wachsen bei Stardew-Scope zu Monolithen — dieselbe Falle wie der Content-Monolith vor #348. |
| **B — `docs/` ist das Wiki, nach dem Starter-Kit-Modell ergänzt** (gewählt) | Nutzt Vorhandenes, erzeugt keinen Always-Load-Zuwachs, trennt Wissensarten sauber, und die bestehenden Wächter decken neue Seiten sofort ab. Braucht Index, Lebenszyklus-Regel, einen Pflege-Schritt und einen Erreichbarkeits-Wächter. |
| **C — `.claude/rules/` mit `paths:` als Wissensträger** | Nicht als Primärort: tool-spezifisch (andere Agenten lesen `.claude/` nicht), von `check:docdrift` nicht erfasst (#1077), und das zuverlässige Greifen von `paths:` müsste erst gemessen werden. Höchstens später additiv. |
| **D — Modul-lokale `AGENTS.md` ausbauen** | Ergänzt B, ersetzt es nicht: der richtige, tool-neutrale Ort für bereichsspezifische **Regeln** (lazy geladen), nicht für erklärendes Wissen. Budget-Frage läuft als #1088. |
| **E — Nichts tun, ADR 0012 genügt** | Verworfen: unverlinkte Dokumente und Schnappschüsse ohne Lebenszyklus sind eine messbare Lücke, und ohne Pflege-Schritt geht das Wissen, das bisher ins Brain floss, verloren. |

## Entscheidung

**`docs/` ist das agentengepflegte Wiki von kubernia.** Es gibt keinen zweiten Wissensordner und kein repo-externes Brain für Projektwissen. Das Modell folgt dem Starter-Kit:

1. **Wissensarten und ihr Ort** (die Frage beim Schreiben: *„In sechs Monaten noch wahr, und nicht aus Code oder Git ableitbar?“*):
   - **Regeln** → [AGENTS.md](../../AGENTS.md) bzw. modul-lokale `AGENTS.md` — lebend, jede Regel genau einmal.
   - **Entscheidungen** → `docs/adr/` — historisch; wird nicht umgeschrieben, nur mit „präzisiert/abgelöst durch“ verknüpft.
   - **Evergreen-Wissen** (Konzepte, Zusammenhänge, gelernte Fallstricke) → die passende bestehende Seite (`docs/<thema>.md`, `docs/module/`, `docs/referenz/`, Glossar); gibt es keine, eine **neue Seite pro Konzept**, im Index eingehängt. Lebend, im selben PR gepflegt wie der Code.
   - **Laufender Stand** (offene Punkte, „wartet auf X“) → **GitHub-Issues**, nie ins Wiki.
   - **Abgeschlossene Arbeit** → PR, Commit, Issue-Kommentar; bei Grundsatzfragen ein ADR.
   - **Schnappschüsse** (Analysen, Audits) → datiert, mit sichtbarem Hinweis „Momentaufnahme, wird nicht aktualisiert“; neue Erkenntnisse ergänzen, nicht überschreiben.
2. **Lessons learned sind das Wiki — aber kuratiert.** Am Ticket-Ende prüft der Agent, ob etwas Übertragbares entstanden ist, und schreibt es nach Punkt 1 an den richtigen Ort, **im selben PR** (kein Nach-PR, Ein-PR-pro-Ticket-Regel). Die Vorschau aus dem Starter-Kit übernimmt der Mehr-Perspektiven-Review (#1012): er beurteilt Wiki-Änderungen wie Code. Freie Tagebuch-Notizen („heute gelernt …“) ohne Einordnung gibt es nicht.
3. **Kuratierter Index statt generierter Liste:** `docs/README.md` als Landkarte — eine Zeile pro Seite mit „wann lesen“, nach Wissensart gruppiert. On demand, nicht always-geladen.
4. **Links nach Starter-Kit-Konvention:** Standard-Markdown mit Kontext-Halbsatz, keine nackten „siehe auch“-Listen; tragende Verbindungen in beide Richtungen.
5. **Herkunft und Stand pro Wissensseite:** weil mehrere Agenten parallel schreiben (Team-Fall des Starter-Kits), tragen neue Evergreen-Seiten einen knappen Kopf mit Stand-Datum und Herkunfts-Ticket.
6. **Mechanischer Gesundheitscheck:** Erreichbarkeits-Wächter — jede Datei unter `docs/` ist von mindestens einer anderen Datei verlinkt — **hart**, mit `ALLOWLIST`-Ratchet und stale-Meldung wie `check:size`, als Regel in `check:docdrift` (vorhandene Link-Extraktion, keine neue Infrastruktur).
7. **Grenzen, die unverändert gelten:** öffentliches Repo — keine Klarnamen, keine internen Bezüge (`check:internalrefs`); keine personen- oder vertraulichen Notizen; nichts davon wird always-geladen.

## Konsequenzen

**Positiv**
- Projektwissen liegt dort, wo jeder Agent es findet — tool-neutral, versioniert, reviewt — und nicht mehr in einem privaten Vault, den nur eine Maschine kennt.
- Kein Always-Load-Zuwachs: das Wiki wird on demand über Index und Links gelesen; das Kontext-Budget aus #1064 bleibt unberührt.
- Die Trennung der Wissensarten verhindert die Hauptursache veralteter Doku (Wissen und Status in einer Datei) und skaliert mit Stardew-Scope sub-linear: neue Seiten pro Konzept statt wachsender Sammeldateien.
- Vorhandene Wächter (`check:docdrift`, `check:internalrefs`) decken neue Seiten ohne Zusatzaufwand ab.

**Negativ / Trade-offs**
- **Pflege kostet pro Ticket etwas Zeit und Tokens** (Prüfen, ob Wissen entstanden ist; Einordnen). Bewusst in Kauf genommen, weil sonst Wissen verloren geht.
- **Die Einordnung ist Urteil des Agenten.** Der Review fängt Fehleinordnungen ab, aber nicht sicher; der Erreichbarkeits-Wächter prüft nur Mechanik.
- **AGENTS.md-Budget:** die Pflege-Regel muss dort knapp Platz finden, ohne das Budget aus `check:contextsize` anzuheben.

## Umsetzung (Folgetickets)

Session-große Slices, angelegt nach diesem ADR (Nummern im Übersichts-Kommentar an #1083):

1. `docs/README.md` als kuratierter Index, die zwei unverlinkten Dokumente einhängen.
2. Wissensarten + Wiki-Pflege-Schritt als Regel in AGENTS.md und im Ticket-Ablauf (Skill/Workflow), inkl. Review-Lens-Prüfpunkt; beantwortet auch #1006 (ADR-Verweise werden nicht umgeschrieben).
3. Erreichbarkeits-Wächter in `check:docdrift`, test-first, hart mit `ALLOWLIST`.
4. Schnappschuss-Kennzeichnung für Analysen und Audits (am Ort, Banner statt Verschieben).
5. Kopf-Konvention (Stand-Datum, Herkunfts-Ticket) für Evergreen-Seiten, als Vorlage.

## Re-Evaluierungs-Trigger

- **Das Wiki veraltet trotzdem** — der Erreichbarkeits-Wächter steht dauerhaft mit wachsender `ALLOWLIST` da, oder Reviews finden wiederholt widersprüchliche Seiten: dann eine regelmäßige Bereinigungs-Routine (eine Seite pro Durchlauf, wie im Starter-Kit) ergänzen.
- **`docs/` wird unübersichtlich** (Größenordnung 60+ Seiten ohne klare Gruppen): Unterordner nach Wissensart einziehen.
- **Messbar schlechtere Agenten-Ergebnisse** durch Wiki-Inhalte (z.B. über die Token-/Loop-Baseline aus #1068): Pflege-Schritt schärfen oder zurücknehmen.
- **Path-scoped Rules erweisen sich als zuverlässig und tool-übergreifend** — dann Option C als additive Ladehilfe neu bewerten.
