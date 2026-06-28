// Geteilte UI-Bausteine (#356, ui.ts-Split): read-only DOM-/Content-Helfer ($, esc, NPCS,
// SMALLTALK, shuffled, vorab geladene Porträt-/Shop-Bilder) und der part()-Helper, der die
// Domänen-Methodenbündel typisiert (this = UISelf, permissiv) – die öffentlichen Methoden-
// Signaturen bleiben dabei erhalten (ThisType-Muster). Präsentationsschicht (DOM).
import { KQContent } from "../content";
import { KQAssets } from "../assets-data";

/** this-Typ der UI-Methodenbündel: permissiv, da Methoden quer über Bündel auf this.* zugreifen.
 *  Bewusster ThisType-Escape-Hatch (analog `GameSelf` in game/shared.ts): die Index-Signatur
 *  lässt sich hier NICHT durch `unknown` ersetzen, weil sonst die quer aufgerufenen Methoden
 *  (this.foo()) nicht mehr aufrufbar wären (zirkulärer this-Typ). Darum hier – und nur hier –
 *  ein begründetes `any`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UISelf = Record<string, any>;
/** Typisiert ein Methodenbündel so, dass this = UISelf ist, ohne die Methoden-Signaturen zu verlieren. */
export function part<T>(b: T & ThisType<UISelf>): T { return b; }

// Die DOM-Knoten liegen alle fest in index.html – darum geben wir hier ein
// nicht-nullbares HTMLElement zurück (Migrations-Shim, wie window.* in vite-env.d.ts).
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

// NPC-/Smalltalk-Tabellen werden per NPC-Id (Laufzeit-String) nachgeschlagen –
// als String-indizierbare Maps typisiert, statt jeden Zugriff einzeln zu casten.
/** NPC-Stammdaten, wie sie die Porträt-/Dialog-Schicht braucht (Name, Titel, Sprite,
 *  optionale PixelLab-Textur). Eigener UI-Wert-Typ, damit Porträt-Helfer nicht `any` brauchen. */
export type UINpc = { name: string; title: string; sprite: number; tex?: string };
const NPCS = KQContent.NPCS as Record<string, UINpc>;
const SMALLTALK = KQContent.SMALLTALK as Record<string, string[]>;

/** Shop-Eintrag, wie ihn die Shop-/Vorlade-Schicht liest. Die Quell-Daten (content/progression.ts)
 *  sind ein heterogenes Objekt-Literal; dieser Typ macht die je nach Item-Art optionalen Felder
 *  (sprite/tex/color) explizit, statt jeden Zugriff per `any` zu öffnen. */
export interface UIShopItem {
  id: string;
  icon: string;
  name: string;
  price: number;
  type: string;
  desc: string;
  sprite?: number;
  tex?: string;
  color?: number;
}

function esc(s: unknown) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Befehls-Karten im Krabben-Quiz: so viele Tipp-Versuche, bevor die Lösung
// gezeigt und die Karte als "nicht gekonnt" gewertet wird (#234). Jederzeit
// kann man per "Lösung zeigen" früher aussteigen – man hängt also nie fest.
const CMD_MAX_ATTEMPTS = 3;

/** Kleines Lernstand-Abzeichen (#219) für ein Übungs-Konzept anhand seiner Leitner-Box
 *  (0 = nie geübt … 5 = sitzt). Macht „das kannst du schon / das üben wir nochmal" sichtbar.
 *  Reine Anzeige – die Box liefert `Game.masteryBox`. */
function masteryBadge(box: number): string {
  if (box <= 0) return '<span class="mastery-badge new">🆕 neu</span>';
  if (box <= 2) return '<span class="mastery-badge weak">🔁 üben wir nochmal</span>';
  if (box <= 4) return '<span class="mastery-badge mid">📈 fast sicher</span>';
  return '<span class="mastery-badge done">✅ sitzt</span>';
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Spritesheet-Bilder für Porträts (unabhängig von Phaser, geht auch per file://)
const sheetImgs: Record<string, HTMLImageElement> = {};
const assets = KQAssets as Record<string, string>;
for (const key of ["town", "dungeon"]) {
  const img = new Image();
  img.src = assets[key];
  sheetImgs[key] = img;
}
// PixelLab-NPC-Figuren fürs Dialog-Porträt vorladen (Kopf/Schulter-Ausschnitt)
for (const npc of Object.values(NPCS)) {
  if (npc.tex && assets[npc.tex] && !sheetImgs[npc.tex]) {
    const img = new Image();
    img.src = assets[npc.tex];
    sheetImgs[npc.tex] = img;
  }
}
// PixelLab-Shop-Grafiken (Haustiere) fürs Shop-Icon vorladen
for (const item of KQContent.SHOP as UIShopItem[]) {
  if (item.tex && assets[item.tex] && !sheetImgs[item.tex]) {
    const img = new Image();
    img.src = assets[item.tex];
    sheetImgs[item.tex] = img;
  }
}


export { $, esc, NPCS, SMALLTALK, CMD_MAX_ATTEMPTS, shuffled, masteryBadge, sheetImgs, assets };
