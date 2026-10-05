# Art Direction: Abweichungsliste gegen die Stardew-Messlatte

> 🧭 **Fachlich geprüft am: 2026-10-05.**

> Lebende Liste: wo die Optik von der Messlatte abweicht und was bewusst so bleibt. Die **Regeln** stehen in [`AGENTS.md` › Grafik-Stil](../AGENTS.md#konventionen), das **Vorbild** in [`stardew-referenz.md`](stardew-referenz.md), die Asset-Tokens in [`assets/pixellab/README.md`](../assets/pixellab/README.md). Der Juni-Schnappschuss [`art-direction-audit.md`](art-direction-audit.md) bleibt als Historie.
> Der laufende Status der Folge-Tickets steht in GitHub, nicht hier (Kopfzeilen-Konvention: [doku-vorlagen.md](referenz/doku-vorlagen.md)).

Gegliedert nach **Bereich bzw. Befund-Klasse**, nicht pro Asset. Wächst das Spiel, kommen Bereiche dazu, die Tabelle wird nicht pro Sprite länger.

## Abweichungen

| Bereich | Befund | Fundstelle (Modul) | Ticket |
|---|---|---|---|
| **Skalierung** | Krumme Faktoren statt ganzzahlig: rund 40 `setScale`-Aufrufe mit Dezimalfaktor auf hochaufgelösten Sprites, Kamera-Zoom 2.4 unter 900 px, `Clamp(fit, 2.4, 6)` im Innenraum. Mit `pixelArt: true` (Nearest-Neighbor) ungleichmäßige Pixeldichte. | `scenes/worldscene/scenery.ts`, `scenes/InteriorScene.ts`, `scenes/regions.ts`, `scenes/WorldScene.ts`, `scenes/RegionScene.ts` | [#1220](https://github.com/fluffels/kubernia/issues/1220) |
| **Emojis als Icon** | Titel und Hinweise der Regionen, Minispiel-Panels, Shop-Artikel, Ränge, Toasts, Funkgerät und Quiz nutzen Emojis als Icon. Plattform- und fontabhängig, bricht die Pixelart-Optik. | `scenes/regions.ts`, `ui/*` (Minispiele, Shop, Radio, Quiz), `content/data/shop.json`, `content/data/ranks.json`, `main.ts`, `scenes/worldscene/scenery.ts` (Welt-Marker im Canvas), `scenes/worldscene/events.ts` (Event-Toasts), `scenes/worldscene/clustersync.ts` (Status-Tags) | [#1222](https://github.com/fluffels/kubernia/issues/1222) |

## Kohärent (Stichprobe gegen den Code)

Terrain (Wang-Tilesets, `flat shading` seit #866), Gebäude (`low top-down`), Gegner, Kanone, Türen, Innenräume und HUD-Icons halten die Messlatte. Wird ein Bereich angefasst, gehört sein Befund in die Tabelle oben, nicht in diese Zeile.

## Bewusste Ausnahmen

Diese Abweichungen sind entschieden und kein Befund:

- **Dynamische Effekte** bleiben prozedural: Lichtkegel, Schatten, Tag-Nacht- und Sturm-Overlay, Banner, Fortschrittsflagge.
- **Ansicht:** die Aufteilung je Asset-Art (`low top-down` / `high top-down` / `side`) steht in [`stardew-referenz.md`](stardew-referenz.md) §6 (maßgeblich: Tokens je Asset-Art); sie entspricht der leicht erhöhten Schrägansicht des Vorbilds.
- **Figuren-Canvas** 32² bzw. 48² statt 16×32, auf gleiche Höhe und Fußlinie normalisiert.
- **Prozeduraler Tür-Fallback** in `makeDoor` (`scenes/worldscene/terrain.ts`): greift nur defensiv, alle Hafentüren haben ein Asset.
- **DOM-UI** (Dialog, Panels) mit Pixelrahmen statt Canvas-Rendering.
- **Emojis in Dialog-Prosa** (Quest- und Smalltalk-Texte) sind Sprache, kein Icon.

## So prüfst du nach

Zahlen und Fundstellen veralten, das Rezept nicht. Ein Durchgang:

1. **Skalierung:** `setScale(` mit Dezimalzahl und `setZoom(` in `src/scenes` suchen.
2. **Primitive:** `fillRoundedRect`, `fillCircle`, `fillTriangle`, `add.ellipse`, `add.rectangle` in `src/scenes` suchen. Jede Stelle ist ein dynamischer Effekt (erlaubt) oder ein Platzhalter (Befund).
3. **Emojis:** `rg -n "\p{Extended_Pictographic}" src/ui src/scenes src/main.ts src/content/data` (Testszenen wie `TilemapTestScene` sind Rauschen). Icon-Funktion ist ein Befund, Dialog-Prosa nicht.
4. **Browser-Tour:** `npm run dev`, dann per `kqGame.scene.run(...)` Hafen (Tag, Nacht, Sturm), alle Regionen, Innenräume, HUD und Overlays ansehen, einmal auch in einem Fenster unter 900 px Breite.

Ergebnis: Tabelle oben anpassen, Datum in der Kopfzeile hochsetzen. Der PR, der einen Befund behebt, streicht im selben PR seine Zeile.
