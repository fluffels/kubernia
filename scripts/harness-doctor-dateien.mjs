/* Harness-Doctor, Dateipunkte (factory#94, ADR 0022): zwei Kern-Regeln gegen die Projektdateien des Beziehers, je Punkt `OK`, `LÜCKE` oder
 * `NICHT PRÜFBAR` (nie still grün; fehlt die `AGENTS.md` im Root, ist `Root-Kontextdatei` nicht prüfbar statt leer grün). Sie ersetzen die Projekt-Kopien der Kern-Tests agents-md-native und line-endings im Bezieher; der Unit-Anteil
 * (Parser, Erkennung) bleibt Kern-Test und ruft dieselben Funktionen aus diesem Modul.
 *
 *   `Root-Kontextdatei`: keine `CLAUDE.md`, `.claude/CLAUDE.md` oder `CLAUDE.local.md` im Root (auch ungetrackt): sie schaltet das native Laden von AGENTS.md ab.
 *   `Zeilenenden`: `.claude/**`, `.agents/**` und `LF_BEISPIELE` haben `eol=lf`, jede andere Textdatei eine eol-Regel (`lf` oder ausdrücklich `crlf`),
 *   der Index enthält kein `crlf` und kein `mixed`. Binärdateien (Index `-text`, Attribut `-text`) und leere Dateien sind ausgenommen.
 *
 * Nur Node-Builtins (der Wochenlauf hat kein `npm ci`); `git` und `existiert` sind injizierbar (Tests). Fehlt Git oder der Index, ist `Zeilenenden`
 * nicht prüfbar, `Root-Kontextdatei` wird trotzdem bewertet. Grenze: ein CI-Checkout sieht ungetrackte Dateien nicht, nur ein lokales `--pruefen`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";

/** Memory-Dateien im Root, deren Existenz das native Laden von AGENTS.md abschaltet; `~/.claude/CLAUDE.md` und Unterordner zählen nicht. */
export const BLOCKIERENDE_KONTEXTDATEIEN = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** Pfade, für die `eol=lf` auch dann gelten muss, wenn es die Datei noch nicht gibt (Hooks, Skills und Agenten dürfen nie CRLF bekommen). */
export const LF_BEISPIELE = [".claude/hooks/neu.js", `${ZEIGER_WURZEL}/neu/SKILL.md`, ".claude/agents/neu.md", `${QUELL_VERZEICHNIS}/neu/SKILL.md`];

const STRENG = [".claude/", ".agents/"];
const MAX_PFADE = 5;

/** Welche der blockierenden Kontextdateien liegen im Root `rootDir` (per `existiert`, auch ungetrackt)? */
export function blockierendeKontextdateien(rootDir, existiert = existsSync) {
  return BLOCKIERENDE_KONTEXTDATEIEN.filter((rel) => existiert(join(rootDir, rel)));
}

/**
 * Parst die `-z`-Ausgabe von `git check-attr -z eol -- <pfade>` (NUL-getrennte Tripel
 * pfad/attribut/wert) und liefert alle Pfade, deren `eol` NICHT `lf` ist.
 */
export function pfadeOhneLf(checkAttrZ) {
  const teile = checkAttrZ.split("\0");
  const ohneLf = [];
  for (let i = 0; i + 2 < teile.length; i += 3) {
    if (teile[i + 2] !== "lf") ohneLf.push(teile[i]);
  }
  return ohneLf;
}

/** Wie `pfadeOhneLf`, aber ein ausdrückliches `crlf` ist erlaubt: nur Pfade ganz ohne eol-Regel (`unspecified`, `unset`, `auto`) sind Funde. */
export function pfadeOhneEolRegel(checkAttrZ) {
  const teile = checkAttrZ.split("\0");
  const funde = [];
  for (let i = 0; i + 2 < teile.length; i += 3) {
    if (teile[i + 2] !== "lf" && teile[i + 2] !== "crlf") funde.push(teile[i]);
  }
  return funde;
}

/**
 * Parst `git ls-files --eol` (Zeilen `i/<index> w/<arbeitskopie> attr/<attr>\t<pfad>`) und
 * liefert die Pfade, deren Index-Zeilenende `crlf` oder `mixed` ist.
 */
export function pfadeMitCrlfImIndex(eolAusgabe) {
  const funde = [];
  for (const zeile of eolAusgabe.split("\n")) {
    const [kopf, pfad] = zeile.split("\t");
    if (pfad !== undefined && /^i\/(crlf|mixed)\b/.test(kopf)) funde.push(pfad);
  }
  return funde;
}

