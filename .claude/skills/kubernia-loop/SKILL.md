---
name: kubernia-loop
description: Arbeitet MEHRERE offene kubernia-Tickets nacheinander im Stapel ab — pro Ticket ein frischer Subagent mit eigenem, leerem Kontext (kein Kontext-Ballast zwischen Tickets), der jeweils den normalen kubernia-Skill end-to-end fährt. Fragt zuerst nach der Anzahl, arbeitet dann N Tickets sequenziell ab (Merge-kollisionssicher), meldet nach jedem Ticket eine Statuszeile und stoppt hart nach N oder früher, wenn keine freien Tickets mehr da sind. Auslösen bei "kubernia-loop", "mehrere kubernia-tickets", "arbeite N kubernia tickets ab", "kubernia im loop", "kubernia im stapel", "batch kubernia", "arbeite kubernia tickets ab bis", oder wenn autonom mehr als ein kubernia-Ticket hintereinander umgesetzt werden soll.
---

# Kubernia-Tickets im Stapel abarbeiten (Loop)

Arbeitet **mehrere** kubernia-Tickets hintereinander ab. Jedes Ticket läuft in einem **eigenen Subagenten mit frischem Kontext** — das ist bewusst so: kubernia-Tickets sind komplett unabhängig, und frischer Kontext pro Ticket verhindert Kontext-Aufblähung (der Grund, warum wir NICHT den eingebauten `/loop` nehmen, der alles in einem Chat ansammelt).

## Warum Subagenten statt `/loop`?

- `/loop` sammelt den Kontext über alle Runden im selben Chat → nach ein paar Tickets aufgebläht, frisst genau das 5h-Budget, das geschont werden soll. Kein automatisches `/clear`.
- Ein Subagent pro Ticket = frischer, leerer Kontext pro Ticket. Der Haupt-Chat bleibt schlank (nur Statuszeilen). Das ist das „`/clear` zwischendrin", nur sauberer.

## Ablauf

### 1. Anzahl N bestimmen
- Hat die Auslöse-Nachricht schon eine Zahl genannt (z.B. „mach 4", „arbeite 3 Tickets ab") → diese N nehmen.
- Sonst per `AskUserQuestion` fragen: „Wie viele Tickets soll ich abarbeiten?" (Vorschläge: 3, 4, 5). **Orientierung für die Userin:** ein Ticket frisst grob 5–15 % des 5h-Fensters; 3–4 ist sicher, 5–6 ambitionierter. Es gibt **kein** Tool, um das 5h-Limit zu messen — N ist der bewusste Ersatz für „90 % vom Limit".

### 2. Schleife i = 1 … N (STRIKT SEQUENZIELL, nie parallel)
Sequenziell ist Pflicht: mehrere Subagenten würden sonst gleichzeitig auf `main` mergen und sich im geteilten Board/Arbeitsverzeichnis in die Quere kommen → Merge-Kollision. Also immer erst das eine Ticket fertig (inkl. Merge + Aufräumen), dann das nächste.

Pro Runde **genau einen** Subagenten spawnen (Agent-Tool, `subagent_type: general-purpose`, **kein Modell-Override** — der Session-Default ist der kuratierte Coding-Sweet-Spot für die Umsetzung; Modell-Routing-Strategie: [docs/model-routing.md](../../../docs/model-routing.md)) mit sinngemäß diesem Auftrag:

> Arbeite in `C:\git\kubernia`. Rufe den `kubernia`-Skill auf und arbeite **GENAU EIN** offenes Ticket vollständig end-to-end ab — strikt nach `AGENTS.md` und `CLAUDE.md`: das oberste freie Item der Board-Reihenfolge wählen (Auswahl-Befehl in `docs/ticket-reihenfolge.md`, nicht nachsortieren), per `gh issue edit <nr> --add-assignee @me` claimen und verifizieren, eigenen `git worktree` anlegen, umsetzen, `npm run verify` grün, im Browser verifizieren, mit `(#<nr>)` committen, über das Remote nach `main` mergen+pushen, Issue schließen+verifizieren, Worktree+Branch aufräumen+verifizieren. Commit-Identität: `fluffels` (lokale Repo-Config, nie Klarname/Firmen-Mail). **Falls KEIN freies Ticket verfügbar ist** (alle offenen sind bereits assigned/haben Branch/Worktree, oder das Board ist leer): NICHT implementieren, sondern das sofort zurückmelden. **Falls das Ticket ein zu großes Epic/eine Phase ist:** nicht selbst umsetzen, sondern nach dem Claimen in konkrete Kindertickets aufteilen und das Epic auf done schließen (siehe Skill). Gib als LETZTE Zeile eine kompakte Zusammenfassung zurück im Format: `#<nr> — <Titel> — <was gemacht> — <gemerged: ja/nein>` bzw. `KEIN FREIES TICKET`.

Nach jedem Subagenten:
- Seine Zusammenfassungs-Zeile als **Statuszeile an die Userin** ausgeben (`[i/N] #… — …`).
- Meldet der Subagent **KEIN FREIES TICKET** → Schleife **sofort beenden** (nicht bis N weiterlaufen) und das der Userin sagen.
- Sonst weiter mit i+1.

### 3. Abschluss
Nach der letzten Runde (oder frühem Stopp) eine **Sammel-Übersicht** ausgeben: welche Tickets erledigt wurden (Nummern + Titel), wie viele von N geschafft, und ob früh gestoppt wurde. Kurz halten.

## Regeln
- **Nie parallel spawnen** — immer erst den einen Subagenten abwarten, dann den nächsten.
- **Nicht selbst committen/mergen** außerhalb des kubernia-Workflows — die kubernia-Autonomie (committen/mergen/pushen/Issue schließen) gilt, sie passiert aber IM Subagenten pro Ticket über den `kubernia`-Skill, nicht hier im Orchestrator.
- Der Orchestrator (dieser Skill) implementiert selbst **nichts** und legt selbst **keinen** Worktree an — er delegiert jedes Ticket an einen Subagenten.
- Bricht ein Subagent-Lauf mit Fehler ab: den Fehler als Statuszeile melden, die Userin fragen, ob abbrechen oder mit dem nächsten Ticket weitermachen.
