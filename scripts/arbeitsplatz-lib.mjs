// Lib ohne Direktaufruf-Guard; `arbeitsplatz.mjs`, `projekt-config-lib.mjs`, `ticket-namen.mjs` und `mess-lib.mjs` importieren sie (ADR 0022 Fortschreibung, #87).
/**
 * Betriebsart Arbeitsplatz: der optionale Config-Block `arbeitsplatz` (`wurzel`, `repos[]` mit `name` und `pfad`), der Resolver daraus
 * (Wurzel, Repo-Pfade, Worktree-Ordner je Repo), der Worktree-Befehl und der Parser für Harness-Spuren im Projekt-Repo.
 *
 * Eingebettet (ohne Block) liegt der Harness im Repo, der Worktree-Ordner ist `<repo>/.claude/worktrees`. Im Arbeitsplatz liegen die Repos
 * unter einer Wurzel, die Worktrees außerhalb jedes Repos unter `<wurzel>/.claude/worktrees/<name>`.
 *
 * Nur `node:path`: ein Import von `projekt-config-lib` oder `ticket-namen` ergäbe einen Zyklus (beide importieren diese Datei).
 *
 * bekannte Muster (Spur-Liste, geschlossen): Segmente `.claude`, `.agents`, `.factory`, `.codex`; Dateinamen `AGENTS.md`, `CLAUDE.md`,
 * `CLAUDE.local.md`; ein Segment `<worktree-präfix><nr>` (mit `-`, `.` oder Ende dahinter); jeweils ohne Groß-/Kleinschreibung und nur bei
 * Status `??` (ungetrackt) oder `!!` (ignoriert).
 * Grenze: `git status` fasst einen ungetrackten oder ignorierten Ordner zu einem Eintrag zusammen; was darin liegt, wird nicht gesucht.
 * Tut ein Ordner mit anderem Namen Harness-Dateien auf, sieht der Parser sie nicht.
 */
import { isAbsolute, posix, resolve } from "node:path";

/** Zeichenklasse eines Repo-Namens (Regex-Quelltext): beginnt alphanumerisch, danach Buchstaben, Ziffern, `.`, `_`, `-`; kein Schrägstrich, kein Leerraum. */
export const REPO_NAME_QUELLE = "[A-Za-z0-9][A-Za-z0-9._-]*";

const NAME_MUSTER = new RegExp(`^${REPO_NAME_QUELLE}$`);
const BLOCK_SCHLUESSEL = ["wurzel", "repos"];
const REPO_SCHLUESSEL = ["name", "pfad"];

/** Pur: ist `name` ein gültiger Repo-Name? */
export const istRepoName = (name) => typeof name === "string" && NAME_MUSTER.test(name);

/**
 * Pur: Regex-Quelltext des optionalen Repo-Segments vor einem Worktree-Namen. `wEscaped` ist das maskierte Worktree-Präfix, `trenner` der
 * Regex-Quelltext des Pfadtrenners. Das Segment darf selbst nicht wie `<wt><nr>` beginnen, damit es den Worktree-Namen nicht verschluckt.
 */
export const repoSegment = (wEscaped, trenner) => `(?:(?!${wEscaped}\\d)${REPO_NAME_QUELLE}${trenner})?`;

/** Pur: ein relativer POSIX-Pfad (`src`, `docs/module`): kein absoluter Pfad, kein Laufwerk, keine `.`/`..`-Segmente, kein Backslash, kein End- oder Doppel-Slash. */
export function istRelativPosix(pfad) {
  if (pfad.includes("\\") || pfad.includes(":")) return false;
  return pfad.split("/").every((teil) => teil !== "" && teil !== "." && teil !== "..");
}

const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const istText = (v) => typeof v === "string" && v.trim() !== "";
const unbekannte = (obj, erlaubt, wo) => Object.keys(obj).filter((k) => !erlaubt.includes(k)).map((k) => `${wo}.${k} ist unbekannt`);
const nurPunkte = (pfad) => pfad.split("/").every((teil) => teil === "." || teil === ".." || teil === "");

