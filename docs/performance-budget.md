# Performance-Budget (#82)

Leitfaden für die Laufzeit-Performance, wenn die Welt wächst (Stardew-Größe: große
Karten, viele Sprites/Deko). Ziel ist ein flüssiges Spiel auf Alltags-Hardware,
ohne dass die Sprite-Zahl unkontrolliert die Framerate frisst.

## Richtwerte (Budget)

| Größe | Ziel | Anmerkung |
|---|---|---|
| Framerate | **60 FPS** (min. 50 unter Last) | Phaser läuft mit `pixelArt`-Renderer; Einbrüche kommen v.a. von zu vielen gleichzeitig gezeichneten Objekten. |
| Gleichzeitig **gezeichnete** Deko-Sprites | **≤ ~400** | Das ist die Zahl *im Sichtfeld*, nicht die Gesamtzahl. Durch Culling bleibt sie auch bei dichter/größerer Karte ungefähr konstant, weil die Kamera (Zoom 3) nur einen Ausschnitt zeigt. |
| Gesamt-Deko auf der Karte | unkritisch | Off-screen-Deko ist ausgeblendet (`visible = false`) und kostet im Render-Pass praktisch nichts. |

## Maßnahmen

### 1. Off-screen-Culling (umgesetzt)

Statische Deko (Blumen, Gras-Büschel, Büsche, Steine, Laternen + Glühen, Pilze,
Muscheln, Treibholz, Bäume, Möbel) wird beim Anlegen über
`WorldScene.registerCullable()` registriert. Pro Frame (gedrosselt, nur bei
nennenswertem Kamera-Scroll) blendet `WorldScene.cullDecor()` alles außerhalb des
Sichtfelds aus und innerhalb wieder ein.

- Die reine Sichtfeld-Logik liegt Phaser-frei und getestet in
  [`src/hud/cull.ts`](../src/hud/cull.ts) (`expandRect`, `inView`, `cull`, `FrameSampler`).
- **Nur Optik:** Kollision (`solidGrid`) hängt **nicht** an der Sichtbarkeit – ein
  ausgeblendeter Baum bleibt solide.
- **Kein Pop-in:** Das Sichtfeld wird um `MARGIN = 4 × Kachel` erweitert, damit hohe
  Objekte (Bäume ragen weit über ihren Fuß-Anker) schon sichtbar sind, bevor der
  Anker ins Bild scrollt.

### 2. Cluster-Tag-Culling & -Pool (#416, umgesetzt)

Die Spielwelt **ist** der Cluster: bei großem Cluster (viele Deployments/Pods/Services)
entstehen hunderte dynamische Tags (`nginx 3/3`, `kasse`, …). Früher hielt
[`clustersync.ts`](../src/scenes/worldscene/clustersync.ts) **je Tag einen Phaser-
Container** vor und lief pro Frame über **alle** Tags (Nähe-Fade + O(n²)-Entzerrung) –
ein Frame-Killer, sobald das Spiel „groß" wird. Jetzt:

- **Tags sind Daten, keine Dauer-Objekte.** `scene.dynTags` hält nur Position/Text/
  Status. Nur die **wenigen JETZT sichtbaren** Tags bekommen pro Frame einen Container
  aus einem **wiederverwendeten Pool** (`scene.tagPool`, gedeckelt auf 64). Die Zahl der
  Tag-Render-Objekte wächst damit **nicht** mehr mit der Cluster-Größe.
- **Sichtfeld + Nähe entscheiden.** Welche Tags sichtbar sind, wählt die pure, getestete
  [`selectVisibleTags`](../src/hud/cull.ts): im (erweiterten) Sichtfeld UND im Aufdeck-Radius,
  nach Distanz gedeckelt. Off-screen-Tags werden **gar nicht** gerendert.
- **Entzerrung nur über die sichtbaren Tags** → die O(n²)-Label-Entzerrung (#207) ist aufs
  Sichtfeld begrenzt statt auf den ganzen Cluster.

**Beleg (Dev-Build, Playwright, `?perf`):** Cluster künstlich auf **300 Services**
aufgebläht → **300 Tag-Daten, aber nur 3 gerenderte Tags** (Pool 3), **60 FPS** gehalten,
keine Laufzeit-Fehler. Ohne den Umbau wären alle 300 Container gleichzeitig im
Display-Tree und würden pro Frame durchlaufen.

> **Bewusst noch offen (eigenes Ticket):** Die *dekorativen* dynGroup-Sprites (Helm-
> Flaggen je Release, Service-Laternen je Service) + ihre Dauer-Tweens skalieren weiter
> 1:1 mit dem Cluster. Das ist ein separater Render-Pfad (Objekt-Visualisierung, nicht
> „Tags") und in einem Folge-Ticket erfasst.

### 3. Lazy-Asset-Loading pro Insel (offen → eigenes Ticket)

Aktuell lädt die `BootScene` **alle** Assets aus dem `ASSET_MANIFEST` vorab. Das ist
sinnvoll, solange es genau **eine** Insel (Port Kubernia) gibt. Sinnvolles
Lazy-Loading pro Szene/Insel setzt voraus, dass es **mehrere** Inseln/Maps mit je
eigenen Assets gibt – das entsteht erst mit der Tiled-/Map-Registry-Arbeit
(#191–196, #57) und der Asset-Pipeline (#59). Darum ist dieser Teil als eigenes,
darauf aufbauendes Ticket ausgelagert (siehe Issue-Verweis in #82).

## Messen (Beleg vor/nach)

Zwei Debug-Schalter über die URL (nur Messung, kein Effekt aufs normale Spiel):

- `?perf` – blendet ein HUD ein: **FPS** + **„Sprites sichtbar X/Gesamt"** + Zahl der
  gecullten Sprites. Beim Herumlaufen sieht man, wie „sichtbar" beim Scrollen
  konstant niedrig bleibt, während „Gesamt" hoch ist.
- `?stress=N` – multipliziert die Deko-Dichte (Blumen + Gras) mit `N` (1–20). Damit
  lässt sich eine künstlich „vergrößerte"/dichtere Karte simulieren, ohne echten
  Karten-Umbau. Beispiel: `?perf&stress=10`.

**Beleg-Methode:** Mit `?perf&stress=10` öffnen, FPS + sichtbar/gesamt notieren,
herumlaufen. Ohne Culling würden *alle* (z.B. >1500) Sprites gezeichnet; mit Culling
bleibt „sichtbar" im niedrigen dreistelligen Bereich, die FPS halten das Budget.
