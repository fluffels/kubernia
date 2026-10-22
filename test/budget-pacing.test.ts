/* Budget-Pacing (#1358): Entscheidung ok/knapp/stopp aus dem Rate-Limit-Snapshot, Quellen, Snapshot-I/O, CLI. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { altName, ohneKernEnv } from "./support/env-alt";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/budget-lib.mjs";

type Fenster = { pct: number; resetsAt: number };
type Snap = { stand: number; quelle?: string; sevenDay?: Fenster; fiveHour?: Fenster };
type Urteil = { status: string; pauseBis: number | null; ist7: number | null; soll7: number | null; ist5: number | null; warnungen: string[] };
const B = raw as unknown as {
  pacing: (s: unknown, o?: { jetzt?: number; zielquote?: number }) => Urteil;
  ausStatusline: (i: unknown, j?: number) => Snap | null;
  ausProbe: (z: string[], j?: number) => Snap | null;
  zielquoteAusEnv: (e: Record<string, string>) => { zielquote: number; warnung?: string };
  brauchtProbe: (s: unknown, j?: number) => boolean;
  liesSnapshot: (p: string) => { snapshot: Snap | null; warnung: string | null };
  snapshotPfad: (e: Record<string, string>) => string;
  schreibeSnapshot: (s: unknown, p: string) => void;
};

const WOCHE = 7 * 24 * 3_600_000;
const JETZT = Date.UTC(2026, 9, 15, 12, 0, 0);
/** 7d-Fenster, das zur Hälfte verstrichen ist (Soll bei Zielquote 60: 30 %). */
const HALB = (JETZT + WOCHE / 2) / 1000;
const snap = (extra: Partial<Snap>): Snap => ({ stand: JETZT, quelle: "statusline", ...extra });
const p = (s: unknown, o: { jetzt?: number; zielquote?: number } = {}) => B.pacing(s, { jetzt: JETZT, zielquote: 60, ...o });
const sieben = (pct: number, resetsAt = HALB): Fenster => ({ pct, resetsAt });
const fuenf = (pct: number): Fenster => ({ pct, resetsAt: JETZT / 1000 + 3600 });

describe("pacing: 7-Tage-Fenster", () => {
  test.each([
    [30, "ok"],
    [35, "ok"], // Grenze Soll + 5 ist noch ok (strikt größer)
    [35.01, "knapp"],
    [59.9, "knapp"],
    [60, "stopp"], // ab Zielquote
    [100, "stopp"],
  ])("Ist %s bei Soll 30 ergibt %s", (ist, erwartet) => {
    expect(p(snap({ sevenDay: sieben(ist) })).status).toBe(erwartet);
  });

  test("knapp nennt die Wartezeit bis Soll + Toleranz gleich Ist ist", () => {
    const u = p(snap({ sevenDay: sieben(45) }));
    expect(u.status).toBe("knapp");
    // Soll(t) = 60 % × Anteil = 40 ⇒ Anteil 2/3 ⇒ Fensterstart + 4,67 d
    const start = HALB * 1000 - WOCHE;
    expect(u.pauseBis).toBeCloseTo(start + (WOCHE * 40) / 60, -2);
    expect(u.pauseBis as number).toBeGreaterThan(JETZT);
    expect(u.soll7).toBeCloseTo(30);
  });

  test("stopp wartet bis zum Reset des Wochenfensters", () => {
    const u = p(snap({ sevenDay: sieben(61) }));
    expect(u).toMatchObject({ status: "stopp", pauseBis: HALB * 1000 });
  });

  test("Fenster ohne Verlauf (Reset mehr als 7 Tage voraus) hat Anteil 0", () => {
    const u = p(snap({ sevenDay: sieben(6, (JETZT + 2 * WOCHE) / 1000) }));
    expect(u.soll7).toBe(0);
    expect(u.status).toBe("knapp");
  });

  test("Zielquote wirkt auf Soll und Stopp", () => {
    expect(p(snap({ sevenDay: sieben(45) }), { zielquote: 85 }).status).toBe("ok");
    expect(p(snap({ sevenDay: sieben(45) }), { zielquote: 45 }).status).toBe("stopp");
  });

  test.each([
    ["Nicht-Zahl", "x"],
    ["negativ", -3],
  ])("ungültiger Wert (%s) macht das Fenster ungültig: ok mit Warnung", (_n, pct) => {
    const u = p(snap({ sevenDay: { pct: pct as number, resetsAt: HALB } }));
    expect(u.status).toBe("ok");
    expect(u.warnungen.join()).toMatch(/7-Tage-Fenster/);
  });

  test("Werte über 100 werden auf 100 begrenzt", () => {
    expect(p(snap({ sevenDay: sieben(120) })).ist7).toBe(100);
  });

  test("Reset in der Vergangenheit: Fenster abgelaufen, ok mit Warnung", () => {
    const u = p(snap({ sevenDay: sieben(99, JETZT / 1000 - 1) }));
    expect(u.status).toBe("ok");
    expect(u.warnungen.join()).toMatch(/abgelaufen/);
  });
});

