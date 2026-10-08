/* Sandbox-Doktor (#1432): pure Prüffunktionen mit Negativfällen, Vorlage und CLI-Verhalten.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board-haertung.test.ts). */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sandbox-doctor.mjs";

type Ergebnis = { status: "OK" | "FEHLT" | "HINWEIS"; text: string };
type Cred = { name: string; mode: string; injectHosts?: string[] };
type Settings = {
  env?: Record<string, string>;
  sandbox?: {
    enabled?: boolean;
    failIfUnavailable?: boolean;
    allowUnsandboxedCommands?: boolean;
    network?: { strictAllowlist?: boolean; tlsTerminate?: unknown; allowedDomains?: string[] };
    credentials?: { allowPlaintextInject?: boolean; envVars?: Cred[] };
  };
};
type Doktor = {
  wslArt: (release: string) => "wsl1" | "wsl2" | null;
  pruefePlattform: (a: { platform: string; release: string; env?: Record<string, string | undefined> }) => Ergebnis[];
  pruefeWerkzeuge: (which: (name: string) => boolean) => Ergebnis[];
  pruefeWslConf: (text: string | null) => Ergebnis[];
  erzeugeVorlage: (a: { projektDomains: string[]; langfuseBaseUrl?: string }) => Settings;
  pruefeUserSettings: (user: Settings | null, vorlage: Settings) => Ergebnis[];
  verhaltensprobe: (io: { home: string; schreibe: (p: string) => void; loesche: (p: string) => void }) => Ergebnis[];
  projektDomains: (settingsText: string) => string[];
};
const D = raw as unknown as Doktor;

const SKRIPT = fileURLToPath(new URL("../scripts/sandbox-doctor.mjs", import.meta.url));
const stati = (r: Ergebnis[]) => r.map((e) => e.status);
const rot = (r: Ergebnis[]) => r.filter((e) => e.status === "FEHLT");

describe("pruefePlattform", () => {
  test("natives Windows ist rot und verweist auf ADR 0021", () => {
    const r = D.pruefePlattform({ platform: "win32", release: "10.0.26300", env: {} });
    expect(stati(r)).toEqual(["FEHLT"]);
    expect(r[0].text).toContain("ADR 0021");
  });
  test("WSL1 (Kernel mit Microsoft, ohne WSL2) ist rot", () => {
    expect(rot(D.pruefePlattform({ platform: "linux", release: "4.4.0-19041-Microsoft", env: {} }))).toHaveLength(1);
  });
  test("WSL2 ist ok", () => {
    expect(stati(D.pruefePlattform({ platform: "linux", release: "5.15.153.1-microsoft-standard-WSL2", env: {} }))).toEqual(["OK"]);
  });
  test("WSL2-Kernel ohne WSL2-Suffix (microsoft-standard) ist ok, nicht WSL1 (#1428 Z26)", () => {
    expect(stati(D.pruefePlattform({ platform: "linux", release: "4.19.104-microsoft-standard", env: {} }))).toEqual(["OK"]);
    expect(D.pruefePlattform({ platform: "linux", release: "4.19.104-microsoft-standard", env: {} })[0].text).toContain("WSL2");
  });
  test("wslArt unterscheidet WSL2, WSL1 und kein WSL am Kernel-Release (#1428 Z26)", () => {
    expect(D.wslArt("5.15.153.1-microsoft-standard-WSL2")).toBe("wsl2");
    expect(D.wslArt("4.19.104-microsoft-standard")).toBe("wsl2");
    expect(D.wslArt("4.4.0-19041-Microsoft")).toBe("wsl1");
    expect(D.wslArt("6.8.0-45-generic")).toBeNull();
    expect(D.wslArt(undefined as unknown as string)).toBeNull();
  });
  test("reines Linux ist ok", () => {
    expect(stati(D.pruefePlattform({ platform: "linux", release: "6.8.0-45-generic", env: {} }))).toEqual(["OK"]);
  });
  test("macOS ist ok (Sandbox dort offiziell unterstützt)", () => {
    expect(stati(D.pruefePlattform({ platform: "darwin", release: "24.0.0", env: {} }))).toEqual(["OK"]);
  });
});

