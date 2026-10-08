/* Wächter für die Agenten-Sandbox-Konfiguration (#1432, ADR 0021).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `.claude/settings.json` trägt einen `sandbox`-Block (Shell-Befehle laufen unter WSL2 in bubblewrap,
 * unter nativem Windows startet die Session unverändert ohne Sandbox). Dieser Wächter hält fest, dass
 * der Block nicht still ausgehöhlt wird:
 *   1. Flags exakt (`enabled`, `allowUnsandboxedCommands: false`), kein `failIfUnavailable` im Projekt
 *      (würde native Windows-Sessions aussperren), keine abschwächenden Schlüssel.
 *   2. Die Netz-Allowlist ist eng (kein Voll-Wildcard) und deckungsgleich mit der Doku-Tabelle.
 *   3. Secret-Pfade stehen in `filesystem.denyRead` UND als `Read(...)`-deny (Read läuft außerhalb der Sandbox).
 *   4. `filesystem.denyWrite` deckt jedes Hook-/MCP-Skript samt lokalen Importen ab (Hooks laufen ungesandboxt).
 *   5. Keine persönlichen Pfade im Block.
 * Die Doku liegt in docs/agent-harness.md › Agenten-Sandbox (WSL2).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hookSkripte, lokaleImporteTransitiv, mcpSkripte } from "./hook-importe";

type Sandbox = {
  enabled?: boolean;
  allowUnsandboxedCommands?: boolean;
  failIfUnavailable?: boolean;
  network?: { allowedDomains?: string[]; allowAllUnixSockets?: boolean; [k: string]: unknown };
  filesystem?: { denyRead?: string[]; denyWrite?: string[]; allowWrite?: string[]; disabled?: boolean; [k: string]: unknown };
  [k: string]: unknown;
};
type Settings = { sandbox?: Sandbox; permissions?: { deny?: string[] } };

const wurzel = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));
const read = (rel: string) => readFileSync(wurzel(rel), "utf8");

/** Die Secret-Pfade, die der Agent nie lesen darf (Inhalte fasst das Repo nie an). */
const SECRET_PFADE = [
  "~/.ssh",
  "~/.config/gh",
  "~/.claude/.credentials.json",
  "~/.claude.json",
  "~/.config/agent-secrets.env",
  "./.env",
  "./.env.local",
  "./.env.development.local",
  "./.env.production.local",
  "./.env.test.local",
];

/** Schlüssel, die die Sandbox abschwächen; der Block darf sie nicht setzen. */
function abschwaechendeSchluessel(block: Sandbox): string[] {
  const treffer: string[] = [];
  if ("enableWeakerNestedSandbox" in block) treffer.push("enableWeakerNestedSandbox");
  if ("enableWeakerNetworkIsolation" in block) treffer.push("enableWeakerNetworkIsolation");
  if (block.network && "allowAllUnixSockets" in block.network) treffer.push("network.allowAllUnixSockets");
  if (block.filesystem && "disabled" in block.filesystem) treffer.push("filesystem.disabled");
  return treffer;
}

/** Verstöße der Allowlist: leer, Voll-Wildcard, Wildcard mit weniger als zwei Labels, Schema, Pfad. */
function allowlistVerstoesse(domains: string[] | undefined): string[] {
  if (!domains || domains.length === 0) return ["Allowlist leer oder fehlt"];
  const fehler: string[] = [];
  for (const d of domains) {
    if (d === "*") fehler.push("Voll-Wildcard *");
    else if (/[/:]/.test(d)) fehler.push(`${d}: nur Hostname, kein Schema/Pfad/Port`);
    else if (d.startsWith("*.") && d.slice(2).split(".").length < 2) fehler.push(`${d}: Wildcard braucht mindestens zwei Labels`);
    else if (d.includes("*") && !d.startsWith("*.")) fehler.push(`${d}: Wildcard nur als Präfix *.`);
  }
  return fehler;
}

