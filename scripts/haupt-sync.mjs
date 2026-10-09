// Kein Shebang: wird als SessionStart-Hook gestartet UND von test/harness/haupt-sync.test.ts importiert.
/**
 * Haupt-Checkout aktuell halten (#1349): Tickets laufen in Worktrees von `origin/main`, der Haupt-Checkout (`main`) wird
 * dadurch nie aktualisiert. Eine Session dort las Agenten-Definitionen und Doku vom Vorabend (Beleg #1304: 15 Commits
 * Rückstand, der Planer lief mit veralteter Definition). Dieser `SessionStart`-Hook holt `origin/main` und hebt `main`
 * per `git merge --ff-only`, aber nur, wenn das gefahrlos geht:
 *
 *   - nur im Haupt-Checkout (ein Linked Worktree bleibt unberührt),
 *   - nur auf dem Branch `main`,
 *   - nur bei sauberem Arbeitsbaum (getrackte Änderungen; untracked stört ein Fast-Forward nicht),
 *   - nur fast-forward (hat `main` lokale Commits, wird nicht angefasst).
 *
 * Sonst bleibt alles liegen, und der Hook meldet „N Commits hinter origin/main“ samt Grund in den Kontext der Session.
 * Als SessionStart-Hook gibt er IMMER `Sitzungsbasis: <HEAD vor dem Pull>` aus: der Skill `kubernia` prüft damit vor dem
 * Spawn, ob sich Agenten-Definitionen seit dem Start der Session geändert haben (der Hook-/Definitions-Snapshot wird beim
 * Start eingefroren, ein Pull ändert die laufende Session nicht). Nur diese Zeile ist die Sitzungsbasis: der Haupt-Checkout
 * ist geteilt, ein späterer Aufruf (`--text`, auch aus einer anderen Session) sieht einen schon gehobenen `main` und darum
 * einen falschen Stand; `--text` nennt deshalb nur „Stand vor diesem Sync“ (HEAD des Checkouts beim Aufruf) und behauptet nichts über die Basis der Session, die nur der SessionStart-Kontext nennt. Hat der Pull `.claude/` oder `AGENTS.md` geändert, sagt er das
 * zusätzlich ausdrücklich. Fail-open: jeder Fehler (kein Netz, kein git) ergibt nur eine kurze Notiz, nie einen Abbruch.
 *
 * `--text --streng` ist der erste Schritt des Skills `kubernia` (#1392): derselbe Sync (entspricht `git pull --ff-only`, aber mit Stopp
 * bei getrackten Resten), nur dass jede Abweichung vom sauberen `main` Exit 1 ergibt (`exitCodeFuer`): der Hauptchat startet dann kein
 * Ticket. Hat der Sync `.claude/skills`, `.claude/agents` oder `AGENTS.md` geändert, sagt der Text „Skill neu lesen“: der Skill-Text
 * der laufenden Session stammt noch vom alten Stand.
 *
 * Hook-Ausgabe: `hookSpecificOutput.additionalContext` (SessionStart). Wächter: test/harness/haupt-sync.test.ts.
 * Nur Node-Builtins.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { istDirektaufruf } from "./hook-io.mjs";

/**
 * Was tut der Sync? Pur. `hinter`/`vor` = Commits, die `main` gegenüber `origin/main` hinten/vorn liegt.
 * Liefert `{ aktion: "pull" | "melden" | "nichts", grund }`.
 */
export function entscheideSync({ istLinkedWorktree, branch, sauber, hinter, vor }) {
  if (istLinkedWorktree) return { aktion: "nichts", grund: "Linked Worktree (läuft von origin/main, wird nicht angefasst)" };
  if (!Number.isInteger(hinter) || hinter < 0 || !Number.isInteger(vor) || vor < 0) {
    return { aktion: "nichts", grund: "Rückstand nicht bestimmbar" };
  }
  if (hinter === 0) return { aktion: "nichts", grund: "aktuell" };
  if (branch !== "main") return { aktion: "melden", grund: `Branch ${branch}, nicht main (nicht angefasst)` };
  if (!sauber) return { aktion: "melden", grund: "Arbeitsbaum nicht sauber (nicht angefasst)" };
  if (vor > 0) return { aktion: "melden", grund: `main hat ${vor} lokale Commits, kein Fast-Forward (nicht angefasst)` };
  return { aktion: "pull", grund: "main ist sauber und nur zurück: Fast-Forward" };
}