describe("pruefeWerkzeuge", () => {
  test("beide da: ok", () => {
    expect(stati(D.pruefeWerkzeuge(() => true))).toEqual(["OK", "OK"]);
  });
  test("bwrap fehlt: rot mit Installationsbefehl", () => {
    const r = D.pruefeWerkzeuge((n) => n !== "bwrap");
    expect(rot(r)).toHaveLength(1);
    expect(rot(r)[0].text).toContain("bwrap");
    expect(rot(r)[0].text).toContain("apt-get install");
  });
  test("socat fehlt: rot", () => {
    const r = D.pruefeWerkzeuge((n) => n !== "socat");
    expect(rot(r)).toHaveLength(1);
    expect(rot(r)[0].text).toContain("socat");
  });
});

describe("pruefeWslConf", () => {
  const gut = "[automount]\nenabled=false\n\n[interop]\nenabled=false\nappendWindowsPath=false\n";
  test("vollständig: drei OK", () => {
    expect(stati(D.pruefeWslConf(gut))).toEqual(["OK", "OK", "OK"]);
  });
  test("Datei fehlt: alle Defaults sind an, rot", () => {
    expect(rot(D.pruefeWslConf(null)).length).toBeGreaterThanOrEqual(1);
    expect(stati(D.pruefeWslConf(null))).not.toContain("OK");
  });
  test("Interop an: rot", () => {
    const r = D.pruefeWslConf(gut.replace("[interop]\nenabled=false", "[interop]\nenabled=true"));
    expect(rot(r)).toHaveLength(1);
    expect(rot(r)[0].text).toMatch(/interop/i);
  });
  test("appendWindowsPath fehlt: Default true, rot", () => {
    const r = D.pruefeWslConf("[automount]\nenabled=false\n[interop]\nenabled=false\n");
    expect(rot(r)).toHaveLength(1);
    expect(rot(r)[0].text).toContain("appendWindowsPath");
  });
  test("Automount an: rot", () => {
    const r = D.pruefeWslConf(gut.replace("[automount]\nenabled=false", "[automount]\nenabled=true"));
    expect(rot(r)).toHaveLength(1);
    expect(rot(r)[0].text).toMatch(/automount/i);
  });
  test("Groß-/Kleinschreibung, Leerzeichen und Kommentare werden toleriert", () => {
    const text = "# Kommentar\n[Automount]\n Enabled = False ; Zeilenkommentar\n[INTEROP]\nenabled=FALSE\n; noch einer\nAppendWindowsPath = false\n";
    expect(stati(D.pruefeWslConf(text))).toEqual(["OK", "OK", "OK"]);
  });
  test("ein auskommentierter Schlüssel zählt nicht", () => {
    const r = D.pruefeWslConf("[automount]\n#enabled=false\n[interop]\nenabled=false\nappendWindowsPath=false\n");
    expect(rot(r)).toHaveLength(1);
  });
  test("Schlüssel in der falschen Sektion zählt nicht", () => {
    const r = D.pruefeWslConf("[interop]\nenabled=false\nappendWindowsPath=false\n[boot]\nenabled=false\n");
    expect(rot(r).length).toBeGreaterThanOrEqual(1);
  });
});

