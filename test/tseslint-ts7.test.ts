/* TS-7-Freigabe-Wächter (#847) — meldet, sobald typescript-eslint TS 7 zulässt,
 * damit das (upstream blockierte, in dependabot.yml ge-ignore-te) Upgrade NICHT
 * vergessen wird. Der eigentliche Abgleich fragt die npm-Registry (Netz, nicht
 * deterministisch) und läuft als eigener non-blocking CI-Job — NICHT in dieser
 * hermetischen Suite. Getestet wird hier die REINE, offline + deterministische
 * Range-Logik `peerAllowsTs7`: „erlaubt dieser typescript-Peer eine 7.x-Version?".
 * Fitness-Function-Kategorie neben docdrift/doctickets — kein Verhaltens-Test.
 *
 * Ausführen mit:  npm test   (der Registry-Abgleich: npm run check:tseslint-ts7)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";

// Reines Node-Tooling-Skript ohne Declaration-File (scripts/ nicht im tsconfig).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkTseslintTs7 from "../scripts/check-tseslint-ts7.mjs";

const peerAllowsTs7: (range: string | null | undefined) => boolean = checkTseslintTs7.peerAllowsTs7;

describe("TS-7-Freigabe-Wächter (#847)", () => {
  // ── Red-Green: der reale Ist-Zustand blockiert, plausible Freigaben lassen durch ──

  test("der aktuelle typescript-eslint-Peer blockiert TS 7 (Regressions-Lock auf #847)", () => {
    // Exakt der Peer, an dem #847 hängt — muss FALSE sein, sonst hätte der Wächter
    // in der Realität längst Alarm geschlagen (Red-Green-Anker gegen einen kaputten Parser).
    assert.equal(peerAllowsTs7(">=4.8.4 <6.1.0"), false);
  });

  test("erlaubt TS 7, sobald die Obergrenze 7.x einschließt", () => {
    assert.equal(peerAllowsTs7(">=4.8.4 <7.1.0"), true); // 7.0.x fällt rein
    assert.equal(peerAllowsTs7(">=4.8.4 <8.0.0"), true); // ganze 7.x-Reihe
    assert.equal(peerAllowsTs7(">=7.0.0"), true); // untere Schranke auf 7
    assert.equal(peerAllowsTs7(">=5.0.0 <9.0.0"), true);
  });

  test("blockiert weiterhin, wenn die Obergrenze 7 ausschließt", () => {
    assert.equal(peerAllowsTs7(">=4.8.4 <7.0.0"), false); // schließt alle 7.x aus
    assert.equal(peerAllowsTs7(">=4.8.4 <6.9.9"), false);
    assert.equal(peerAllowsTs7("<5.0.0"), false);
  });

  test("Randfälle: <=7.x zählt als erlaubt, <=6.x nicht", () => {
    assert.equal(peerAllowsTs7(">=4.8.4 <=7.2.0"), true);
    assert.equal(peerAllowsTs7(">=4.8.4 <=6.9.9"), false);
  });

  test("ODER-Alternativen (||) werden respektiert", () => {
    assert.equal(peerAllowsTs7("<6.1.0 || >=7.0.0 <8.0.0"), true);
    // Zwei Alternativen, von denen keine eine 7.x zulässt → false.
    assert.equal(peerAllowsTs7("<6.0.0 || >=6.0.3 <6.1.0"), false);
  });

  test("unbeschränkte / leere Ranges gelten als erlaubt (permissiver Bias)", () => {
    // Fehlt der Peer ganz (null) oder ist er „*", ist typescript unbeschränkt →
    // TS 7 möglich. Lieber ein Fehlalarm (Mensch prüft) als ein verpasstes Signal.
    assert.equal(peerAllowsTs7(null), true);
    assert.equal(peerAllowsTs7(undefined), true);
    assert.equal(peerAllowsTs7(""), true);
    assert.equal(peerAllowsTs7("*"), true);
  });
});
