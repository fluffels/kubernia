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
 * Als SessionStart-Hook gibt er IMMER `Sitzungsbasis: <HEAD vor dem Pull>` aus: der Ticket-Skill prüft damit vor dem
 * Spawn, ob sich Agenten-Definitionen seit dem Start der Session geändert haben (der Hook-/Definitions-Snapshot wird beim
 * Start eingefroren, ein Pull ändert die laufende Session nicht). Nur diese Zeile ist die Sitzungsbasis: der Haupt-Checkout
 * ist geteilt, ein späterer Aufruf (`--text`, auch aus einer anderen Session) sieht einen schon gehobenen `main` und darum
 * einen falschen Stand; `--text` nennt deshalb nur „Stand vor diesem Sync“ (HEAD des Checkouts beim Aufruf) und behauptet nichts über die Basis der Session, die nur der SessionStart-Kontext nennt. Hat der Pull `.claude/` oder `AGENTS.md` geändert, sagt er das
 * zusätzlich ausdrücklich. Fail-open: jeder Fehler (kein Netz, kein git) ergibt nur eine kurze Notiz, nie einen Abbruch.
 *
 * `--text --streng` ist der erste Schritt des Ticket-Skills (#1392): derselbe Sync (entspricht `git pull --ff-only`, aber mit Stopp
 * bei getrackten Resten), nur dass jede Abweichung vom sauberen `main` Exit 1 ergibt (`exitCodeFuer`): der Hauptchat startet dann kein
 * Ticket. Hat der Sync eine Ticket-Skill-Quelle (`.agents/skills/`), deren Zeiger (`.claude/skills`) oder `AGENTS.md` geändert, sagt der Text „Skill neu lesen“: der Skill-Text
 * der laufenden Session stammt noch vom alten Stand.
 *
 * Aufruf-Fehler (unbekanntes Flag, fehlender Wert, doppeltes Flag, Positionsargument): Exit 2 vor Sync und Folge-Skript.
 *
 * Hook-Ausgabe: `hookSpecificOutput.additionalContext` (SessionStart). Wächter: test/harness/haupt-sync.test.ts.
 * Nur Node-Builtins.
 */
import { execFileSync, spawnSync as spawnSyncEcht } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf, readStdin } from "./hook-io.mjs";
import { KERN_TICKET_SKILL, TICKET_SKILL_ORDNER } from "./projekt-config-lib.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";

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

/** Verzeichnis der Ticket-Skill-Quelle als fester Kern-Pfad (#1748, `ROLLEN_PFADE.ticketSkill`, seit #1850 unter `.agents/skills/`): ohne Config, ohne IO (der Hook ist fail-open). */
export const TICKET_SKILL_VERZEICHNIS = `${TICKET_SKILL_ORDNER}/`;

/** Grund, warum die Projekt-Config nicht nutzbar ist (mit Fix-Zeile), sonst `null`. Wirft nie. */
export function configGrund(deps = {}) {
  return namenOderGrund("haupt-sync", deps).grund ?? null;
}

/** Quell-Verzeichnis des Kern-Ticket-Skills samt gemeinsamem Ablauf (#1806): zählt immer als Skill, unabhängig von der Projekt-Config. */
export const KERN_SKILL_VERZEICHNIS = `${QUELL_VERZEICHNIS}/${KERN_TICKET_SKILL}/`;

/** Die generierten Zeiger beider Ticket-Skills unter dem Werkzeug-Verzeichnis (#1850): eine Änderung dort meint immer die Quelle. */
export const ZEIGER_VERZEICHNISSE = [`${ZEIGER_WURZEL}/${KERN_TICKET_SKILL}/`, `${ZEIGER_WURZEL}/${posix.basename(TICKET_SKILL_ORDNER)}/`];

/** Pfad eines Zeigers → Pfad seiner Quelle (Zeiger und Quelle heißen gleich); alles andere unverändert. */
export function quellePfad(d) {
  const zeiger = ZEIGER_VERZEICHNISSE.find((v) => d.startsWith(v));
  return zeiger ? `${QUELL_VERZEICHNIS}/${d.slice(ZEIGER_WURZEL.length + 1)}` : d;
}

/**
 * Geänderte Dateien eines Syncs nach Wirkung ordnen (#1572). `skill`: die Ticket-Skills (Quelle und Zeiger des festen Kern-Pfads `factory-ticket/` und des Kern-Skills `factory` samt Ablauf) und die Wurzel-AGENTS.md (der Hauptchat
 * liest sie neu); `agenten`: Agent-Definitionen (gelten erst nach Session-Neustart); `sonstige`: übrige `.claude/`-Dateien, Skill-Quellen unter `.agents/` (#1848) und
 * modul-lokale AGENTS.md; `lockGeaendert`: package-lock.json. Pur, wirft nie.
 */