describe("erzeugeVorlage", () => {
  const domains = ["github.com", "api.github.com"];
  test("Grundform: Flags, strenge Allowlist, GH_TOKEN maskiert, vier Deny-Einträge", () => {
    const v = D.erzeugeVorlage({ projektDomains: domains });
    expect(v.sandbox?.enabled).toBe(true);
    expect(v.sandbox?.failIfUnavailable).toBe(true);
    expect(v.sandbox?.allowUnsandboxedCommands).toBe(false);
    expect(v.sandbox?.network?.strictAllowlist).toBe(true);
    expect(v.sandbox?.network?.tlsTerminate).toEqual({});
    expect(v.sandbox?.network?.allowedDomains).toEqual(domains);
    const envs = v.sandbox?.credentials?.envVars ?? [];
    expect(envs.find((e) => e.name === "GH_TOKEN")).toEqual({ name: "GH_TOKEN", mode: "mask", injectHosts: ["api.github.com", "github.com"] });
    expect(envs.filter((e) => e.mode === "deny").map((e) => e.name).sort()).toEqual(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "GITHUB_TOKEN", "PIXELLAB_TOKEN"]);
  });
  test("ohne Langfuse kein Langfuse-Eintrag", () => {
    const v = D.erzeugeVorlage({ projektDomains: domains });
    expect(JSON.stringify(v)).not.toContain("LANGFUSE");
  });
  test("https-Langfuse: Host in der Allowlist, Secret maskiert, kein allowPlaintextInject", () => {
    const v = D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "https://cloud.langfuse.example/api" });
    expect(v.sandbox?.network?.allowedDomains).toContain("cloud.langfuse.example");
    expect(v.sandbox?.credentials?.envVars).toContainEqual({ name: "LANGFUSE_SECRET_KEY", mode: "mask", injectHosts: ["cloud.langfuse.example"] });
    expect(v.sandbox?.credentials?.allowPlaintextInject).toBeUndefined();
  });
  test("lokales http-Langfuse: allowPlaintextInject gesetzt", () => {
    const v = D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "http://localhost:3000" });
    expect(v.sandbox?.credentials?.allowPlaintextInject).toBe(true);
    expect(v.sandbox?.network?.allowedDomains).toContain("localhost");
  });
  test("ungültige Langfuse-URL wird ignoriert", () => {
    const v = D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "kein url" });
    expect(JSON.stringify(v)).not.toContain("LANGFUSE");
  });
  test("keine Secret-Werte im JSON: nur Namen und Hosts", () => {
    const geheim = "sk-lf-supergeheim-1234";
    const v = D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "https://lf.example" });
    process.env.LANGFUSE_SECRET_KEY = geheim;
    process.env.GH_TOKEN = geheim;
    try {
      expect(JSON.stringify(D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "https://lf.example" }))).not.toContain(geheim);
    } finally {
      delete process.env.LANGFUSE_SECRET_KEY;
      delete process.env.GH_TOKEN;
    }
    expect(JSON.stringify(v)).not.toContain(geheim);
  });
  test("die Projektliste wird nicht verändert", () => {
    const kopie = [...domains];
    D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "https://lf.example" });
    expect(domains).toEqual(kopie);
  });
});

