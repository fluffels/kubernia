/* Statusline-Weiche (#1358): Snapshot ablegen, persönliche Statusline unverändert durchreichen, nie werfen. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const KOPIE = 'node -e "process.stdin.pipe(process.stdout)"';
const PAYLOAD = JSON.stringify({
  model: { display_name: "Ä-Modell" },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: 1792098000 }, seven_day: { used_percentage: 34, resets_at: 1792184400 } },
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function lauf(stdin: string, kommando: string | null, env: Record<string, string> = {}) {
  dir = mkdtempSync(join(tmpdir(), "statusline-"));
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify(kommando === null ? {} : { statusLine: { type: "command", command: kommando } }));
  const snapshot = join(dir, "snap.json");
  const r = spawnSync(process.execPath, ["scripts/statusline.mjs"], {
    input: stdin,
    env: { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot, FACTORY_STATUSLINE_DURCHREICHEN: "", ...env },
  });
  return { code: r.status, out: r.stdout.toString("utf8"), snapshot };
}

describe("scripts/statusline.mjs", () => {
  test("reicht die persönliche Statusline byte-gleich durch und legt den Snapshot ab", () => {
    const r = lauf(PAYLOAD, KOPIE);
    expect(r.code).toBe(0);
    expect(r.out).toBe(PAYLOAD);
    const s: unknown = JSON.parse(readFileSync(r.snapshot, "utf8"));
    expect(s).toMatchObject({ quelle: "statusline", sevenDay: { pct: 34, resetsAt: 1792184400 }, fiveHour: { pct: 12 } });
  });

  test("ohne rate_limits bleibt ein vorhandener Snapshot unberührt", () => {
    dir = mkdtempSync(join(tmpdir(), "statusline-"));
    const snapshot = join(dir, "snap.json");
    writeFileSync(snapshot, '{"alt":true}');
    const settings = join(dir, "s.json");
    writeFileSync(settings, "{}");
    const r = spawnSync(process.execPath, ["scripts/statusline.mjs"], {
      input: '{"model":"x"}',
      env: { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot },
    });
    expect(r.status).toBe(0);
    expect(readFileSync(snapshot, "utf8")).toBe('{"alt":true}');
  });

  test("Teil-Snapshot ohne 7-Tage-Fenster ersetzt keinen vorhandenen Wochenstand, mit Wochenstand schon", () => {
    dir = mkdtempSync(join(tmpdir(), "statusline-"));
    const snapshot = join(dir, "snap.json");
    const settings = join(dir, "s.json");
    writeFileSync(settings, "{}");
    const alt = '{"stand":1,"quelle":"probe","sevenDay":{"pct":5,"resetsAt":1792184400}}';
    writeFileSync(snapshot, alt);
    const env = { ...process.env, FACTORY_USER_SETTINGS: settings, FACTORY_RATE_LIMITS_SNAPSHOT: snapshot };
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: '{"rate_limits":{"five_hour":{"used_percentage":9,"resets_at":1792098000}}}', env });
    expect(readFileSync(snapshot, "utf8")).toBe(alt);
    spawnSync(process.execPath, ["scripts/statusline.mjs"], { input: PAYLOAD, env });
    expect(JSON.parse(readFileSync(snapshot, "utf8"))).toMatchObject({ quelle: "statusline", sevenDay: { pct: 34 } });
  });

  test("Teil-Snapshot wird geschrieben, wenn noch kein Wochenstand da ist (fehlt oder ohne sevenDay)", () => {
    const teil = '{"rate_limits":{"five_hour":{"used_percentage":9,"resets_at":1792098000}}}';
    const r = lauf(teil, null);
    expect(JSON.parse(readFileSync(r.snapshot, "utf8"))).toMatchObject({ fiveHour: { pct: 9 } });
    writeFileSync(r.snapshot, '{"stand":1,"quelle":"probe","fiveHour":{"pct":1,"resetsAt":1}}');
    spawnSync(process.execPath, ["scripts/statusline.mjs"], {
      input: teil,
      env: { ...process.env, FACTORY_USER_SETTINGS: join(dir, "settings.json"), FACTORY_RATE_LIMITS_SNAPSHOT: r.snapshot },
    });
    expect(JSON.parse(readFileSync(r.snapshot, "utf8"))).toMatchObject({ quelle: "statusline", fiveHour: { pct: 9 } });
  });

  test("ohne persönliche Statusline: leere Ausgabe, Exit 0, Snapshot trotzdem da", () => {
    const r = lauf(PAYLOAD, null);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(existsSync(r.snapshot)).toBe(true);
  });

  test("kaputtes stdin: Exit 0, Durchreichung läuft, kein Snapshot", () => {
    const r = lauf("{kein json", KOPIE);
    expect(r.code).toBe(0);
    expect(r.out).toBe("{kein json");
    expect(existsSync(r.snapshot)).toBe(false);
  });

  test("Schleifenschutz: im Kind (FACTORY_STATUSLINE_DURCHREICHEN=1) wird nichts durchgereicht", () => {
    const r = lauf(PAYLOAD, KOPIE, { FACTORY_STATUSLINE_DURCHREICHEN: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("persönliches Kommando mit Exit 1: dessen Ausgabe erscheint, Exit 0", () => {
    const r = lauf(PAYLOAD, 'node -e "process.stdout.write(\'zeile\'); process.exit(1)"');
    expect(r.code).toBe(0);
    expect(r.out).toBe("zeile");
  });
});
