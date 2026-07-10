# Art-Direction-Audit: Optik gegen die Stardew-Messlatte (#44)

> Abweichungsliste, kein Feature-Bau. Grundlage für die Folge-Optik-Tickets.
> Stand: Juni 2026, Code-Stand `main` zum Zeitpunkt von #44.
> Die **Messlatte selbst** steht in [`AGENTS.md` §Grafik-Stil](../AGENTS.md#konventionen) – hier wird die bestehende Optik dagegen geprüft.

## Kurzfassung (TL;DR)

Der **Boden (Terrain-Tilesets) ist der stärkste Bereich** und schon klar
Stardew-artig: einheitliche 16px-Wang-Tilesets mit pixelgleichen Übergängen.
**Objekte, Gebäude und NPCs** sind überwiegend kohärent (durchgängig PixelLab,
gleiche Pixeldichte). Die „nicht nach Stardew"-Eindrücke kommen aus einer
Handvoll klar benennbarer Stilbrüche – fast alle bereits in eigenen Tickets:

1. **Prozedurale Dreieck-Grashalme** statt Pixelart-Gras → **#107** (Re-Do von #40).
2. **Prozedural gemalte Gegner** (Krake, Piraten-Schiff) statt Pixelart-Assets → erfasst über **#53**.
3. **HUD/UI als HTML/CSS + Emojis** (🪙🔥🕐 …) statt Pixelart → erfasst über **#53**.
4. **Schiff liegt auf einer Holz-Plattform** statt im Wasser zu schwimmen → **#108** (Platzierung, kein Stil).
5. **Offene Stil-Entscheidung:** Gebäude in schräger 2.5D-Sicht vs. die frontale `view: side`-Messlatte → neues Entscheidungs-Ticket (siehe unten).

**Voraussetzung** für die eigentliche Umsetzung der Optik-Tickets: die echte
Referenz lesen, damit gegen ein Vorbild gearbeitet wird statt zu raten →
[`stardew-referenz.md`](stardew-referenz.md) (#106, erledigt).

---

## Messlatte (Kurzform, Details in AGENTS.md)

Einheitliche Pixeldichte (alles auf 16px-Raster) · ganzzahlige Skalierung
(×2/×3/×4, nie krumm) · frontale Ansicht als Default · kohärente, gedämpfte
Palette · keine simpel-prozeduralen Platzhalter, wo ein Asset hingehört
(dynamische Effekte ausgenommen) · große Objekte hoch auflösen + ganzzahlig
verkleinern.

---

## Audit nach Bereichen

| Bereich | Stand heute | Gegen die Messlatte | Maßnahme |
|---|---|---|---|
| **Boden / Terrain** | PixelLab-Wang-Tilesets (coast, meadow, path, kai, dock), 16×16, über `lower_base_tile_id` verkettet → pixelgleiche Übergänge (`renderGround`, `scenes.ts`). | ✅ **Kohärent.** Einheitliche Pixeldichte, sauberes Autotiling. Stärkster Bereich. | – |
| **Gras (Deko)** | Prozedurale Dreieck-Halme: `g.fillTriangle(...)` erzeugt `grasstuft`-Texturen (`scenes.ts` ~467). | ❌ **Stilbruch.** Gemalte Vektordreiecke, keine Pixelart, fremde Detailtiefe neben den Tilesets. | **#107** (Gras als echtes Stardew-Pixelart, Re-Do von #40). |
| **Gebäude** | PixelLab `house_office/forge/chart` + `lighthouse`, hoch aufgelöst, via `building()` mit Tiefe gerendert. | ✅ **Kohärent in Pixeldichte/Politur.** 2.5D (`high top-down`) für Gebäude ist **bewusste Ausnahme** (zeigt Dach + Tiefe wie Stardew bei Gebäuden, ermöglicht Depth-Sortierung). Leuchtturm = senkrechte Struktur → `view: side` korrekt. Entschieden in **#181** (2026-06-19). | – |
| **Schiff (Spieler)** | PixelLab `ship.png` (hoch aufgelöst, Hintergrund auf Transparenz freigestellt); ersetzt die früheren prozeduralen Primitive. | ✅ **Asset-seitig kohärent.** Aber Platzierungs-Bug: liegt auf einer Holz-Plattform statt im Wasser. | **#108** (Platzierung – kein Stilthema). |
| **Gegner (Krake, Piraten-Schiff)** | Rein prozedural mit `graphics` gemalt: Kraken-Körper `fillCircle/fillRect` (`scenes.ts` ~1046), Piraten-Rumpf `fillRect` (~1002). | ❌ **Stilbruch.** Code-Primitive statt Pixelart-Assets, fremde Formensprache. | Erfasst über **#53** (Nicht-Pixelart-Inventar + Per-Element-Tickets). |
| **NPCs / Figuren** | PixelLab-Chibi-Figuren, `view: low top-down`; ältere `size 32`, neuere `size 48`→48² runtergerechnet mit gleicher Körperhöhe/Fußlinie. | ✅ **Kohärent.** Gemischte Generierungs-Größen, aber auf gleiche Höhe/Origin normalisiert (siehe `assets/pixellab/README.md`). Beobachten, nicht ticketn. | – (Beobachtung) |
| **Deko-Objekte** | PixelLab `tree/pine/bush/rock/barrel/crate/well/stall/lamppost/mushroom/seashell/driftwood/sign…`, transparent, gleicher Stil. | ✅ **Kohärent.** Einzige Ausnahme ist das Gras (siehe oben). | – |
| **HUD / UI** | HTML/CSS-Overlays + Emojis (🪙 🔥 🕐 ⚓ …) für Münzen, Streak, Uhr, Menü, Funkgerät, Shop. | ❌ **Nicht-Pixelart.** Bricht die Welt-Optik; Emojis sind plattform-/font-abhängig. | Erfasst über **#53** (Emojis/HTML/CSS-Inventar). |

---

## Folge-Tickets

Fast alle Abweichungen sind bereits geführt – das Audit ordnet sie der Messlatte zu, dupliziert sie nicht:

| # | Bereich | Status |
|---|---|---|
| [#106](https://github.com/fluffels/kubernia/issues/106) | **Voraussetzung:** echte Stardew-Referenz sammeln → [`stardew-referenz.md`](stardew-referenz.md) | ✅ erledigt |
| [#107](https://github.com/fluffels/kubernia/issues/107) | Gras als echtes Pixelart (Re-Do von #40) | offen |
| [#53](https://github.com/fluffels/kubernia/issues/53) | Inventar aller Nicht-Pixelart-Grafiken (Gegner, HUD, Emojis) + Per-Element-Tickets | offen |
| [#108](https://github.com/fluffels/kubernia/issues/108) | Schiff schwimmt im Wasser statt auf Holz-Plattform (Platzierung) | offen |
| [#181](https://github.com/fluffels/kubernia/issues/181) | **Stil-Entscheidung Gebäude:** 2.5D (`high top-down`) vs. frontale `view: side`-Messlatte | ✅ entschieden: 2.5D bleibt (Stardew-konforme Ausnahme) |

Bewusst **kein** neues Ticket: Krake & Piraten-Schiff werden über das #53-Inventar
erfasst (sonst Doppelung); die gemischten NPC-Größen sind auf gleiche Höhe
normalisiert und bleiben Beobachtung.

---

## Verdikt

> **Ist die Optik durchgängig „Stardew-artig"? — Auf dem Weg, mit klar benannten Lücken.**

Das Fundament (Terrain, Objekte, Figuren, Gebäude-Politur) trägt den Stardew-Look
schon. Die verbleibenden „nicht nach Stardew"-Eindrücke sind **nicht** diffus,
sondern auf wenige, präzise Stilbrüche zurückführbar – prozedurale Platzhalter
(Gras, Gegner), die HTML/Emoji-UI und eine offene Blickachsen-Entscheidung bei
den Gebäuden. Werden diese Folge-Tickets (nach der Referenz-Recherche #106)
abgearbeitet, ist die Welt durchgängig kohärent. Die **Messlatte selbst** ist
mit diesem Ticket in `AGENTS.md` verbindlich verankert.