describe("pacing: 5-Stunden-Fenster", () => {
  test("ab 90 % knapp bis zum Reset, darunter ok", () => {
    const u = p(snap({ fiveHour: fuenf(90), sevenDay: sieben(20) }));
    expect(u).toMatchObject({ status: "knapp", pauseBis: JETZT + 3_600_000 });
    expect(p(snap({ fiveHour: fuenf(89.9), sevenDay: sieben(20) })).status).toBe("ok");
  });

  test("fehlendes 5h-Fenster ist normal, ohne Warnung", () => {
    expect(p(snap({ sevenDay: sieben(20) })).warnungen).toEqual([]);
  });

  test("abgelaufenes 5h-Fenster zählt nicht", () => {
    expect(p(snap({ fiveHour: { pct: 99, resetsAt: JETZT / 1000 - 5 }, sevenDay: sieben(20) })).status).toBe("ok");
  });

  test("nur das 5h-Fenster: Pause greift, Wochenstand unbekannt wird gewarnt", () => {
    const u = p(snap({ fiveHour: fuenf(95) }));
    expect(u.status).toBe("knapp");
    expect(u.warnungen.join()).toMatch(/7-Tage/);
  });

  test("beide Fenster: stopp schlägt knapp, pauseBis ist das Maximum", () => {
    const u = p(snap({ fiveHour: fuenf(95), sevenDay: sieben(70) }));
    expect(u).toMatchObject({ status: "stopp", pauseBis: HALB * 1000 });
    const kurz = p(snap({ fiveHour: { pct: 95, resetsAt: HALB + 100 }, sevenDay: sieben(45) }));
    expect(kurz.status).toBe("knapp");
    expect(kurz.pauseBis).toBe((HALB + 100) * 1000);
  });
});

describe("pacing: Alter und fehlender Stand (fail-open)", () => {
  test("ohne Snapshot, mit Müll oder ohne Zeitstempel: ok mit Warnung", () => {
    for (const s of [null, undefined, "x"]) expect(p(s)).toMatchObject({ status: "ok", pauseBis: null });
    expect(p(null).warnungen).toHaveLength(1);
    expect(p({ sevenDay: sieben(99) }).warnungen.join()).toMatch(/Zeitstempel/);
  });

  test("genau 15 min alt ist frisch, eine Millisekunde mehr veraltet", () => {
    const frisch = p(snap({ stand: JETZT - 15 * 60_000, sevenDay: sieben(45) }));
    expect(frisch.status).toBe("knapp");
    const alt = p(snap({ stand: JETZT - 15 * 60_000 - 1, sevenDay: sieben(45) }));
    expect(alt.status).toBe("ok");
    expect(alt.warnungen.join()).toMatch(/alt/);
  });

  test("veraltet behält stopp und die 5h-Pause", () => {
    const stand = JETZT - 3_600_000;
    expect(p(snap({ stand, sevenDay: sieben(70) })).status).toBe("stopp");
    expect(p(snap({ stand, fiveHour: fuenf(95) })).status).toBe("knapp");
  });
});

describe("zielquoteAusEnv", () => {
  test("gültiger Wert, Default und ungültige Werte mit Warnung", () => {
    expect(B.zielquoteAusEnv({ FACTORY_PACING_ZIELQUOTE: "70" })).toEqual({ zielquote: 70 });
    expect(B.zielquoteAusEnv({ FACTORY_PACING_ZIELQUOTE: "100" })).toEqual({ zielquote: 100 });
    expect(B.zielquoteAusEnv({ FACTORY_PACING_ZIELQUOTE: "1" })).toEqual({ zielquote: 1 });
    expect(B.zielquoteAusEnv({})).toEqual({ zielquote: 65 });
    for (const v of ["abc", "0", "0.5", "150", "", "-5"]) {
      const r = B.zielquoteAusEnv({ FACTORY_PACING_ZIELQUOTE: v });
      expect(r.zielquote).toBe(65);
      expect(r.warnung).toMatch(/ungültig/);
    }
  });
});

