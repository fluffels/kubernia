// Arbeitsplatz (ADR 0022 Fortschreibung, #87): Pfade, Worktree-Befehl und Sauberkeits-Prüfung der Repos eines Arbeitsplatzes.
// `node scripts/arbeitsplatz.mjs pfade [--wurzel <pfad>]`
// `node scripts/arbeitsplatz.mjs worktree <nr> <slug> [--repo <name>] [--wurzel <pfad>]`
// `node scripts/arbeitsplatz.mjs sauber [--repo <name>] [--wurzel <pfad>]`
// `--wurzel` ist der Ordner mit `.factory/projekt.json` (Standard: das Repo dieses Skripts). Exit 0 ok, 1 Harness-Spur oder Git-/Config-Fehler, 2 Aufruf.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arbeitsplatzAus, harnessSpuren, worktreeBefehl } from "./arbeitsplatz-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, befehlLesen } from "./flag-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { ticketNamen } from "./ticket-namen.mjs";

const USAGE = [
  "Aufruf: node scripts/arbeitsplatz.mjs pfade [--wurzel <pfad>]",
  "        node scripts/arbeitsplatz.mjs worktree <nr> <slug> [--repo <name>] [--wurzel <pfad>]",
  "        node scripts/arbeitsplatz.mjs sauber [--repo <name>] [--wurzel <pfad>]",
].join("\n");

const WURZEL = { wurzel: { type: "string" } };
const BEFEHLE = {
  pfade: { optionen: { ...WURZEL }, positionale: 0 },
  worktree: { optionen: { ...WURZEL, repo: { type: "string" } }, positionale: 2 },
  sauber: { optionen: { ...WURZEL, repo: { type: "string" } }, positionale: 0 },
};

/** Git-Aufruf im Ordner `cwd`: `{ ok, stdout }`; ein Fehler (kein Repo, kein Git) ist `ok: false` mit der Meldung als `stdout`. */
function gitStandard(args, cwd) {
  try {
    return { ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }) };
  } catch (e) {
    return { ok: false, stdout: e instanceof Error ? e.message : String(e) };
  }
}

/** Wählt das Repo: ohne `--repo` das einzige, bei mehreren ein Aufruf-Fehler mit den Namen. Rückgabe `{ repos }` oder `{ fehler }`. */
function repoWaehlen(aufloesung, name, { mehrere }) {
  if (name !== undefined) {
    const treffer = aufloesung.repos.filter((r) => r.name === name);
    return treffer.length > 0 ? { repos: treffer } : { fehler: `unbekanntes Repo "${name}" (bekannt: ${aufloesung.repos.map((r) => r.name).join(", ")})` };
  }
  if (aufloesung.repos.length > 1 && !mehrere) return { fehler: `mehrere Repos, --repo <name> angeben (${aufloesung.repos.map((r) => r.name).join(", ")})` };
  return { repos: aufloesung.repos };
}

function pfadeAusgeben(aufloesung, out) {
  out(`betriebsart: ${aufloesung.betriebsart}`);
  out(`wurzel: ${aufloesung.wurzel}`);
  for (const r of aufloesung.repos) out(`repo ${r.name}: ${r.pfad} (worktrees: ${r.worktreeOrdner})`);
  return 0;
}

function worktreeAusgeben(aufloesung, config, { positionale, werte }, { out, err }) {
  const [nr, slug] = positionale;
  if (!/^[1-9]\d*$/.test(nr ?? "") || !slug || /\s/.test(slug)) {
    err(`arbeitsplatz: <nr> muss eine positive Ganzzahl und <slug> ein Wort ohne Leerraum sein\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const wahl = repoWaehlen(aufloesung, werte.repo, { mehrere: false });
  if (wahl.fehler) {
    err(`arbeitsplatz: ${wahl.fehler}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const namen = ticketNamen(config);
  out(worktreeBefehl({ aufloesung, repo: wahl.repos[0], worktreeName: namen.worktreeName(nr), branchName: namen.branchName(nr, slug) }));
  return 0;
}

function saubereRepos(config, repos, { git, out, err }) {
  const { dateiMuster } = ticketNamen(config);
  let code = 0;
  for (const r of repos) {
    const status = git(["status", "--porcelain=v1", "-z", "--ignored"], r.pfad);
    if (!status.ok) {
      err(`✖ ${r.name}: git status schlug fehl in ${r.pfad}: ${status.stdout}`);
      code = 1;
      continue;
    }
    const spuren = harnessSpuren(status.stdout, { dateiMuster });
    for (const s of spuren) err(`✖ ${r.name}: ${s.status} ${s.pfad}`);
    if (spuren.length > 0) code = 1;
    else out(`✔ ${r.name}: keine Harness-Spur`);
  }
  if (code === 1) err("Fix: Harness-Dateien und Worktrees gehören in die Arbeitsplatz-Wurzel (Worktrees nach <wurzel>/.claude/worktrees/<name>), nicht ins Projekt-Repo");
  return code;
}

function saeubern(aufloesung, config, { werte }, io) {
  if (aufloesung.betriebsart === "eingebettet") {
    io.out("arbeitsplatz: eingebettet: Harness liegt bewusst im Repo, keine Prüfung");
    return 0;
  }
  const wahl = repoWaehlen(aufloesung, werte.repo, { mehrere: true });
  if (wahl.fehler) {
    io.err(`arbeitsplatz: ${wahl.fehler}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  return saubereRepos(config, wahl.repos, io);
}

/** Kommandozeile; Rückgabe = Exit-Code (0 ok, 1 Spur oder Git-/Config-Fehler, 2 Aufruf). */
export function cli(argv, { wurzel = join(dirname(fileURLToPath(import.meta.url)), ".."), git = gitStandard, out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const gelesen = befehlLesen(argv, BEFEHLE);
  if (gelesen.fehler) {
    err(`arbeitsplatz: ${gelesen.fehler.text}\n${USAGE}`);
    return AUFRUF_EXIT;
  }
  const basis = gelesen.werte.wurzel ?? wurzel;
  let config;
  let aufloesung;
  try {
    config = ladeProjektConfig({ rootDir: basis });
    aufloesung = arbeitsplatzAus(config, basis);
  } catch (e) {
    err(`arbeitsplatz: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  if (gelesen.befehl === "pfade") return pfadeAusgeben(aufloesung, out);
  if (gelesen.befehl === "worktree") return worktreeAusgeben(aufloesung, config, gelesen, { out, err });
  return saeubern(aufloesung, config, gelesen, { git, out, err });
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
