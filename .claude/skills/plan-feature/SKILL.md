---
name: plan-feature
description: Plant ein Feature oder Ticket für kubequest GRÜNDLICH, bevor eine Zeile Code fällt — auf dem stärksten Modell mit hohem Reasoning (Opus 4.8), gemäß der Konvention „Planung stark, Umsetzung schnell" (#741). Erzeugt einen konkreten, umsetzbaren Plan (Ziel, betroffene Dateien/Schichten, Schritte, Tests, Risiken/Trade-offs, Stardew-Scope-Check) und übergibt danach an die normale Umsetzung. Auslösen bei "plane ein Feature", "plane das Ticket", "mach mir einen Plan", "wie setze ich #X um", "Umsetzungsplan", "plan feature", oder wenn vor dem Coden erst durchdacht werden soll.
model: claude-opus-4-8
effort: high
---

# Feature/Ticket planen (Planungsphase, starkes Modell)

Dieser Skill ist die **Planungsphase** der Konvention „Planung stark, Umsetzung schnell" (**[AGENTS.md › Modellwahl nach Phase](../../../AGENTS.md)**, #741). Er läuft bewusst auf **Opus 4.8 mit hohem Reasoning** (`model:`/`effort:` im Frontmatter). Denke hier gründlich nach — die eigentliche **Umsetzung** darf danach ein **schnelleres Modell** tippen.

> ⚠️ Die feste Versions-ID `claude-opus-4-8` im Frontmatter veraltet mit dem nächsten Release (ein Alias wie `opus` zöge automatisch mit, ist hier aber bewusst gepinnt) — gelegentlich nachziehen. Für die **Umsetzung** wird hier **bewusst kein** Modellname festgenagelt: „schnelles Modell" bleibt tool-/versionsneutral (dasselbe Prinzip wie die portable Konvention in AGENTS.md).

> ⚠️ **Nur planen, nicht bauen.** Dieser Skill schreibt **keinen** Produktionscode, öffnet **keinen** PR und legt **keinen** Worktree an. Er liefert einen Plan, den danach der normale Ablauf (bzw. der [`kubequest`-Skill](../kubequest/SKILL.md)) umsetzt. Nach dem Skill fällt die Session automatisch aufs normale Modell zurück.

## Vorher lesen (Kontext)

- **[AGENTS.md](../../../AGENTS.md)** — harte Regeln, Schichtung, Gates, Board-Workflow. Bei Konflikt gilt diese Datei.
- **[CLAUDE.md](../../../CLAUDE.md)** — Repo-Landkarte (welche Datei welche Schicht/Zweck) + Schichtregeln beim Arbeiten im Verzeichnis.
- Geht es um ein konkretes Issue: `gh issue view <nr> --repo fluffels/kubernia` (Body + Akzeptanzkriterien).
- Betroffener Bereich hat eine modul-lokale `AGENTS.md` oder ein `docs/module/*.md`? Dann mitlesen.

## Die eine Leitfrage zuerst (steht über allem)

⭐ **„Ist das okay, wenn Kubernia ein Spiel in Stardew-Valley-Größe wird?"** Nur planen, was auch bei 10× Inhalt/NPCs/Welten trägt — **Granularität und Struktur mitdenken, nicht nur das Format**. Ist das Ticket in Wahrheit ein Epic/eine Phase, ist der „Plan" die **Aufteilung** in session-große Kinder (siehe [AGENTS.md](../../../AGENTS.md)), nicht ein Umsetzungsplan.

## Was der Plan enthält

Gib einen kompakten, konkreten Plan aus — kein Fließtext-Essay:

1. **Ziel in einem Satz** + die Akzeptanzkriterien (aus dem Issue), gegen die am Ende geprüft wird.
2. **Betroffene Dateien & Schichten** — welche Module wahrscheinlich angefasst/neu angelegt werden, mit ihrer Schicht (pure Domäne / Anwendung / Präsentation). Neue Domänenlogik gehört Phaser-frei und testbar in die pure Domäne, nicht in `scenes`/`ui`.
3. **Schrittfolge** — kleine, in sich testbare Schritte in sinnvoller Reihenfolge. **TDD ist der Default für Logik:** erst der fehlschlagende Test (rot), dann die Implementierung (grün).
4. **Tests** — welche neuen/geänderten Tests (inkl. Negativ-/Grenzfälle), wie die Red-Green-Absicherung aussieht. Präsentation wird im Browser verifiziert statt per Unit-Test.
5. **Gates im Blick** — was der Diff bei `npm run verify` berührt (Schichtung `check:arch`, Dateigröße `check:size`, Diff-Größe `check:diffsize` ≤ 20 Dateien/800 Zeilen, Doku-Drift, Coverage-Floor). Droht der Slice zu groß zu werden → aufteilen.
6. **Risiken & Trade-offs** — Save-Migration nötig (`CURRENT_SAVE_VERSION` + Migrationskette, bestehende Stände nie brechen)? Import-Zyklus-Gefahr? Echte Weiche, an der die Maintainerin per Rückfrage entscheiden soll?
7. **Offene Fragen** — was vor der Umsetzung noch geklärt werden muss (statt es zu raten).

## Danach

Plan vorlegen. Bei einer echten Design-Weiche per `AskUserQuestion` abstimmen. Wenn der Plan steht, in die Umsetzung übergehen — die läuft auf dem normalen (schnellen) Modell, z.B. über den [`kubequest`-Skill](../kubequest/SKILL.md) (claimen → Worktree → coden → EIN PR bis Merge).
