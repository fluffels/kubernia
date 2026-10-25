// Kein Shebang: wird von den Launcher-Wrappern (`scripts/playwright-mcp.mjs`, `scripts/likec4-mcp.mjs`) importiert
// und von den Wächter-Tests geprüft.
// Generische Startlogik für lokale MCP-Server der Agenten (#1283, #1422), gestartet aus `.mcp.json`.
//
// Claude Code startet den Server einmal pro Session aus deren Startverzeichnis – meist
// der Haupt-Checkout, dessen node_modules hinter dem Lockfile liegen kann (oder das
// Paket gar nicht hat). Ein fester Pfad auf node_modules/<paket> fiele dann
// still aus: in der Session fehlen nur die mcp__<server>__*-Tools, kein Fehler.
//
// Darum: Version kommt aus dem Lockfile (die eine Quelle, Dependabot pflegt sie).
// Ist das Paket lokal installiert → lokal starten (schnell, offline); weicht die Version vom Lockfile ab,
// steht eine Warnung auf stderr (#1888: der Start über npx kostete beim ersten Mal lange und fiel aus). Fehlt
// die Installation, `npx -y <paket>@<exakte Version>` – nie ungepinnt, nie @latest.
// Alle übrigen Argumente gehen unverändert an den Server.
//
// Bekannte Grenzen (#1309, gemessen unter Windows: nach Beenden des Launchers blieben weder im lokalen
// noch im npx-Modus Prozesse zurück, darum keine Kill-/Retry-Logik): Im npx-Modus werden transitive
// Abhängigkeiten frisch aufgelöst statt aus dem Lockfile, und mehrere Sessions, die nach einem Bump
// gleichzeitig erstmals starten, können sich im `_npx`-Cache in die Quere kommen (ENOTEMPTY). Abhilfe:
// im Haupt-Checkout einmal `npm ci`, dann startet der Server lokal.
// Ausfälle (#1634): Endet der Server ohne Signal des Aufrufers oder mit Exit ≠ 0 (auch Exit 0 nach ersetzter lokaler
// Installation), steht eine Zeile auf stderr (`mcp-logs-*` von Claude Code als „Server stderr“). Ein harter Kill des
// Launchers selbst hinterlässt keine Zeile, nur den Reconnect im Log (`node scripts/mcp-ausfall.mjs`).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Gepinnte Version laut package-lock.json, oder undefined. */
export function readLockVersion(root, pkg) {
  try {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    return lock.packages?.[`node_modules/${pkg}`]?.version;
  } catch {
    return undefined;
  }
}

/** Lokal installierte Version + Pfad des bins, oder null (fehlt / ohne bin). */
export function readInstalled(root, pkg, bin) {
  const dir = join(root, "node_modules", pkg);
  try {
    const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const binRel = typeof json.bin === "string" ? json.bin : json.bin?.[bin];
    if (!binRel) return null;
    const binPath = join(dir, binRel);
    return existsSync(binPath) ? { version: json.version, binPath } : null;
  } catch {
    return null;
  }
}

/** Pure Startentscheidung: lokal, wenn installiert (bei abweichender Version mit `abweichung`), sonst npx gepinnt. */
export function planLaunch({ pkg, lockVersion, installed }) {
  if (!lockVersion) {
    throw new Error(`${pkg} fehlt im Lockfile (package-lock.json) – ohne gepinnte Version kein Start.`);
  }
  if (installed && installed.version === lockVersion) return { mode: "local", binPath: installed.binPath };
  if (installed) return { mode: "local", binPath: installed.binPath, abweichung: { lokal: installed.version, lock: lockVersion } };
  return { mode: "npx", spec: `${pkg}@${lockVersion}` };
}

