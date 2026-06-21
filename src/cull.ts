/* ===== Off-screen-Culling & FPS-Messung (Phaser-frei, pur testbar) – #82 =====
 * Performance-Budget für wachsende Karten: Bei Stardew-Größe (viele Sprites/Deko)
 * soll nur das *Sichtbare* gezeichnet werden. Die reine Entscheidung „liegt
 * Objekt X im (erweiterten) Sichtfeld?" lebt hier – ohne Phaser, damit sie wie
 * world.ts/decor.ts im Node-Test prüfbar ist. scenes.ts hält die Phaser-Objekte
 * und ruft cull() pro (gedrosseltem) Frame mit der Kamera-Sicht auf.
 *
 * Wichtig: Culling ist *nur Optik*. Kollision (solidGrid) hängt nicht an der
 * Sichtbarkeit – ein ausgeblendeter Baum bleibt solide.
 */

/** Achsen-ausgerichtetes Rechteck in Welt-Pixeln (kompatibel zu Phaser.Geom.Rectangle). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Das Minimum, das cull() von einem Render-Objekt braucht: ein setz-/lesbares
 *  `visible`-Flag. Phaser-GameObjects erfüllen das; im Test reicht ein `{visible}`. */
export interface Visible {
  visible: boolean;
}

/** Ein cullbares Deko-/Sprite-Objekt mit fester Welt-Position (Anker-Pixel). */
export interface Cullable {
  /** Welt-x des Ankerpunkts (Pixel) */
  x: number;
  /** Welt-y des Ankerpunkts (Pixel) */
  y: number;
  /** das Render-Objekt, dessen Sichtbarkeit getoggelt wird */
  obj: Visible;
}

/** Sichtfeld um `margin` Pixel nach allen Seiten erweitern. Der Rand verhindert
 *  „Pop-in": Objekte werden schon sichtbar, *bevor* sie hereinscrollen, und erst
 *  ausgeblendet, wenn sie ein Stück draußen sind. `margin` muss mindestens so
 *  groß sein wie das höchste Objekt (Bäume ragen weit über ihren Fuß-Anker). */
export function expandRect(view: Rect, margin: number): Rect {
  return {
    x: view.x - margin,
    y: view.y - margin,
    width: view.width + margin * 2,
    height: view.height + margin * 2,
  };
}

/** Liegt der Punkt (px,py) im Rechteck (Kanten inklusive)? */
export function inView(px: number, py: number, r: Rect): boolean {
  return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
}

/** Blendet alle Cullables außerhalb von `bounds` aus und innerhalb wieder ein.
 *  Setzt `visible` nur, wenn es sich ändert (spart Phaser-Flag-Arbeit), und gibt
 *  zurück, wie viele sichtbar sind – die Zahl füttert das Performance-HUD. */
export function cull(items: Cullable[], bounds: Rect): number {
  let visible = 0;
  for (const it of items) {
    const vis = inView(it.x, it.y, bounds);
    if (it.obj.visible !== vis) it.obj.visible = vis;
    if (vis) visible++;
  }
  return visible;
}

/* ===== Sichtbare Cluster-Tags wählen (#416) =====
 * Die dynamischen Cluster-Tags (Pod-/Deployment-/Service-Labels) dürfen bei großem
 * Cluster (Stardew-Scope: hunderte Entities) nicht alle gleichzeitig gerendert und
 * pro Frame neu entzerrt werden – das wäre ein Frame-Killer. Diese reine Funktion
 * wählt aus ALLEN registrierten Tags die wenigen, die JETZT wirklich dargestellt
 * werden: im Sichtfeld UND nah genug an der Figur, gedeckelt auf eine feste Zahl.
 * Phaser-frei (wie der restliche cull.ts-Kern), darum im Node-Test prüfbar. */

/** Ein Cluster-Tag aus Sicht der Auswahl: nur sein Bezugspunkt in Welt-Pixeln. */
export interface TagAnchor {
  /** Welt-x des Bezugs-Objekts (Distanz zur Figur + Sichtfeld-Prüfung). */
  ax: number;
  /** Welt-y des Bezugs-Objekts. */
  ay: number;
}