/**
 * Exit-Code des strengen Modus (`--streng`): 1 bei jeder Abweichung, die der Hauptchat vor einem Ticketstart nicht ignorieren darf,
 * sonst 0. Abweichung = Meldung (anderer Branch, getrackte Reste, kein Fast-Forward) oder ein Fehler (`notiz`, z.B. fetch), und auch
 * ein anderer Branch als `main` bzw. getrackte Reste, wenn `main` gar nicht zurückliegt (`sauber`/`branch` aus dem Sync). Ein Linked
 * Worktree (kein `sauber`/`branch` im Ergebnis) ist nie ein Stopp. Pur.
 */
export function exitCodeFuer(ergebnis) {
  if (ergebnis.notiz) return 1;
  if (ergebnis.aktion === "melden") return 1;
  if (ergebnis.sauber === false) return 1;
  if (typeof ergebnis.branch === "string" && ergebnis.branch !== "" && ergebnis.branch !== "main") return 1;
  return 0;
}

/** True, wenn unter den geänderten Dateien Agenten-Definitionen, Hooks, Skills oder AGENTS.md sind (die Session kennt sie nur im Startstand). Pur. */
export const agentenGeaendert = (dateien) => dateien.some((d) => /^\.claude\//.test(d) || /(^|\/)AGENTS\.md$/.test(d));

/**
 * Node-Versionsprüfung (#1411): erfüllt `version` (z. B. `process.versions.node`) die Angabe `engines.node`, deren Form `>=X[.Y[.Z]]`
 * ist? Liefert eine Hinweiszeile, wenn nicht; `null`, wenn ja oder wenn die Angabe nicht lesbar ist (andere Formen werden still
 * übersprungen, ein SessionStart-Hook darf nie wegen einer exotischen Range stören). Pur.
 */
export function pruefeNodeVersion(version, engines) {
  const soll = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(String(engines ?? ""));
  const ist = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  if (!soll || !ist) return null;
  const mindest = [soll[1], soll[2] ?? "0", soll[3] ?? "0"].map(Number);
  const hat = [ist[1], ist[2], ist[3]].map(Number);
  for (let i = 0; i < 3; i++) {
    if (hat[i] > mindest[i]) return null;
    if (hat[i] < mindest[i]) return `Node ${hat.join(".")} erfüllt engines.node "${String(engines).trim()}" nicht: lokales Node anheben (npm ci warnt sonst mit EBADENGINE, Werkzeuge können fehlschlagen).`;
  }
  return null;
}

/** Hinweis zur Node-Version des laufenden Prozesses gegen `engines.node` der Wurzel-package.json in `dir`; fail-open (`""`). */
export function nodeHinweisFuer(dir, version = process.versions.node) {
  try {
    return pruefeNodeVersion(version, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).engines?.node) ?? "";
  } catch {
    return "";
  }
}

/**
 * node_modules gegen package-lock.json (#1428 Z2): das versteckte Lock `node_modules/.package-lock.json` listet, was wirklich installiert
 * ist. Gezählt werden Pakete des Locks (ohne Wurzel und ohne optionale, plattformabhängige), deren Version im Install-Stand abweicht
 * oder fehlt. Liefert die Hinweiszeile oder `null` (alles passt oder ein Text ist nicht lesbar: fail-open, ein SessionStart-Hook darf
 * nie stören); `hiddenText === null` heißt „kein Install-Stand“. Prüft den ZUSTAND, nicht den Diff des Pulls. Pur.
 */
