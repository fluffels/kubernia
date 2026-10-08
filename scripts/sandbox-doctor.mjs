#!/usr/bin/env node
/* Sandbox-Doktor (#1432, ADR 0021): prüft, ob die Agenten-Sandbox auf dieser Maschine wirklich greift.
 *
 *   node scripts/sandbox-doctor.mjs --vorlage   druckt die User-Settings-Vorlage (JSON, nie Secret-Werte)
 *   node scripts/sandbox-doctor.mjs --check     prüft Plattform, bwrap/socat, wsl.conf, User-Settings, Verhaltensprobe
 *   node scripts/sandbox-doctor.mjs --sessionstart   SessionStart-Hook (#1486): meldet unter nativem Windows die Shell-Sperre des
 *                                               Projekt-Blocks samt Abhilfe; endet immer mit Exit 0, blockiert nie
 *
 * Berichtend: `--check` endet immer mit Exit 0 (eine strenge Variante kommt mit #1437). Unbekannte Argumente: Exit 2.
 * Die Vorlage führt die Projekt-Allowlist aus `.claude/settings.json` vollständig mit, weil `strictAllowlist` im
 * User-Scope die Domains des Repos ignoriert. Secret-Inhalte liest und druckt dieses Skript nie; Meldungen nennen
 * nur Schlüsselnamen. Die Prüffunktionen sind rein (Eingaben als Parameter) und in test/sandbox-doctor.test.ts getestet.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, release as osRelease } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./hook-io.mjs";

const ok = (text) => ({ status: "OK", text });
const fehlt = (text) => ({ status: "FEHLT", text });
const hinweis = (text) => ({ status: "HINWEIS", text });

/** Token-Variablen, die die Vorlage in jedem Projekt sperrt (die MCP-Header und Tokens laufen außerhalb der Sandbox). */
const DENY_VARIABLEN = ["PIXELLAB_TOKEN", "GITHUB_TOKEN", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"];
/** Namensmuster für Secrets im `env`-Block der User-Settings (die öffentliche Langfuse-Kennung LANGFUSE_PUBLIC_KEY trifft es nicht). */
const SECRET_MUSTER = /TOKEN|SECRET|PASSWORD|_API_KEY/i;

/**
 * Welche WSL-Art meldet der Kernel-Release (#1428 Z26)? WSL2 trägt `microsoft-standard` (neu: `5.15.x-microsoft-standard-WSL2`, ältere WSL2-Kernel
 * ohne das Suffix: `4.19.104-microsoft-standard`), WSL1 `Microsoft` ohne diese Merkmale (`4.4.0-19041-Microsoft`). Bewusst der Kernel-Release und
 * nicht WSLInterop: die empfohlene wsl.conf schaltet Interop ab. Liefert `"wsl2"`, `"wsl1"` oder `null` (kein WSL). Pur.
 */
export function wslArt(release) {
  const r = String(release ?? "");
  if (/microsoft-standard|wsl2/i.test(r)) return "wsl2";
  return /microsoft/i.test(r) ? "wsl1" : null;
}

/** Plattform: natives Windows hat keine Sandbox, WSL1 ebenso nicht (WSL2 braucht echten Linux-Kernel). */
export function pruefePlattform({ platform, release }) {
  if (platform === "win32") {
    return [fehlt("natives Windows: keine Sandbox, der strikte Projekt-Block sperrt hier Shell-Befehle; gesandboxt nur unter WSL2 (ADR 0021, docs/agent-harness.md#natives-windows)")];
  }
  if (wslArt(release) === "wsl1") {
    return [fehlt(`WSL1 (Kernel ${release}): die Sandbox braucht WSL2 (wsl --set-version <Name> 2)`)];
  }
  return [ok(`Plattform ${platform === "linux" && wslArt(release) === "wsl2" ? "WSL2" : platform} unterstützt die Sandbox`)];
}

/** Der empfohlene lokale Override (Inhalt von .claude/settings.local.json). */
const LOKAL_OVERRIDE = '{"sandbox":{"enabled":false}}';

function jsonOderUndefined(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Sperrt der strikte Projekt-Block (#1486) auf dieser Plattform Shell-Befehle? Nur unter nativem Windows (keine Sandbox),
 * wenn `.claude/settings.json` `enabled: true` mit `allowUnsandboxedCommands: false` setzt und `.claude/settings.local.json`
 * (Vorrang) das nicht aufhebt. Kaputtes lokales JSON zählt als Sperre (Override unlesbar), kaputtes oder fehlendes Projekt-JSON nicht. Pur.
 */
export function pruefeWindowsSperre({ platform, projektText, lokalText }) {
  if (platform !== "win32" || projektText === null || projektText === undefined) return false;
  const projekt = jsonOderUndefined(projektText)?.sandbox;
  if (!projekt) return false;
  let lokal = {};
  if (lokalText !== null && lokalText !== undefined) {
    const l = jsonOderUndefined(lokalText);
    if (l === undefined) lokal = {};
    else lokal = l?.sandbox ?? {};
  }
  const enabled = lokal.enabled ?? projekt.enabled;
  const erlaubt = lokal.allowUnsandboxedCommands ?? projekt.allowUnsandboxedCommands;
  return enabled === true && erlaubt === false;
}

const WINDOWS_ABHILFE = `Natives Windows: der Projekt-Block (.claude/settings.json) sperrt hier Shell-Befehle (sicher das PowerShell-Tool), weil es unter Windows keine Sandbox gibt. Abhilfe einmal je Checkout: ${LOKAL_OVERRIDE} in .claude/settings.local.json (ungetrackt, wirkt nur hier), dann die Session neu starten. Gesandboxt arbeitet man nur unter WSL2 (docs/agent-harness.md#natives-windows).`;

/** Die SessionStart-Ausgabe (JSON für Claude Code) bei Sperre, sonst leer. Pur. */
export function sessionStartAusgabe(eingabe) {
  if (!pruefeWindowsSperre(eingabe)) return "";
  return JSON.stringify({
    systemMessage: WINDOWS_ABHILFE,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: `${WINDOWS_ABHILFE} Override nicht selbst eintragen (Leitplanke), der Maintainerin melden; bis dahin das Bash-Tool nehmen.`,
    },
  });
}

/** bwrap und socat müssen im PATH liegen. `which(name)` liefert true, wenn vorhanden. */
export function pruefeWerkzeuge(which) {
  return ["bwrap", "socat"].map((name) =>
    which(name)
      ? ok(`${name} gefunden`)
      : fehlt(`${name} fehlt: sudo apt-get install bubblewrap socat`),
  );
}

/** Liest `[sektion] schluessel=wert` (ohne Groß-/Kleinschreibung, mit # und ; als Kommentar) aus einer wsl.conf. */
function wslKonfig(text) {
  const werte = new Map();
  let sektion = "";
  for (const roh of text.split(/\r?\n/)) {
    const zeile = roh.split(/[#;]/)[0].trim();
    if (!zeile) continue;
    const kopf = /^\[([^\]]+)\]$/.exec(zeile);
    if (kopf) {
      sektion = kopf[1].trim().toLowerCase();
      continue;
    }
    const eq = zeile.indexOf("=");
    if (eq > 0) werte.set(`${sektion}.${zeile.slice(0, eq).trim().toLowerCase()}`, zeile.slice(eq + 1).trim().toLowerCase());
  }
  return werte;
}

/** `/etc/wsl.conf`: Automount, Interop und appendWindowsPath müssen aus sein (Default ist an, also rot bei Fehlen). */
export function pruefeWslConf(text) {
  const werte = wslKonfig(text ?? "");
  const regeln = [
    ["automount.enabled", "[automount] enabled=false (Windows-Laufwerke unter /mnt)"],
    ["interop.enabled", "[interop] enabled=false (Windows-Programme aus WSL starten)"],
    ["interop.appendwindowspath", "[interop] appendWindowsPath=false (Windows-PATH in WSL)"],
  ];
  return regeln.map(([schluessel, beschreibung]) =>
    werte.get(schluessel) === "false"
      ? ok(`wsl.conf: ${beschreibung}`)
      : fehlt(`wsl.conf${text === null ? " fehlt" : ""}: ${beschreibung} ist nicht gesetzt (Default: an); danach wsl --terminate <Name>`),
  );
}

/** Die Projekt-Allowlist aus dem Text von `.claude/settings.json` (leer bei kaputtem JSON oder ohne Block). */
export function projektDomains(settingsText) {
  try {
    const d = JSON.parse(settingsText)?.sandbox?.network?.allowedDomains;
    return Array.isArray(d) ? d.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Host einer Langfuse-URL, `undefined` bei leerer oder ungültiger Angabe. */
function langfuseHost(url) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Die User-Settings-Vorlage. Enthält Namen, Modi und Hosts, nie Werte. */
export function erzeugeVorlage({ projektDomains: domains, langfuseBaseUrl }) {
  const host = langfuseHost(langfuseBaseUrl);
  const allowedDomains = [...domains];
  if (host && !allowedDomains.includes(host)) allowedDomains.push(host);
  const envVars = [{ name: "GH_TOKEN", mode: "mask", injectHosts: ["api.github.com", "github.com"] }];
  if (host) envVars.push({ name: "LANGFUSE_SECRET_KEY", mode: "mask", injectHosts: [host] });
  for (const name of DENY_VARIABLEN) envVars.push({ name, mode: "deny" });
  const credentials = { envVars };
  if (host && langfuseBaseUrl.trim().toLowerCase().startsWith("http://")) credentials.allowPlaintextInject = true;
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      network: { strictAllowlist: true, tlsTerminate: {}, allowedDomains },
      credentials,
    },
  };
}

/** Vergleicht die User-Settings mit der Vorlage. Nennt nur Schlüsselnamen und Domains, nie Werte. */
export function pruefeUserSettings(user, vorlage) {
  const r = [];
  const sb = user?.sandbox;
  const soll = vorlage.sandbox;
  if (!sb) {
    r.push(fehlt("User-Settings: kein sandbox-Block (node scripts/sandbox-doctor.mjs --vorlage)"));
  } else {
    const flag = (name, erwartet) =>
      sb[name] === erwartet ? ok(`User-Settings: ${name} = ${erwartet}`) : fehlt(`User-Settings: ${name} muss ${erwartet} sein`);
    r.push(flag("enabled", true), flag("failIfUnavailable", true), flag("allowUnsandboxedCommands", false));
    r.push(
      sb.network?.strictAllowlist === true ? ok("User-Settings: network.strictAllowlist = true") : fehlt("User-Settings: network.strictAllowlist muss true sein"),
      sb.network?.tlsTerminate !== undefined ? ok("User-Settings: network.tlsTerminate gesetzt") : fehlt("User-Settings: network.tlsTerminate fehlt (Token-Maskierung braucht TLS-Terminierung)"),
    );
    const vorhanden = new Set(sb.network?.allowedDomains ?? []);
    const fehlend = soll.network.allowedDomains.filter((d) => !vorhanden.has(d));
    r.push(fehlend.length === 0 ? ok("User-Settings: Allowlist deckt die Vorlage ab") : fehlt(`User-Settings: Allowlist ohne ${fehlend.join(", ")} (strictAllowlist ignoriert die Projektliste)`));
    for (const e of soll.credentials.envVars) {
      const ist = (sb.credentials?.envVars ?? []).find((x) => x.name === e.name);
      const hostsFehlen = (e.injectHosts ?? []).filter((h) => !(ist?.injectHosts ?? []).includes(h));
      if (!ist) r.push(fehlt(`User-Settings: credentials.envVars ohne ${e.name} (${e.mode})`));
      else if (ist.mode !== e.mode) r.push(fehlt(`User-Settings: ${e.name} hat Modus ${ist.mode}, erwartet ${e.mode}`));
      else if (hostsFehlen.length > 0) r.push(fehlt(`User-Settings: ${e.name} ohne injectHosts ${hostsFehlen.join(", ")}`));
      else r.push(ok(`User-Settings: ${e.name} (${e.mode})`));
    }
    if (soll.credentials.allowPlaintextInject) {
      r.push(sb.credentials?.allowPlaintextInject === true ? ok("User-Settings: allowPlaintextInject (lokales http-Langfuse)") : fehlt("User-Settings: credentials.allowPlaintextInject fehlt (Langfuse läuft über http)"));
    }
  }
  const secrets = Object.keys(user?.env ?? {}).filter((k) => SECRET_MUSTER.test(k));
  r.push(secrets.length === 0 ? ok("User-Settings: keine Secrets im env-Block") : fehlt(`User-Settings: Secrets im env-Block (${secrets.join(", ")}); nach ~/.config/agent-secrets.env verschieben`));
  return r;
}

/** Schreibversuch ins Home: in der Sandbox muss er scheitern. Eine gelungene Probe-Datei wird sofort gelöscht. */
export function verhaltensprobe({ home, schreibe, loesche }) {
  const pfad = `${home.replace(/[\\/]+$/, "")}/.kq-sandbox-probe-${process.pid}`;
  try {
    schreibe(pfad);
  } catch (e) {
    const code = e && typeof e === "object" ? e.code : undefined;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") return [ok(`Verhaltensprobe: Schreiben ins Home ist gesperrt (${code})`)];
    return [hinweis(`Verhaltensprobe unklar: Schreiben scheiterte mit ${String(code ?? e)}`)];
  }
  loesche(pfad);
  return [fehlt("Verhaltensprobe: Schreiben ins Home gelang, die Sandbox greift hier nicht (im eigenen Terminal statt in einer Claude-Session?)")];
}

const USAGE = "Usage: node scripts/sandbox-doctor.mjs --vorlage | --check | --sessionstart";

function projektSettingsText() {
  return readFileSync(fileURLToPath(new URL("../.claude/settings.json", import.meta.url)), "utf8");
}

function vorlageAusUmgebung(env) {
  return erzeugeVorlage({ projektDomains: projektDomains(projektSettingsText()), langfuseBaseUrl: env.LANGFUSE_BASE_URL });
}

const vorhanden = (name) => {
  const r = spawnSync(name, ["--version"], { stdio: "ignore" });
  return !r.error;
};

function lies(pfad) {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return null;
  }
}

/** Der volle Lauf mit echten Quellen (Dateisystem, Prozess). */
function windowsErgebnis(io) {
  if (io.platform !== "win32") return [];
  return pruefeWindowsSperre(io)
    ? [fehlt(`natives Windows: Projekt-Block sperrt Shell-Befehle; Abhilfe: ${LOKAL_OVERRIDE} in .claude/settings.local.json, Session neu starten`)]
    : [ok("natives Windows: lokaler Override aktiv, Shell-Befehle laufen ungesandboxt")];
}

function pruefeAlles(env, io) {
  const platform = io.platform;
  const rel = osRelease();
  const alle = [...pruefePlattform({ platform, release: rel, env }), ...windowsErgebnis(io)];
  const sandboxMoeglich = platform !== "win32" && wslArt(rel) !== "wsl1";
  if (sandboxMoeglich) {
    alle.push(...pruefeWerkzeuge(vorhanden));
    alle.push(...(wslArt(rel) === "wsl2" ? pruefeWslConf(lies("/etc/wsl.conf")) : [hinweis("wsl.conf: nur unter WSL2 relevant")]));
  } else {
    alle.push(hinweis("bwrap/socat, wsl.conf und Verhaltensprobe werden hier nicht geprüft (keine Sandbox-Plattform)"));
  }
  const userPfad = join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
  const text = lies(userPfad);
  let user = null;
  try {
    user = text === null ? null : JSON.parse(text);
  } catch {
    alle.push(fehlt("User-Settings: kein gültiges JSON"));
  }
  alle.push(...pruefeUserSettings(user, vorlageAusUmgebung(env)));
  if (sandboxMoeglich) {
    alle.push(...verhaltensprobe({ home: homedir(), schreibe: (p) => writeFileSync(p, "probe"), loesche: (p) => rmSync(p, { force: true }) }));
  }
  return alle;
}

/** CLI. Gibt den Exit-Code zurück; schreibt über `out`/`err`, damit kein process.exit() Ausgaben abschneidet. */
export function main(argv, env = process.env, out = console.log, err = console.error, io = {}) {
  if (argv.length !== 1 || !["--vorlage", "--check", "--sessionstart"].includes(argv[0])) {
    err(USAGE);
    return 2;
  }
  const wurzel = env.CLAUDE_PROJECT_DIR || fileURLToPath(new URL("..", import.meta.url));
  const quellen = {
    platform: io.platform ?? process.platform,
    projektText: "projektText" in io ? io.projektText : lies(join(wurzel, ".claude", "settings.json")),
    lokalText: "lokalText" in io ? io.lokalText : lies(join(wurzel, ".claude", "settings.local.json")),
  };
  if (argv[0] === "--sessionstart") {
    try {
      const ausgabe = sessionStartAusgabe(quellen);
      if (ausgabe) out(ausgabe);
    } catch {
      // Der Hinweis darf den Start nie blockieren.
    }
    return 0;
  }
  if (argv[0] === "--vorlage") {
    out(JSON.stringify(vorlageAusUmgebung(env), null, 2));
    return 0;
  }
  for (const e of pruefeAlles(env, quellen)) out(`${e.status} ${e.text}`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main(process.argv.slice(2));
