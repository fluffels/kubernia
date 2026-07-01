/* ===== KubeQuest – WorldScene-Cluster-Sync (worldscene/clustersync.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier wird der simulierte Cluster
 * (Game.sim) auf die sichtbare Hafenwelt gespiegelt: Pods als Kisten an den
 * Stegen (syncCluster), Deployment-/Docker-/Helm-/Service-Tags neu bauen bei
 * Änderung (rebuildDynamic) und die Nähe-Aufdeckung + Entzerrung der dynamischen
 * Tags (updateDynamicTags).
 *
 * Freie Funktionen mit der Szene als Parameter; der Cluster-Zustand bleibt in
 * Game.sim, die Render-Primitive (addShadow/makeTechTag/burstAt) auf der Szene.
 *
 * Performance bei großem Cluster (#416, Stardew-Scope): Die Tags werden NICHT mehr
 * je als eigener Container vorgehalten (das skalierte 1:1 mit der Entity-Zahl →
 * Frame-Killer). Stattdessen sind die Tags reine DATEN (`scene.dynTags`), und nur
 * die wenigen JETZT sichtbaren (im Sichtfeld + nah an der Figur, gedeckelt) bekommen
 * einen Container aus einem wiederverwendeten POOL (`scene.tagPool`). So bleibt die
 * Zahl der Tag-Render-Objekte UND die O(n²)-Entzerrung konstant, egal wie groß der
 * Cluster wird. Welche Tags sichtbar sind, entscheidet die pure, getestete Auswahl
 * `selectVisibleTags` in cull.ts.
 */
import Phaser from "phaser";
import { Game } from "../../game";
import { SFX } from "../../sfx";
import { spreadLabelsVertically, type LayoutBox } from "../../labellayout";
import { selectVisibleTags, expandRect } from "../../cull";
import { T, hashHue, hueColor, SIGN_FONT, SIGN_SCALE } from "../shared";
import type { WorldSceneLike } from "./types";

// Nähe-Aufdeckung: voll sichtbar bis FULL, ausgeblendet ab FADE (Welt-Pixel).
const REVEAL_FULL = 42;
const REVEAL_FADE = 84;
// Höchstzahl gleichzeitig gerenderter Tags. Der Aufdeck-Radius (FADE) begrenzt die
// realistisch sichtbaren Tags ohnehin auf wenige; der Deckel ist die harte Garantie,
// dass Pool-Größe + Entzerrung auch im pathologischen Fall (sehr dichter Cluster)
// konstant bleiben. Mehr als CAP Tags im Radius → die NÄCHSTEN gewinnen.
const TAG_CAP = 64;
// Sichtfeld fürs Tag-Culling großzügig erweitern, damit am Bildrand nichts aufpoppt
// (Tags ragen über ihren Bezugspunkt + werden beim Entzerren nach oben geschoben).
const TAG_VIEW_MARGIN = 2 * T;

function podSlotPos(scene: WorldSceneLike, slot: number) {
  const pier = scene.piers[Math.floor(slot / 12)];
  const i = slot % 12;
  const col = i % 2 === 0 ? 0 : 2;
  const row = Math.floor(i / 2);
  return { x: (pier.x + col) * T + 8, y: (28 + row) * T + 8 };
}

export function syncCluster(scene: WorldSceneLike) {
  if (!Game.sim) return;
  const pods = [];
  for (const d of Game.sim.deployments) for (const p of d.pods) pods.push({ name: p.name, dep: d.name });
  const names = new Set<string>(pods.map(p => p.name));

  for (const p of pods) {
    if (!scene.podSlots[p.name]) {
      let slot = scene.slotUsed.findIndex((u: boolean) => !u);
      if (slot === -1) slot = 0;
      scene.slotUsed[slot] = true;
      const pos = podSlotPos(scene, slot);
      const hue = hashHue(p.dep);
      const shadow = scene.addShadow(pos.x, pos.y + 7, 11);
      const crate = scene.add.image(pos.x, pos.y - 44, "crate").setScale(0.6).setDepth(pos.y + 8);
      const band = scene.add.image(pos.x, pos.y - 44 - 5, "px").setScale(6, 1.5).setTint(hueColor(hue)).setDepth(pos.y + 9);
      scene.tweens.add({ targets: [crate, band], y: "+=44", duration: 550, ease: "Bounce.easeOut",
        onComplete: () => scene.burstAt(pos.x, pos.y + 4, "dust") });
      scene.podSlots[p.name] = { slot, crate, band, shadow, dep: p.dep };
    }
  }
  for (const name of Object.keys(scene.podSlots)) {
    if (!names.has(name)) {
      const info = scene.podSlots[name];
      const pos = podSlotPos(scene, info.slot);
      scene.burstAt(pos.x, pos.y + 4, "splash");
      SFX.splash();
      info.crate.destroy(); info.band.destroy(); info.shadow.destroy();
      scene.slotUsed[info.slot] = false;
      delete scene.podSlots[name];
    }
  }

  // Kaputte Deployments: Kisten rot einfärben
  const brokenMap: Record<string, boolean> = {};
  for (const d of Game.sim.deployments) brokenMap[d.name] = !!d.broken;
  for (const info of Object.values(scene.podSlots) as { crate: Phaser.GameObjects.Image; dep: string }[]) {
    info.crate.setTint(brokenMap[info.dep] ? 0xff8d8d : 0xffffff);
  }

  // Signaturen: Fässer / Flaggen / Laternen / Deployment-Labels nur bei Änderung neu bauen
  const dSig = Game.sim.deployments.map(d => d.name + d.replicas + (d.broken ? d.broken.type : "")).join("|");
  const bSig = Game.sim.docker.containers.map(c => c.name + c.running).join("|");
  const fSig = Game.sim.releases.map(r => r.name + r.revision).join("|");
  const sSig = Game.sim.services.map(s => s.name).join("|");
  if (dSig !== scene.dynamic.depSig || bSig !== scene.dynamic.barrelsSig || fSig !== scene.dynamic.flagsSig || sSig !== scene.dynamic.svcSig) {
    scene.dynamic = { depSig: dSig, barrelsSig: bSig, flagsSig: fSig, svcSig: sSig };
    rebuildDynamic(scene);
  }

  // Terraform-Plateau & Bojen
  const applied = Game.sim.tf.applied;
  scene.tfGroup.setVisible(applied);
  scene.tfBuoys.forEach((b: Phaser.GameObjects.Image) => b.setVisible(Game.sim.tf.initialized && !applied));
  scene.cannon.setVisible(Game.hasUpgrade("kanone"));
}