export function pruefeNodeModules(lockText, hiddenText) {
  let lock;
  try {
    lock = JSON.parse(String(lockText ?? ""))?.packages;
  } catch {
    return null;
  }
  if (!lock || typeof lock !== "object") return null;
  if (hiddenText === null || hiddenText === undefined) return "node_modules hat keinen Install-Stand (.package-lock.json fehlt): vor npm-Skripten im Hauptcheckout einmal `npm ci`.";
  let installiert;
  try {
    installiert = JSON.parse(String(hiddenText))?.packages;
  } catch {
    return null;
  }
  if (!installiert || typeof installiert !== "object") return null;
  let abweichend = 0;
  for (const [pfad, p] of Object.entries(lock)) {
    if (pfad === "" || !pfad.startsWith("node_modules/") || p?.optional || p?.link) continue;
    if (installiert[pfad]?.version !== p?.version) abweichend += 1;
  }
  return abweichend === 0 ? null : `node_modules passt nicht zu package-lock.json (${abweichend} Pakete): vor npm-Skripten im Hauptcheckout einmal \`npm ci\`.`;
}

/** Hinweis zu node_modules in `dir` (siehe `pruefeNodeModules`); ohne package-lock.json oder bei Lesefehlern `""` (fail-open). */
export function nodeModulesHinweisFuer(dir) {
  try {
    const lockText = readFileSync(join(dir, "package-lock.json"), "utf8");
    let hiddenText = null;
    try {
      hiddenText = readFileSync(join(dir, "node_modules", ".package-lock.json"), "utf8");
    } catch {
      /* kein Install-Stand */
    }
    return pruefeNodeModules(lockText, hiddenText) ?? "";
  } catch {
    return "";
  }
}

/** Bilddateien (Screenshots, Aufnahmen) unter den Root-Dateinamen. Pur; Groß-/Kleinschreibung egal. */
export const bildReste = (namen) => namen.filter((n) => /.(png|jpe?g|webm)$/i.test(n));

/** Bilddateien im Root von `dir` (nur Dateien, keine Unterordner wie `.playwright-mcp/`); bei Lesefehlern `[]` (fail-open). */
export function bildResteFuer(dir) {
  try {
    return bildReste(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    return [];
  }
}

/** Der Kontext-Text der Session. Pur. `ergebnis` = `{ aktion, grund, hinter, basis, gepullt, agentenGeaendert, notiz }`. */
export function baueText(ergebnis, { sitzungsbasis = true } = {}) {
  const zeilen = [];
  if (ergebnis.notiz) zeilen.push(`Haupt-Sync: ${ergebnis.notiz}`);
  if (ergebnis.aktion === "melden") zeilen.push(`Haupt-Checkout: ${ergebnis.hinter} Commits hinter origin/main (${ergebnis.grund}).`);
  if (ergebnis.gepullt) {
    zeilen.push(`Haupt-Checkout: main per Fast-Forward um ${ergebnis.hinter} Commits auf origin/main gehoben.`);
    if (ergebnis.agentenGeaendert && sitzungsbasis) {
      zeilen.push("Hooks, Agenten, Skills und AGENTS.md dieser Session stammen vom alten Stand (der Snapshot wird beim Start eingefroren): für den neuen Stand die Session neu starten.");
    } else if (ergebnis.agentenGeaendert) {
      zeilen.push("Skill neu lesen: `.claude/skills`, `.claude/agents` oder AGENTS.md haben sich geändert, der Skill-Text dieser Session stammt vom alten Stand. `.claude/skills/kubernia/SKILL.md` jetzt neu lesen und der neuen Fassung folgen; bei geänderter AGENTS.md zusätzlich `git diff <Stand vor diesem Sync> HEAD -- AGENTS.md` lesen. Hooks und Agent-Definitionen gelten erst nach einem Session-Neustart.");
    }
  }
  if (ergebnis.nodeHinweis) zeilen.push(`Node-Version: ${ergebnis.nodeHinweis}`);
  if (ergebnis.nodeModulesHinweis) zeilen.push(`Abhängigkeiten: ${ergebnis.nodeModulesHinweis}`);
  if (ergebnis.bildReste?.length) zeilen.push(`Bilddateien im Hauptcheckout-Root: ${ergebnis.bildReste.join(", ")} (Screenshots gehören nach .playwright-mcp/, FAQ Browser); verschieben oder löschen.`);
  if (ergebnis.basis) zeilen.push(sitzungsbasis ? `Sitzungsbasis: ${ergebnis.basis}` : `Stand vor diesem Sync: ${ergebnis.basis} (Stand des geteilten Checkouts bei diesem Aufruf; die Basis dieser Session nennt nur der SessionStart-Kontext)`);
  return zeilen.join("\n");
}

const git = (dir, args, opts = {}) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeout ?? 8_000 }).trim();

