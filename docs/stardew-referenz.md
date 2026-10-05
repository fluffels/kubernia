# Stardew-Valley-Referenz: so sieht das Vorbild WIRKLICH aus (#106)

> 🧭 **Fachlich geprüft am: 2026-10-05.**

> **Pflichtlektüre vor jedem Optik-Ticket.** Hier steht das *echte* Vorbild fest —
> damit beim Umsetzen **gewusst** statt **geraten** wird (genau daran ist #40 gescheitert:
> „Stardew-Gras" wurde zu prozeduralen Dreieck-Halmen, weil niemand ein konkretes Vorbild vor Augen hatte).
>
> - Die **verbindliche Messlatte** (Regeln) steht in [`AGENTS.md` §Grafik-Stil](../AGENTS.md#konventionen) — Nordstern #44.
> - Wie die bestehende Optik gegen die Messlatte abschneidet: [`art-direction.md`](art-direction.md) (lebende Abweichungsliste; der Juni-Schnappschuss [`art-direction-audit.md`](art-direction-audit.md) ist Historie).
> - Wie wir Assets konkret erzeugen/ablegen: [`assets/pixellab/README.md`](../assets/pixellab/README.md).
> - **Dieses Dokument** liefert das fehlende Stück: *wie Stardew tatsächlich aussieht* — Raster, Palette, Outlines, Gras/Boden, und was das für PixelLab-Prompts heißt.

Stardew Valley wurde komplett von einer Person (Eric „ConcernedApe" Barone) in Pixelart gezeichnet. Der „warme, lebendige" Eindruck entsteht **nicht** aus einer hohen Auflösung, sondern aus **Disziplin**: ein einziges Raster, eine kohärente gedämpft-warme Palette, weiche getönte Outlines und **gestreute Detail-Sprites** statt geometrischer Platzhalter.

---

## 1. Harte Fakten (gesichert, mit Quellen)

| Aspekt | Stardew Valley | Quelle | Unser Stand |
|---|---|---|---|
| **Basis-Raster** | **16×16 px** pro Tile (Boden, Items, Objekt-Bausteine) | [SV-Forum](https://forums.stardewvalley.net/threads/sprite-sizes-character-sheets-pixel-art.5597/) | ✅ 16px, deckt sich |
| **Runtime-Skalierung** | **×4 ganzzahlig**, Nearest-Neighbor (16px → 64px am Bildschirm) | [FreeGameSprites](https://freegamesprites.com/en/news/tile-size-2d-game-pixel-art-guide) | ⚠️ `pixelArt`-Renderer, aber krumme Skalierung/Zoom 2.4 im Bestand, siehe [art-direction.md](art-direction.md) |
| **Figur (Welt-Sprite)** | **16×32 px** (1×2 Tiles, Kopf+Körper hoch) | [SV-Forum](https://forums.stardewvalley.net/threads/sprite-sizes-character-sheets-pixel-art.5597/) | ⚠️ unsere Figuren auf 32²/48²-Canvas, gleiche Fußlinie — höher, aber konsistent |
| **NPC-Portrait** | **64×64 px** (separate Dialog-Brustbilder, nicht der Welt-Sprite) | [SV-Forum](https://forums.stardewvalley.net/threads/sprite-sizes-character-sheets-pixel-art.5597/) | – (wir haben keine Portraits, nur Welt-Sprites) |
| **Ansicht** | leicht erhöhte **Frontal-/Schrägansicht**; Figuren & Objekte werden **von vorn** gezeigt (keine echte Iso, keine reine Top-Down-Draufsicht) | Spielbeobachtung | Figuren/Gebäude `low top-down`, Boden/Objekte `high top-down`, Leuchtturm/Türen/Schild `side` (Gebäude seit #794 `low top-down`, #181 abgelöst) |
| **Technik** | Antialiasing (sparsam), **Dithering**, **Cluster** (zusammenhängende Farbflächen), **selective outlining** | [Lospec-Tutorial](https://lospec.com/pixel-art-tutorials/create-a-pixel-texture-stardew-valley-tileset-tutorial-1-by-etosurvival) | – |

**Merksatz:** Stardew ist **16px @ ×4**. Jede krumme Skalierung (1.5×, 2.3×) oder gemischte Pixeldichte (fein detailliertes Asset neben grobem) liest sich sofort als „nicht Stardew".

---

## 2. Palette: gedämpft, warm, kohärent

Stardew benutzt **keine** kleine Fixpalette (kein PICO-8). Es ist eine **größere, aber bewusst entsättigte und warme** Farbwelt mit **einheitlicher Licht-/Schattenrichtung** (Licht von oben-links). Pro Material reichen meist **3–4 Werte**: Grundton · Highlight · Schatten · (getönte) Outline.

**Prinzipien (das ist das Wichtige, wichtiger als exakte Hex):**
- **Entsättigt & warm:** keine Neon-/Reinfarben. Grün geht ins Oliv, Blau ins Graublau, alles hat einen leichten Erd-/Gelbstich.
- **Wenige Werte pro Fläche:** nicht jeder Pixel eine eigene Farbe — **Cluster** gleicher Farbe, Übergänge per **Dithering** statt weichem Verlauf.
- **Eine Lichtrichtung:** Highlights konsequent oben-links, Schatten unten-rechts — über **alle** Assets gleich.
- **Schatten = getönt, nicht nur dunkler:** Schattentöne ziehen leicht ins Blau/Violett, Highlights ins Warm-Gelb (kein reines Abdunkeln/Aufhellen desselben Farbtons).

**Arbeits-Anker-Palette** (repräsentativ für den Stardew-Look, deckt sich mit unseren bestehenden Tilesets; vor Pixelgenauigkeit gegen echte Screenshots gegenprüfen — siehe §6):

| Material | Highlight | Grundton | Schatten | Outline (getönt) |
|---|---|---|---|---|
| **Gras** | `#9cc05a` | `#74a23e` | `#4f7a30` | `#37562a` |
| **Erde / Weg** | `#c19a66` | `#9a6f43` | `#6f4a2c` | `#4a3120` |
| **Wasser** | `#6fb4cf` | `#3f86ad` | `#2b5f82` | `#1f4257` |
| **Holz (Steg/Deck)** | `#c08a52` | `#8f5e34` | `#5f3d22` | `#3f2817` |
| **Stein / Kai** | `#a39c8c` | `#74705f` | `#4d493f` | `#33302a` |
| **Sand** | `#ecd9a6` | `#cdb079` | `#a4884f` | `#6f5a34` |

> Das sind **Anker**, kein Diktat: neue Assets müssen sich in diese gedämpft-warme Familie einfügen, nicht exakt diese Hex treffen. Reingrelle Farben (`#00ff00`-Grün, Neon-Blau) sind raus.

---

## 3. Outlines & Shading (woran man „echtes" Pixelart erkennt)

- **Selective Outline statt durchgehender schwarzer Kontur.** Außenkanten bekommen eine dunkle, **zum Material getönte** Linie (dunkles Braungrün ums Gras, dunkles Blau ums Wasser) — **nie reines `#000000`** rundherum. Innen-Outlines werden weggelassen, wo Form/Schatten schon trennt → das „weiche", nicht-comichafte Aussehen.
- **Cluster, keine Einzelpixel-Sprenkel.** Farbflächen sind zusammenhängend; Detail entsteht aus 2–4-Pixel-Gruppen, nicht aus zufälligem Rauschen.
- **Dithering sparsam & gezielt** für Material-Übergänge und große Flächen, nicht flächendeckend.
- **Antialiasing nur an Schlüsselkanten**, von Hand — kein automatischer Weichzeichner (matscht das Pixelraster).

---

## 4. Gras & Boden — der konkrete Knackpunkt (warum #40 scheiterte)

So macht Stardew Wiesen „dicht/lebendig" — **das ist die Vorlage für #107**:

1. **Boden ist ein Tile mit echten Pixel-Varianten**, kein einfarbiges Feld: mehrere Grün-Nuancen im selben 16×16-Tile, ein paar dunklere Cluster als Büschel-Andeutung. Mehrere **Tile-Varianten** (3–5) werden gestreut, damit kein sichtbares Wiederhol-Muster entsteht.
2. **Detail-Sprites werden obendrauf gestreut**, nicht in den Boden gemalt: kleine **Grasbüschel, Unkraut, Blümchen, Steinchen, Zweige** als eigene transparente Mini-Objekte, dünn und zufällig platziert → erzeugt die „dichte Wiese" ohne Tile-Wiederholung.
3. **Saisonale Tönung**: derselbe Boden in Frühling/Sommer/Herbst/Winter nur umgefärbt (für uns nicht nötig, aber zeigt: ein gutes Boden-Tile trägt viel).

**Das heißt für uns:** Gras = **PixelLab-Tile-Set mit echten Pixel-Halmen** + ein paar gestreute Deko-Sprites (Büschel/Blume), die wir wie die bestehende Natur-Deko (`scatter()` in `scenes.ts`) verteilen. **Nicht** `g.fillTriangle(...)` — code-gemalte Vektordreiecke sind genau der Stilbruch aus #40/#107.

> Bestätigt durch die Stardew-Grass-Mods, die ausschließlich **PNG-Sprites** austauschen ([More Grass](https://www.nexusmods.com/stardewvalley/mods/5398)) — das Spiel selbst arbeitet sprite-/tilebasiert, nirgends prozedural-geometrisch.

---

## 5. Do / Don't (Schnell-Check fürs Asset)

**Do**
- Auf **16px-Raster** zeichnen, **×2/×3/×4** skalieren.
- **Gedämpfte, warme** Töne; 3–4 Werte pro Material; eine Lichtrichtung (oben-links).
- **Getönte selective Outlines** (dunkle Material-Farbe), Innenkanten sparsam.
- **Gestreute Detail-Sprites** für Dichte (Gras, Blumen, Steinchen).
- Große Objekte (Haus, Baum, Schiff) **hoch auflösen, dann ganzzahlig verkleinern** (PixelLab Tier 1 kann große Bilder).

**Don't**
- ❌ Krumme Skalierung (1.5×, 2.3×) oder **gemischte Pixeldichte** im selben Bild.
- ❌ **Durchgehende reinschwarze** Kontur (`#000000`) um alles.
- ❌ **Reingrelle/Neon-Farben**, kalte Knall-Sättigung.
- ❌ **Code-gezeichnete geometrische Platzhalter** (Dreieck-Gras, `fillRect`-Gegner), wo ein Asset hingehört. *Dynamische Effekte* (Leuchtturm-Lichtkegel, Tag-Nacht-Schleier, Glow) sind **kein** Platzhalter und bleiben Code.
- ❌ Weichzeichner/Auto-Antialiasing über das ganze Sprite.

---

## 6. Was das für PixelLab-Generierung heißt (Prompt-Bausteine)

Aligned mit [`assets/pixellab/README.md`](../assets/pixellab/README.md) — diese Stil-Tokens **immer** mitgeben:

- **Tiles/Terrain:** `16x16`, `flat shading`, `high top-down` (Terrain seit #866 flat); gedämpft-warme Palette; mehrere Tile-Varianten für Variation.
- **Figuren:** `low top-down`, `chibi`, `selective outline`, `high detail`, size 32, 4 Richtungen; gleiche Körperhöhe/Fußlinie wie Bestand.
- **Objekte:** `create_map_object`, transparent, `high top-down` (senkrechte Strukturen, Türen, Icons: `side`; Gebäude: `low top-down`), `selective outline`, `detailed shading`; Maßstab **Mensch = 1 Kachel (16px)** als Anker (Baum ~3 Kacheln, Busch ~1).
- **Palette im Prompt verankern:** „muted warm earthy palette, soft dark-tinted outlines (not pure black), single light source top-left" statt nur „Stardew style".
- **Groß generieren, klein rechnen:** Häuser/Bäume/Schiffe in hoher Auflösung, dann ganzzahlig verkleinern — nie klein generieren + hochskalieren.

---

## 7. Checkliste: „Ist es Stardew-Niveau?"

Ein neues/geändertes Asset besteht, wenn **alle** Punkte ✅ sind:

- [ ] Auf 16px-Raster gezeichnet, nur ganzzahlig skaliert (×2/×3/×4).
- [ ] Gleiche Pixeldichte wie die Nachbar-Assets (kein fein-neben-grob).
- [ ] Gedämpft-warme Palette, fügt sich in die Anker-Familie (§2) ein, keine Neon-Töne.
- [ ] Getönte selective Outline, keine reinschwarze Volllinie.
- [ ] Eine konsistente Lichtrichtung (oben-links), Schatten getönt (nicht nur dunkler).
- [ ] Dichte/Detail über **gestreute Sprites**, nicht über prozedurale Geometrie.
- [ ] Kanten scharf (kein Weichzeichner), Pixel ganzzahlig.

Wenn ein Punkt ❌ ist: nicht „nah genug" durchwinken — das sind genau die Abweichungen, die den Stardew-Eindruck kippen.

---

## Quellen

- [Stardew Valley Forum – Sprite Sizes / Character Sheets](https://forums.stardewvalley.net/threads/sprite-sizes-character-sheets-pixel-art.5597/) (16×16 Tiles, 16×32 Figur, 64×64 Portrait)
- [Stardew Valley Forum – Sprite size (First time modding)](https://forums.stardewvalley.net/threads/sprite-size-first-time-modding-sv.7128/)
- [FreeGameSprites – Tile-Size-Guide 16×16 vs 32×32](https://freegamesprites.com/en/news/tile-size-2d-game-pixel-art-guide) (×4-Skalierung, Nearest-Neighbor)
- [Lospec – Stardew-Valley-Tileset-Tutorial (ETOSurvival)](https://lospec.com/pixel-art-tutorials/create-a-pixel-texture-stardew-valley-tileset-tutorial-1-by-etosurvival) (Antialiasing, Dithering, Cluster, selective outlining)
- [Pixilart – Stardew-Valley-Palette](https://www.pixilart.com/palettes/stardew-valley-45323) (gedämpft-warme Töne als Referenz)
- [Nexus Mods – „More Grass" (Stardew)](https://www.nexusmods.com/stardewvalley/mods/5398) (Gras ist PNG-/sprite-basiert, nicht prozedural)
- [Stardew Valley Wiki – Grass](https://stardewvalleywiki.com/Grass)

## Die Messlatte in Kurzform (ausgelagert aus AGENTS.md › Grafik-Stil, #1064)

> Wörtlich aus [AGENTS.md](../AGENTS.md) ausgelagert (#1064): dort steht jetzt nur die knappe Regel, hier die Langbegründung + Historie. **Bei Konflikt gilt AGENTS.md.**

- **Grafik-Stil – Stardew-Look als verbindliche Messlatte (Nordstern, #44).** Das Spiel-Thema bleibt unser eigenes (DevOps/K8s-Hafen), aber **Qualität, Genauigkeit und Politur auf Stardew-Niveau** sind der verbindliche Maßstab für jede neue oder geänderte Grafik. Der Stardew-Look entsteht **nicht** aus einer bestimmten Rastergröße, sondern aus *Einheitlichkeit* + *ganzzahliger Skalierung*. Konkret prüfbar (das ist die „Messlatte" fürs Audit):
- **Einheitliche Pixeldichte:** alles auf demselben **16px-Raster** gezeichnet (Tiles 16×16, Figuren auf den etablierten 32²/48²-Canvas mit gleicher Körperhöhe/Fußlinie). **Kein gemischtes Auflösungs-Niveau** – fein detaillierte Assets direkt neben grob gerasterten wirken sofort „nicht Stardew".
- **Ganzzahlige Skalierung:** nur ×2/×3/×4 usw., **nie 1.5×/2.3×** – krumme Faktoren matschen die Kanten, der `pixelArt`-Renderer braucht ganze Pixel.
- **Leicht erhöhte Frontalansicht** wie das Vorbild. Pro Asset-Art: Figuren und Gebäude `low top-down` (Gebäude seit #794; die frühere Entscheidung #181 für `high top-down` ist abgelöst), Boden und Objekte `high top-down`, senkrechte Strukturen (Leuchtturm, Türen, Schilder) und Icons `side`. Gebäude via `building()` zeigen Dach und Tiefe und werden nach Fußlinie tiefensortiert.
- **Kohärente Palette:** gedämpfte, warme Stardew-nahe Farbwelt statt grell/neon, einheitliche Licht-/Schattenrichtung.
- **Keine simpel-prozeduralen Platzhalter dort, wo ein Asset hingehört:** code-gezeichnete Primitive (Dreieck-Grashalme, mit `graphics` gemalte Gegner/Boote) sind nur Übergangslösung und bekommen ein Asset-Ticket. *Dynamische Effekte* (rotierender Leuchtturm-Lichtkegel, Schatten/Glow, Tag-Nacht-Schleier) sind **kein** Platzhalter und bleiben bewusst Code.
- **Hoch auflösen, dann ganzzahlig verkleinern:** große Objekte (Häuser, Bäume, Schiff) in hoher Auflösung generieren (PixelLab-Abo Tier 1 erlaubt große Bilder) statt klein erzeugen + hochskalieren, damit der Renderer scharf bleibt.