/** Die Read-deny-Formen zu einem Pfad: `~/x` ↔ `Read(~/x)`/`Read(~/x/**)`, `./x` ↔ `Read(/x)`. */
function readDenyFormen(pfad: string): string[] {
  const p = pfad.startsWith("./") ? pfad.slice(1) : pfad;
  return [`Read(${p})`, `Read(${p}/**)`];
}

/** Secret-Pfade, die in `denyRead` fehlen. */
function fehlendeDenyRead(denyRead: string[] | undefined, pfade = SECRET_PFADE): string[] {
  return pfade.filter((p) => !(denyRead ?? []).includes(p));
}

/** Secret-Pfade, für die kein `Read(...)`-deny existiert. */
function fehlendeReadDeny(deny: string[] | undefined, pfade = SECRET_PFADE): string[] {
  return pfade.filter((p) => !readDenyFormen(p).some((f) => (deny ?? []).includes(f)));
}

/** Pfade, die kein `denyWrite`-Eintrag abdeckt (gleich oder als Ordner-Präfix); Einträge stehen als `./…`. */
function ungedeckteSchreibPfade(denyWrite: string[] | undefined, pfade: string[]): string[] {
  const eintraege = (denyWrite ?? []).map((e) => e.replace(/^\.\//, "").replace(/\/$/, ""));
  return pfade.filter((p) => !eintraege.some((e) => p === e || p.startsWith(`${e}/`)));
}

/** Domains der Tabellenzeilen „Projekt“ im Doku-Abschnitt (Platzhalterzeilen `<…>` ausgenommen). */
function tabellenDomains(doku: string): string[] {
  const start = doku.indexOf("### Agenten-Sandbox (WSL2)");
  if (start === -1) return [];
  const rest = doku.slice(start + 3);
  const ende = rest.search(/\n### /);
  const abschnitt = ende === -1 ? rest : rest.slice(0, ende);
  const domains: string[] = [];
  for (const zeile of abschnitt.split("\n")) {
    const zellen = zeile.split("|").map((z) => z.trim());
    if (zellen.length < 4 || zellen[3] !== "Projekt") continue;
    const m = /^`([^`]+)`$/.exec(zellen[1]);
    if (m && !m[1].includes("<")) domains.push(m[1]);
  }
  return domains;
}

/** Personengebundene Pfade im Block (erlaubt ist nur `/mnt`). */
function persoenlichePfade(werte: string[]): string[] {
  return werte.filter((w) => w !== "/mnt" && (/^\/(home|Users|root)\b/.test(w) || /^[A-Za-z]:[\\/]/.test(w) || /\/(home|Users)\//.test(w)));
}

/** `allowWrite`-Einträge auf/unter Orten, aus denen ungesandboxte Prozesse Code laden (ADR 0021). */
function gefaehrlicheAllowWrite(allowWrite: string[] | undefined, denyWrite: string[] | undefined): string[] {
  const verboten = ["~/.npm", "~/.cache/ms-playwright", "~/.claude", ...(denyWrite ?? [])];
  return (allowWrite ?? []).filter((a) => verboten.some((v) => a === v || a.startsWith(`${v}/`)));
}

const settings = JSON.parse(read(".claude/settings.json")) as Settings;
const sb = settings.sandbox ?? {};

describe("Agenten-Sandbox-Konfiguration (#1432)", () => {
  test("Block vorhanden, Flags exakt, kein failIfUnavailable im Projekt", () => {
    assert.ok(settings.sandbox, "`sandbox`-Block fehlt in .claude/settings.json");
    assert.equal(sb.enabled, true);
    assert.equal(sb.allowUnsandboxedCommands, false, "Befehle dürfen die Sandbox nicht per Parameter verlassen");
    assert.ok(!("failIfUnavailable" in sb), "failIfUnavailable gehört nur in die User-Vorlage (sperrt sonst native Windows-Sessions aus)");
    assert.deepEqual(abschwaechendeSchluessel(sb), []);
  });

  test("SessionStart meldet die Windows-Sperre über den Sandbox-Doktor (#1486)", () => {
    const hooks = (JSON.parse(read(".claude/settings.json")) as { hooks?: { SessionStart?: { hooks?: { args?: string[]; command?: string }[] }[] } }).hooks;
    const eintraege = (hooks?.SessionStart ?? []).flatMap((g) => g.hooks ?? []);
    const treffer = eintraege.filter((h) => (h.args ?? []).some((a) => a.endsWith("scripts/sandbox-doctor.mjs")) && (h.args ?? []).includes("--sessionstart"));
    assert.equal(treffer.length, 1, "SessionStart braucht genau einen Hook `sandbox-doctor.mjs --sessionstart`");
  });

  test("Allowlist eng und deckungsgleich mit der Doku-Tabelle", () => {
    const domains = sb.network?.allowedDomains;
    assert.deepEqual(allowlistVerstoesse(domains), []);
    const tabelle = tabellenDomains(read("docs/agent-harness.md"));
    assert.deepEqual([...(domains ?? [])].sort(), [...tabelle].sort(), "allowedDomains und Tabelle (Quelle „Projekt“) weichen ab");
  });

  test("Secret-Pfade stehen in denyRead UND als Read-deny, /mnt in denyRead", () => {
    assert.deepEqual(fehlendeDenyRead(sb.filesystem?.denyRead), []);
    assert.ok((sb.filesystem?.denyRead ?? []).includes("/mnt"), "/mnt (Windows-Laufwerke) muss in denyRead stehen");
    assert.deepEqual(fehlendeReadDeny(settings.permissions?.deny), []);
    assert.ok((settings.permissions?.deny ?? []).includes("Read(/.env.*)"), "Glob-deny für alle .env.*-Varianten im Projekt-Root fehlt");
  });

  test("denyWrite deckt Hook-/MCP-Skripte samt Importen, node_modules, Lockfile und .githooks", () => {
    const wurzeln = [...hookSkripte(read(".claude/settings.json")), ...mcpSkripte(read(".mcp.json"))];
    assert.ok(wurzeln.length > 3, "Hook- und MCP-Skripte wurden gefunden");
    const kette = lokaleImporteTransitiv(wurzeln, read);
    assert.ok(kette.includes("scripts/hook-io.mjs"), "die Kette enthält hook-io.mjs");
    assert.ok(kette.includes("scripts/playwright-mcp.mjs"), "die Kette enthält das MCP-Skript");
    const dw = sb.filesystem?.denyWrite;
    assert.deepEqual(ungedeckteSchreibPfade(dw, kette), []);
    assert.deepEqual(ungedeckteSchreibPfade(dw, ["node_modules/x", "package-lock.json", ".githooks/pre-push"]), []);
    for (const e of dw ?? []) {
      assert.ok(e.startsWith("./"), `${e}: denyWrite-Einträge beginnen mit ./`);
      assert.ok(!/[*?[]/.test(e), `${e}: Linux/WSL2 überspringen Write-Einträge mit * ? [ still`);
    }
  });

  test("keine persönlichen Pfade, kein allowWrite auf Code-Ladeorten", () => {
    const alle = [...(sb.filesystem?.denyRead ?? []), ...(sb.filesystem?.denyWrite ?? []), ...(sb.filesystem?.allowWrite ?? [])];
    assert.deepEqual(persoenlichePfade(alle), []);
    assert.deepEqual(gefaehrlicheAllowWrite(sb.filesystem?.allowWrite, sb.filesystem?.denyWrite), []);
  });
});

describe("Red-Green: die Hilfsfunktionen erkennen Verfälschungen", () => {
  test("abschwächende Schlüssel", () => {
    assert.deepEqual(abschwaechendeSchluessel({ enableWeakerNestedSandbox: true }), ["enableWeakerNestedSandbox"]);
    assert.deepEqual(abschwaechendeSchluessel({ enableWeakerNetworkIsolation: true }), ["enableWeakerNetworkIsolation"]);
    assert.deepEqual(abschwaechendeSchluessel({ network: { allowAllUnixSockets: true } }), ["network.allowAllUnixSockets"]);
    assert.deepEqual(abschwaechendeSchluessel({ filesystem: { disabled: false } }), ["filesystem.disabled"]);
    assert.deepEqual(abschwaechendeSchluessel({ enabled: true }), []);
  });

  test("Allowlist", () => {
    assert.equal(allowlistVerstoesse([]).length, 1);
    assert.equal(allowlistVerstoesse(undefined).length, 1);
    assert.equal(allowlistVerstoesse(["*"]).length, 1);
    assert.equal(allowlistVerstoesse(["*.com"]).length, 1);
    assert.equal(allowlistVerstoesse(["https://github.com"]).length, 1);
    assert.equal(allowlistVerstoesse(["a*.example.com"]).length, 1);
    assert.deepEqual(allowlistVerstoesse(["*.pixellab.ai", "github.com"]), []);
  });

  test("Read-deny-Normalisierung und fehlende Pfade", () => {
    assert.deepEqual(readDenyFormen("./.env"), ["Read(/.env)", "Read(/.env/**)"]);
    assert.deepEqual(readDenyFormen("~/.ssh"), ["Read(~/.ssh)", "Read(~/.ssh/**)"]);
    assert.deepEqual(fehlendeDenyRead(["~/.ssh"], ["~/.ssh", "./.env"]), ["./.env"]);
    assert.deepEqual(fehlendeReadDeny(["Read(~/.ssh/**)"], ["~/.ssh", "./.env"]), ["./.env"]);
    assert.deepEqual(fehlendeReadDeny(["Read(/.env)"], ["./.env"]), []);
    assert.deepEqual(fehlendeReadDeny(undefined, ["./.env"]), ["./.env"]);
  });

  test("denyWrite: nur ein Hook-Skript gelistet → die Importe fehlen", () => {
    const kette = ["scripts/pretooluse-hook.mjs", "scripts/hook-io.mjs"];
    assert.deepEqual(ungedeckteSchreibPfade(["./scripts/pretooluse-hook.mjs"], kette), ["scripts/hook-io.mjs"]);
    assert.deepEqual(ungedeckteSchreibPfade(["./scripts"], kette), []);
    assert.deepEqual(ungedeckteSchreibPfade(["./scripts-alt"], kette), kette, "Präfix nur an Ordnergrenze");
  });

  test("Doku-Tabelle: nur Projekt-Zeilen ohne Platzhalter", () => {
    const doku = [
      "### Agenten-Sandbox (WSL2)",
      "| Domain | Wofür | Quelle |",
      "|---|---|---|",
      "| `github.com` | git | Projekt |",
      "| `<Host aus X>` | Langfuse | nur User-Vorlage |",
      "| `<Host>` | x | Projekt |",
      "### Nächster",
      "| `fremd.de` | y | Projekt |",
    ].join("\n");
    assert.deepEqual(tabellenDomains(doku), ["github.com"]);
    assert.deepEqual(tabellenDomains("nichts"), []);
  });

  test("persönliche Pfade und allowWrite-Ladeorte", () => {
    assert.deepEqual(persoenlichePfade(["/mnt", "~/.ssh", "./scripts", "/home/x/.ssh", "C:\\Users\\y", "/Users/z"]), ["/home/x/.ssh", "C:\\Users\\y", "/Users/z"]);
    assert.deepEqual(gefaehrlicheAllowWrite(["~/.npm/_cache", "~/.claude", "./out", "./scripts/x"], ["./scripts"]), ["~/.npm/_cache", "~/.claude", "./scripts/x"]);
  });

  test("mcpSkripte liest nur Skript-Argumente", () => {
    assert.deepEqual(mcpSkripte(JSON.stringify({ mcpServers: { a: { args: ["scripts/x.mjs", "--y"] }, b: { url: "https://z" } } })), ["scripts/x.mjs"]);
  });
});
