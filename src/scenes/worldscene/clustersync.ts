/* ===== KubeQuest – WorldScene-Cluster-Sync (worldscene/clustersync.ts) =====
 * Schritt des WorldScene.ts-Splits (#393). Hier wird der simulierte Cluster
 * (Game.sim) auf die sichtbare Hafenwelt gespiegelt: Pods als Kisten an den
 * Stegen (syncCluster), Deployment-/Docker-/Helm-/Service-Tags neu bauen bei
 * Änderung (rebuildDynamic) und die Nähe-Aufdeckung + Entzerrung der dynamischen
 * Tags (revealNearbyLabels).
 *
 * Freie Funktionen mit der Szene als Parameter; der Cluster-Zustand bleibt in
 * Game.sim, die Render-Primitive (addShadow/makeTechTag/burstAt) auf der Szene.
 */
import Phaser from "phaser";
import { Game } from "../../game";
import { SFX } from "../../sfx";
import { spreadLabelsVertically, type LayoutBox } from "../../labellayout";
import { T, hashHue, hueColor } from "../shared";
import type { WorldSceneLike } from "./types";

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
  const names = new Set(pods.map(p => p.name));

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
  scene.dynLabels = [];
  // Digitales Cluster-Tag bauen + für die Nähe-Aufdeckung registrieren.
  // (lx,ly) = Tag-Position, (ax,ay) = Bezugspunkt des Objekts (Distanz zur Figur).
  const mkTag = (lx: number, ly: number, str: string, status: number, ax: number, ay: number, compact = false) => {
    const tag = scene.makeTechTag(lx, ly, str, status, compact);
    // Tiefe am Bezugs-Objekt (ay) ausrichten statt fix ganz oben: so rendert eine
    // davorstehende Figur (größeres Fuß-y → größere Tiefe) ÜBER dem Tag und wird
    // nicht mehr verdeckt (#207) – analog zur y-Sortierung der Holz-Schilder.
    tag.setDepth(ay);
    scene.dynGroup.add(tag);
    scene.dynLabels.push({ obj: tag, x: ax, y: ay, ty: ly });
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

/** Nähe-Aufdeckung: dynamische Cluster-Tags nur nahe der Figur einblenden
 *  (sanfter Fade), damit nie alle gleichzeitig sichtbar sind und überlappen.
 *  Zusätzlich werden die GERADE sichtbaren Tags vertikal entzerrt (#207), damit
 *  sich ihre Texte – und die der festen Holz-Schilder – nicht überlagern. */
export function revealNearbyLabels(scene: WorldSceneLike) {
  const pl = scene.playerPos;
  const FULL = 42, FADE = 84;   // px: voll sichtbar <=FULL, ausgeblendet >=FADE
  const visible = [];
  for (const dl of scene.dynLabels) {
    const d = Math.hypot(dl.x - pl.x, dl.y - pl.y);
    const a = d <= FULL ? 1 : d >= FADE ? 0 : 1 - (d - FULL) / (FADE - FULL);
    dl.obj.setAlpha(a).setVisible(a > 0.02);
    if (a > 0.02) visible.push(dl);
    else dl.obj.y = dl.ty;   // ausgeblendet → zurück auf die Basis-Position
  }
  // Entzerren: feste Schilder als unbewegliche Hindernisse zuerst, dann die
  // sichtbaren Tags (gemessen an ihrer Basis-Position ty + Panel-Größe).
  const boxes: LayoutBox[] = scene.signBoxes ? scene.signBoxes.slice() : [];
  const offset = boxes.length;
  for (const dl of visible) {
    const bg = dl.obj.list[0];   // Hintergrund-Rechteck des Tech-Tags (Maße = Panel)
    // Container-Skalierung einrechnen (#255): compact-Fass-Tags sind um SIGN_SCALE
    // verkleinert – das Entzerren muss die TATSÄCHLICHE Endgröße nehmen, sonst
    // reserviert es zu viel Platz und schiebt die Tags unnötig auseinander.
    boxes.push({ x: dl.obj.x, y: dl.ty, w: bg.width * dl.obj.scaleX, h: bg.height * dl.obj.scaleY });
  }
  const dys = spreadLabelsVertically(boxes, 2);
  visible.forEach((dl, i) => { dl.obj.y = dl.ty + dys[offset + i]; });
}
