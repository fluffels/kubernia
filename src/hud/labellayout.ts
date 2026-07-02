/* Label-Layout (#207): deterministisches Entzerren sich überlappender In-Welt-Beschriftungen.
 *
 * Problem: Im Cluster-/Node-Bereich liegen die digitalen Pod-/Container-Tags
 * (z.B. `nginx-43`, `rabbitmq-90b1`) und die festen Holz-Schilder (`ahoi-control`,
 * `Bos Dock` …) so dicht beieinander, dass sich ihre Texte überlagern und
 * unlesbar werden. Diese Schicht ist bewusst **Phaser-frei** (rein Geometrie auf
 * Rechtecken), damit sie im Node-Test prüfbar ist; `scenes.ts` füttert sie mit den
 * aktuell sichtbaren Tag-Boxen + den festen Schildern und wendet die Versätze an.
 *
 * Verfahren: Boxen, die sich horizontal überschneiden, werden vertikal nach OBEN
 * auseinandergeschoben (Tags sitzen ohnehin über ihrem Objekt – nach oben ist die
 * natürliche Ausweichrichtung). Feste Schilder (`movable: false`) bleiben stehen
 * und dienen nur als Hindernis; bewegliche Tags weichen ihnen aus. */

/** Eine zu platzierende Beschriftung. (x,y) ist der **Mittelpunkt**, (w,h) die Maße.
 *  `movable: false` markiert ein festes Hindernis (z.B. Holz-Schild), das nicht
 *  verschoben wird – Default ist beweglich. */
export interface LayoutBox {
  x: number;
  y: number;
  w: number;
  h: number;
  movable?: boolean;
}

/** Prüft, ob sich zwei Boxen auf der x-Achse überschneiden (ihre Spalten teilen). */
function overlapsX(a: { x: number; w: number }, b: { x: number; w: number }): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2;
}

/** Eine bereits endgültig platzierte Box (festes Hindernis oder schon entzerrter Tag). */
interface Placed { x: number; w: number; top: number; bottom: number }

/** Höchste (kleinstes `top`) bereits platzierte Box, die die Box `b` an vertikaler
 *  Position `y` horizontal überlappt UND vertikal (inkl. `gap`) berührt. `Infinity`,
 *  wenn `y` frei ist – dann muss `b` nicht weiter angehoben werden. Ausgelagert aus
 *  der Relaxations-Schleife, damit deren Verschachtelung flach bleibt (max-depth). */
function highestCollidingTop(b: LayoutBox, y: number, placed: Placed[], gap: number): number {
  let liftedTop = Infinity;
  for (const p of placed) {
    const touches = overlapsX(b, p) && y - b.h / 2 < p.bottom + gap && y + b.h / 2 > p.top - gap;
    if (touches && p.top < liftedTop) liftedTop = p.top;
  }
  return liftedTop;
}

/**
 * Schiebt sich horizontal überlappende Boxen vertikal nach oben auseinander.
 *
 * Gibt je Eingabe-Box (gleiche Reihenfolge!) den y-Versatz `dy` zurück, der auf den
 * Mittelpunkt addiert werden muss, damit sich keine zwei horizontal überlappenden
 * Boxen mehr vertikal berühren. Nach oben heißt **negatives** `dy`. Feste Hindernisse
 * (`movable === false`) bekommen immer `dy = 0`.
 *
 * Deterministisch: gleiche Eingabe → gleiche Ausgabe. Boxen ohne horizontalen
 * Überlapp bleiben unverändert (`dy = 0`).
 *
 * @param boxes  Liste der Boxen (Mittelpunkt + Maße, optional `movable`).
 * @param gap    Mindest-Luft zwischen zwei entzerrten Boxen (px), Default 2.
 */
export function spreadLabelsVertically(boxes: LayoutBox[], gap = 2): number[] {
  const n = boxes.length;
  const dy = new Array<number>(n).fill(0);
  if (n <= 1) return dy;

  // Endgültig platzierte Boxen (feste + schon entzerrte) – als Hindernisse für die
  // jeweils nächste bewegliche Box.
  const placed: Placed[] = [];

  // Feste Hindernisse zuerst einhängen: sie bleiben stehen, also müssen bewegliche
  // Boxen ihnen ausweichen – egal in welcher y-Reihenfolge sie kommen.
  for (let i = 0; i < n; i++) {
    if (boxes[i].movable === false) {
      const b = boxes[i];
      placed.push({ x: b.x, w: b.w, top: b.y - b.h / 2, bottom: b.y + b.h / 2 });
    }
  }

  // Bewegliche Boxen von UNTEN nach OBEN abarbeiten (größtes y zuerst); bei Gleichstand
  // entscheidet der ursprüngliche Index → stabil und deterministisch.
  const movable = [];
  for (let i = 0; i < n; i++) if (boxes[i].movable !== false) movable.push(i);
  movable.sort((a, b) => boxes[b].y - boxes[a].y || a - b);

  for (const i of movable) {
    const b = boxes[i];
    let y = b.y;
    // Relaxation: solange diese Box eine horizontal überlappende, bereits platzierte
    // Box vertikal berührt, knapp darüber heben – und erneut prüfen. Das y sinkt
    // monoton (nur nach oben), also terminiert die Schleife; der Zähler ist nur ein
    // Sicherheitsnetz. Nötig, weil ein Hub die Box in eine WEITER oben liegende
    // Nachbar-Box schieben kann, die beim ersten Blick noch nicht im Weg war.
    for (let guard = 0; guard <= placed.length; guard++) {
      const liftedTop = highestCollidingTop(b, y, placed, gap);
      if (liftedTop === Infinity) break; // freie Lücke gefunden
      y = liftedTop - gap - b.h / 2;     // knapp über die höchste kollidierende Box
    }
    dy[i] = y - b.y;
    placed.push({ x: b.x, w: b.w, top: y - b.h / 2, bottom: y + b.h / 2 });
  }

  return dy;
}