describe("pruefeUserSettings", () => {
  const vorlage = D.erzeugeVorlage({ projektDomains: ["github.com", "api.github.com"], langfuseBaseUrl: "https://lf.example" });
  const kopie = (): Settings => JSON.parse(JSON.stringify(vorlage)) as Settings;
  test("vollständig: kein Rot", () => {
    expect(rot(D.pruefeUserSettings(kopie(), vorlage))).toEqual([]);
    expect(D.pruefeUserSettings(kopie(), vorlage).length).toBeGreaterThan(3);
  });
  test("ohne Datei oder ohne sandbox-Block: rot", () => {
    expect(rot(D.pruefeUserSettings(null, vorlage)).length).toBeGreaterThanOrEqual(1);
    expect(rot(D.pruefeUserSettings({ env: {} }, vorlage)).length).toBeGreaterThanOrEqual(1);
  });
  test("failIfUnavailable fehlt: rot", () => {
    const u = kopie();
    delete u.sandbox?.failIfUnavailable;
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("failIfUnavailable");
  });
  test("enabled nicht true: rot", () => {
    const u = kopie();
    u.sandbox!.enabled = false;
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("enabled");
  });
  test("tlsTerminate fehlt: rot", () => {
    const u = kopie();
    delete u.sandbox!.network!.tlsTerminate;
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("tlsTerminate");
  });
  test("allowUnsandboxedCommands true: rot", () => {
    const u = kopie();
    (u.sandbox as { allowUnsandboxedCommands: boolean }).allowUnsandboxedCommands = true;
    expect(rot(D.pruefeUserSettings(u, vorlage))[0].text).toContain("allowUnsandboxedCommands");
  });
  test("Domain fehlt: rot, die Domain wird genannt", () => {
    const u = kopie();
    (u.sandbox!.network as { allowedDomains: string[] }).allowedDomains = ["github.com"];
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("api.github.com");
  });
  test("zusätzliche Domains sind erlaubt (Obermenge)", () => {
    const u = kopie();
    u.sandbox!.network!.allowedDomains!.push("extra.example");
    expect(rot(D.pruefeUserSettings(u, vorlage))).toEqual([]);
  });
  test("strictAllowlist fehlt: rot", () => {
    const u = kopie();
    delete u.sandbox!.network!.strictAllowlist;
    expect(rot(D.pruefeUserSettings(u, vorlage))[0].text).toContain("strictAllowlist");
  });
  test("GH_TOKEN als deny statt mask: rot", () => {
    const u = kopie();
    const gh = u.sandbox!.credentials!.envVars!.find((e) => e.name === "GH_TOKEN")!;
    gh.mode = "deny";
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("GH_TOKEN");
  });
  test("injectHosts unvollständig: rot", () => {
    const u = kopie();
    u.sandbox!.credentials!.envVars!.find((e) => e.name === "GH_TOKEN")!.injectHosts = ["github.com"];
    expect(rot(D.pruefeUserSettings(u, vorlage))).toHaveLength(1);
  });
  test("Credential-Eintrag fehlt ganz: rot", () => {
    const u = kopie();
    u.sandbox!.credentials!.envVars = u.sandbox!.credentials!.envVars!.filter((e) => e.name !== "PIXELLAB_TOKEN");
    expect(rot(D.pruefeUserSettings(u, vorlage))[0].text).toContain("PIXELLAB_TOKEN");
  });
  test("Secret im env-Block: rot, nur der Name steht in der Meldung, nie der Wert", () => {
    const u = kopie();
    u.env = { GH_TOKEN: "ghp_geheimerwert", LANGFUSE_PUBLIC_KEY: "pk-lf-ok", CC_LANGFUSE_TRACE_TAGS: "kubernia" };
    const r = rot(D.pruefeUserSettings(u, vorlage));
    expect(r).toHaveLength(1);
    expect(r[0].text).toContain("GH_TOKEN");
    expect(JSON.stringify(r)).not.toContain("ghp_geheimerwert");
    expect(JSON.stringify(r)).not.toContain("LANGFUSE_PUBLIC_KEY");
  });
  test("Secret-Muster: SECRET, PASSWORD und _API_KEY zählen", () => {
    const u = kopie();
    u.env = { LANGFUSE_SECRET_KEY: "a", DB_PASSWORD: "b", FOO_API_KEY: "c", HARMLOS: "d" };
    const text = rot(D.pruefeUserSettings(u, vorlage))[0].text;
    for (const n of ["LANGFUSE_SECRET_KEY", "DB_PASSWORD", "FOO_API_KEY"]) expect(text).toContain(n);
    expect(text).not.toContain("HARMLOS");
  });
  test("allowPlaintextInject fehlt, obwohl die Vorlage es verlangt: rot", () => {
    const lokal = D.erzeugeVorlage({ projektDomains: ["github.com"], langfuseBaseUrl: "http://localhost:3000" });
    const u = JSON.parse(JSON.stringify(lokal)) as Settings;
    delete u.sandbox!.credentials!.allowPlaintextInject;
    expect(rot(D.pruefeUserSettings(u, lokal))[0].text).toContain("allowPlaintextInject");
  });
});