/** Datei-Kennung des bins (Inode, Anlege- und Änderungszeit) oder null; ein `npm ci` legt `node_modules` neu an und ändert sie. */
export function statInstallation(binPath) {
  try {
    const s = statSync(binPath);
    return { ino: s.ino, birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

/** Wurde die lokale Installation während der Laufzeit ersetzt? `vorher === null` (npx-Modus) ist nie „ersetzt“. Pur. */
export function installationErsetzt(vorher, nachher) {
  if (!vorher) return false;
  if (!nachher) return true;
  return vorher.ino !== nachher.ino || vorher.birthtimeMs !== nachher.birthtimeMs || vorher.mtimeMs !== nachher.mtimeMs;
}

/** Signale, mit denen der Host den Server gewollt beendet (Fenster zu, Terminal weg): kein Ausfall. */
const SIGNALE_VON_AUSSEN = ["SIGINT", "SIGTERM", "SIGHUP"];

/** Stderr-Zeile für ein unerwartetes Ende des Servers (#1634) oder null: gewollte Beendigung und sauberer Exit 0 bleiben still. Pur. */
export function exitMeldung({ name, code, signal, vonAussen, laufzeitMs, modus, ersetzt }) {
  if (vonAussen || (signal && SIGNALE_VON_AUSSEN.includes(signal)) || (code === 0 && !ersetzt)) return null;
  const ende = signal ? `Signal ${signal}` : `Exit ${code}`;
  const zusatz = ersetzt ? "; lokale Installation während der Laufzeit ersetzt, etwa durch npm ci" : "";
  return `${name}: Server beendet (${ende}, nach ${Math.round(laufzeitMs / 1000)} s, Modus ${modus}${zusatz})`;
}

/** Warnzeile für eine lokale Installation, deren Version vom Lockfile abweicht. Pur. */
export function abweichungHinweis(name, { lokal, lock }) {
  return `${name}: lokale Version ${lokal} weicht vom Lockfile ${lock} ab, starte lokal (npm ci gleicht an)`;
}

/** Hinweiszeile für den npx-Modus; das Format erkennt `scripts/mcp-ausfall.mjs` (Pfeil + `npx`). Pur. */
export function npxHinweis(name, spec) {
  return `${name}: lokale Installation fehlt → npx ${spec}`;
}

/**
 * Launcher-Bausteine für einen Server: Name, Paket und bin sind gebunden, `scripts/<server>-mcp.mjs` ist nur noch ein Einzeiler darüber.
 * `starte({ root, args, cwd })` startet den Server; `root` (der Repo-Root, Elternordner von `scripts/`) übergibt der Aufrufer, `cwd` ist optional.
 */
export function launcherFuer({ name, pkg, bin }) {
  return {
    PKG: pkg,
    BIN: bin,
    NAME: name,
    readLockVersion: (root) => readLockVersion(root, pkg),
    readInstalled: (root) => readInstalled(root, pkg, bin),
    planLaunch: ({ lockVersion, installed }) => planLaunch({ pkg, lockVersion, installed }),
    statInstallation,
    installationErsetzt,
    exitMeldung: (o) => exitMeldung({ name, ...o }),
    npxHinweis: (spec) => npxHinweis(name, spec),
    abweichungHinweis: (a) => abweichungHinweis(name, a),
    starte: ({ root, args, cwd }) => starte({ name, pkg, bin, root, args, cwd }),
  };
}

/**
 * Startet den Server (lokal oder per npx) und reicht Exit-Code und Signale durch. `cwd` optional (sonst das der Session).
 * `abhaengigkeiten` ersetzt in Tests Kindprozess, stderr, Prozessende, Signal-Anmeldung und Plattform (`spawn`, `stderr`, `exit`, `onSignal`, `plattform`); Standard sind die echten.
 */
export function starte({ name, pkg, bin, root, args, cwd }, abhaengigkeiten = {}) {
  const { spawn: starten = spawn, stderr = process.stderr, exit = (c) => process.exit(c), onSignal = (sig, fn) => process.on(sig, fn), plattform = process.platform } = abhaengigkeiten;
  const plan = planLaunch({ pkg, lockVersion: readLockVersion(root, pkg), installed: readInstalled(root, pkg, bin) });
  const start = Date.now();
  const vorher = plan.mode === "local" ? statInstallation(plan.binPath) : null;
  let vonAussen = false;
  const opt = { stdio: "inherit", ...(cwd ? { cwd } : {}) };
  // stdout gehört dem MCP-Protokoll – Hinweise nur auf stderr.
  if (plan.abweichung) stderr.write(`${abweichungHinweis(name, plan.abweichung)}
`);
  const child =
    plan.mode === "local"
      ? starten(process.execPath, [plan.binPath, ...args], opt)
      : (stderr.write(`${npxHinweis(name, plan.spec)}
`),
        starten("npx", ["-y", plan.spec, ...args], { ...opt, shell: plattform === "win32" }));
  child.on("error", (e) => {
    stderr.write(`${name}: Start fehlgeschlagen (${e.code ?? e.message})
`);
    exit(1);
  });
  child.on("exit", (code, signal) => {
    const ersetzt = plan.mode === "local" && installationErsetzt(vorher, statInstallation(plan.binPath));
    const zeile = exitMeldung({ name, code, signal, vonAussen, laufzeitMs: Date.now() - start, modus: plan.mode === "local" ? "local" : "npx", ersetzt });
    if (zeile) stderr.write(`${zeile}
`);
    exit(code ?? (signal ? 1 : 0));
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    onSignal(sig, () => {
      vonAussen = true;
      child.kill(sig);
    });
  }
}
