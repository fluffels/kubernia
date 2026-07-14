/* ===== Kubernia – WorldScene-Cluster-Sync (worldscene/clustersync.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier wird der simulierte Cluster
 * (Game.sim) auf die sichtbare Hafenwelt gespiegelt: Pods als offene Bootsrümpfe an den
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
import { spreadLabelsVertically, type LayoutBox } from "../../hud/labellayout";
import { selectVisibleTags, expandRect, flagBobOffset, lampFlickerAlpha } from "../../hud/cull";
import { containerBarrelTile } from "../../hud/containeryard";
import { T, hashHue, hueColor, SIGN_FONT, SIGN_SCALE } from "../shared";
// Pod-Steg-Belegung + Tag-Rendering-Konstanten liegen zentral in scenes/geometry.ts (#590).
import { SLOTS_PER_PIER, TAG_CAP, REVEAL_FULL, REVEAL_FADE } from "../geometry";
import type { WorldSceneLike, DynTagData } from "./types";
import { harborTexture, pierHealed } from "./harbordamage";
export { harborTexture, pierHealed } from "./harbordamage";

// Sichtfeld fürs Tag-Culling großzügig erweitern, damit am Bildrand nichts aufpoppt
// (Tags ragen über ihren Bezugspunkt + werden beim Entzerren nach oben geschoben).
const TAG_VIEW_MARGIN = 2 * T;

// Dekorative dynGroup-Sprites (#431): Bewegungs-Konstanten für die Sinus-Ersatzbewegung
// der früheren Dauer-Tweens (Flagge: y-Wippe, Lampe: Alpha-Flicker). period = volle
// Hoch-Runter-Periode in Sekunden (die alten Tweens liefen mit yoyo → 2× duration).
const FLAG_BOB_PX = 2;
const FLAG_BOB_PERIOD_S = 1.2;
const LAMP_MIN_ALPHA = 0.55;
const LAMP_FLICKER_PERIOD_S = 1.6;
// Leichter Phasen-Versatz je Index, damit nicht ALLE Flaggen/Lampen exakt synchron
// wippen/flackern (rein kosmetisch, kein Zufall nötig – deterministisch aus dem Index).
const DECOR_PHASE_STEP = 0.8;

const PIER_ROWS = SLOTS_PER_PIER / 2;   // 2 Spalten × PIER_ROWS Reihen je Steg (#590/#523)

function podSlotPos(scene: WorldSceneLike, slot: number) {
  const P = Math.max(1, scene.piers.length);
  const page = Math.floor(slot / (P * SLOTS_PER_PIER)); // vollständige Füllung aller Stege
  const within = slot % (P * SLOTS_PER_PIER);
  const pier = scene.piers[Math.floor(within / SLOTS_PER_PIER)];
  const i = within % SLOTS_PER_PIER;
  const col = i % 2 === 0 ? 0 : 2;
  const row = Math.floor(i / 2) + page * PIER_ROWS;      // Folge-Seiten stapeln nach unten
  return { x: (pier.x + col) * T + 8, y: (28 + row) * T + 8 };
}

export function syncCluster(scene: WorldSceneLike) {
  if (!Game.sim) return;
  // #523: Der teure Pod-/Signatur-Sync läuft nur, wenn sich der Cluster seit dem
  // letzten Frame geändert hat (Sim.rev). Vorher lief er JEDEN Frame O(n) über alle
  // Pods + baute vier join("|")-Signaturen – Frame-Killer bei Stardew-Scope.
  if (Game.sim.rev !== scene.lastClusterRev) {
    scene.lastClusterRev = Game.sim.rev;
    syncPods(scene);
    syncHarborDamage(scene);
  }
  // Billige, jeden Frame nötige Sichtbarkeit (hängt an Game-State/tf, NICHT an rev –
  // die Kanone wird per Shop-Kauf freigeschaltet, ohne den Cluster zu ändern):
  const applied = Game.sim.tf.applied;
  scene.tfGroup.setVisible(applied);
  scene.tfBuoys.forEach((b: Phaser.GameObjects.Image) => b.setVisible(Game.sim.tf.initialized && !applied));
  scene.cannon.setVisible(Game.hasUpgrade("kanone"));
}

/** Synchronisiert die Sturm-Schadensoptik mit dem Cluster-Zustand:
 *  - Gebäude/Schiff per CP-Zustand (#692)
 *  - Steg-Overlays granular per Node-Beitritt (#693) */