describe("verhaltensprobe", () => {
  const home = "/home/agent";
  test("Schreiben gelingt: rot, die Probe-Datei wird sofort gelöscht", () => {
    const geloescht: string[] = [];
    const r = D.verhaltensprobe({ home, schreibe: () => undefined, loesche: (p) => geloescht.push(p) });
    expect(stati(r)).toEqual(["FEHLT"]);
    expect(geloescht).toHaveLength(1);
    expect(geloescht[0].startsWith(home)).toBe(true);
  });
  test("EROFS und EACCES: ok, nichts zu löschen", () => {
    for (const code of ["EROFS", "EACCES", "EPERM"]) {
      const geloescht: string[] = [];
      const r = D.verhaltensprobe({
        home,
        schreibe: () => {
          throw Object.assign(new Error("denied"), { code });
        },
        loesche: (p) => geloescht.push(p),
      });
      expect(stati(r)).toEqual(["OK"]);
      expect(geloescht).toEqual([]);
    }
  });
  test("anderer Fehler (z. B. ENOENT): nur Hinweis, nicht ok", () => {
    const r = D.verhaltensprobe({
      home,
      schreibe: () => {
        throw Object.assign(new Error("weg"), { code: "ENOENT" });
      },
      loesche: () => undefined,
    });
    expect(stati(r)).toEqual(["HINWEIS"]);
  });
});

describe("Integration mit dem echten Projekt", () => {
  test("die Vorlage aus der echten .claude/settings.json enthält alle Projekt-Domains", () => {
    const text = readFileSync(fileURLToPath(new URL("../.claude/settings.json", import.meta.url)), "utf8");
    const domains = D.projektDomains(text);
    expect(domains.length).toBeGreaterThan(5);
    const v = D.erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl: "https://lf.example" });
    for (const d of domains) expect(v.sandbox?.network?.allowedDomains).toContain(d);
  });
  test("projektDomains: kaputtes JSON oder fehlender Block liefert eine leere Liste", () => {
    expect(D.projektDomains("{")).toEqual([]);
    expect(D.projektDomains("{}")).toEqual([]);
  });
});

describe("CLI", () => {
  const lauf = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [SKRIPT, ...args], { encoding: "utf8", env: { ...process.env, LANGFUSE_BASE_URL: "", ...env } });
  test("--vorlage druckt gültiges JSON mit failIfUnavailable und ohne Secret-Werte", () => {
    const r = lauf(["--vorlage"], { LANGFUSE_BASE_URL: "https://lf.example", GH_TOKEN: "ghp_cli_geheim" });
    expect(r.status).toBe(0);
    const json = JSON.parse(r.stdout) as Settings;
    expect(json.sandbox?.failIfUnavailable).toBe(true);
    expect(r.stdout).not.toContain("ghp_cli_geheim");
  });
  test("--check endet immer mit Exit 0 (berichtend) und druckt Statuszeilen", () => {
    const r = lauf(["--check"], { CLAUDE_CONFIG_DIR: fileURLToPath(new URL("./nicht-vorhanden", import.meta.url)) });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^(OK|FEHLT|HINWEIS)\b/m);
  });
  test("--check meldet kaputtes User-Settings-JSON als FEHLT und endet mit Exit 0", () => {
    const dir = mkdtempSync(join(tmpdir(), "kq-sandbox-doctor-"));
    try {
      writeFileSync(join(dir, "settings.json"), "{");
      const r = lauf(["--check"], { CLAUDE_CONFIG_DIR: dir });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/^FEHLT User-Settings: kein gültiges JSON$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("--vorlage führt die Projekt-Allowlist und den Langfuse-Host mit", () => {
    const r = lauf(["--vorlage"], { LANGFUSE_BASE_URL: "https://lf.example" });
    const json = JSON.parse(r.stdout) as Settings;
    expect(json.sandbox?.network?.allowedDomains).toContain("registry.npmjs.org");
    expect(json.sandbox?.network?.allowedDomains).toContain("lf.example");
  });
  test("unbekanntes oder fehlendes Argument: Usage und Exit 2", () => {
    expect(lauf(["--quatsch"]).status).toBe(2);
    expect(lauf([]).status).toBe(2);
    expect(lauf(["--quatsch"]).stderr).toContain("Usage");
  });
});