/** Textdateien aus `git ls-files --eol`: nicht binär (Index `-text`), nicht leer (`none`) und nicht ausdrücklich `-text` im Attribut. */
function textPfade(eolAusgabe) {
  const pfade = [];
  for (const zeile of eolAusgabe.split("\n")) {
    const [kopf, pfad] = zeile.split("\t");
    if (pfad === undefined || pfad === "") continue;
    const attribute = /attr\/(.*)$/.exec(kopf)?.[1].trim().split(/\s+/) ?? [];
    if (/^i\/(-text|none)\b/.test(kopf) || attribute.includes("-text")) continue;
    pfade.push(pfad);
  }
  return pfade;
}

const istStreng = (pfad) => STRENG.some((p) => pfad.startsWith(p));
const kurz = (pfade) => (pfade.length > MAX_PFADE ? `${pfade.slice(0, MAX_PFADE).join(", ")} (+${pfade.length - MAX_PFADE} weitere)` : pfade.join(", "));


/** Git-Aufruf im Bezieher (`rootDir`); `input` geht über stdin (Windows begrenzt die Kommandozeile). Wirft mit der ersten Fehlerzeile. */
export function gitStandard(rootDir) {
  return (args, input) => {
    const r = spawnSync("git", ["-C", rootDir, "-c", "core.quotepath=off", ...args], { encoding: "utf8", input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error((r.stderr ?? "").split("\n")[0] || `git ${args[0]} endete mit ${r.status}`);
    return r.stdout;
  };
}

function kontextPunkt(rootDir, existiert) {
  const gefunden = blockierendeKontextdateien(rootDir, existiert);
  if (gefunden.length === 0) {
    if (existiert(join(rootDir, "AGENTS.md"))) return gut("Root-Kontextdatei");
    return nichtPruefbar("Root-Kontextdatei", "keine AGENTS.md im Root: es gibt keine Kontextdatei, die geladen werden könnte", "AGENTS.md im Root des Projekts anlegen (die eine Kontextdatei) oder den Doctor im Projekt-Root starten, dann erneut prüfen");
  }
  return luecke(
    "Root-Kontextdatei",
    `${gefunden.join(", ")} liegt im Root und schaltet das native Laden von AGENTS.md ab`,
    "Inhalt in den Projekt-Block der AGENTS.md übernehmen, Datei entfernen (ungetrackte zählen mit)",
  );
}

function zeilenendenFunde(git) {
  const eol = git(["ls-files", "--eol"]);
  const text = textPfade(eol);
  if (eol.trim() === "") return null;
  const streng = [...text.filter(istStreng), ...LF_BEISPIELE];
  const lax = text.filter((p) => !istStreng(p));
  const ohneLf = pfadeOhneLf(git(["check-attr", "--stdin", "-z", "eol"], streng.join("\0")));
  const ohneRegel = lax.length ? pfadeOhneEolRegel(git(["check-attr", "--stdin", "-z", "eol"], lax.join("\0"))) : [];
  return { ohneLf, ohneRegel, crlf: pfadeMitCrlfImIndex(eol) };
}

function zeilenendenPunkt(git) {
  const fix = "`* text=auto eol=lf` in .gitattributes (Binärdateien `binary`), dann `git add --renormalize .` und committen";
  let funde;
  try {
    funde = zeilenendenFunde(git);
  } catch (e) {
    return nichtPruefbar("Zeilenenden", `Git nicht lesbar (${e instanceof Error ? e.message : String(e)})`, "in einem Git-Checkout mit installiertem git prüfen (git status), dann erneut prüfen");
  }
  if (funde === null) return nichtPruefbar("Zeilenenden", "keine getrackten Dateien im Index", "in einem Git-Checkout mit committeten Dateien prüfen, dann erneut prüfen");
  const teile = [];
  if (funde.ohneLf.length) teile.push(`ohne eol=lf unter .claude/ und .agents/: ${kurz(funde.ohneLf)}`);
  if (funde.ohneRegel.length) teile.push(`ohne eol-Regel: ${kurz(funde.ohneRegel)}`);
  if (funde.crlf.length) teile.push(`CRLF oder gemischt im Index: ${kurz(funde.crlf)}`);
  return teile.length ? luecke("Zeilenenden", teile.join("; "), fix) : gut("Zeilenenden");
}

/** Die Dateipunkte des Doctors: `[Root-Kontextdatei, Zeilenenden]`, immer beide, nie weniger. */
export function pruefeDateien({ rootDir, git = gitStandard(rootDir), existiert = existsSync }) {
  return [kontextPunkt(rootDir, existiert), zeilenendenPunkt(git)];
}
