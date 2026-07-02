/* Overlay-Register (#505) — die eine Datenquelle für die Overlays.
 *
 * Vorher stand dieselbe Overlay-ID-Liste an mehreren Stellen (blocking/closeOverlays
 * je 7, overlayKey abweichend mit 5) → reale Drift. Jetzt leiten alle drei aus
 * `src/ui/overlays.ts` ab. Diese Tests sichern die Ableitungen UND binden das
 * Register an die echten `#overlay-*`-Panels in index.html (Anti-Drift-Fitness-
 * Function, Vorbild docmap/readme): fügt jemand ein Overlay im HTML hinzu/entfernt es,
 * ohne das Register nachzuziehen, wird der Test rot.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OVERLAYS, BLOCKING_OVERLAY_IDS, KEYNAV_OVERLAY_IDS, OVERLAY_ID } from "../src/ui/overlays";

const indexHtml = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");

/** Alle `id="overlay-…"` aus index.html (die tatsächlichen Modal-Panels). */
function overlayIdsInHtml(html: string): string[] {
  return [...html.matchAll(/id="(overlay-[a-z]+)"/g)].map(m => m[1]).sort();
}

describe("Overlay-Register (#505)", () => {
  test("Register deckt sich EXAKT mit den #overlay-Panels in index.html (Anti-Drift)", () => {
    const htmlIds = overlayIdsInHtml(indexHtml);
    const registerIds = OVERLAYS.map(o => o.id).sort();
    assert.deepEqual(
      registerIds,
      htmlIds,
      "Register (src/ui/overlays.ts) und die #overlay-Panels in index.html sind auseinandergelaufen — " +
        "beim Hinzufügen/Entfernen eines Overlays BEIDE nachziehen.",
    );
  });

  test("BLOCKING_OVERLAY_IDS = alle sieben blockierenden Overlays", () => {
    assert.deepEqual([...BLOCKING_OVERLAY_IDS].sort(), OVERLAYS.filter(o => o.blocking).map(o => o.id).sort());
    assert.equal(BLOCKING_OVERLAY_IDS.length, 7, "aktuell sind alle sieben Overlays blockierend");
  });

  test("KEYNAV_OVERLAY_IDS schließt Terminal + Wissensrunde bewusst aus (eigene Tastatur-Handler)", () => {
    // Genau die Drift, die das Ticket nennt: overlayKey darf terminal/review NICHT enthalten
    // (Terminal = Eingabefeld, review = eigener reviewKey-Handler).
    assert.ok(!KEYNAV_OVERLAY_IDS.includes("overlay-terminal"), "Terminal hat ein Eingabefeld, keine Button-Navigation");
    assert.ok(!KEYNAV_OVERLAY_IDS.includes("overlay-review"), "Wissensrunde hat einen eigenen reviewKey-Handler");
    assert.deepEqual(
      [...KEYNAV_OVERLAY_IDS].sort(),
      ["overlay-album", "overlay-menu", "overlay-quest", "overlay-shop", "overlay-stack"],
      "keyNav = Stapel/Shop/Logbuch/Album/Menü",
    );
  });

  test("keyNav ⊆ blocking (ein navigierbares Overlay ist immer auch blockierend)", () => {
    const blocking = new Set(BLOCKING_OVERLAY_IDS);
    for (const id of KEYNAV_OVERLAY_IDS) assert.ok(blocking.has(id), `${id} ist keyNav, muss also blocking sein`);
  });

  test("OVERLAY_ID bildet jeden Schlüssel auf seine Panel-ID ab (für Einzel-Checks in main.ts)", () => {
    assert.equal(OVERLAY_ID.review, "overlay-review");
    assert.equal(OVERLAY_ID.quest, "overlay-quest");
    assert.equal(OVERLAY_ID.album, "overlay-album");
    for (const o of OVERLAYS) assert.equal(OVERLAY_ID[o.key], o.id, `${o.key} → ${o.id}`);
  });

  test("Register-Einträge sind konsistent: id = 'overlay-'+key, eindeutige ids/keys", () => {
    for (const o of OVERLAYS) assert.equal(o.id, `overlay-${o.key}`, `${o.key}: id folgt der Konvention overlay-<key>`);
    assert.equal(new Set(OVERLAYS.map(o => o.id)).size, OVERLAYS.length, "keine doppelten ids");
    assert.equal(new Set(OVERLAYS.map(o => o.key)).size, OVERLAYS.length, "keine doppelten keys");
  });

  test("Detektion greift wirklich (Red-Green): eine erfundene Panel-ID würde auffliegen", () => {
    // No-op-Schutz: der Anti-Drift-Vergleich MUSS bei einer Abweichung rot werden.
    const withExtra = overlayIdsInHtml(indexHtml + '<div id="overlay-phantom">');
    assert.notDeepEqual(withExtra, OVERLAYS.map(o => o.id).sort(), "ein zusätzliches HTML-Overlay muss die Abweichung zeigen");
  });
});
