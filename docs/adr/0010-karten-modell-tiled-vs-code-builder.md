# ADR 0010: Zwei Karten-Modelle bewusst nebeneinander (Tiled-Daten vs. Code-Builder)

> Architecture Decision Record. Format: Kontext → Problem → Entscheidung → Konsequenzen → Umsetzungsreihenfolge.
> Status: **akzeptiert** · Datum: 2026-07-23

## Status

**Akzeptiert.** Aufgeteilt aus #870 (iSAQB-Analyse 2026-07-14) als #957 – eine echte architektonische Weiche, die laut oberster Regel in [AGENTS.md](../../AGENTS.md) per Rückfrage mit der Maintainerin entschieden wurde, statt sie einseitig mitten in einer Umsetzung festzulegen.

## Kontext

Zwei Karten-Modelle existieren nebeneinander:

- **Hafen** – eine Tiled-Datenpipeline (`src/world/maps/harbormap.ts` + `mapregistry.ts`): `harborGeometry()` schreibt Boden-/Kollisionsraster imperativ in Code, `harborTiledMap()` serialisiert das nach `assets/maps/harbor.tmj`, der Datenpfad parst die Datei beim Laden zurück (`decodeHarborGround`). Türen/NPC-Standplätze liegen als Tiled-Objektlayer in derselben Datei.
- **Regionen** – prozedurale Code-Builder (`src/world/regions/*.ts`, sechs Regionen über die generische `RegionScene`, #427): `landLevel()` berechnet die Inselform aus elliptischem Abstand + Sinus-Wobble, dazu deterministischer Hash-Scatter für Bäume/Steine – zur Laufzeit berechnet, als pure Funktion unit-testbar.

Auf den ersten Blick wirkt das wie vermeidbare Redundanz zweier Wege, dieselbe Sache (eine begehbare Karte) zu bauen. Eine nähere Prüfung zeigt aber einen entscheidenden Fakt: **die Hafen-„Tiled"-Pipeline liefert heute keine echte Tiled-Editor-Bearbeitung.** `harbor.tmj` wird von Code generiert und von Code wieder gelesen – niemand öffnet die Datei im Tiled-Editor. Das eingebettete Tileset ist laut Code-Kommentar (`harbormap.ts:155-165`) ein reiner Schema-Platzhalter; gerendert wird ausschließlich über den Wang-Autotile-Renderer, denselben, den auch die Regionen nutzen.

## Die Kernfrage

- Konvergieren wir alles auf die Tiled-Pipeline (Regionen bekommen `.tmj`-Dateien), oder
- segnen wir bewusst zwei Pipelines ab (Tiled für bespoke Karten, Code-Builder für prozedurale Regionen)?

## Entscheidung

**Zwei Pipelines bleiben bestehen, mit einer klaren Grenzregel:**

- **Bespoke/handdesignt → Tiled-Datenpipeline.** Feste, von Hand platzierte Geometrie (Kai, Marktplatz, Stege) gehört ins Tiled-Datenformat.
- **Prozedural/parametrisch → Code-Builder.** Zur Laufzeit generierte, parametrisierte Geometrie (Insel-Form, Scatter) bleibt eine pure, testbare Funktion.
- **Der gemeinsame Unterbau bleibt geteilt**, nicht dupliziert: identische Bodencode-Semantik (`WATER`/`SAND`/`PATH`/`DOCK`/`STONE`), der Wang-Autotile-Renderer (aktuelle Code-Duplizierung zwischen `worldscene/terrain.ts` und `RegionScene.ts` ist bereits als eigenes Ticket #958 erfasst) und die Entity-Registry (#349) für NPCs/Objekte.

### Warum nicht konvergieren

1. **Kein realer Gewinn beim Hafen selbst.** Tiled wird heute nicht als Editier-Werkzeug genutzt, nur als Serialisierungsformat – das „wir haben doch schon Tiled"-Argument für Konvergenz ist schwächer, als es klingt.
2. **Echter Verlust bei den Regionen.** Sechs Regionen zu statischen `.tmj`-Dateien auszubacken würde `landLevel()` + deterministischen Scatter aufgeben (keine Parameter-Justierung mehr) und die puren `build()`-Unit-Tests verlieren – für ein Ergebnis, das (1) nicht liefert.
3. **Industrie-Präzedenz.** Ein Hybrid-Ansatz – Kernlayout handdesignt, weniger kritische/variantenreiche Teile prozedural generiert – ist gängige Praxis in tile-basierten 2D-Spielen (Stardew selbst: Farm/Städte handgezeichnet, Minen/Skull-Cavern prozedural).
4. **Die Tiled-Pipeline ist Vorstufen-Infrastruktur, keine Fehlinvestition.** Genau wie Content-as-Data (#348) erst Schema + Loader gebaut hat, bevor Nicht-Entwickler wirklich Content beisteuern konnten, legt die `.tmj`-Serialisierung die Datenform schon jetzt fest – für den Tag, an dem tatsächlich jemand eine bespoke Karte im Tiled-Editor zeichnen will, ohne dass dafür nochmal ein Format-Umbau nötig wäre.

### Was bewusst *nicht* entschieden wird

- **Kein Migrations-Epic.** Da keine Konvergenz beschlossen ist, entsteht keine Folge-Arbeit an den bestehenden Pipelines selbst.
- **Kein Zeitpunkt für „echtes" Tiled-Hand-Editing.** Ob/wann ein Nicht-Entwickler tatsächlich im Tiled-Editor arbeiten soll, ist eine eigene, spätere Entscheidung (neues Ticket, falls der Bedarf entsteht).

## Konsequenzen

**Positiv**
- Beide Modelle behalten die Eigenschaft, die sie am besten können: der Hafen bleibt exakt/handplatzierbar, Regionen bleiben parametrisch/prozedural und pur unit-testbar.
- Kein Aufwand für eine Migration, die keinen technischen Gewinn brächte.
- Die Grenzregel (bespoke→Tiled, prozedural→Code) ist jetzt explizit – künftige Tickets müssen die Frage nicht neu aufrollen.

**Negativ / Aufwand**
- Zwei Pipelines bleiben im Kopf zu halten; die geteilten Teile (Renderer, Bodensemantik, Entity-Registry) müssen diszipliniert geteilt bleiben, sonst driften sie doch auseinander (siehe #958 für den aktuellen Renderer-Diskrepanz-Fall).
- Eine neue bespoke Karte braucht weiterhin die Tiled-Serialisierungs-Schritte (Geometrie → `.tmj` → Loader), auch wenn niemand die Datei von Hand editiert.

## Verwandte ADRs

- [ADR 0004 – Skalierungs-Fundament](0004-skalierungs-fundament.md): Diese Entscheidung folgt derselben Content-as-Data-Logik (Datenform zuerst, Nicht-Entwickler-Workflow später) für die Karten-Ebene.
- [ADR 0001 – Engine Phaser](0001-engine-phaser.md): unberührt – beide Karten-Modelle laufen in der Phaser-freien Domänenschicht (`build()`/`harborGeometry()` sind pur).