/** Auswahl-Ergebnis für ein sichtbares Tag. */
export interface VisibleTag {
  /** Index in der übergebenen Tag-Liste. */
  i: number;
  /** Ziel-Transparenz (0..1) aus der Nähe-Aufdeckung. */
  alpha: number;
  /** Distanz zur Figur (Pixel) – nach ihr wird beim Deckeln gereiht. */
  dist: number;
}

/** Parameter der Nähe-Aufdeckung + Mengen-Deckel. */
export interface TagRevealOpts {
  /** Distanz (px), bis zu der ein Tag voll sichtbar ist (alpha = 1). */
  full: number;
  /** Distanz (px), ab der ein Tag ganz ausgeblendet ist (nicht mehr gewählt). */
  fade: number;
  /** Höchstzahl gleichzeitig dargestellter Tags – deckelt Render-/Entzerr-Aufwand. */
  cap: number;
}

/**
 * Wählt die JETZT darzustellenden Cluster-Tags – der Kern des #416-Cullings.
 *
 * Ein Tag kommt nur durch, wenn sein Bezugspunkt (1) im (erweiterten) Sichtfeld
 * `view` liegt – sonst wird es gar nicht gerendert – UND (2) näher als `fade` an der
 * Figur ist. Das Ziel-Alpha fadet linear zwischen `full` (=1) und `fade` (→0). Die
 * Treffer werden nach Distanz sortiert (nächste zuerst, bei Gleichstand der kleinere
 * Index) und auf `cap` gedeckelt. Dadurch bleiben Renderkosten UND die O(n²)-
 * Entzerrung konstant, egal wie groß der Cluster wird.
 *
 * Deterministisch und pur: gleiche Eingabe → gleiche Ausgabe.
 */
export function selectVisibleTags(
  tags: readonly TagAnchor[],
  player: { x: number; y: number },
  view: Rect,
  opts: TagRevealOpts,
): VisibleTag[] {
  const span = opts.fade - opts.full;
  const out: VisibleTag[] = [];
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (!inView(t.ax, t.ay, view)) continue; // außerhalb Sichtfeld → nicht rendern
    const dist = Math.hypot(t.ax - player.x, t.ay - player.y);
    if (dist >= opts.fade) continue; // außerhalb Aufdeck-Radius
    const alpha = dist <= opts.full ? 1 : span > 0 ? 1 - (dist - opts.full) / span : 1;
    out.push({ i, alpha, dist });
  }
  out.sort((a, b) => a.dist - b.dist || a.i - b.i); // nächste zuerst
  return opts.cap >= 0 && out.length > opts.cap ? out.slice(0, opts.cap) : out;
}

/** Rollender FPS-Mittelwert über die letzten `size` Frame-Deltas – fürs
 *  Performance-HUD/Budget. Pur (nimmt nur das Delta in ms entgegen), daher im
 *  Node-Test prüfbar. Nicht-positive Deltas werden ignoriert (erster Frame,
 *  pausierter Tab), damit der Mittelwert nicht durch 0 entgleist. */
export class FrameSampler {
  private samples: number[] = [];
  private readonly size: number;

  constructor(size = 30) {
    this.size = Math.max(1, Math.floor(size));
  }

  /** Ein Frame-Delta (ms) aufnehmen; hält das Fenster auf `size` Werte begrenzt. */
  push(deltaMs: number): void {
    if (!(deltaMs > 0)) return;
    this.samples.push(deltaMs);
    if (this.samples.length > this.size) this.samples.shift();
  }

  /** Gerundete mittlere Bilder/Sekunde über das aktuelle Fenster (0, solange leer). */
  get fps(): number {
    if (this.samples.length === 0) return 0;
    const avg = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    return avg > 0 ? Math.round(1000 / avg) : 0;
  }

  /** Wie viele Frames stecken aktuell im Fenster (0..size). */
  get frames(): number {
    return this.samples.length;
  }
}