describe("ausStatusline", () => {
  const rl = { five_hour: { used_percentage: 23.5, resets_at: 1792098000 }, seven_day: { used_percentage: 41, resets_at: 1792184400 } };
  test("beide Fenster, nur eins, ohne rate_limits, kein Objekt", () => {
    expect(B.ausStatusline({ rate_limits: rl }, 5)).toEqual({
      stand: 5,
      quelle: "statusline",
      sevenDay: { pct: 41, resetsAt: 1792184400 },
      fiveHour: { pct: 23.5, resetsAt: 1792098000 },
    });
    expect(B.ausStatusline({ rate_limits: { five_hour: rl.five_hour } }, 5)).not.toHaveProperty("sevenDay");
    expect(B.ausStatusline({ model: "x" })).toBeNull();
    expect(B.ausStatusline({ rate_limits: {} })).toBeNull();
    expect(B.ausStatusline({ rate_limits: { seven_day: { used_percentage: "x", resets_at: 1 } } })).toBeNull();
    for (const k of [null, 7, "x"]) expect(B.ausStatusline(k)).toBeNull();
  });
});

describe("ausProbe", () => {
  const event = '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","unifiedWindows":{"five_hour":{"utilization":0.66,"resetsAt":1792098000},"seven_day":{"utilization":0.18,"resetsAt":1792184400}}}}';
  test("liest die Fenster aus dem echten Event (Bruchteil mal 100)", () => {
    const s = B.ausProbe(['{"type":"system"}', event, "kaputt{"], 9);
    expect(s?.quelle).toBe("probe");
    expect(s?.fiveHour?.pct).toBeCloseTo(66);
    expect(s?.sevenDay).toMatchObject({ resetsAt: 1792184400 });
    expect(s?.sevenDay?.pct).toBeCloseTo(18);
  });
  test("ohne Event oder nur kaputte Zeilen: null", () => {
    expect(B.ausProbe(['{"type":"result"}', "x"])).toBeNull();
    expect(B.ausProbe([])).toBeNull();
  });
  test("ältere Form mit einem Fenster am Event", () => {
    const alt = '{"type":"rate_limit_event","rateLimitType":"seven_day","utilization":0.5,"resetsAt":1792184400}';
    expect(B.ausProbe([alt])?.sevenDay?.pct).toBeCloseTo(50);
  });
  test("ältere Form mit dem 5h-Fenster", () => {
    const alt = '{"type":"rate_limit_event","rateLimitType":"five_hour","utilization":0.25,"resetsAt":1792098000}';
    const s = B.ausProbe([alt]);
    expect(s?.fiveHour?.pct).toBeCloseTo(25);
    expect(s).not.toHaveProperty("sevenDay");
  });
  test("das letzte Event gewinnt", () => {
    const neu = event.replace("0.18", "0.19");
    expect(B.ausProbe([event, neu])?.sevenDay?.pct).toBeCloseTo(19);
  });
});

