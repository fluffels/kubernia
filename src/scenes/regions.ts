/* ===== KubeQuest – Region-Konfigurationen (scenes/regions.ts) =====
 * #427: die DATEN der drei Nachbar-Regionen (GitOps-Archipel #92, Monitoring-Leuchtturm
 * #111, Lagerhallen-Viertel #124) als RegionConfig-Liste – die generische RegionScene baut
 * daraus die jeweilige Szene. Eine neue Standard-Region ist ein weiterer Eintrag hier, KEINE
 * neue Szenen-Klasse (Kern-AK von #415).
 *
 * Region-spezifische Geometrie/Konstanten bleiben SSOT in den puren Modulen
 * (archipel.ts/lighthouse.ts/warehouse.ts); hier werden sie nur zu Config-Einträgen
 * gebündelt. Die `decorate`-Hooks tragen die ECHTE Sondermechanik (Archipel-Bäume +
 * Quest-Trigger-Statue, Leuchtturm-Lichtkegel, Lager-Güter-Hitboxen) – Phaser-Code, der auf
 * die fertige Szene aufsetzt; der `build`-Parameter ist das Ergebnis des jeweiligen Builders
 * und wird hier auf seinen konkreten Map-Typ gecastet (derselbe Builder hat es erzeugt).
 */
import Phaser from "phaser";
import { circleHitbox, rectHitbox } from "../world";
import { npcSpawnsForMap } from "../content/entities";
import { T, DEVICE } from "./shared";
import type { RegionConfig, RegionScene } from "./RegionScene";
import { buildArchipel, ARCHIPEL_TO_WORLD, ARCHIPEL_ARRIVAL, ARCHIPEL_NPC, ARCHIPEL_QUEST_TRIGGER, type ArchipelMap } from "../archipel";
import { buildLighthouse, LIGHTHOUSE_TO_WORLD, LIGHTHOUSE_ARRIVAL, LIGHTHOUSE_NPC, LIGHTHOUSE_QUEST_TRIGGER, LIGHTHOUSE_TOWER, type LighthouseMap } from "../lighthouse";
import { buildWarehouse, WAREHOUSE_TO_WORLD, WAREHOUSE_ARRIVAL, type WarehouseMap } from "../warehouse";
import { buildWatchtower, WATCHTOWER_TO_WORLD, WATCHTOWER_ARRIVAL, WATCHTOWER_TOWER } from "../watchtower";
import { buildFlotte, FLOTTE_TO_WORLD, FLOTTE_ARRIVAL, type FlotteMap } from "../flotte";
import { buildWerft, WERFT_TO_WORLD, WERFT_ARRIVAL, WERFT_NPC, WERFT_BUILD_TRIGGER, type WerftMap } from "../werft";

/** #343/#386: Hitbox-Maße der Lager-Güter – Fässer rund (Radius), Kisten als mittig
 *  eingerücktes Rechteck (Kantenlänge). Wie in der früheren WarehouseScene. */
const HIT_R = 6;
const CRATE_HIT = 12;

/** GitOps-Archipel (#92): organische Insel mit Sandstrand + Holz-Steg; Bäume als grüner
 *  Saum, der Quest-Trigger als Stein-Statue. E-Notausgang auf dem ganzen Steg. */
const archipel: RegionConfig = {
  key: "Archipel",
  map: "archipel",
  build: buildArchipel,
  regionReturn: ARCHIPEL_TO_WORLD,
  arrival: ARCHIPEL_ARRIVAL,
  title: "⚓ GitOps-Archipel",
  hint: "Zum Steg laufen ⚓ – zurück nach Port Kubernia",
  returnGlyph: "⚓",
  returnSign: "Heimhafen",
  questSignDy: -1,            // Schild ÜBER der Quest-Trigger-Statue
  dockEmergencyExit: true,    // E-Notausgang auf dem ganzen Steg (falls man dort feststeht)
  decor: {
    reserved: [
      { x: ARCHIPEL_NPC.x, y: ARCHIPEL_NPC.y },
      { x: ARCHIPEL_QUEST_TRIGGER.x, y: ARCHIPEL_QUEST_TRIGGER.y },
    ],
    bands: [{ max: 5, kind: "bush" }, { max: 9, kind: "rock" }, { max: 16, kind: "flowers" }],
  },
  decorate(scene: RegionScene, build) {
    const m = build as ArchipelMap;
    // Bäume (grüner Saum) – gemischter Wald wie auf der Hauptkarte.
    for (const t of m.trees) {
      const kind = ((t.x * 7 + t.y * 13) % 3 === 0) ? "pine" : "tree";
      scene.add.image(t.x * T + 8, (t.y + 1) * T, kind).setOrigin(0.5, 1)
        .setScale(kind === "pine" ? 0.95 : 1.1).setDepth((t.y + 1) * T);
    }
    // Quest-Trigger-Statue: ein „dungeon"-Tile als Mahnmal, bis #94–97 echte Quests einhängen.
    const cx = ARCHIPEL_QUEST_TRIGGER.x * T + 8, baseY = (ARCHIPEL_QUEST_TRIGGER.y + 1) * T;
    scene.add.ellipse(cx, baseY - 1, 14, 5, 0x000000, 0.22).setDepth(baseY - 1);
    scene.add.image(cx, baseY, "dungeon", DEVICE).setOrigin(0.5, 1).setScale(1.1).setDepth(baseY);
  },
};