function syncHarborDamage(scene: WorldSceneLike) {
  const cpUp = Game.sim.controlPlane.up;
  if (cpUp !== scene.lastControlPlaneUp) {
    scene.lastControlPlaneUp = cpUp;
    scene.lighthouseImg.setTexture(harborTexture("lighthouse", cpUp));
    scene.shipImg.setTexture(harborTexture("ship", cpUp));
    scene.houseOfficeImg.setTexture(harborTexture("house_office", cpUp));
  }
  const nodeNames = Game.sim.nodes.map((n: { name: string }) => n.name);
  const nodeSig = `${cpUp}|${nodeNames.join(",")}`;
  if (nodeSig !== scene.lastNodesSig) {
    scene.lastNodesSig = nodeSig;
    for (let i = 0; i < scene.piers.length; i++) {
      scene.pierDamageImgs[i].setVisible(!pierHealed(scene.piers[i].name, cpUp, nodeNames));
    }
  }
}

/** Pod-Kisten + Signatur-abhängige Deko an den aktuellen Cluster-Zustand angleichen.
 *  Läuft nur bei geänderter Cluster-Revision (#523), nicht mehr pro Frame. */
function syncPods(scene: WorldSceneLike) {
  const pods = [];
  for (const d of Game.sim.deployments) for (const p of d.pods) pods.push({ name: p.name, dep: d.name });
  const names = new Set<string>(pods.map(p => p.name));

  for (const p of pods) {
    if (!scene.podSlots[p.name]) {
      // #523: freien Slot suchen; sind alle belegt, die Belegungsliste dynamisch um
      // einen Slot wachsen lassen (podSlotPos stapelt darüber sauber) statt auf Slot 0
      // zurückzufallen und die Kiste zu überlagern.
      let slot = scene.slotUsed.findIndex((u: boolean) => !u);
      if (slot === -1) slot = scene.slotUsed.length;
      scene.slotUsed[slot] = true;
      const pos = podSlotPos(scene, slot);
      const hue = hashHue(p.dep);
      const shadow = scene.addShadow(pos.x, pos.y + 7, 11);
      const hull = scene.add.image(pos.x, pos.y - 44, "pod_hull").setScale(0.6).setDepth(pos.y + 8);
      const barrel = scene.add.image(pos.x, pos.y - 44 - 2, "barrel").setScale(0.35).setTint(hueColor(hue)).setDepth(pos.y + 9);
      scene.tweens.add({ targets: [hull, barrel], y: "+=44", duration: 550, ease: "Bounce.easeOut",
        onComplete: () => scene.burstAt(pos.x, pos.y + 4, "dust") });
      scene.podSlots[p.name] = { slot, hull, barrel, shadow, dep: p.dep, wx: pos.x, wy: pos.y };
    }
  }
  for (const name of Object.keys(scene.podSlots)) {
    if (!names.has(name)) {
      const info = scene.podSlots[name];
      const pos = podSlotPos(scene, info.slot);
      scene.burstAt(pos.x, pos.y + 4, "splash");
      SFX.splash();
      info.hull.destroy(); info.barrel.destroy(); info.shadow.destroy();
      scene.slotUsed[info.slot] = false;
      delete scene.podSlots[name];
    }
  }

  // Kaputte Deployments: Rumpf rot einfärben
  const brokenMap: Record<string, boolean> = {};
  for (const d of Game.sim.deployments) brokenMap[d.name] = !!d.broken;
  for (const info of Object.values(scene.podSlots) as { hull: Phaser.GameObjects.Image; dep: string }[]) {
    info.hull.setTint(brokenMap[info.dep] ? 0xff8d8d : 0xffffff);
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
}

export function rebuildDynamic(scene: WorldSceneLike) {
  scene.dynGroup.clear(true, true);
  // Tags sind reine Daten (#416): hier nur sammeln, NICHT je einen Container bauen.
  // (lx,ly) = Tag-Position, (ax,ay) = Bezugspunkt des Objekts (Distanz zur Figur +
  // Tiefen-Sortierung). `ty` ist die Basis-Position fürs Entzerren.
  scene.dynTags = [];
  // #431: dekorative Sprites (Flaggen/Laternen) parallel als Daten sammeln – analog zu
  // dynTags NEU aufgebaut bei jedem rebuildDynamic, damit kein Eintrag auf ein von
  // dynGroup.clear() bereits zerstörtes Sprite zeigt.
  scene.dynDecor = [];
  const mkTag = (lx: number, ly: number, str: string, status: number, ax: number, ay: number, compact = false) => {
    scene.dynTags.push({ tx: lx, ty: ly, ax, ay, text: str, status, compact });
  };

  // Deployment-Tags AM Rumpf der ersten Kiste (kaputte rot mit Status!)
  // #651: Bezugspunkt auf die Kisten-Mitte (pos.y - 44) gesetzt; Label schwebt
  // knapp über der Kiste statt zwischen Kiste und Boden.
  const seen: Record<string, boolean> = {};
  for (const d of Game.sim.deployments) {
    const first = d.pods[0] && scene.podSlots[d.pods[0].name];
    if (first && !seen[d.name]) {
      seen[d.name] = true;
      const pos = podSlotPos(scene, first.slot);
      const crateY = pos.y - 44;  // Kisten-Mitte (Sprite-Ursprung der Image)
      const text = d.broken
        ? d.name + " ⚠ " + (d.broken.type === "imagepull" ? "ImagePullBackOff" : d.broken.type === "crashloop" ? "CrashLoopBackOff" : "Pending")
        : d.name + " " + d.replicas + "/" + d.replicas;
      mkTag(pos.x, crateY - 14, text, d.broken ? 0xff7b7b : 0x6fe09a, pos.x, crateY);
    }
  }
  // Docker-Fässer (max. 10 sichtbar): laufende am Dock bei Bo, gestoppte im
  // Lagerschuppen (#303). Der Ortswechsel macht „gestoppt ≠ gelöscht" (docker ps -a)
  // sichtbar – Layout-SSOT + Placement-Mathe pur in hud/containeryard.ts, damit
  // Fass-Positionen und der Schuppen (scenery) nicht driften. Jede Gruppe packt ab 0.
  let nRun = 0, nStop = 0;
  Game.sim.docker.containers.slice(-10).forEach((c) => {
    const k = c.running ? nRun++ : nStop++;
    const tile = containerBarrelTile(c.running, k);
    const bx = tile.x * T + 8, by = tile.y * T + 8;
    const barrel = scene.add.image(bx, by, "barrel").setScale(0.5).setDepth(by + 8).setAlpha(c.running ? 1 : 0.45);
    scene.dynGroup.add(barrel);
    // #491: „gestoppt" farbunabhängig markieren – zusätzlich zur Tag-Farbe (grün→grau)
    // ein Pause-Symbol vor dem Namen, damit Rot-Grün-Sehschwäche den Zustand nicht verliert.
    mkTag(bx, by - 9 - (k % 2) * 7, (c.running ? "" : "⏸ ") + c.name, c.running ? 0x6fe09a : 0x8a98a8, bx, by, true);
  });
  // Helm-Flaggen an der Werft. #431: kein Dauer-Tween mehr (skalierte bei
  // Stardew-Scope 1:1 mit der Release-Zahl, auch off-screen) – Mast+Flagge sind
  // cullbar (dynDecor), die Wipp-Bewegung berechnet updateDynDecor() pro Frame nur
  // für aktuell sichtbare Flaggen (flagBobOffset in cull.ts).
  Game.sim.releases.forEach((r, i) => {
    const pole = scene.flagPoles[i % scene.flagPoles.length];
    const fx = pole.x * T + 8, fy = pole.y * T;
    const mast = scene.add.image(fx, fy, "px").setScale(1, 15).setTint(0x6b5436).setDepth(fy + 30);
    const flagBaseY = fy - 12;
    const flag = scene.add.image(fx + 6, flagBaseY, "px").setScale(6, 3.5).setTint(hueColor(hashHue(r.name))).setDepth(fy + 31);
    scene.dynGroup.add(mast); scene.dynGroup.add(flag);
    scene.dynDecor.push({ x: fx, y: fy, obj: mast });
    scene.dynDecor.push({ x: fx, y: fy, obj: flag, anim: { kind: "flag", baseY: flagBaseY, phase: i * DECOR_PHASE_STEP } });
    mkTag(fx + 4, fy - 18, r.name + " rev" + r.revision, 0x6fd0e6, fx, fy - 8);
  });
  // Service-Laternen am Dockrand. #431: analog – Alpha-Flicker nur fürs sichtbare
  // Lamp-Sprite (lampFlickerAlpha in cull.ts), Pfosten + Lampe cullbar.
  Game.sim.services.forEach((s, i) => {
    const lx = (6 + i * 4) * T + 8, ly = 23 * T + 8;
    const post = scene.add.image(lx, ly + 2, "px").setScale(1, 6).setTint(0x5a4632).setDepth(ly + 8);
    const lamp = scene.add.image(lx, ly - 5, "px").setScale(3, 2.5).setTint(0xffdc78).setDepth(ly + 9);
    scene.dynGroup.add(post); scene.dynGroup.add(lamp);
    scene.dynDecor.push({ x: lx, y: ly, obj: post });
    scene.dynDecor.push({ x: lx, y: ly, obj: lamp, anim: { kind: "lamp", baseY: ly, phase: i * DECOR_PHASE_STEP } });
    mkTag(lx, ly - 10, s.name, 0x6fd0e6, lx, ly);
  });
}

/** Pro Frame: die Wipp-/Flicker-Bewegung der dekorativen dynGroup-Sprites NUR für
 *  die aktuell sichtbaren berechnen (#431) – der Rest bleibt unangetastet, bis er
 *  wieder ins Sichtfeld scrollt (dann setzt `cull()` seine Position/Alpha beim
 *  nächsten Sichtbar-Werden ohnehin neu, kein Sprung sichtbar). Ersetzt die
 *  früheren `scene.tweens.add({repeat:-1})`-Dauer-Tweens, die unabhängig von der
 *  Sichtbarkeit pro Frame tickten. */
export function updateDynDecor(scene: WorldSceneLike, time: number) {
  const t = time / 1000;
  for (const d of scene.dynDecor) {
    if (!d.anim || !d.obj.visible) continue;
    if (d.anim.kind === "flag") {
      d.obj.y = d.anim.baseY + flagBobOffset(t, d.anim.phase, FLAG_BOB_PX, FLAG_BOB_PERIOD_S);
    } else {
      d.obj.setAlpha(lampFlickerAlpha(t, d.anim.phase, LAMP_MIN_ALPHA, LAMP_FLICKER_PERIOD_S));
    }
  }
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
function applyTag(scene: WorldSceneLike, cont: Phaser.GameObjects.Container, data: DynTagData, alpha: number) {
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

/** Pro Frame: die JETZT sichtbaren Cluster-Tags (im Sichtfeld + nah, gedeckelt)
 *  aus dem Pool darstellen, den Rest ausblenden – und NUR die sichtbaren vertikal
 *  entzerren (#207), sodass der O(n²)-Aufwand aufs Sichtfeld begrenzt bleibt (#416).
 *  Ersetzt das frühere revealNearbyLabels, das je Tag einen Dauer-Container hielt
 *  und pro Frame ALLE durchlief. */
export function updateDynamicTags(scene: WorldSceneLike) {
  const wv = scene.cameras.main.worldView;
  if (wv.width <= 0) return; // worldView erst nach dem ersten Render gefüllt
  const view = expandRect({ x: wv.x, y: wv.y, width: wv.width, height: wv.height }, TAG_VIEW_MARGIN);
  const visible = selectVisibleTags(scene.dynTags, scene.playerPos, view, { full: REVEAL_FULL, fade: REVEAL_FADE, cap: TAG_CAP });
  ensureTagPool(scene, visible.length);

  const pool = scene.tagPool as Phaser.GameObjects.Container[];
  // Feste Holz-Schilder als unbewegliche Hindernisse zuerst, dann die sichtbaren Tags.
  const boxes: LayoutBox[] = scene.signBoxes ? scene.signBoxes.slice() : [];
  const offset = boxes.length;
  for (let k = 0; k < visible.length; k++) {
    const data = scene.dynTags[visible[k].i];
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
    const data = scene.dynTags[visible[k].i];
    pool[k].y = data.ty + dys[offset + k];
  }
  scene.visibleTags = visible.length;
}