describe("liesSnapshot und CLI", () => {
  let dir = "";
  const alle: string[] = [];
  afterEach(() => {
    for (const d of alle.splice(0)) rmSync(d, { recursive: true, force: true });
    dir = "";
  });
  const neu = () => {
    dir = mkdtempSync(join(tmpdir(), "kq-budget-"));
    alle.push(dir);
    return dir;
  };

  test("fehlende Datei und kaputtes JSON liefern null mit Grund", () => {
    const d = neu();
    expect(B.liesSnapshot(join(d, "nix.json"))).toMatchObject({ snapshot: null, warnung: expect.stringMatching(/fehlt/) as string });
    writeFileSync(join(d, "k.json"), "{nicht json");
    expect(B.liesSnapshot(join(d, "k.json"))).toMatchObject({ snapshot: null, warnung: expect.stringMatching(/kaputtes JSON/) as string });
    writeFileSync(join(d, "n.json"), "42");
    expect(B.liesSnapshot(join(d, "n.json")).snapshot).toBeNull();
  });

  test("schreibeSnapshot: Erfolg legt die Datei an, ein Fehler räumt die Temp-Datei weg und wirft weiter", () => {
    const d = neu();
    B.schreibeSnapshot({ stand: 1 }, join(d, "ok.json"));
    expect(JSON.parse(readFileSync(join(d, "ok.json"), "utf8"))).toEqual({ stand: 1 });
    mkdirSync(join(d, "ziel.json"));
    expect(() => B.schreibeSnapshot({ stand: 1 }, join(d, "ziel.json"))).toThrow();
    expect(readdirSync(d).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  test("CLI: nicht schreibbarer Snapshot-Pfad ergibt eine Warnung, der Stand der Probe gilt trotzdem", () => {
    const d = neu();
    mkdirSync(join(d, "ziel.json"));
    const probe = join(d, "probe.mjs");
    writeFileSync(probe, `console.log(${JSON.stringify(JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.9, resetsAt: Math.floor(Date.now() / 1000) + 3.5 * 86400 } } } }))});`);
    const r = spawnSync(process.execPath, ["scripts/budget-pacing.mjs", "--json"], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_RATE_LIMITS_SNAPSHOT: join(d, "ziel.json"), FACTORY_PACING_PROBE_SKRIPT: probe, FACTORY_PACING_ZIELQUOTE: "65" },
    });
    expect(r.status).toBe(4);
    expect((JSON.parse(r.stdout) as Urteil).warnungen.join()).toMatch(/Snapshot nicht schreibbar/);
  });

  test("snapshotPfad: Env überschreibt, sonst OS-Temp", () => {
    expect(B.snapshotPfad({ FACTORY_RATE_LIMITS_SNAPSHOT: "/x/y.json" })).toBe("/x/y.json");
    expect(B.snapshotPfad({})).toBe(join(tmpdir(), "claude-rate-limits.json"));
  });

  const cli = (snapshot: Snap | string | null, env: Record<string, string> = {}, args: string[] = ["--ohne-probe", "--json"]) => {
    const d = neu();
    const pfad = join(d, "s.json");
    if (snapshot !== null) writeFileSync(pfad, typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot));
    const basis: Record<string, string | undefined> = { ...process.env };
    // Eine Zielquote aus der Umgebung der Maintainerin (nur der neue Name wirkt) darf die Tests nicht verschieben.
    ohneKernEnv(basis, "FACTORY_PACING_ZIELQUOTE");
    Object.assign(basis, { FACTORY_RATE_LIMITS_SNAPSHOT: pfad, ...env });
    const r = spawnSync(process.execPath, ["scripts/budget-pacing.mjs", ...args], { encoding: "utf8", env: basis });
    return { code: r.status, out: r.stdout, err: r.stderr, pfad };
  };
  const jetztS = () => Math.floor(Date.now() / 1000);
  const wochenfenster = (haelfte: number) => ({ pct: haelfte, resetsAt: jetztS() + 3.5 * 86400 });

  test.each([
    ["ok", { pct: 10 }, 0],
    ["knapp", { pct: 50 }, 3],
    ["stopp", { pct: 90 }, 4],
  ])("CLI: %s ergibt Exit %i", (status, w, code) => {
    const r = cli({ stand: Date.now(), quelle: "statusline", sevenDay: { ...wochenfenster(0), ...w } });
    expect(r.code).toBe(code);
    expect((JSON.parse(r.out) as Urteil).status).toBe(status);
  });

  test("CLI: fehlender oder kaputter Snapshot ist fail-open (Exit 0 mit Warnung)", () => {
    for (const s of [null, "{kaputt"]) {
      const r = cli(s);
      expect(r.code).toBe(0);
      expect((JSON.parse(r.out) as Urteil).warnungen.length).toBeGreaterThan(0);
    }
  });

  test("CLI: ungültiger Aufruf endet mit Exit 2, Zielquote per Env", () => {
    const r = spawnSync(process.execPath, ["scripts/budget-pacing.mjs", "--gibtsnicht"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    const streng = cli({ stand: Date.now(), quelle: "statusline", sevenDay: { pct: 20, resetsAt: jetztS() + 3.5 * 86400 } }, { FACTORY_PACING_ZIELQUOTE: "20" });
    expect(streng.code).toBe(4);
  });

  test("CLI: der Altname der Zielquote wirkt nicht mehr und warnt nicht", () => {
    const snap = { stand: Date.now(), quelle: "statusline", sevenDay: { pct: 20, resetsAt: jetztS() + 3.5 * 86400 } };
    const ohneVariable = cli(snap);
    const mitAltname = cli(snap, { [altName("FACTORY_PACING_ZIELQUOTE")]: "20" });
    expect(mitAltname.code).toBe(ohneVariable.code);
    expect((JSON.parse(mitAltname.out) as { zielquote: number }).zielquote).toBe((JSON.parse(ohneVariable.out) as { zielquote: number }).zielquote);
    expect(mitAltname.err).toBe("");
    expect(cli(snap, { FACTORY_PACING_ZIELQUOTE: "20" }).code).toBe(4);
  });

  test("CLI: Textausgabe nennt Status, Pause, Werte und Warnungen", () => {
    const knapp = cli({ stand: Date.now(), quelle: "statusline", sevenDay: wochenfenster(50) }, {}, ["--ohne-probe"]);
    expect(knapp.code).toBe(3);
    const zeilen = knapp.out.trim().split("\n");
    expect(zeilen[0]).toMatch(/^knapp · Pause bis \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(.+\)$/);
    expect(zeilen[1]).toMatch(/^7d: Ist 50 %, Soll [\d.]+ %, Zielquote 65 % · 5h: \? · Quelle: statusline · Alter: \d+ min$/);
    const offen = cli(null, {}, ["--ohne-probe"]);
    expect(offen.code).toBe(0);
    expect(offen.out.split("\n")[0]).toBe("ok");
    expect(offen.out).toMatch(/^Warnung: .*fehlt/m);
  });

  describe("Headless-Probe (ersetzt durch ein Skript, kein echter Aufruf)", () => {
    const probeSkript = (zeilen: string[]) => {
      const pfad = join(dir, "probe.mjs");
      writeFileSync(pfad, `console.log(${JSON.stringify(zeilen.join("\n"))});`);
      return pfad;
    };
    const event = (siebenTage: number) =>
      JSON.stringify({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { seven_day: { utilization: siebenTage, resetsAt: jetztS() + 3.5 * 86400 } } } });

    test("fehlender Snapshot: die Probe liefert den Stand und wird als Snapshot abgelegt", () => {
      neu();
      const r = cli(null, { FACTORY_PACING_PROBE_SKRIPT: probeSkript([event(0.9)]) }, ["--json"]);
      expect(r.code).toBe(4);
      expect(JSON.parse(r.out)).toMatchObject({ status: "stopp", quelle: "probe" });
      expect(JSON.parse(readFileSync(r.pfad, "utf8"))).toMatchObject({ quelle: "probe" });
    });

    test("Probe ohne Ergebnis: fail-open mit Warnung, kein Snapshot", () => {
      const r = cli(null, { FACTORY_PACING_PROBE_SKRIPT: join(tmpdir(), "gibt-es-nicht.mjs") }, ["--json"]);
      expect(r.code).toBe(0);
      expect((JSON.parse(r.out) as Urteil).warnungen.join()).toMatch(/Probe lieferte keinen Stand/);
      expect(existsSync(r.pfad)).toBe(false);
    });

    test("frischer Snapshot mit Wochenstand startet keine Probe, einer ohne Wochenstand schon", () => {
      const frisch = { stand: Date.now(), quelle: "statusline", sevenDay: wochenfenster(10) };
      const skript = join(tmpdir(), "gibt-es-nicht.mjs");
      expect((JSON.parse(cli(frisch, { FACTORY_PACING_PROBE_SKRIPT: skript }, ["--json"]).out) as Urteil).warnungen).toEqual([]);
      const ohne7 = cli({ stand: Date.now(), quelle: "statusline" }, { FACTORY_PACING_PROBE_SKRIPT: skript }, ["--json"]);
      expect((JSON.parse(ohne7.out) as Urteil).warnungen.join()).toMatch(/Probe lieferte keinen Stand/);
    });
  });
});

describe("brauchtProbe", () => {
  const f = { pct: 10, resetsAt: JETZT / 1000 + 100 };
  test("fehlt, veraltet oder ohne 7-Tage-Fenster ja, frisch mit Wochenstand nein", () => {
    expect(B.brauchtProbe(null, JETZT)).toBe(true);
    expect(B.brauchtProbe({ stand: JETZT - 15 * 60_000 - 1, sevenDay: f }, JETZT)).toBe(true);
    expect(B.brauchtProbe({ stand: JETZT, fiveHour: f }, JETZT)).toBe(true);
    expect(B.brauchtProbe({ stand: JETZT - 15 * 60_000, sevenDay: f }, JETZT)).toBe(false);
  });
});