/** Monitoring-Leuchtturm (#111): Gras-Hochebene mit Stein-Klippenrand; Felsbrocken als Saum,
 *  oben der große Leuchtturm mit rotierendem Lichtkegel + pulsierender Lampe. */
const lighthouse: RegionConfig = {
  key: "Lighthouse",
  map: "lighthouse",
  build: buildLighthouse,
  regionReturn: LIGHTHOUSE_TO_WORLD,
  arrival: LIGHTHOUSE_ARRIVAL,
  title: "🔭 Monitoring-Leuchtturm",
  hint: "Pfad hinab ⬇ – zurück nach Port Kubernia",
  returnGlyph: "⬇",
  returnSign: "Port Kubernia",
  questSignDy: 1,
  decor: {
    reserved: [
      { x: LIGHTHOUSE_QUEST_TRIGGER.x, y: LIGHTHOUSE_QUEST_TRIGGER.y },
      { x: LIGHTHOUSE_NPC.x, y: LIGHTHOUSE_NPC.y },
      { x: LIGHTHOUSE_ARRIVAL.tx, y: LIGHTHOUSE_ARRIVAL.ty },
    ],
    bands: [{ max: 5, kind: "bush" }, { max: 14, kind: "flowers" }],
  },
  decorate(scene: RegionScene, build) {
    const m = build as LighthouseMap;
    // Felsbrocken am Klippenrand – die pure Kachel-Solidität (buildLighthouse) wird durch
    // eine runde Hitbox ersetzt (#386), sodass man weich vorbeigleitet statt eckig abzuprallen.
    for (const r of m.rocks) {
      scene.add.image(r.x * T + 8, (r.y + 1) * T, "rock").setOrigin(0.5, 1).setScale(0.5).setDepth((r.y + 1) * T);
      scene.solid[r.y * scene.W + r.x] = 0;
      scene.addSoftCircle(r.x, r.y);
    }
    // Großer Leuchtturm + rotierender Lichtkegel + pulsierende Lampe (PixelLab-Turm).
    const lx = LIGHTHOUSE_TOWER.x * T + 8, lyB = (LIGHTHOUSE_TOWER.y + 1) * T, lhSc = 0.6;
    scene.add.ellipse(lx, lyB - 1, 32, 10, 0x5a6470).setDepth(lyB - 2);   // Felsen-Sockel
    scene.add.image(lx, lyB, "lighthouse").setOrigin(0.5, 1).setScale(lhSc).setDepth(lyB + 4);
    const lampY = lyB - Math.round(100 * lhSc) + 9;
    if (!scene.textures.exists("lhbeam")) {
      const bw = 84, bh = 34, bg = scene.make.graphics({}, false);
      bg.fillStyle(0xffe9a0, 1); bg.fillTriangle(0, bh / 2, bw, 0, bw, bh);
      bg.generateTexture("lhbeam", bw, bh); bg.destroy();
    }
    const beam = scene.add.image(lx, lampY, "lhbeam").setOrigin(0, 0.5)
      .setAlpha(0.13).setBlendMode(Phaser.BlendModes.ADD).setDepth(lyB + 3);
    scene.tweens.add({ targets: beam, angle: 360, duration: 4600, repeat: -1, ease: "Linear" });
    const lamp = scene.add.image(lx, lampY, "px").setScale(4.5, 2.5).setTint(0xffe28a).setDepth(lyB + 5);
    scene.tweens.add({ targets: lamp, alpha: { from: 0.5, to: 1 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  },
};

/** Lagerhallen-Viertel (#124): gepflasterter Hafenkai mit Stein-Kai-Wand + Holz-Steg;
 *  keine Boden-Deko, dafür gestreute Lager-Güter (Kisten/Fässer) mit Sub-Tile-Hitboxen. */
const warehouse: RegionConfig = {
  key: "Warehouse",
  map: "warehouse",
  build: buildWarehouse,
  regionReturn: WAREHOUSE_TO_WORLD,
  arrival: WAREHOUSE_ARRIVAL,
  title: "📦 Lagerhallen-Viertel",
  hint: "Steg hinab ⬇ – zurück nach Port Kubernia",
  returnGlyph: "⬇",
  returnSign: "Port Kubernia",
  questSignDy: 1,
  // keine Boden-Deko (decor weggelassen) – die Quay-Fläche trägt stattdessen Lager-Güter.
  decorate(scene: RegionScene, build) {
    const m = build as WarehouseMap;
    // Lager-Güter (Kisten/Fässer): die pure Kachel-Solidität (buildWarehouse) wird durch eine
    // Sub-Tile-Hitbox ersetzt (#386) – Fässer rund, Kisten als leicht eingerücktes Rechteck.
    for (const g of m.goods) {
      scene.add.image(g.x * T + 8, (g.y + 1) * T, g.kind).setOrigin(0.5, 1).setScale(0.5).setDepth((g.y + 1) * T);
      scene.solid[g.y * scene.W + g.x] = 0;
      scene.softGrid[g.y * scene.W + g.x] = 1;
      if (g.kind === "barrel") {
        scene.softObstacles.push(circleHitbox(g.x * T + 8, g.y * T + 8, HIT_R));
      } else {
        const off = (T - CRATE_HIT) / 2;   // mittig in der Kachel
        scene.softObstacles.push(rectHitbox(g.x * T + off, g.y * T + off, CRATE_HIT, CRATE_HIT));
      }
    }
  },
};

/** Wachturm-Quartier (#130): befestigter Gras-Bailey mit Stein-Wehrmauer + Tor + Holz-Steg;
 *  im Hof der namensgebende Wachturm. Thema: Zugriffskontrolle (RBAC/Security, Phase 6). Der
 *  NPC Vidar (#131, Wachveteran am Tor) steht jetzt als Registry-Eintrag (entities.json) im
 *  Hof; die Quests (#132–135) docken später an. Der Wachturm selbst ist bis zu seinem
 *  PixelLab-Asset (#440) ein bewusster prozeduraler Platzhalter (siehe decorate). */
const watchtower: RegionConfig = {
  key: "Watchtower",
  map: "watchtower",
  build: buildWatchtower,
  regionReturn: WATCHTOWER_TO_WORLD,
  arrival: WATCHTOWER_ARRIVAL,
  title: "🛡️ Wachturm-Quartier",
  hint: "Steg hinab ⬇ – zurück nach Port Kubernia",
  returnGlyph: "⬇",
  returnSign: "Port Kubernia",
  questSignDy: 1,
  decor: {
    reserved: [
      { x: WATCHTOWER_ARRIVAL.tx, y: WATCHTOWER_ARRIVAL.ty },
      { x: WATCHTOWER_TO_WORLD.tx, y: WATCHTOWER_TO_WORLD.ty },
      // Vidar (#131) + künftige Quartier-NPCs: Standplätze aus der Entity-Registry
      // freihalten, damit keine Boden-Deko (Busch/Blume) auf ihnen landet. Datengetrieben
      // statt Koordinaten-Literal, damit es nicht von entities.json driften kann.
      ...npcSpawnsForMap("watchtower").map((s) => ({ x: s.x, y: s.y })),
    ],
    // Sparsame Begrünung – ein Stein-Festungshof, kein Garten: ein paar Büsche + Blumen.
    bands: [{ max: 4, kind: "bush" }, { max: 11, kind: "flowers" }],
  },
  decorate(scene: RegionScene) {
    // Wachturm als prozeduraler Platzhalter (#130): bis das PixelLab-Asset existiert, ein
    // klar erkennbarer Stein-Turm mit Zinnenkranz + Banner aus Primitiven (wie der Leucht-
    // turm Sockel/Lampe teils prozedural sind). Mittig über dem 2×2-Fußabdruck, fußlinien-
    // depth-sortiert. Asset-Ticket: echtes Wachturm-Sprite + Umzug in die Entity-Registry.
    const cx = WATCHTOWER_TOWER.x * T;                  // Boundary zwischen den 2 Fuß-Spalten = Mitte
    const baseY = (WATCHTOWER_TOWER.y + 1) * T;         // Fußlinie (untere Kante des Fußabdrucks)
    scene.add.ellipse(cx, baseY - 1, 30, 9, 0x000000, 0.22).setDepth(baseY - 2);   // Schatten
    // Turmschaft (Stein), leicht nach oben verjüngt.
    const shaftH = 54, shaftW = 24;
    scene.add.rectangle(cx, baseY, shaftW, shaftH, 0x7b8493).setOrigin(0.5, 1).setDepth(baseY);
    scene.add.rectangle(cx - shaftW / 2 + 2, baseY, 3, shaftH, 0x9aa3b2).setOrigin(0.5, 1).setDepth(baseY + 0.1); // Lichtkante
    scene.add.rectangle(cx + shaftW / 2 - 2, baseY, 3, shaftH, 0x5d6675).setOrigin(0.5, 1).setDepth(baseY + 0.1); // Schattenkante
    // Tür + Arrow-Slit-Fenster (dunkle Öffnungen).
    scene.add.rectangle(cx, baseY, 8, 12, 0x2a2f38).setOrigin(0.5, 1).setDepth(baseY + 0.2);           // Tor
    scene.add.rectangle(cx, baseY - 30, 4, 9, 0x2a2f38).setOrigin(0.5, 1).setDepth(baseY + 0.2);        // Schießscharte
    // Zinnenkranz: breitere Plattform + drei Zinnen-Zacken.
    const topY = baseY - shaftH;
    scene.add.rectangle(cx, topY + 4, shaftW + 8, 8, 0x6b7280).setOrigin(0.5, 1).setDepth(baseY + 0.3);
    for (const dx of [-12, 0, 12]) {
      scene.add.rectangle(cx + dx, topY - 4, 6, 6, 0x6b7280).setOrigin(0.5, 1).setDepth(baseY + 0.3);
    }
    // Banner (stahlblau – Wache/Security) am kurzen Fahnenmast.
    scene.add.rectangle(cx + 14, topY - 6, 1.5, 16, 0x3a2f22).setOrigin(0.5, 1).setDepth(baseY + 0.4);  // Mast
    const flag = scene.add.triangle(cx + 14, topY - 16, 0, 0, 12, 4, 0, 8, 0x3b6ea5).setOrigin(0, 0.5).setDepth(baseY + 0.4);
    scene.tweens.add({ targets: flag, scaleX: { from: 1, to: 0.82 }, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  },
};

/** Expeditions-Flotte (#148, Phase 9): rechteckiges Holz-Deck im offenen Meer, ringsum die
 *  vertäute Flotte. Keine Boden-Deko (ein Schiffsdeck, kein Garten) – Charakter kommt aus den
 *  vertäuten Flotten-Schiffen (echtes ship-Sprite, COMMON_ASSET) auf den Wasser-Standplätzen
 *  aus buildFlotte. NPC #149 + Quests #150–153 docken später an. */
const flotte: RegionConfig = {
  key: "Flotte",
  map: "flotte",
  build: buildFlotte,
  regionReturn: FLOTTE_TO_WORLD,
  arrival: FLOTTE_ARRIVAL,
  title: "⛵ Expeditions-Flotte",
  hint: "Steg hinab ⬇ – zurück nach Port Kubernia",
  returnGlyph: "⬇",
  returnSign: "Port Kubernia",
  questSignDy: 1,
  // keine Boden-Deko (decor weggelassen) – das Holz-Deck trägt keine Büsche/Blumen.
  decorate(scene: RegionScene, build) {
    const m = build as FlotteMap;
    // Vertäute Flotten-Schiffe rings um das Deck (auf Wasser, nicht begehbar) – das echte
    // ship-Sprite, fußlinien-depth-sortiert + sanftes Dümpeln, damit die Flotte lebt.
    for (const s of m.ships) {
      const cx = s.x * T + 8, baseY = (s.y + 1) * T;
      scene.add.ellipse(cx, baseY - 1, 26, 7, 0x000000, 0.18).setDepth(baseY - 2);   // Wasserschatten
      const ship = scene.add.image(cx, baseY, "ship").setOrigin(0.5, 1).setScale(0.7).setFlipX(s.flip).setDepth(baseY);
      scene.tweens.add({ targets: ship, y: baseY - 2, duration: 1900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    }
  },
};

/** Heimat-Werft (#165, Phase 10): gepflasterter Werft-Hof mit Stein-Kai-Wand + hölzerner
 *  Helling (Slipway) im Süden. Auf der Helling das im Bau befindliche Schiff (der „eigene
 *  Service", den der Capstone bauen lässt), flankiert von zwei Bau-Gerüsten. Sparsame Begrünung
 *  – ein Arbeitshof, kein Garten. Die Werftmeisterin Greta (#166) steht über die Entity-Registry
 *  auf dem Hof-Platz (von RegionScene aus npcSpawnsForMap gespawnt); die Capstone-Quest (#167)
 *  dockt später am reservierten Trigger-Platz an. Das im Bau befindliche Schiff + die Gerüste sind bewusst
 *  prozedural/aus dem gemeinsamen ship-Sprite (kein neues Asset) – ein echtes Werft-Gantry-
 *  Sprite ist ein separates Optik-Ticket (Stardew-Nordstern). */
const werft: RegionConfig = {
  key: "Werft",
  map: "werft",
  build: buildWerft,
  regionReturn: WERFT_TO_WORLD,
  arrival: WERFT_ARRIVAL,
  title: "⚒ Heimat-Werft",
  hint: "Helling hinab ⬇ – zurück nach Port Kubernia",
  returnGlyph: "⬇",
  returnSign: "Port Kubernia",
  questSignDy: 1,
  decor: {
    reserved: [
      { x: WERFT_ARRIVAL.tx, y: WERFT_ARRIVAL.ty },
      { x: WERFT_TO_WORLD.tx, y: WERFT_TO_WORLD.ty },
      { x: WERFT_NPC.x, y: WERFT_NPC.y },
      { x: WERFT_BUILD_TRIGGER.x, y: WERFT_BUILD_TRIGGER.y },
    ],
    // Ein Arbeitshof, kein Garten: ein paar Büsche + Blumen am Rand.
    bands: [{ max: 4, kind: "bush" }, { max: 11, kind: "flowers" }],
  },
  decorate(scene: RegionScene, build) {
    const m = build as WerftMap;
    // Bau-Gerüste links/rechts der Helling: schlanke Holz-Gerüst-Rahmen aus Primitiven (wie
    // der Wachturm-Platzhalter), bis ein echtes Werft-Gantry-Sprite existiert.
    for (const s of m.scaffolds) {
      const cx = s.x * T + 8, baseY = (s.y + 1) * T;
      scene.add.ellipse(cx, baseY - 1, 16, 5, 0x000000, 0.2).setDepth(baseY - 2);
      // Zwei senkrechte Holzstützen + drei Querstreben = ein Bau-Gerüst.
      scene.add.rectangle(cx - 5, baseY, 2, 26, 0x6b4a2a).setOrigin(0.5, 1).setDepth(baseY);
      scene.add.rectangle(cx + 5, baseY, 2, 26, 0x6b4a2a).setOrigin(0.5, 1).setDepth(baseY);
      for (const dy of [4, 13, 22]) {
        scene.add.rectangle(cx, baseY - dy, 12, 2, 0x7c5a36).setOrigin(0.5, 1).setDepth(baseY + 0.1);
      }
    }
    // Das im Bau befindliche Schiff (der „eigene Service") mittig auf der Helling – das
    // gemeinsame ship-Sprite, fußlinien-depth-sortiert, mit sanftem Werft-Wippen. Eine
    // Funken-Andeutung (gelbe Pixel) darüber liest sich als „hier wird gerade gebaut".
    const cx = m.hull.x * T + 8, baseY = (m.hull.y + 1) * T;
    scene.add.ellipse(cx, baseY - 1, 28, 8, 0x000000, 0.2).setDepth(baseY - 2);   // Schatten/Kielblock
    const ship = scene.add.image(cx, baseY, "ship").setOrigin(0.5, 1).setScale(0.75).setDepth(baseY);
    scene.tweens.add({ targets: ship, y: baseY - 1.5, duration: 2100, yoyo: true, repeat: -1, ease: "Sine.inOut" });
    const spark = scene.add.image(cx + 6, baseY - 18, "px").setScale(2).setTint(0xffe28a).setDepth(baseY + 1);
    scene.tweens.add({ targets: spark, alpha: { from: 0.2, to: 0.9 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
  },
};

/** Die EINE Liste aller Region-Szenen-Configs. Reihenfolge = Registrierungsreihenfolge in
 *  scenes.ts (Szenen-Keys sind disjunkt, also nicht load-bearing). */
export const REGION_CONFIGS: RegionConfig[] = [archipel, lighthouse, warehouse, watchtower, flotte, werft];
