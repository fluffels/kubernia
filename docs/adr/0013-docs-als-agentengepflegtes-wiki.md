# ADR 0013: `docs/` als agentengepflegtes Wiki — kein zweiter Wissensspeicher, kein externes Brain

> Architecture Decision Record. Format: Kontext → Problem → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-09-29 · Tickets: #1083 (Recherche + dieser ADR)

## Status

**Akzeptiert.** Präzisiert durch [ADR 0015](0015-projekt-brain.md) (#1205): Begriff Projekt-Brain, Prinzipien, Token-Ziel, Messung. Präzisiert [ADR 0012](0012-harness-autonomie-audit-spur.md) an einer Stelle: ADR 0012 hielt fest, dass kein separates „Projekt-Brain“ neben dem Repo angelegt wird und das Repo selbst der Wissensspeicher ist. Dieser ADR bleibt dabei, schließt aber die Lücke, die das offen ließ: **wie** das Repo als Wissensspeicher gepflegt wird, nachdem die repo-externe Brain-Pflege entfallen ist. Die Umsetzung läuft über Folgetickets (siehe unten); dieser ADR selbst ändert noch keine Regel. **Sobald die Regeln in [AGENTS.md](../../AGENTS.md) stehen, ist AGENTS.md maßgeblich** — dieser ADR dokumentiert dann nur noch das *Warum*, keine zweite Regelquelle.

## Kontext

Bis Ende September 2026 lief nach gemergten kubernia-Tickets eine „Brain-Pflege“: übertragbares Wissen wurde in ein **privates, repo-externes** Notiz-System der Maintainerin geschrieben. Die Maintainerin möchte das nicht mehr — Wissen über kubernia soll **im Repo** leben und von den Agenten gepflegt werden, die ohnehin darin arbeiten. Die Brain-Pflege war nie Teil des Repos (sie lag als persönlicher Skill außerhalb, vgl. die Abgrenzung zum privaten Vault in [docs/agent-harness.md](../agent-harness.md)) und ist bereits entfernt.

Bestandsaufnahme zum Zeitpunkt der Entscheidung:

- `docs/` ist faktisch schon ein Wiki: rund 40 Markdown-Dateien — arc42, Glossar, fünf `docs/module/`-Tiefendocs, `docs/referenz/` (seit #1085), zwölf ADRs, Audits und Analysen.
- Eine Landkarte existiert bereits: [docs/referenz/anlaufstellen.md](../referenz/anlaufstellen.md) („wo welche Doku liegt“). Sie ist aber **nicht vollständig**: `docs/barrierefreiheit-audit.md` und `docs/spielkonzept-review.md` sind von keiner Datei verlinkt, weitere Seiten nur über Umwege erreichbar.
- Es fehlt eine **Lebenszyklus-Regel**: sechs `architektur-analyse-*`-Schnappschüsse und mehrere Audits stehen gleichrangig neben lebender Doku, ohne Kennzeichnung, was gepflegt und was eingefroren ist.
- Drift-Schutz existiert teilweise: `check:docdrift` prüft, dass interne Links und Anker **auflösen**, aber nicht, dass jede Seite **erreichbar** ist. `check:internalrefs` scannt alle getrackten Dateien. `check:docmap` deckt nur `src/` → `docs/module/` ab. Kein Wächter gleicht die ADR-Tabelle in arc42 §9 gegen `docs/adr/` ab.

## Das Problem

Ein agentengepflegtes Wiki kann auf zwei Arten scheitern: es **veraltet**, weil niemand es pflegt, oder es **verwässert**, weil Agenten ungeprüft Prosa hineinschreiben, die das Repo schon an anderer Stelle sagt. Beides ist bei Stardew-Scope (viele Welten, NPCs, Quests, parallele Agenten) teuer. Gesucht ist eine Form, die Wissen aus Tickets festhält, ohne eine zweite Quelle der Wahrheit neben AGENTS.md, ADRs und `docs/` zu schaffen und ohne das Always-Load-Budget jeder Session zu belasten.

## Recherche (Quellen)

- **Gloaguen et al., „Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?“** ([arXiv:2602.11988](https://arxiv.org/abs/2602.11988), Feb./Jun. 2026): Kontextdateien verbesserten die Erfolgsrate nicht generell, erhöhten die Inferenzkosten aber um mehr als 20 %. Repository-Übersichten brachten keinen messbaren Nutzen; hilfreich sind sie vor allem für **nicht aus dem Code ableitbare** Konventionen. Gemessen wurden Dateien, die **in jeder Session** geladen werden.
- **Claude-Code-Doku, „How Claude remembers your project“** ([code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory)): Kontextdateien in Unterordnern laden erst, wenn dort eine Datei gelesen wird; `@`-Imports sparen keinen Kontext (sie laden beim Start); `.claude/rules/` mit `paths:` lädt nur bei passenden Dateien; Skills kosten ständig nur Name + Beschreibung, ihr Inhalt lädt erst beim Aufruf; eine Unterordner-`AGENTS.md` wird nach #1078 nativ gelesen, sobald dort eine Datei geöffnet wird; **Auto Memory ist maschinenlokal** (Index `MEMORY.md`, davon max. 200 Zeilen bzw. 25 KB pro Session geladen) und wird Subagenten nicht mitgegeben — für geteiltes Projektwissen also ungeeignet. Die Doku empfiehlt selbst, aus dem Code ableitbare Übersichten aus Always-Load-Dateien herauszuhalten.
- **Cline Memory Bank** ([docs.cline.bot](https://docs.cline.bot/prompting/cline-memory-bank)): das bekannteste Muster — sechs feste Kerndateien (Projekt-Brief, Produkt-Kontext, aktiver Kontext, System-Muster, Tech-Kontext, Fortschritt), gepflegt auf Zuruf. Mischt evergreen Wissen und laufenden Stand in denselben Dateien.
- **Starter-Kit-Modell der Maintainerin** (privates Vorlagen-Repo für ein KI-gepflegtes Wissens-Vault, nicht verlinkt): trennt **Evergreen-Wissen**, **laufenden Stand** und **abgeschlossene Arbeitseinheiten**; kuratierte Landkarten statt generierter Listen; Links in Standard-Markdown mit Kontext-Halbsatz; Schreiben nur nach **Vorschau**; Selbstpflege über vier Routinen (Input am Session-Ende, Einzel-Notiz auf Zuruf, regelmäßiges Bereinigen je Datei, mechanischer Gesundheitscheck); bei mehreren Schreibern zusätzlich eine Stand-/Vertrauens-Kennzeichnung pro Notiz.

Die Studie spricht gegen **always-geladene, ungeprüfte** Agenten-Prosa, nicht gegen ein **on-demand gelesenes, kuratiertes** Wiki. Genau diese Unterscheidung trägt die Entscheidung. Token-Folge für kubernia: das Wiki kostet nur, wenn eine Seite gelesen wird; das Always-Load-Budget aus #1064 wächst nicht.

## Optionen

| Option | Bewertung |
|---|---|
| **A — Neuer `docs/wiki/`-Ordner im Memory-Bank-Stil** | Verworfen. Die festen Kerndateien doppeln README, arc42 und `docs/module/` (zweite SSOT = Drift-Bug), mischen Wissen mit laufendem Stand, und Dateien wie „Fortschritt“ wachsen bei Stardew-Scope zu Monolithen — dieselbe Falle wie der Content-Monolith vor #348. |
| **B — `docs/` ist das Wiki, nach dem Starter-Kit-Modell ergänzt** (gewählt) | Nutzt Vorhandenes (auch die bestehende Landkarte), erzeugt keinen Always-Load-Zuwachs, trennt Wissensarten sauber, und die bestehenden Wächter decken neue Seiten sofort ab. Braucht eine vollständige Landkarte, eine Lebenszyklus-Regel, einen Pflege-Schritt und einen Erreichbarkeits-Wächter. |
| **C — `.claude/rules/` mit `paths:` als Wissensträger** | Nicht als Primärort: tool-spezifisch (andere Agenten lesen `.claude/` nicht), von `check:docdrift` nicht erfasst (#1077), und das zuverlässige Greifen von `paths:` müsste erst gemessen werden. Höchstens später additiv. |
| **D — Modul-lokale `AGENTS.md` ausbauen** | Ergänzt B, ersetzt es nicht: der richtige, tool-neutrale Ort für bereichsspezifische **Regeln** (lazy geladen), nicht für erklärendes Wissen. Budget-Frage läuft als #1088. |
| **E — Nichts tun, ADR 0012 genügt** | Verworfen: unverlinkte Dokumente und Schnappschüsse ohne Lebenszyklus sind eine messbare Lücke, und ohne Pflege-Schritt geht das Wissen, das bisher ins Brain floss, verloren. |

## Entscheidung

**`docs/` ist das agentengepflegte Wiki von kubernia.** Es gibt keinen zweiten Wissensordner und kein repo-externes Brain für Projektwissen. Das Modell folgt dem Starter-Kit, mit den unten benannten bewussten Anpassungen:

1. **Wissensarten und ihr Ort** (die Frage beim Schreiben: *„In sechs Monaten noch wahr, und nicht aus Code oder Git ableitbar?“*):
   - **Regeln** → AGENTS.md bzw. modul-lokale `AGENTS.md` — lebend, jede Regel genau einmal.
   - **Entscheidungen** → `docs/adr/` — historisch; wird nicht umgeschrieben, nur mit „präzisiert/abgelöst durch“ verknüpft.
   - **Evergreen-Wissen** (Konzepte, Zusammenhänge, gelernte Fallstricke) → die passende bestehende Seite (`docs/<thema>.md`, `docs/module/`, `docs/referenz/`, Glossar); gibt es keine, eine **neue Seite pro Konzept**, in der Landkarte eingehängt. Lebend, im selben PR gepflegt wie der Code.
   - **Laufender Stand** (offene Punkte, „wartet auf X“) → **GitHub-Issues**, nie ins Wiki.
   - **Abgeschlossene Arbeit** → PR, Commit, Issue-Kommentar; bei Grundsatzfragen ein ADR.
   - **Schnappschüsse** (Analysen, Audits) → datiert, mit sichtbarem Hinweis „Momentaufnahme, wird nicht aktualisiert“; neue Erkenntnisse ergänzen, nicht überschreiben.
2. **Lessons learned sind das Wiki — aber kuratiert.** Am Ticket-Ende prüft der Agent, ob etwas Übertragbares entstanden ist, und schreibt es nach Punkt 1 an den richtigen Ort, **im selben PR** (Ein-PR-pro-Ticket-Regel). Freie Tagebuch-Notizen („heute gelernt …“) ohne Einordnung gibt es nicht.
   - *Bewusste Anpassung „Vorschau“:* im Starter-Kit sieht der Mensch den Inhalt vor dem Schreiben. Hier übernimmt das der Mehr-Perspektiven-Review (#1012), der Wiki-Änderungen wie Code beurteilt; die Maintainerin liest wie bei ADR 0012 asynchron im PR gegen. Grund: möglichst wenig Human-in-the-Loop (ADR 0012).
   - *Warum als Schritt im Ticket-Ablauf, nicht per Hook oder eigenem Skill:* ein Hook sieht nur Ereignisse, nicht, ob Wissen entstanden ist, und schriebe nach dem Commit — das bräuchte einen zweiten PR. Ein separater Skill müsste eigens aufgerufen werden und fiele genau dann aus, wenn es eilig ist. Der Schritt im Ablauf läuft zwangsläufig vor dem PR.
3. **Die vier Selbstpflege-Routinen des Starter-Kits:**
   - *Input am Session-Ende* → Punkt 2 (am Ticket-Ende).
   - *Einzel-Notiz auf Zuruf* → sagt die Maintainerin in einer kubernia-Session „merk dir das“, landet es nach Punkt 1 im Repo: im laufenden Ticket-PR, sonst als Issue (keine Ad-hoc-Commits auf `main`).
   - *Regelmäßiges Bereinigen je Datei* → vorerst **nicht** eingeführt: die Seiten werden bei jedem Ticket im Bereich ohnehin gepflegt, und eine geplante Bereinigung braucht ein Stand-Signal (Punkt 5), das erst entstehen muss. Kommt über den Re-Evaluierungs-Trigger.
   - *Mechanischer Gesundheitscheck* → Punkt 6.
4. **Eine Landkarte, keine zweite:** [docs/referenz/anlaufstellen.md](../referenz/anlaufstellen.md) wird zur **vollständigen, kuratierten** Landkarte ausgebaut (nach Wissensart gruppiert, je Seite ein Halbsatz „wann lesen“). Kein zusätzliches `docs/README.md`. On demand, nicht always-geladen.
5. **Stand-Kennzeichnung nur, wo Git sie nicht liefert:** Autor, Datum und Herkunfts-Ticket stehen schon in `git log` (Commit-Nachricht mit `(#<nr>)`). Evergreen-Seiten tragen deshalb nur einen Kopf **„fachlich geprüft am“** — das Datum, an dem jemand den Inhalt gegen den Code gehalten hat, nicht den letzten Commit. Das ist das Stand-Signal aus der Team-Variante des Starter-Kits, das parallele Agenten brauchen.
6. **Mechanischer Gesundheitscheck:** Erreichbarkeits-Wächter — jede `.md`-Datei unter `docs/` ist von der Landkarte aus **transitiv über Links erreichbar** (bloß „irgendwo verlinkt“ genügt nicht; zwei sich gegenseitig verlinkende Waisen fielen sonst durch). **Hart**, mit `ALLOWLIST`-Ratchet und stale-Meldung wie `check:size`, als Regel in `check:docdrift` (vorhandene Link-Extraktion, keine neue Infrastruktur). Test-first über einen Fixture-Root, weil der echte Bestand nach der Landkarten-Pflege keinen roten Fall mehr hat.
7. **Grenzen, die unverändert gelten:** öffentliches Repo — keine Klarnamen, keine internen Bezüge (`check:internalrefs`); keine personen- oder vertraulichen Notizen; nichts davon wird always-geladen.

## Konsequenzen

**Positiv**
- Projektwissen liegt dort, wo jeder Agent es findet — tool-neutral, versioniert, reviewt — und nicht mehr in einem privaten Vault, den nur eine Maschine kennt.
- Kein Always-Load-Zuwachs: das Wiki wird on demand über die Landkarte und Links gelesen.
- Die Trennung der Wissensarten verhindert die Hauptursache veralteter Doku (Wissen und Status in einer Datei) und skaliert mit Stardew-Scope sub-linear: neue Seiten pro Konzept statt wachsender Sammeldateien.
- Vorhandene Wächter (`check:docdrift`, `check:internalrefs`) decken neue Seiten ohne Zusatzaufwand ab.

**Negativ / Trade-offs**
- **Pflege kostet pro Ticket etwas Zeit und Tokens** (Prüfen, ob Wissen entstanden ist; Einordnen). Bewusst in Kauf genommen, weil sonst Wissen verloren geht.
- **Die Einordnung ist Urteil des Agenten**, und ohne menschliche Vorschau fängt nur der Review Fehleinordnungen ab. Der Erreichbarkeits-Wächter prüft nur Mechanik; „fachlich geprüft am“ und die Schnappschuss-Hinweise bekommen bewusst keinen Wächter.
- **AGENTS.md-Budget:** die Pflege-Regel muss dort knapp Platz finden, ohne das Budget aus `check:contextsize` anzuheben.

## Umsetzung (Folgetickets)

Session-große Slices, angelegt nach diesem ADR (Nummern im Übersichts-Kommentar an #1083):

1. `docs/referenz/anlaufstellen.md` zur vollständigen Landkarte ausbauen (nach Wissensart gruppiert, „wann lesen“), die zwei unverlinkten Dokumente einhängen.
2. Wissensarten, Pflege-Schritt und „merk dir das“ als knappe Regel in AGENTS.md; beantwortet dabei #1006 (ADR-Verweise werden nicht umgeschrieben, nur verknüpft).
3. Pflege-Schritt im Ticket-Ablauf verdrahten: `kubernia`-Skill, Workflow-Skript, Prüfpunkt für die Requirement-Lens.
4. Erreichbarkeits-Wächter in `check:docdrift`, test-first per Fixture, hart mit `ALLOWLIST`; dazu der Abgleich der arc42-ADR-Tabelle gegen `docs/adr/`.
5. Schnappschuss-Hinweis für Analysen und Audits (am Ort, Hinweis statt Verschieben) und Kopf „fachlich geprüft am“ als Vorlage für Evergreen-Seiten.

## Re-Evaluierungs-Trigger

- **Das Wiki veraltet trotzdem** — der Erreichbarkeits-Wächter steht dauerhaft mit wachsender `ALLOWLIST` da, oder Reviews finden wiederholt widersprüchliche Seiten: dann die Bereinigungs-Routine (eine Seite pro Durchlauf, gesteuert über „fachlich geprüft am“) einführen.
- **`docs/` wird unübersichtlich** (Größenordnung 60+ Seiten ohne klare Gruppen): Unterordner nach Wissensart einziehen.
- **Messbar schlechtere Agenten-Ergebnisse** durch Wiki-Inhalte (z.B. über die Token-/Loop-Baseline aus #1068): Pflege-Schritt schärfen oder zurücknehmen.
- **Path-scoped Rules erweisen sich als zuverlässig und tool-übergreifend** — dann Option C als additive Ladehilfe neu bewerten.
