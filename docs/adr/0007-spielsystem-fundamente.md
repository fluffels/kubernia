# ADR 0007: Spielsystem-Fundamente für Content-Skalierung (Quest-Modell, Checks, Zeit)

> Architecture Decision Record. Format: Kontext → Problem → Entscheidung → Konsequenzen → Umsetzungsreihenfolge.
> Status: **akzeptiert** · Datum: 2026-06-21

## Status

**Akzeptiert.** Ergänzt [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md) um die **Spielsystem-/Mechanik-Ebene**. ADR 0004 hat das Fundament auf der *Infrastruktur*-Ebene gelegt (Content-as-Data, Entity-Registry, IndexedDB). Dieser ADR schließt die *Mechanik*-Lücke darüber.

## Kontext

Eine erneute Stardew-Scope-Gesamtanalyse (2026-06-21, [architektur-analyse-2026-06.md](../architektur-analyse-2026-06.md)) wurde **bewusst ohne Blick in die bestehenden ADRs** durchgeführt, um die alten Annahmen unvoreingenommen zu stresstesten (oberste Regel: „trägt das bei Stardew-Größe?"). Befund: Das Infrastruktur-Fundament (ADR 0004) **trägt** – aber die vorherige Analyse (Stand 2026-06-20) war auf **Assets/Save/Tooling** fokussiert und hat drei **Spielsystem-Schulden** übersehen, die die Content-**Mechanik** betreffen, nicht die Content-**Ablage**. Sie werden mit jedem weiteren Quest teurer und gehören deshalb **vor** den großen Content-Push.

## Das Problem – drei Mechanik-Grenzen

### 1. Quest-Fortschritt ist linear (#410)

Der Fortschritt ist eine Zahl (`questIdx`) als Position in einer geordneten Liste (`quest-order.json`, 40 Quests) plus `questStep`/`taskIdx` – alles im Spielstand. Es ist immer **genau eine** Quest aktiv. Kein paralleles Offen-Haben, keine Voraussetzungen, keine optionalen/wiederholbaren Quests. Stardew besteht zu großen Teilen aus dem Gegenteil. `questIdx` steckt in jedem Save → der spätere Umbau ist eine Migration über alle Nutzerstände (teuerster denkbarer Umbau).

### 2. Quest-Logik ist nur ~90 % Daten – die Mechanik-Ränder sind Code (#411, #412)

Quests sind JSON, aber ihre **Erfolgs-Bedingungen** sind 56 handgeschriebene Prädikate in `src/content/checks.ts`. Und die **Karten-Freischaltung** ist auf zwei Hand-Maps verteilt (`EXTRA_CARDS` in `spaced-repetition.ts` + `CONCEPT_INTRO` in `learnorder.ts`), die dieselbe Info doppelt führen. Jede neue Quest/Karte braucht damit Code-Änderungen – das Content-as-Data-Versprechen aus ADR 0004 ist an genau diesen Rändern unvollständig.

### 3. Keine persistente Zeit-Achse (#413)

Tag/Nacht existiert nur als Render-Effekt aus der Frame-Zeit; `GameState` hat **kein** Kalender-/Jahreszeit-Feld. Bei Reload ist wieder „Tag 1". Stardew *ist* sein Kalender (Jahreszeiten, Festivals, Routinen). Das ist die größte „leere Säule" – kein teurer Umbau, aber Voraussetzung dafür, dass „Stardew-Scope" überhaupt trägt.

## Entscheidung

1. **Quest-Fortschritt auf ein erweiterbares Modell** (Set aktiver Quests + Voraussetzungen statt linearem Index) – #410. Jetzt, weil die Save-Migration mit jedem Quest teurer wird. `currentQuestId` (#353) ist die saubere Basis.
2. **Quest-Checks deklarativ** als kleine DSL in JSON + Interpreter (#411) und **Karten-Freischaltung konsolidieren** in ein JSON-Feld (#412). Das **vollendet** „Content ist Daten" aus ADR 0004.
3. **Persistenter Spiel-Kalender** im `GameState` (#413) als Fundament für saisonalen Content.
4. **Voraussetzung über allem:** das **Save-Migrations-Netz** (#414, Integrationstest mit echten Alt-Stand-Fixtures) steht **vor** #410 und #413 – beide sind Save-Migrationen, und die Grundregel „kein Update bricht je einen bestehenden Stand" muss durch Tests abgesichert sein, bevor migriert wird.

### Bewusst *nicht* entschieden (Scope-Frage offen)

- **NPC-Tagesplan/Routinen (#420)** und **reiches Item-/Crafting-Modell (#421)** sind `status:zurückgestellt` + `question`. Sie hängen an einer Design-Entscheidung: bedeutet „Stardew-Scope" für ein **K8s-Lernspiel** simulierte Alltagsroutinen/Crafting – oder vor allem **Lern-Tiefe** (mehr Themen/Quests/Welten)? Erst entscheiden, dann ggf. bauen. (#420 setzt zudem #413 voraus.)

## Konsequenzen

**Positiv**
- „Content ist Daten" gilt dann durchgängig – neue Quests/Karten ohne Code-Änderung.
- Nicht-lineare Lernpfade (parallele/optionale Quests) werden möglich (Voraussetzung für das Lernpfad-Review #271).
- Saisonaler/zeitabhängiger Content wird überhaupt erst baubar.
- Save-Format-Änderungen sind durch das Netz (#414) abgesichert.

**Negativ / Aufwand**
- #410 ist ein tiefer Eingriff (Save-Migration über alle Stände) – deshalb das Netz zuerst.
- Eine Check-DSL ist neue Mechanik (Interpreter + Validierung), bringt aber den Code-Anteil im Content dauerhaft runter.

## Umsetzungsreihenfolge (Tickets)

| Reihenfolge | Ticket | Warum hier |
|---|---|---|
| 1 | **#414** Save-Migrations-Integrationstest | Netz **vor** jeder Save-Migration |
| 2 | **#410** Quest-Modell erweiterbar | tiefster Umbau, je früher desto billiger |
| 3 | **#411** Check-DSL | vollendet Content-as-Data |
| 4 | **#412** Karten-Freischaltung konsolidieren | kleiner Schwester-Schnitt zu #411 |
| 5 | **#413** Persistenter Kalender | isoliert, Fundament für saisonalen Content |

Volle, abhängigkeitsbewusste Gesamtsequenz: [ticket-reihenfolge.md](../ticket-reihenfolge.md).

## Verwandte ADRs

- [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md): dieser ADR ergänzt die dort begonnene „Content ist Daten"-Linie um die Mechanik-Ebene (Checks/Quest-Struktur) und um die Zeit-Achse.
- [ADR 0006 – Backend & Skalierung](0006-backend-und-skalierung.md): Save bleibt client-seitig; die hier beschlossenen Save-Format-Änderungen ändern daran nichts.
- [ADR 0001 – Engine Phaser](0001-engine-phaser.md): unberührt – alle drei Fundamente sind in der Phaser-freien Domänen-/Anwendungsschicht umsetzbar.