/** Pur: Mängel eines Repo-Pfads relativ zur Wurzel (Form, enthält die Wurzel, außerhalb, absolut). */
function pfadMaengel(pfad, wo) {
  if (!istText(pfad)) return [`${wo}.pfad muss ein nicht-leerer String sein`];
  if (nurPunkte(pfad)) return [`${wo}.pfad "${pfad}" enthält die Wurzel (ein Repo darf die Arbeitsplatz-Wurzel nicht enthalten)`];
  if (pfad.startsWith("../")) return [`${wo}.pfad "${pfad}" liegt außerhalb der Wurzel`];
  if (!istRelativPosix(pfad)) return [`${wo}.pfad "${pfad}" muss ein relativer POSIX-Pfad zur Wurzel sein (kein Backslash, Laufwerk, absolut, \`.\`/\`..\`-Segment)`];
  return [];
}

/** Pur: Mängel eines Repo-Namens (Form, Worktree-Präfix am Anfang). */
function nameMaengel(name, wo, worktreePraefix) {
  if (!istRepoName(name)) return [`${wo}.name "${String(name)}" ist ungültig (${REPO_NAME_QUELLE}, ohne Schrägstrich und Leerraum)`];
  if (istText(worktreePraefix) && name.toLowerCase().startsWith(worktreePraefix.toLowerCase()) && /^\d/.test(name.slice(worktreePraefix.length))) {
    return [`${wo}.name "${name}" beginnt wie ein Worktree-Name (${worktreePraefix}<nr>)`];
  }
  return [];
}

/** Pur: überschneidet ein Repo-Pfad den Worktree-Ordner `.claude/worktrees/<name>` (Repo `.claude` oder `.claude/worktrees` enthält ihn, `.claude/worktrees/…` ist er oder liegt darin)? */
function ordnerMaengel(repos) {
  const pfade = repos.map((r) => r?.pfad).filter((p) => istText(p) && istRelativPosix(p));
  return [...new Set(pfade.filter((p) => p === ".claude" || p === ".claude/worktrees" || p.startsWith(".claude/worktrees/")))]
    .map((p) => `repos.pfad "${p}" überschneidet den Worktree-Ordner .claude/worktrees (Worktrees liegen außerhalb jedes Repos)`);
}

/** Pur: prüft den Block `arbeitsplatz`; leere Liste = gültig. `worktreePraefix` (`praefixe.worktree`) schützt Repo-Namen vor Verwechslung mit Worktree-Namen. */
export function arbeitsplatzMaengel(block, { worktreePraefix } = {}) {
  if (!istObjekt(block)) return ["arbeitsplatz muss ein Objekt (wurzel, repos) sein"];
  const fehler = unbekannte(block, BLOCK_SCHLUESSEL, "arbeitsplatz");
  if (!istText(block.wurzel)) fehler.push("arbeitsplatz.wurzel muss ein nicht-leerer String sein");
  if (!Array.isArray(block.repos) || block.repos.length === 0) {
    fehler.push("arbeitsplatz.repos muss eine nicht-leere Liste von { name, pfad } sein");
    return fehler;
  }
  const gesehen = new Set();
  block.repos.forEach((repo, i) => {
    const wo = `arbeitsplatz.repos[${i}]`;
    if (!istObjekt(repo)) {
      fehler.push(`${wo} muss ein Objekt { name, pfad } sein`);
      return;
    }
    fehler.push(...unbekannte(repo, REPO_SCHLUESSEL, wo), ...nameMaengel(repo.name, wo, worktreePraefix), ...pfadMaengel(repo.pfad, wo));
    const schluessel = typeof repo.name === "string" ? repo.name.toLowerCase() : undefined;
    if (schluessel !== undefined && gesehen.has(schluessel)) fehler.push(`${wo}.name "${repo.name}" kommt doppelt vor (ohne Beachtung der Groß-/Kleinschreibung)`);
    if (schluessel !== undefined) gesehen.add(schluessel);
  });
  fehler.push(...ordnerMaengel(block.repos));
  return fehler;
}