/** Die ganze Ablaufkette gegen ein echtes Repo in `dir` (nur CLI). Wirft nie; Fehler landen in `notiz`. */
export function fuehreSyncAus(dir) {
  const ergebnis = { aktion: "nichts", grund: "", hinter: 0, basis: "", gepullt: false, agentenGeaendert: false, notiz: "", branch: "", sauber: undefined };
  try {
    ergebnis.basis = git(dir, ["rev-parse", "HEAD"]);
    const istLinkedWorktree = resolve(dir, git(dir, ["rev-parse", "--git-dir"])) !== resolve(dir, git(dir, ["rev-parse", "--git-common-dir"]));
    if (istLinkedWorktree) return { ...ergebnis, ...entscheideSync({ istLinkedWorktree, branch: "", sauber: false, hinter: 0, vor: 0 }) };
    try {
      git(dir, ["fetch", "origin"], { timeout: 20_000 });
    } catch (e) {
      ergebnis.notiz = `git fetch fehlgeschlagen (${String(e.message).split("\n")[0].slice(0, 100)}), Rückstand aus dem letzten bekannten Stand`;
    }
    const branch = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const [vor, hinter] = git(dir, ["rev-list", "--left-right", "--count", "HEAD...origin/main"]).split(/\s+/).map(Number);
    const sauber = git(dir, ["status", "--porcelain", "--untracked-files=no"]) === "";
    const e = entscheideSync({ istLinkedWorktree, branch, sauber, hinter, vor });
    Object.assign(ergebnis, e, { hinter, branch, sauber });
    if (e.aktion === "pull") {
      git(dir, ["merge", "--ff-only", "origin/main"], { timeout: 30_000 });
      ergebnis.gepullt = true;
      ergebnis.agentenGeaendert = agentenGeaendert(git(dir, ["diff", "--name-only", ergebnis.basis, "HEAD"]).split("\n").filter(Boolean));
    }
  } catch (e) {
    ergebnis.notiz = `${ergebnis.notiz ? `${ergebnis.notiz}; ` : ""}Fehler (${String(e.message).split("\n")[0].slice(0, 100)}), nichts verändert`;
  }
  return ergebnis;
}

/** Die Ausgabe des Hooks: Klartext (`--text`, ohne Sitzungsbasis) oder die SessionStart-JSON (mit Sitzungsbasis); leer ohne Text. Pur. */
export function ausgabe(ergebnis, text) {
  const t = baueText(ergebnis, { sitzungsbasis: !text });
  if (!t) return "";
  return text ? t : JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: t } });
}

function main() {
  const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ergebnis = { ...fuehreSyncAus(dir), nodeHinweis: nodeHinweisFuer(dir), nodeModulesHinweis: nodeModulesHinweisFuer(dir), bildReste: bildResteFuer(dir) };
  const out = ausgabe(ergebnis, process.argv.includes("--text"));
  if (out) console.log(out);
  if (process.argv.includes("--streng") && exitCodeFuer(ergebnis) !== 0) {
    console.log("Haupt-Sync (streng): STOPP, den Hauptcheckout hebt erst die Maintainerin (Reste committen oder verwerfen, auf main wechseln). Kein Ticket starten.");
    process.exitCode = 1;
  }
}

if (istDirektaufruf(import.meta.url)) main();
