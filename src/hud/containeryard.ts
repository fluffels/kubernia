// Container-Hof-Layout (#303): wohin die Docker-Fässer im Hafen gehören. Laufende
// Container liegen als Fässer am Dock bei Bo (Wasserkante), gestoppte wandern in den
// Lagerschuppen ein Stück östlich auf dem Kai – so wird „gestoppt ≠ gelöscht"
// (docker ps -a) sichtbar. Reine, Phaser-freie Präsentations-Geometrie (wie viewdecide/
// cull): EINE Quelle für die Fass-Positionen (clustersync) UND den Schuppen (scenery),
// damit beide nicht driften; die Kachel→Pixel-Umrechnung (× T + 8) macht der Aufrufer.

/** Fass-Reihe am Dock bei Bo (laufende Container). `x0`/`y` in Kacheln, `cols` Fässer
 *  je Reihe, `colStep` Kachel-Abstand. Werte = bisheriges Dock-Layout (unverändert). */
export const CONTAINER_DOCK = { x0: 4, y: 26, cols: 5, colStep: 2 } as const;

/** Lagerschuppen für gestoppte Container. Wie `CONTAINER_DOCK`, plus der Schuppen-
 *  Fußabdruck `shed` (Kacheln) für die Code-Optik (PixelLab-Asset folgt als Ticket). */
export const CONTAINER_LAGER = {
  x0: 15, y: 25, cols: 4, colStep: 1.5,
  shed: { x: 14.5, y: 22.6, w: 6, h: 2.4 },
} as const;

/** Kachel-Position des `k`-ten Fasses SEINER Gruppe: laufende → Dock, gestoppte →
 *  Lagerschuppen. `k` zählt je Gruppe ab 0 (nicht der globale Container-Index), damit
 *  jede Gruppe eng gepackt ab ihrem Anker beginnt. Reihen brechen nach `cols` um. */
export function containerBarrelTile(running: boolean, k: number): { x: number; y: number } {
  const lay = running ? CONTAINER_DOCK : CONTAINER_LAGER;
  return { x: lay.x0 + (k % lay.cols) * lay.colStep, y: lay.y };
}
