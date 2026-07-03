/* ===== KubeQuest – Szenen-Geometrie-/Hitbox-Konstanten (scenes/geometry.ts) =====
 * #590 (iSAQB Präsentation). EINE Quelle für die Geometrie-/Hitbox-Maße, die vorher
 * über die Szenen verstreut und mehrfach byte-gleich standen: der Sub-Tile-Hitbox-
 * Radius lag als `NPC_HIT_R`/`ROCK_HIT_R`/`BUSH_HIT_R` (WorldScene.ts), `HIT_R`
 * (RegionScene.ts) UND `HIT_R` (regions.ts) fünfmal identisch da; die Pod-Steg-/Tag-
 * Layout-Konstanten (`SLOTS_PER_PIER`/`TAG_CAP` …) lokal in clustersync.ts. Bei
 * Stardew-Scope (viele Regionen/Szenen) driften solche Kopien leicht auseinander –
 * darum hier zentral.
 *
 * Reine Zahlen-Konstanten der Präsentations-Schicht (kein Phaser/DOM): sie sagen, WIE
 * groß eine Hitbox ist bzw. WIE das Cluster-Layout gerastert wird – nicht, wie es
 * gerendert wird. Die Kollisions-Fabriken selbst (`circleHitbox`/`npcHitboxes`) leben
 * in der puren Domäne (`world.ts`); die Radien sind die Präsentations-Wahl davor.
 */

// ── Sub-Tile-Kollisions-Hitboxen (#343/#386) ────────────────────────────────
/** Radius (Welt-Pixel) der runden Sub-Tile-Hitbox um den Mittelpunkt von NPCs,
 *  Steinen, Büschen und Lager-Fässern: man gleitet weich an der runden Silhouette
 *  vorbei, statt eckig am vollen 16×16-Quadrat abzuprallen. In ALLEN Szenen gleich. */
export const HIT_R = 6;

/** Hafenlaternen sind schmale Pfosten: kleines, dünnes Rechteck (Breite × Höhe)
 *  statt Kreis, damit man dicht am Pfosten vorbeikommt (#386). */
export const LAMP_HIT: readonly [number, number] = [6, 10];

/** Lager-Kisten: mittig in der Kachel eingerücktes Quadrat (Kantenlänge). Fässer
 *  bleiben rund (`HIT_R`); die Kiste ist das eckige Gegenstück (#386). */
export const CRATE_HIT = 12;

// ── Cluster→Welt-Sync: Pod-Steg-Belegung + Tag-Rendering (#416/#523) ─────────
/** Slots je Steg: 2 Spalten × 6 Reihen = 12. Bei mehr Pods als Stege×12 wird nicht
 *  auf Slot 0 zurückgefallen (Überlagerung, #523), sondern eine weitere „Seite"
 *  darunter gestapelt – die Slot-Vergabe ist dynamisch, nicht fix. */
export const SLOTS_PER_PIER = 12;

/** Höchstzahl gleichzeitig gerenderter Cluster-Tags (#416). Der Aufdeck-Radius
 *  begrenzt die realistisch sichtbaren Tags ohnehin; der Deckel ist die harte
 *  Garantie, dass Pool-Größe + O(n²)-Entzerrung auch bei sehr dichtem Cluster
 *  konstant bleiben. Mehr als CAP Tags im Radius → die NÄCHSTEN gewinnen. */
export const TAG_CAP = 64;

/** Nähe-Aufdeckung der dynamischen Tags (Welt-Pixel): voll sichtbar bis `REVEAL_FULL`,
 *  ausgeblendet ab `REVEAL_FADE`. */
export const REVEAL_FULL = 42;
export const REVEAL_FADE = 84;