export function ordneHarnessAenderungen(dateien) {
  const ordnung = { skill: [], agenten: [], sonstige: [], lockGeaendert: false };
  for (const d of Array.isArray(dateien) ? dateien : []) {
    if (d === "package-lock.json") ordnung.lockGeaendert = true;
    else if (d === "AGENTS.md" || d.startsWith(KERN_SKILL_VERZEICHNIS) || d.startsWith(TICKET_SKILL_VERZEICHNIS) || ZEIGER_VERZEICHNISSE.some((v) => d.startsWith(v))) ordnung.skill.push(d);
    else if (d.startsWith(".claude/agents/")) ordnung.agenten.push(d);
    else if (d.startsWith(".claude/") || d.startsWith(".agents/") || /(^|\/)AGENTS\.md$/.test(d)) ordnung.sonstige.push(d);
  }
  return ordnung;
}

const MAX_PFADE = 8;
const pfadListe = (pfade) => (pfade.length > MAX_PFADE ? `${pfade.slice(0, MAX_PFADE).join(", ")} … und ${pfade.length - MAX_PFADE} weitere` : pfade.join(", "));

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
export const bildReste = (namen) => namen.filter((n) => /\.(png|jpe?g|webm)$/i.test(n));

/** Bilddateien im Root von `dir` (nur Dateien, keine Unterordner wie `.playwright-mcp/`); bei Lesefehlern `[]` (fail-open). */
export function bildResteFuer(dir) {
  try {
    return bildReste(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));
  } catch {
    return [];
  }
}

