/* Szenen-neutraler Taktgeber (#501, Anwendungsschicht, Phaser-frei).
 * Die frame-unabhängigen Domänen-Ticks (Hafen-Wirtschaft + Spiel-Zeit) liefen früher NUR
 * aus WorldScene.update(). Eine RegionScene hat ein eigenes update() und rief sie nicht –
 * darum standen passives Einkommen UND Kalender still, solange man in Archipel/Leuchtturm/
 * Lager/Wachturm war (verifizierter Bug #501). Jetzt bündelt Game.tick(dtMs) diese Ticks an
 * EINER Stelle; main.ts treibt sie aus Phasers globalem Pre-Step, der unabhängig von der
 * aktiven Szene je Frame feuert – so ticken sie in JEDER Szene.
 *
 * Bewusst NUR die frame-unabhängige Domäne (Wirtschaft/Zeit/Gefahren): die szenen-spezifische
 * Präsentation bleibt in der jeweiligen Szene (Tag-Nacht-Schleier liest die schon vorgerückte
 * Achse in WorldScene). Seit #540 gehört auch der Gefahren-Takt (Piraten/Krake/Sturm) hierher
 * – die Zeitachse + Cluster-Mutation laufen szenen-neutral (Game.hazardTick), nur die
 * Welt-Sprites bleiben weltgebunden (worldscene/events.ts rendert den gemeldeten Zustand).
 *
 * Die fällige Auszahlung wird entkoppelt über den runtime-Sink (notifyPayout) gemeldet –
 * die Anwendung darf die Präsentation nicht importieren (Schichtung wie Audio-#344/Save-#497).
 * Die HUD-Uhr-Anzeige (Datum/Uhrzeit) meldet dieser Takt seit #588 ebenso szenen-neutral über
 * notifyClock – vorher setzte sie nur die WorldScene (updateDayNight), sodass sie in den
 * Region-/Interior-Szenen einfror (gleiche Bug-Klasse wie das economyTick-#501).
 */
import { notifyPayout, notifyClock } from "../runtime";
import { part } from "./shared";

/** Obergrenze für den Wirtschafts-dt EINES Frames (Sekunden). Ein in den Hintergrund gelegter
 *  Tab oder ein Lade-Hänger liefert beim Wiederkommen ein riesiges `delta`; ohne Deckel würde
 *  ein einziger Frame Sekunden an Einkommen auf einmal auszahlen (Catch-up-Windfall). Mit
 *  Deckel läuft die Wirtschaft einfach dort weiter, wo sie war. (Der Kalender deckelt separat
 *  in advanceClock gegen MAX_FRAME_MS.) Spiegelt den früheren Inline-Deckel der WorldScene. */
const MAX_ECONOMY_DT = 0.05;

/** Szenen-neutraler Frame-Takt der Game-Fassade (#501). */
export const tickBundle = part({
  /** Ein Frame der frame-unabhängigen Domäne: Spiel-Zeit-Achse vorrücken + HUD-Uhr melden +
   *  Hafen-Wirtschaft auszahlen. Wird szenen-neutral aus main.ts (Phaser-Pre-Step) mit der
   *  realen Frame-Zeit `deltaMs` getrieben, damit Einkommen, Kalender UND Uhr-Anzeige in JEDER
   *  Szene laufen (#501/#588). Uhr + fällige Auszahlung gehen über runtime-Sinks an die
   *  Präsentation (HUD-Uhr / HUD-Refresh + „+N 🪙"-Floater). Unsinnige Deltas (NaN/≤0) rücken
   *  nichts vor. */
  tick(deltaMs: number) {
    // advanceClock deckelt/ignoriert Unsinn (NaN/≤0/Riesen-Frame) selbst – unbedingt rufen.
    this.advanceClock(deltaMs);
    // Uhr-Anzeige nach dem (evtl.) Vorrücken szenen-neutral melden (#588). Auch bei einem
    // Unsinns-Delta harmlos: der Kalender ist dann unverändert, die Präsentation schreibt
    // nur bei echter Änderung in den DOM (UI.setClock dedupliziert per Signatur).
    const clock = this.calendar();
    notifyClock(clock.dateLabel, clock.timeLabel, clock.title);
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const payout = this.economyTick(Math.min(MAX_ECONOMY_DT, deltaMs / 1000));
    if (payout > 0) notifyPayout(payout);
    // Szenen-neutrale Zufalls-Gefahren (#540): Zeitachse + Cluster-Mutation laufen jetzt hier
    // (nicht mehr in WorldScene.update über scene.time.now), damit Gefahren in JEDER Szene
    // starten/fortschreiten. Die Effekte (Sprites/Alarm/roter Rahmen) meldet der runtime-Sink.
    this.hazardTick(deltaMs);
  },
});
