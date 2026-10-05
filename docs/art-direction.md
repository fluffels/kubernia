# Art Direction: Abweichungsliste gegen die Stardew-Messlatte

> 🧭 **Fachlich geprüft am: 2026-10-05.**

> Lebende Liste: wo die Optik von der Messlatte abweicht und was bewusst so bleibt. Die **Regeln** stehen in [`AGENTS.md` › Grafik-Stil](../AGENTS.md#konventionen), das **Vorbild** in [`stardew-referenz.md`](stardew-referenz.md), die Asset-Tokens in [`assets/pixellab/README.md`](../assets/pixellab/README.md). Der Juni-Schnappschuss [`art-direction-audit.md`](art-direction-audit.md) bleibt als Historie.
> Der laufende Status der Folge-Tickets steht in GitHub, nicht hier (Kopfzeilen-Konvention: [doku-vorlagen.md](referenz/doku-vorlagen.md)).

Gegliedert nach **Bereich bzw. Befund-Klasse**, nicht pro Asset. Wächst das Spiel, kommen Bereiche dazu, die Tabelle wird nicht pro Sprite länger.

## Abweichungen

| Bereich | Befund | Fundstelle (Modul) | Ticket |
|---|---|---|---|
| **Skalierung** | Krumme Faktoren statt ganzzahlig: rund 40 `setScale(0.x)`-Aufrufe auf hochaufgelösten Sprites, Kamera-Zoom 2.4 unter 900 px, `Clamp(fit, 2.4, 6)` im Innenraum. Mit `pixelArt: true` (Nearest-Neighbor) ungleichmäßige Pixeldichte. | `scenes/worldscene/scenery.ts`, `scenes/InteriorScene.ts`, `scenes/regions.ts`, `scenes/WorldScene.ts`, `scenes/RegionScene.ts` | [#1220](https://github.com/fluffels/kubernia/issues/1220) |
| **Prozedurale Platzhalter** | Primitive, wo ein Asset hingehört: Schiffs-Luke außen (das Asset `ship_hatch` existiert und wird innen schon genutzt), Münz-Textur, grauer Felssockel unter dem Leuchtturm, Innenraum-Mast. | `scenes/worldscene/scenery.ts`, `scenes/shared.ts`, `scenes/regions.ts`, `scenes/InteriorScene.ts` | [#1221](https://github.com/fluffels/kubernia/issues/1221) |
| **Emojis als Icon** | Titel und Hinweise der Regionen, Minispiel-Panels, Shop-Artikel, Ränge, Toasts, Funkgerät und Quiz nutzen Emojis als Icon. Plattform- und fontabhängig, bricht die Pixelart-Optik. | `scenes/regions.ts`, `ui/*` (Minispiele, Shop, Radio, Quiz), `content/data/shop.json`, `content/data/ranks.json`, `main.ts` | [#1222](https://github.com/fluffels/kubernia/issues/1222) |

## Kohärent (Stichprobe gegen den Code)

Terrain (Wang-Tilesets, `flat shading` seit #866), Gebäude (`low top-down`), Gegner, Kanone, Türen, Innenräume und HUD-Icons halten die Messlatte. Wird ein Bereich angefasst, gehört sein Befund in die Tabelle oben, nicht in diese Zeile.

## Bewusste Ausnahmen

Diese Abweichungen sind entschieden und gelten auch dann, wenn einzelne Tickets geschlossen sind:

- **Dynamische Effekte** bleiben prozedural: Lichtkegel, Schatten, Tag-Nacht- und Sturm-Overlay, Banner, Fortschrittsflagge.
- **Ansicht:** Figuren und Gebäude `low top-down`, Boden und flache Objekte `high top-down`, senkrechte Strukturen, Türen und Icons `side`. Das entspricht der leicht erhöhten Schrägansicht des Vorbilds; Tokens je Asset-Art in [`stardew-referenz.md`](stardew-referenz.md) §6.
- **Figuren-Canvas** 32² bzw. 48² statt 16×32, auf gleiche Höhe und Fußlinie normalisiert.
- **DOM-UI** (Dialog, Panels) mit Pixelrahmen statt Canvas-Rendering.
- **Emojis in Dialog-Prosa** (Quest- und Smalltalk-Texte) sind Sprache, kein Icon.

## So prüfst du nach

Zahlen und Fundstellen veralten, das Rezept nicht. Ein Durchgang:

1. **Skalierung:** `setScale(` mit Dezimalzahl und `setZoom(` in `src/scenes` suchen.
2. **Primitive:** `fillRoundedRect`, `fillCircle`, `fillTriangle`, `add.ellipse`, `add.rectangle` in `src/scenes` suchen. Jede Stelle ist ein dynamischer Effekt (erlaubt) oder ein Platzhalter (Befund).
3. **Emojis:** Zeichenklasse `\p{Extended_Pictographic}` in `src/ui`, `src/scenes`, `src/main.ts` und `src/content/data` suchen. Icon-Funktion ist ein Befund, Dialog-Prosa nicht.
4. **Browser-Tour:** `npm run dev`, dann per `kqGame.scene.run(...)` Hafen (Tag, Nacht, Sturm), alle Regionen, Innenräume, HUD und Overlays ansehen, einmal auch in einem Fenster unter 900 px Breite.

Ergebnis: Tabelle oben anpassen, Datum in der Kopfzeile hochsetzen.