/** Der Kontext-Text der Session. Pur. `ergebnis` = `{ aktion, grund, hinter, basis, gepullt, harness, nodeHinweis, nodeModulesHinweis, notiz }`. */
export function baueText(ergebnis, { sitzungsbasis = true } = {}) {
  const zeilen = [];
  if (ergebnis.notiz) zeilen.push(`Haupt-Sync: ${ergebnis.notiz}`);
  if (ergebnis.aktion === "melden") zeilen.push(`Haupt-Checkout: ${ergebnis.hinter} Commits hinter origin/main (${ergebnis.grund}).`);
  if (ergebnis.gepullt) {
    zeilen.push(`Haupt-Checkout: main per Fast-Forward um ${ergebnis.hinter} Commits auf origin/main gehoben.`);
    const h = ergebnis.harness ?? { skill: [], agenten: [], sonstige: [], lockGeaendert: false };
    const alle = [...h.skill, ...h.agenten, ...h.sonstige];
    if (alle.length && sitzungsbasis) {
      zeilen.push("Hooks, Agenten, Skills und AGENTS.md dieser Session stammen vom alten Stand (der Snapshot wird beim Start eingefroren): für den neuen Stand die Session neu starten.");
    } else if (alle.length) {
      zeilen.push(`Geändert (Harness): ${pfadListe(alle)}`);
      if (h.skill.length) {
        const agentsMd = h.skill.includes("AGENTS.md") ? " Die Wurzel-AGENTS.md hat sich geändert: zusätzlich `git diff <Stand vor diesem Sync> HEAD -- AGENTS.md` lesen." : "";
        const quellen = [...new Set(h.skill.map(quellePfad))];
        const skillMd = quellen.filter((d) => d.endsWith("/SKILL.md"));
        const skillDateien = skillMd.length ? skillMd : quellen.filter((d) => d.endsWith("/ablauf.md")).slice(0, 1);
        zeilen.push(`Skill neu lesen: ${quellen.join(", ")} haben sich geändert, der Skill-Text dieser Session stammt vom alten Stand. ${skillDateien.length ? skillDateien.map((d) => `\`${d}\``).join(", ") : "Den Ticket-Skill"} jetzt neu lesen und der neuen Fassung folgen.${agentsMd}`);
      }
      if (h.agenten.length) zeilen.push("Agent-Definitionen geändert: gelten erst nach Session-Neustart; beim Umsetzer-Spawn den Umsetzer-Zusatz setzen (Skill § Vor dem Spawn).");
      const quelle = h.sonstige.filter((d) => d.startsWith(`${QUELL_VERZEICHNIS}/`));
      if (h.sonstige.length > quelle.length) zeilen.push("Übrige .claude-Dateien (Hooks, Einstellungen, andere Skills) gelten erst nach einem Session-Neustart.");
      if (quelle.length) zeilen.push(`Geänderte Skill-Quellen unter ${QUELL_VERZEICHNIS}/ gelten ab dem nächsten Skill-Aufruf (der Zeiger verweist auf die Quelle).`);
    }
  }
  // Im Klartext-Modus (--text, Skill-Schritt 0) steht die Node-Version schon im SessionStart-Kontext, node_modules nur nach einer Lock-Änderung dieses Syncs.
  if (ergebnis.nodeHinweis && sitzungsbasis) zeilen.push(`Node-Version: ${ergebnis.nodeHinweis}`);
  if (ergebnis.nodeModulesHinweis && (sitzungsbasis || ergebnis.harness?.lockGeaendert)) zeilen.push(`Abhängigkeiten: ${ergebnis.nodeModulesHinweis}`);
  if (ergebnis.bildReste?.length) zeilen.push(`Bilddateien im Hauptcheckout-Root: ${ergebnis.bildReste.join(", ")} (Screenshots gehören nach .playwright-mcp/, FAQ Browser); verschieben oder löschen.`);
  if (ergebnis.basis) zeilen.push(sitzungsbasis ? `Sitzungsbasis: ${ergebnis.basis}` : `Stand vor diesem Sync: ${ergebnis.basis} (Stand des geteilten Checkouts bei diesem Aufruf; die Basis dieser Session nennt nur der SessionStart-Kontext)`);
  return zeilen.join("\n");
}

const git = (dir, args, opts = {}) =>
  execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: opts.timeout ?? 8_000 }).trim();

/** Die ganze Ablaufkette gegen ein echtes Repo in `dir` (nur CLI). Wirft nie; Fehler landen in `notiz`. */
export function fuehreSyncAus(dir, deps = {}) {
  const ergebnis = { aktion: "nichts", grund: "", hinter: 0, basis: "", gepullt: false, notiz: "", branch: "", sauber: undefined };
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
      // Ohne nutzbare Config bleibt der Fast-Forward (fail-open), der Grund steht in `notiz` und macht `--streng` rot.
      const { grund } = namenOderGrund("haupt-sync", deps);
      if (grund) ergebnis.notiz = `${ergebnis.notiz ? `${ergebnis.notiz}; ` : ""}${grund}`;
      ergebnis.harness = ordneHarnessAenderungen(git(dir, ["diff", "--name-only", ergebnis.basis, "HEAD"]).split("\n").filter(Boolean));
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

const USAGE = "Aufruf: node scripts/haupt-sync.mjs [--text] [--streng] [--danach <skript>]";

/**
 * Liest den Aufruf (`flagsLesen`): `{ text, streng, danach }` oder `{ fehler }`. `danach` ist das Skript, das der Hook nach dem Sync mit demselben
 * stdin startet; im Modus `--text` (Skill-Schritt 0) und bei leerem Wert nie (`null`). Pur.
 */
export function aufrufLesen(argv) {
  const r = flagsLesen(argv, { text: { type: "boolean" }, streng: { type: "boolean" }, danach: { type: "string" } });
  if (r.fehler) return { fehler: r.fehler.text };
  const text = r.werte.text === true;
  const danach = !text && typeof r.werte.danach === "string" && r.werte.danach !== "" ? r.werte.danach : null;
  return { text, streng: r.werte.streng === true, danach };
}

/**
 * Startet `node <skript>` mit dem Hook-stdin und wartet kurz (Zeitgrenze 8 s; die Hook-Einstiege starten ihre Arbeit losgelöst und enden sofort).
 * Die Ausgabe des Folge-Skripts wird verworfen, damit die Hook-JSON rein bleibt. Fail-open: `false` bei Fehler, nie ein Wurf.
 */
export function starteDanach(skript, text, { spawnSync = spawnSyncEcht, execPath = process.execPath } = {}) {
  try {
    const r = spawnSync(execPath, [skript], { input: text, stdio: ["pipe", "ignore", "ignore"], timeout: 8_000, windowsHide: true });
    return !r?.error;
  } catch {
    return false;
  }
}

function main() {
  // Aufruf-Fehler vor stdin, Sync und Folge-Skript (#1817).
  const aufruf = aufrufLesen(process.argv.slice(2));
  if (aufruf.fehler) {
    console.error(`haupt-sync: ${aufruf.fehler}\n${USAGE}`);
    process.exitCode = AUFRUF_EXIT;
    return;
  }
  const { danach } = aufruf;
  // Der Folge-Hook (Langfuse-Abgleich, #1568) braucht den Stand NACH dem Fast-Forward: sonst lädt er den alten Code des Hauptcheckouts. Darum läuft er im `finally`, auch bei Abbruch.
  const stdinText = danach ? readStdin() : "";
  try {
    const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const ergebnis = { ...fuehreSyncAus(dir), nodeHinweis: nodeHinweisFuer(dir), nodeModulesHinweis: nodeModulesHinweisFuer(dir), bildReste: bildResteFuer(dir) };
    const out = ausgabe(ergebnis, aufruf.text);
    if (out) console.log(out);
    if (aufruf.streng && exitCodeFuer(ergebnis) !== 0) {
      console.log("Haupt-Sync (streng): STOPP, den Hauptcheckout hebt erst die Maintainerin (Reste committen oder verwerfen, auf main wechseln). Kein Ticket starten.");
      process.exitCode = 1;
    }
  } finally {
    if (danach) starteDanach(danach, stdinText);
  }
}

if (istDirektaufruf(import.meta.url)) main();