export function rebuildDynamic(scene: WorldSceneLike) {
  scene.dynGroup.clear(true, true);
  // Tags sind reine Daten (#416): hier nur sammeln, NICHT je einen Container bauen.
  // (lx,ly) = Tag-Position, (ax,ay) = Bezugspunkt des Objekts (Distanz zur Figur +
  // Tiefen-Sortierung). `ty` ist die Basis-Position fürs Entzerren.
  scene.dynTags = [];
  const mkTag = (lx: number, ly: number, str: string, status: number, ax: number, ay: number, compact = false) => {
    scene.dynTags.push({ tx: lx, ty: ly, ax, ay, text: str, status, compact });
  };

  // Deployment-Tags über der ersten Kiste (kaputte rot mit Status!)
  const seen: Record<string, boolean> = {};
  for (const d of Game.sim.deployments) {
    const first = d.pods[0] && scene.podSlots[d.pods[0].name];
    if (first && !seen[d.name]) {
      seen[d.name] = true;
      const pos = podSlotPos(scene, first.slot);
      const text = d.broken
        ? d.name + " ⚠ " + (d.broken.type === "imagepull" ? "ImagePullBackOff" : d.broken.type === "crashloop" ? "CrashLoopBackOff" : "Pending")
        : d.name + " " + d.replicas + "/" + d.replicas;
      mkTag(pos.x, pos.y - 12, text, d.broken ? 0xff7b7b : 0x6fe09a, pos.x, pos.y);
    }
  }
  // Docker-Fässer bei Bo (max. 10 sichtbar, Tags versetzt gegen Überlappung)
  Game.sim.docker.containers.slice(-10).forEach((c, i) => {
    const bx = (4 + (i % 5) * 2) * T + 8, by = (26 + Math.floor(i / 5) * 0.0) * T + 8;
    const barrel = scene.add.image(bx, by, "barrel").setScale(0.5).setDepth(by + 8).setAlpha(c.running ? 1 : 0.45);
    scene.dynGroup.add(barrel);
    mkTag(bx, by - 9 - (i % 2) * 7, c.name, c.running ? 0x6fe09a : 0x8a98a8, bx, by, true);
  });
  // Helm-Flaggen an der Werft
  Game.sim.releases.forEach((r, i) => {
    const pole = scene.flagPoles[i % scene.flagPoles.length];
    const fx = pole.x * T + 8, fy = pole.y * T;
    const mast = scene.add.image(fx, fy, "px").setScale(1, 15).setTint(0x6b5436).setDepth(fy + 30);
    const flag = scene.add.image(fx + 6, fy - 12, "px").setScale(6, 3.5).setTint(hueColor(hashHue(r.name))).setDepth(fy + 31);
    scene.tweens.add({ targets: flag, y: fy - 14, duration: 600, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    scene.dynGroup.add(mast); scene.dynGroup.add(flag);
    mkTag(fx + 4, fy - 18, r.name + " rev" + r.revision, 0x6fd0e6, fx, fy - 8);
  });
  // Service-Laternen am Dockrand
  Game.sim.services.forEach((s, i) => {
    const lx = (6 + i * 4) * T + 8, ly = 23 * T + 8;
    const post = scene.add.image(lx, ly + 2, "px").setScale(1, 6).setTint(0x5a4632).setDepth(ly + 8);
    const lamp = scene.add.image(lx, ly - 5, "px").setScale(3, 2.5).setTint(0xffdc78).setDepth(ly + 9);
    scene.tweens.add({ targets: lamp, alpha: { from: 0.55, to: 1 }, duration: 800, yoyo: true, repeat: -1 });
    scene.dynGroup.add(post); scene.dynGroup.add(lamp);
    mkTag(lx, ly - 10, s.name, 0x6fd0e6, lx, ly);
  });
}

/** Vergrößert den Tag-Pool bei Bedarf auf `n` (≤ TAG_CAP) wiederverwendbare
 *  Container. Die Pool-Container leben über die ganze Szene und werden NICHT in
 *  `dynGroup` gehängt (das wird bei jedem Cluster-Wechsel geleert – der Pool nicht). */
function ensureTagPool(scene: WorldSceneLike, n: number) {
  const need = Math.min(n, TAG_CAP);
  while (scene.tagPool.length < need) {
    const cont = scene.makeTechTag(0, 0, "", 0x6fe09a, false) as Phaser.GameObjects.Container;
    // Die native (nicht-compacte) Schriftgröße einmal merken, um beim Wiederverwenden
    // zwischen compact/normal korrekt umschalten zu können.
    if (scene.tagFontDefault == null) scene.tagFontDefault = (cont.list[1] as Phaser.GameObjects.BitmapText).fontSize;
    cont.setVisible(false);
    scene.tagPool.push(cont);
  }
}

/** Setzt einen Pool-Container auf die Daten eines Tags um (Text/Status/Position/
 *  Größe/Transparenz). Re-Sizing des Hintergrund-Panels analog zu makeTechTag. */
function applyTag(scene: WorldSceneLike, cont: Phaser.GameObjects.Container, data: DynTagLike, alpha: number) {
  const bg = cont.list[0] as Phaser.GameObjects.Rectangle;
  const txt = cont.list[1] as Phaser.GameObjects.BitmapText;
  const dot = cont.list[2] as Phaser.GameObjects.Arc;
  if (txt.text !== data.text) txt.setText(data.text);
  txt.setFontSize(data.compact ? SIGN_FONT : (scene.tagFontDefault as number));
  const padL = 9, padR = 4, padY = 2;
  const w = txt.width + padL + padR, h = txt.height + padY * 2;
  bg.setSize(w, h);
  txt.setPosition(-w / 2 + padL, 0);
  dot.setPosition(-w / 2 + 4.5, 0).setFillStyle(data.status);
  cont.setPosition(data.tx, data.ty).setDepth(data.ay).setScale(data.compact ? SIGN_SCALE : 1).setAlpha(alpha).setVisible(true);
}

/** Minimal-Sicht auf ein Tag-Datum (das WorldScene-Feld ist voll getippt). */
interface DynTagLike { tx: number; ty: number; ax: number; ay: number; text: string; status: number; compact: boolean; }

/** Pro Frame: die JETZT sichtbaren Cluster-Tags (im Sichtfeld + nah, gedeckelt)
 *  aus dem Pool darstellen, den Rest ausblenden – und NUR die sichtbaren vertikal
 *  entzerren (#207), sodass der O(n²)-Aufwand aufs Sichtfeld begrenzt bleibt (#416).
 *  Ersetzt das frühere revealNearbyLabels, das je Tag einen Dauer-Container hielt
 *  und pro Frame ALLE durchlief. */
export function updateDynamicTags(scene: WorldSceneLike) {
  const wv = scene.cameras.main.worldView;
  if (wv.width <= 0) return; // worldView erst nach dem ersten Render gefüllt
  const view = expandRect({ x: wv.x, y: wv.y, width: wv.width, height: wv.height }, TAG_VIEW_MARGIN);
  const visible = selectVisibleTags(scene.dynTags as DynTagLike[], scene.playerPos, view, { full: REVEAL_FULL, fade: REVEAL_FADE, cap: TAG_CAP });
  ensureTagPool(scene, visible.length);

  const pool = scene.tagPool as Phaser.GameObjects.Container[];
  // Feste Holz-Schilder als unbewegliche Hindernisse zuerst, dann die sichtbaren Tags.
  const boxes: LayoutBox[] = scene.signBoxes ? scene.signBoxes.slice() : [];
  const offset = boxes.length;
  for (let k = 0; k < visible.length; k++) {
    const data = scene.dynTags[visible[k].i] as DynTagLike;
    const cont = pool[k];
    applyTag(scene, cont, data, visible[k].alpha);
    const bg = cont.list[0] as Phaser.GameObjects.Rectangle;
    // Tatsächliche Endgröße (Container-Skalierung einrechnen, #255), gemessen an der Basis-Position ty.
    boxes.push({ x: data.tx, y: data.ty, w: bg.width * cont.scaleX, h: bg.height * cont.scaleY });
  }
  // Ungenutzte Pool-Container ausblenden.
  for (let k = visible.length; k < pool.length; k++) pool[k].setVisible(false);

  const dys = spreadLabelsVertically(boxes, 2);
  for (let k = 0; k < visible.length; k++) {
    const data = scene.dynTags[visible[k].i] as DynTagLike;
    pool[k].y = data.ty + dys[offset + k];
  }
  scene.visibleTags = visible.length;
}