const posixAus = (pfad) => pfad.replace(/\\/g, "/").replace(/(?<=.)\/+$/, "");

/**
 * Pur: leitet Betriebsart, Wurzel, Repo-Pfade und Worktree-Ordner je Repo ab, alles mit Schrägstrichen. `basis` ist der Ordner, der
 * `.factory/projekt.json` enthält. Ohne Block (eingebettet) ist die Wurzel die Basis und der einzige Repo die Basis selbst. Wirft bei kaputtem Block mit „Fix:“-Zeile.
 */
export function arbeitsplatzAus(config, basis) {
  const block = config?.arbeitsplatz;
  if (block === undefined) {
    const pfad = posixAus(resolve(basis));
    const name = typeof config?.repo === "string" && config.repo.includes("/") ? config.repo.split("/")[1] : pfad.split("/").pop();
    return { betriebsart: "eingebettet", wurzel: pfad, repos: [{ name, pfad, worktreeOrdner: `${pfad}/.claude/worktrees` }] };
  }
  const maengel = arbeitsplatzMaengel(block, { worktreePraefix: config?.praefixe?.worktree });
  if (maengel.length > 0) throw new Error(`${maengel.join("; ")}\nFix: den Block arbeitsplatz (wurzel, repos[] mit name und pfad) in der Projekt-Config korrigieren`);
  const wurzel = posixAus(isAbsolute(block.wurzel) ? block.wurzel : resolve(basis, block.wurzel));
  const repos = block.repos.map(({ name, pfad }) => ({ name, pfad: posix.join(wurzel, pfad), worktreeOrdner: `${wurzel}/.claude/worktrees/${name}` }));
  return { betriebsart: "arbeitsplatz", wurzel, repos };
}

const anfuehren = (pfad) => (/\s/.test(pfad) ? `"${pfad}"` : pfad);

/**
 * Pur: der Befehl, der den Ticket-Worktree anlegt. Eingebettet die relative Form aus AGENTS.md (zeichengleich), im Arbeitsplatz mit `git -C`
 * auf das Repo und dem Worktree-Ordner außerhalb. `repo` ist ein Eintrag aus `arbeitsplatzAus(...).repos`.
 */
export function worktreeBefehl({ aufloesung, repo, worktreeName, branchName }) {
  if (aufloesung.betriebsart === "eingebettet") {
    return `git fetch origin && git worktree add .claude/worktrees/${worktreeName} -b ${branchName} origin/main`;
  }
  const c = `git -C ${anfuehren(repo.pfad)}`;
  return `${c} fetch origin && ${c} worktree add ${anfuehren(`${repo.worktreeOrdner}/${worktreeName}`)} -b ${branchName} origin/main`;
}

const SPUR_SEGMENTE = new Set([".claude", ".agents", ".factory", ".codex"]);
const SPUR_DATEIEN = new Set(["agents.md", "claude.md", "claude.local.md"]);

/**
 * Pur: Harness-Spuren aus der Ausgabe von `git status --porcelain=v1 -z --ignored`: `[{ status, pfad }]` nur für `??` und `!!`.
 * `dateiMuster` ist das Worktree-Muster aus `ticket-namen` (`<wt><nr>` mit `-`/`.`/Ende dahinter).
 */
export function harnessSpuren(statusZ, { dateiMuster } = {}) {
  const worktree = dateiMuster ? new RegExp(dateiMuster.source, "i") : undefined;
  const felder = String(statusZ).split("\0");
  const spuren = [];
  for (let i = 0; i < felder.length; i++) {
    const eintrag = felder[i];
    if (eintrag.length < 4) continue;
    const status = eintrag.slice(0, 2);
    if (/[RC]/.test(status)) i++;
    if (status !== "??" && status !== "!!") continue;
    const pfad = eintrag.slice(3);
    const segmente = pfad.split("/").filter(Boolean);
    const treffer = segmente.some((s) => SPUR_SEGMENTE.has(s.toLowerCase()) || SPUR_DATEIEN.has(s.toLowerCase()) || worktree?.test(s));
    if (treffer) spuren.push({ status, pfad });
  }
  return spuren;
}
