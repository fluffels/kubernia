/* Sync-Stand dieses Projekts (#1882, ADR 0022 F10).
 *
 * @harness-waechter – Projekt-Test (bleibt im Projekt): kubernia bezieht den Kern per Sync von einem Tag des Factory-Repos. Das Drift-Gate
 * (`scripts/check-factory-drift.mjs`, Besitz) meldet ohne `.factory/sync-stand.json` nur „entfällt“; erst dieser Test fängt, dass der
 * Sync-Stand gelöscht wurde oder nicht von einem Tag stammt. Das Tag wird bewusst nicht wörtlich geprüft, sonst bräche jeder spätere Sync.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeDrift as pruefeDriftRoh } from "../../scripts/check-factory-drift.mjs";

type DriftErgebnis = { entfaellt: boolean; fehler: string[] };
const pruefeDrift = pruefeDriftRoh as (lies: (pfad: string) => string | null) => DriftErgebnis;
const SYNC_WEG = "npm run factory:sync -- --quelle <klon> --tag <name>";

/** Befunde zu einem gelesenen Sync-Stand (null = Datei fehlt); leer heißt sauber. */
function syncStandBefunde(json: unknown): string[] {
  if (json === null) return ["kein Sync-Stand: der Kern kommt per Sync vom Tag"];
  const quelle = (json as { quelle?: { tag?: unknown; commit?: unknown; sauber?: unknown } } | undefined)?.quelle;
  const out: string[] = [];
  if (typeof quelle?.tag !== "string" || quelle.tag === "") out.push("quelle.tag fehlt oder ist leer");
  if (quelle?.sauber !== true) out.push("quelle.sauber ist nicht true (Entwurfs-Sync)");
  if (!/^[0-9a-f]{40}$/.test(String(quelle?.commit))) out.push("quelle.commit ist kein 40-stelliger Hash");
  return out;
}

const HASH = "e800f2747d24041a38fde208fb0fd3fbe90d90c2";
const GUT = { quelle: { tag: "v0.1.0", commit: HASH, sauber: true } };

describe("Sync-Stand von einem Tag", () => {
  test("`.factory/sync-stand.json` nennt Tag, Commit und `sauber: true`", () => {
    assert.ok(existsSync(".factory/sync-stand.json"), `kein Sync-Stand: der Kern kommt per Sync vom Tag (${SYNC_WEG})`);
    assert.deepEqual(syncStandBefunde(JSON.parse(readFileSync(".factory/sync-stand.json", "utf8"))), [], SYNC_WEG);
  });

  test("Red-Green: ein guter Stand ist sauber, jeder kaputte Zustand wird einzeln gemeldet", () => {
    assert.deepEqual(syncStandBefunde(GUT), []);
    assert.match(syncStandBefunde(null).join(), /kein Sync-Stand/);
    assert.match(syncStandBefunde({}).join(), /quelle.tag/);
    assert.deepEqual(syncStandBefunde({ quelle: { ...GUT.quelle, tag: "" } }), ["quelle.tag fehlt oder ist leer"]);
    assert.deepEqual(syncStandBefunde({ quelle: { ...GUT.quelle, tag: 1 } }), ["quelle.tag fehlt oder ist leer"]);
    assert.deepEqual(syncStandBefunde({ quelle: { ...GUT.quelle, sauber: false } }), ["quelle.sauber ist nicht true (Entwurfs-Sync)"]);
    assert.deepEqual(syncStandBefunde({ quelle: { tag: "v0.1.0", commit: HASH } }), ["quelle.sauber ist nicht true (Entwurfs-Sync)"]);
    for (const commit of [HASH.slice(0, 7), HASH.toUpperCase(), HASH + "0", undefined]) {
      assert.deepEqual(syncStandBefunde({ quelle: { ...GUT.quelle, commit } }), ["quelle.commit ist kein 40-stelliger Hash"], String(commit));
    }
  });

  test("eine von Hand geänderte Kern-Datei macht das Drift-Gate rot und nennt den Weg", () => {
    const lies = (p: string): string | null => {
      if (!existsSync(p)) return null;
      const text = readFileSync(p, "utf8");
      return p === "scripts/check-size.mjs" ? `${text}\n// von Hand geändert\n` : text;
    };
    const r = pruefeDrift(lies);
    assert.equal(r.entfaellt, false);
    const f = r.fehler.find((x) => x.includes("scripts/check-size.mjs"));
    assert.ok(f, `kein Fehler zur geänderten Datei: ${r.fehler.join(" | ")}`);
    assert.match(f, /upstream/);
    assert.match(f, /--tag/);
  });

  test("ohne Sync-Stand meldet das Drift-Gate nur „entfällt“ (darum der Test oben)", () => {
    const r = pruefeDrift((p: string) => (p === ".factory/sync-stand.json" ? null : existsSync(p) ? readFileSync(p, "utf8") : null));
    assert.equal(r.entfaellt, true);
  });
});
