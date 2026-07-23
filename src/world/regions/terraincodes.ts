/* ===== Geteilte Terrain-Bodencodes der Regionen (Phaser-frei, pur testbar) =====
 * #959: vorher definierte jede Region ihre eigenen WATER/SAND/PATH/DOCK-Konstanten
 * (byte-gleich, #-2/-3/25/-10), und die generische RegionScene sowie
 * worldscene/terrain.ts importierten sie aus einer WILLKÜRLICHEN konkreten Region
 * (archipel.ts bzw. warehouse/watchtower/flotte/werft) statt aus einer neutralen
 * Quelle – eine fragile Namensabhängigkeit, die bei der 8./15. Region unpraktisch
 * würde. Diese Datei ist die EINE SSOT; jede Region importiert + re-exportiert von
 * hier, damit ihre bestehenden Imports/Tests unverändert bleiben.
 *
 * Bewusst importfrei (keine Abhängigkeit auf harbormap.ts o.ä.), sonst entstünde ein
 * Zyklus (harbormap importiert WORLD_JETTY aus archipel.ts). Die Werte sind identisch
 * zu den Hafenkarte-Konstanten in world/maps/harbormap.ts (PATH↔DIRT, DOCK↔PIER) –
 * per Pin-Test in test/terraincodes.test.ts gesichert; ob die Namen vereinheitlicht
 * werden, ist die separate ADR-Entscheidung #957.
 */
export const WATER = -2;
export const SAND = -3;
export const PATH = 25;
export const DOCK = -10;
