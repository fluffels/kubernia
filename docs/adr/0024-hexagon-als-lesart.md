# ADR 0024: Hexagon als Lesart der bestehenden Schichtung, nicht als Ordnerstruktur

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-10-15 · Ticket: #1567

## Status

**Akzeptiert.** Ergänzt [ADR 0004](0004-skalierungs-fundament.md) (Skalierungs-Fundament) und die DDD-Einordnung in [arc42 §8](../arc42-architektur.md#8-querschnittliche-konzepte--ddd-bewertung); präzisiert [ADR 0020](0020-architekturmodell-likec4.md) (das Modell bekommt die Arten `port` und `adapter`).

## Kontext

Kubernia ist faktisch nach Ports & Adapters gebaut: eine Phaser-freie Domäne und Anwendung, der `SaveStore` mit IndexedDB-, localStorage- und In-Memory-Adapter, die Hafen-Metapher als Anti-Corruption-Layer. Benannt war diese Lesart nirgends. Agenten kennen das Vokabular (Port, Adapter, treibend, getrieben) und könnten damit neuen Code ohne Ratespiel in die richtige Schicht legen, statt `check:arch` erst hinterher rot werden zu lassen. Die Frage der obersten Regel: trägt das bei Stardew-Größe? Eine Lesart ja, ein Umbau würde bei 10× Inhalt nur Dateien verschieben.

## Optionen

| Option | Bewertung |
|---|---|
| **A (gewählt)** Lesart plus Zuordnung plus Wächter | Eine arc42-Tabelle je Port und Adapter mit Backtick-Pfaden und Schicht, das LikeC4-Modell bindet sich daran, `check:c4` prüft Pfade, Schichten (gegen `scripts/layers.cjs`) und Modell. Kein zweites Schichtmodell, kein Code-Umbau. |
| **B** Ordner `src/ports` und `src/adapters` | Verworfen. Großer Umbau, ein zweites Schichtmodell neben `layers.cjs`, die Schichtregeln müssten doppelt gepflegt werden. |
| **C** Nichts tun | Verworfen. Die Zuordnung bleibt implizit, Agenten raten, Ports driften unbemerkt. |

## Entscheidung

Entscheidung: **A**, weil nur sie die Benennung liefert, ohne eine zweite Wahrheit über die Schichten einzuführen. Die arc42-Tabellen sind die maßgebliche Liste (handgeschrieben, maschinell geprüft), das LikeC4-Modell ist die Bildfassung davon (Arten `port` und `adapter`, Seite als Tag `treibend` bzw. `getrieben`, je Adapter genau eine Kante auf seinen Port). Der Wächter ist eine Erweiterung von `check:c4`, kein neues Gate. Ehrlich dokumentiert sind die Grenzen: keine TypeScript-Interfaces je Port, Abhängigkeitsumkehr nur an Schichtgrenzen, der Persistenz-Port wählt seinen Adapter selbst, die Wanduhr ist kein Port.

## Konsequenzen

- Eine neue Ein- oder Ausgabe ist ein neuer Adapter an einem vorhandenen Port: eine Tabellenzeile und ein Element im Modell, sonst `check:c4` rot.
- Kein strategisches DDD, keine getrennten Packages (arc42 §8 gilt weiter).
- Die Tabellen müssen bei Umbenennungen von Pfaden mitgezogen werden; das erzwingt der Wächter.

## Re-Evaluierung

Braucht ein Port zwei zur Laufzeit oder im Build austauschbare Adapter (Cloud-Save nach [ADR 0003](0003-multiplayer-coop-out-of-scope.md) und [ADR 0006](0006-backend-und-skalierung.md), Lazy-Load von Content nach [ADR 0018](0018-content-chunks-je-datei.md)), wird ein echtes TypeScript-Port-Interface mit Injektion neu bewertet.
