// Kein Shebang: wird per `node scripts/gate-fundquote.mjs` gestartet UND von test/gate-fundquote.test.ts importiert.
/**
 * Gate-Fundquote (factory#39): je Teil-Gate von `verify` (plus die Zusatzschritte von `verify:full`) die Zahl der Läufe, die es
 * erreicht haben, davon rot, und die Median-Dauer. Ohne diese Zahl lässt sich die Lockern-Regel (ADR 0027) nicht auf Gates anwenden.
 * `verify` selbst bleibt unverändert; gelesen wird nur die vorhandene Ausgabe, kein eigener Runner.
 *
 * Quellen: Claude-Transkripte (Bash- und PowerShell-Ausgaben) und CI-Logs (`gh run view --log`, `--ci`; gespeicherte Logs `--ci-log`).
 * Gate-Satz und Paketname kommen aus `package.json` (Kern-Datei ohne Projektwort).
 *
 * Zählregeln (geschlossene Liste; was sie nicht sicher deckt, fällt ganz heraus und steht im Fuß „nicht gezählt“, nie halb gezählt):
 *  1. Kopfzeile `> <paket>@<version> <skript>`: nur Skripte des Gate-Satzes zählen; ein anderer Paketname oder ein Skript außerhalb
 *     des Gate-Satzes ist fremd, trennt Abschnitte und wird nie gezählt. Die Kettennamen (`verify`, `verify:full`) sind keine Gates.
 *  2. Ein Gate, dem eine weitere Kopfzeile folgt, ist grün; das letzte ist grün bei Exit 0, sonst rot (ist es fremd, ist kein Gate rot).
 *     Folgt auf eine Kettenkopfzeile ein Rot, zählen die übrigen Gates der Kette als „nicht erreicht“, nie als grün (npm druckt bei
 *     einem roten Schritt keine Fehlerzeile: Rot ist nur aus Kopfzeilen und Exit-Status ableitbar).
 *  3. Transkript: gezählt wird nur eine reine `&&`-Kette aus `cd`, Env-Zuweisungen und Gate-Aufrufen (`npm run`, `npm test`,
 *     `gate-befehl.mjs`, `verify-lauf.mjs`); Pipe (Grund „Pipe“) und jede andere Form (Grund „Befehlsform“) fallen heraus.
 *     Exit 0 bei `is_error` falsch, `Exit code N` bei `is_error` wahr; sonst, bei Unterbrechung, ohne Ergebnis und im Hintergrund:
 *     „abgebrochen“. Eine persistierte Ausgabe wird nur im eigenen Session-Ordner (`<session>/tool-results/`) gelesen (Fremdtext),
 *     sonst „unvollständig“.
 *  4. Die Summenzeile von `verify:kompakt` und `verify:changed` (letzte Zeile, Befehl enthält den Aufruf; auch gepipt) zählt vor den
 *     Kopfzeilen, mit Dauer je Gate; eine rote Zeile nennt nur die roten Gates, die grünen sind die Kette minus die roten, nur wenn
 *     die Kettenlänge stimmt (sonst „Kette geändert“). Im Modus `changed` ist ein grünes `lint` nicht belegt (kann übersprungen sein).
 *  5. CI-Log: `<job>\t<schritt>\t<ISO> <text>`; ein Schritt beginnt mit `##[group]Run ` oder einem Job-/Schrittwechsel; Exit aus
 *     `##[error]Process completed with exit code N.`, `##[error]The operation was canceled.` heißt abgebrochen. Die Dauer ist der
 *     Abstand der Zeitstempel zur nächsten Kopfzeile. Abgebrochene und übersprungene Läufe laden kein Log.
 *  6. Median-Dauer nur aus Summenzeilen und CI-Zeitstempeln; Kopfzeilen im Transkript tragen keine Zeit.
 *
 * Grenzen: nur Claude-Transkripte (Codex-Sitzungen werden nicht gelesen; die CI-Quelle gilt für beide Laufzeiten); Hintergrund- und
 * pre-push-Läufe fehlen; ein fremdes npm-Skript, das selbst Gate-Skripte ruft, kann Rot vortäuschen; das PowerShell-Tool zählt nur
 * über die Summenzeile (sein Exit-Status ist nicht belegt; ein rotes `verify:kompakt` ohne `Exit code`-Präfix gilt als abgebrochen);
 * rote Summenzeilen nach einer Kettenänderung fallen heraus; eine Ad-hoc-`&&`-Kette ohne Kettenkopf (`npm run a && npm run b`) zählt
 * nur die erreichten Gates, die nicht erreichten bleiben unsichtbar (nie grün); nur die npm-Kette aus `package.json`, der Block
 * `befehle` der Projekt-Config wird nicht ausgewertet (Projekte mit anderer Kette bekommen Exit 2).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ghText } from "./gh-cli.mjs";
import { median } from "./mess-lib.mjs";
import { ASSIGN_RE, parseBash } from "./bash-parser.mjs";
import { ketteAusPackage } from "./docs-gen/npm-ketten.mjs";
import { escapeRegex, ohneFarbcodes, SCHRITT_NAME } from "./regex-lib.mjs";
import { hauptrepoWurzel, istProjektOrdner, ladeSessionDatei, ladeSessions, projekteWurzel, projektSlug, toolPaare } from "./transkript.mjs";

const KETTEN = ["verify", "verify:full", "verify:kompakt", "verify:changed"];
const sauber = (t) => ohneFarbcodes(t).split(String.fromCharCode(0xfeff)).join("").replace(/\r/g, "");

/** Gate-Satz des Pakets: Schritte von `verify`, danach die Zusatzschritte von `verify:full`; wirft ohne `verify` oder Paketnamen. */
export function gateSatz(pkg) {
  const scripts = pkg?.scripts ?? {};
  const verify = ketteAusPackage(pkg, ["verify"], "verify");
  if (!pkg.name) throw new Error("package.json hat keinen Namen");
  const extra = typeof scripts["verify:full"] === "string" ? ketteAusPackage(pkg, ["verify", "verify:full"], "verify:full") : [];
  return { gates: [...new Set([...verify, ...extra])], verify, paket: String(pkg.name) };
}

// ── Befehlsform ──────────────────────────────────────────────────────────────

const AUFRUFE = [
  new RegExp(String.raw`^npm\s+(?:run|run-script)\s+(?:-\S+\s+)*${SCHRITT_NAME}(?:\s|$)`),
  /^npm\s+(?:test|t)(?:\s|$)/,
  /^node\s+(?:\S*[\\/])?gate-befehl\.mjs\s+\w+(?:\s|$)/,
  /^node\s+(?:\S*[\\/])?verify-lauf\.mjs(?:\s+--changed)?$/,
];
const KOMPAKT_AUFRUF = /verify:kompakt|verify:changed|gate-befehl\.mjs\s+verify(?:Kompakt|Changed)\b|verify-lauf\.mjs/;

function segmentArt(seg) {
  const t = seg.trim();
  if (/^cd\s+\S+$/.test(t) || /^(?:[A-Za-z_]\w*=\S*\s+)*[A-Za-z_]\w*=\S*$/.test(t)) return "neutral";
  const ohneEnv = t.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, "");
  if (/--zeigen/.test(ohneEnv)) return "fremd";
  return AUFRUFE.some((re) => re.test(ohneEnv)) ? "aufruf" : "fremd";
}

const NICHT_ERKANNT = { art: "befehlsform", aufrufe: 0 };
const ERLAUBTE_UMLEITUNG = /^2>(?:&1|\/dev\/null)$/;

/** Wort eines Kommandos als Text für `segmentArt`: Gequotetes wird zu `Q`, eine erlaubte Umleitung fällt weg, jede andere Umleitung ist `null`. */
function wortText(w) {
  if (w.quoted) return ASSIGN_RE.test(w.text) ? `${w.text.split("=")[0]}=Q` : "Q";
  if (ERLAUBTE_UMLEITUNG.test(w.text)) return "";
  return /[<>]/.test(w.text) ? null : w.text;
}

/** Wörter eines einfachen Kommandos ohne Ersetzungen und Heredocs als Text; sonst `null`. */
function einfachText(cmd) {
  if (cmd.type !== "simple" || cmd.substs.length > 0 || cmd.heredocs.length > 0) return null;
  const worte = cmd.words.map(wortText);
  return worte.includes(null) ? null : worte.filter(Boolean).join(" ");
}

/** Pipelines des einen `&&`-Ausdrucks aus dem AST oder `null` (Parse-Fehlschlag, mehrere Listen-Items, `bg`, anderer Operator, Negation). */
function pipelines(command) {
  const p = parseBash(command);
  const items = p.ok && p.ast.type === "list" ? p.ast.items : [];
  if (items.length !== 1 || items[0].bg) return null;
  const { first, rest } = items[0].andor;
  if (rest.some((r) => r.op !== "&&")) return null;
  const alle = [first, ...rest.map((r) => r.pipe)];
  return alle.some((x) => x.neg) ? null : alle;
}

/** Form eines Shell-Befehls: `{ art: "ok" | "pipe" | "befehlsform", aufrufe }` (Zahl der Gate-Aufrufe), auf Basis von `parseBash`; bei einer Pipe zählt das erste Kommando. Pur. */
export function befehlsform(command) {
  const alle = pipelines(command);
  if (alle === null) return NICHT_ERKANNT;
  const texte = alle.map((x) => einfachText(x.cmds[0]));
  if (texte.includes(null) || alle.some((x) => x.cmds.slice(1).some((c) => einfachText(c) === null))) return NICHT_ERKANNT;
  const arten = texte.map(segmentArt);
  const aufrufe = arten.filter((a) => a === "aufruf").length;
  if (arten.includes("fremd")) return { art: "befehlsform", aufrufe };
  return { art: alle.some((x) => x.cmds.length > 1) ? "pipe" : "ok", aufrufe };
}

// ── Kopfzeilen ───────────────────────────────────────────────────────────────

const KOPF = /^> (\S+)@(\S+) (\S+)(?: .*)?$/;

/** Kopfzeilen der Ausgabe als `[{ name, art: gate|kette|fremd, ms }]`; `zeilen`: `[{ text, ms }]`. Pur. */
function kopfEintraege(zeilen, { paket, gates }) {
  const out = [];
  for (const z of zeilen) {
    const m = KOPF.exec(z.text);
    if (!m) continue;
    const eigen = m[1] === paket;
    const art = eigen && gates.includes(m[3]) ? "gate" : eigen && KETTEN.includes(m[3]) ? "kette" : "fremd";
    out.push({ name: m[3], art, ms: z.ms ?? null });
  }
  return out;
}

const zeilenVon = (text) => sauber(text).split("\n").map((t) => ({ text: t, ms: null }));

/** Enthält die Ausgabe eine Kopfzeile eines Gates oder einer Kette des Pakets? */
export const hatKopf = (zeilen, ctx) => kopfEintraege(zeilen, ctx).some((e) => e.art !== "fremd");

function fehlendeGates(eintraege, verify, gates) {
  const k = eintraege.findIndex((e) => e.art === "kette");
  if (k < 0) return [];
  // `verify:full` druckt zuerst die eigene, dann die Kopfzeile von `verify`: die äußerste Kette bestimmt die erwarteten Gates.
  const erwartet = eintraege.some((e) => e.name === "verify:full") ? gates : verify;
  const gesehen = new Set(eintraege.slice(k).filter((e) => e.art === "gate").map((e) => e.name));
  return erwartet.filter((g) => !gesehen.has(g));
}

/**
 * Regeln 1 und 2: Ergebnis je Gate aus den Kopfzeilen und dem Exit-Status. Rückgabe `{ gates: [{ name, ergebnis, sek }] }`,
 * `{ grund }` (nicht zählbar) oder `null` (keine Kopfzeile des Pakets: kein Gate-Lauf). `zeilen`: `[{ text, ms }]`. Pur.
 */
export function bewerteKopfLauf({ zeilen, exit, paket, gates, verify }) {
  const eintraege = kopfEintraege(zeilen, { paket, gates });
  if (!eintraege.some((e) => e.art !== "fremd")) return null;
  if (eintraege.some((e) => e.name === "verify:kompakt" || e.name === "verify:changed")) return { grund: "unvollständig" };
  const ende = zeilen.length ? zeilen[zeilen.length - 1].ms : null;
  const ergebnis = [];
  eintraege.forEach((e, i) => {
    if (e.art !== "gate") return;
    const naechste = eintraege[i + 1];
    const bis = naechste ? naechste.ms : ende;
    const sek = e.ms != null && bis != null ? Math.max(0, (bis - e.ms) / 1000) : null;
    ergebnis.push({ name: e.name, ergebnis: naechste || exit === 0 ? "gruen" : "rot", sek });
  });
  if (exit !== 0) for (const name of fehlendeGates(eintraege, verify, gates)) ergebnis.push({ name, ergebnis: "nicht-erreicht", sek: null });
  return { gates: ergebnis };
}

// ── Summenzeile (verify:kompakt / verify:changed) ────────────────────────────

const SUMME = /^verify:(kompakt|changed) (grün|ROT) · (.*)$/;
const TEIL = new RegExp(String.raw`^(${SCHRITT_NAME}) (ok|ROT|übersprungen) (\d+(?:[.,]\d+)?) s$`);
const sekunden = (text) => Number(text.replace(",", "."));

/** Grüne Summenzeile: jeder Teil (ohne Klammerzusatz) muss auf `TEIL` passen, sonst ist der Lauf unvollständig (fail-closed, nie teilweise gezählt). */
function summeGruen(teile) {
  const teilTexte = String(teile[2] ?? "").replace(/ \([^)]*\)/g, "").split(", ");
  const treffer = teilTexte.map((x) => TEIL.exec(x.trim()));
  if (treffer.includes(null)) return { grund: "unvollständig" };
  return { gates: treffer.map((m) => (
    m[2] === "übersprungen" ? { name: m[1], ergebnis: "nicht-erreicht", sek: null } : { name: m[1], ergebnis: "gruen", sek: sekunden(m[3]) })) };
}

function summeRot(teile, text, modus, verify) {
  const n = /^(\d+)\/(\d+) grün$/.exec(teile[0] ?? "");
  const rot = /^rot: (.+)$/.exec(teile[2] ?? "")?.[1].split(", ") ?? [];
  const stimmt = n && rot.length && Number(n[2]) === verify.length && Number(n[1]) === verify.length - rot.length && rot.every((r) => verify.includes(r));
  if (!stimmt) return { grund: "Kette geändert" };
  const dauer = (name) => {
    const m = new RegExp(`── ${escapeRegex(name)}: rot \\(Exit \\d+, (\\d+(?:[.,]\\d+)?) s\\) ──`).exec(text);
    return m ? sekunden(m[1]) : null;
  };
  const gates = verify
    .filter((g) => rot.includes(g) || !(modus === "changed" && g === "lint"))
    .map((g) => (rot.includes(g) ? { name: g, ergebnis: "rot", sek: dauer(g) } : { name: g, ergebnis: "gruen", sek: null }));
  return { gates };
}

/** Regel 4: Ergebnis aus der letzten nicht-leeren Zeile, wenn sie eine Summenzeile ist; sonst `null`. Pur. */
export function bewerteSumme(text, { verify }) {
  const sauberer = sauber(text);
  const zeilen = sauberer.split("\n").map((z) => z.trim()).filter(Boolean);
  const m = SUMME.exec(zeilen[zeilen.length - 1] ?? "");
  if (!m) return null;
  const teile = m[3].split(" · ");
  return m[2] === "grün" ? summeGruen(teile) : summeRot(teile, sauberer, m[1], verify);
}

// ── Transkript ───────────────────────────────────────────────────────────────

const textVon = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p?.type === "text" ? p.text : "")).join("") : "");

const istShellAufruf = (row, b) => row.type === "assistant" && b?.type === "tool_use" && (b.name === "Bash" || b.name === "PowerShell") && Boolean(b.id);

/** Shell-Aufrufe samt Ergebnis, über die tool_use-ID verknüpft; die erste Fassung einer ID gilt (Haupt- und Subagent-Datei). */
function sammleAufrufe(zeilen) {
  return toolPaare(zeilen, { istAufruf: istShellAufruf }).map(({ use: { row, block: b }, ergebnis }) => ({
    tool: b.name,
    command: b.input?.command ?? "",
    ts: Date.parse(row.timestamp),
    hintergrund: b.input?.run_in_background === true,
    ergebnis: ergebnis && { fehler: ergebnis.block.is_error === true, text: textVon(ergebnis.block.content), unterbrochen: ergebnis.row.toolUseResult?.interrupted === true },
  }));
}

/** Regel 3 (Persistierte Ausgabe): `null` ohne Marker, `{ text }` aus dem Session-Ordner, sonst `{ fehler: true }`. */
function lesePersistiert(text, sessionId, liesDatei) {
  if (!text.includes("<persisted-output>")) return null;
  const pfad = /Full output saved to: ([^\r\n]+)/.exec(text)?.[1].trim();
  const norm = (pfad ?? "").replace(/\\/g, "/");
  if (!pfad || !sessionId || norm.split("/").includes("..") || !norm.includes(`/${sessionId}/tool-results/`)) return { fehler: true };
  try {
    const inhalt = liesDatei(pfad);
    return typeof inhalt === "string" ? { text: inhalt } : { fehler: true };
  } catch {
    return { fehler: true };
  }
}

/** Regel 3 (Exit-Status): Exit-Code oder `null` bei abgebrochenem Lauf (Unterbrechung, kein Ergebnis, Hintergrund, Fehler ohne `Exit code`). */
function exitStatus(a) {
  const r = a.ergebnis;
  if (!r || a.hintergrund || r.unterbrochen) return null;
  if (!r.fehler) return 0;
  const m = /^Exit code (\d+)/.exec(r.text);
  return m ? Number(m[1]) : null;
}

/** Bewertet den Text eines Laufs: Summenzeile vor Kopfzeilen, danach die Befehlsform. `{ gates }`, `{ grund }` oder `null`. */
function bewerteText(a, text, ctx) {
  const form = befehlsform(a.command);
  const summe = KOMPAKT_AUFRUF.test(a.command) ? bewerteSumme(text, ctx) : null;
  if (summe) return summe;
  if (form.art === "pipe") return { grund: "Pipe" };
  if (form.art !== "ok" || a.tool === "PowerShell") return { grund: "Befehlsform" };
  return bewerteKopfLauf({ zeilen: zeilenVon(text), exit: exitStatus(a), ...ctx });
}

function bewerteAufruf(a, { sessionId, liesDatei, ctx }) {
  const original = a.ergebnis?.text ?? "";
  const relevant = befehlsform(a.command).aufrufe > 0 || KOMPAKT_AUFRUF.test(a.command) || hatKopf(zeilenVon(original), ctx);
  if (!relevant) return null;
  const lauf = { quelle: "transkript", id: sessionId, ts: a.ts };
  const nicht = (grund) => ({ ...lauf, gezaehlt: false, grund, gates: [] });
  const persistiert = lesePersistiert(original, sessionId, liesDatei);
  if (exitStatus(a) === null) return nicht("abgebrochen");
  if (persistiert?.fehler) return nicht("unvollständig");
  const ergebnis = bewerteText(a, persistiert?.text ?? original, ctx);
  if (!ergebnis) return null;
  return ergebnis.grund ? nicht(ergebnis.grund) : { ...lauf, gezaehlt: true, gates: ergebnis.gates };
}

/**
 * Regeln 3 und 4 für eine Session: `zeilen` (Haupt- und Subagent-Zeilen), `sessionId`, `liesDatei(pfad)`, Fenster `von`/`bis` in ms
 * (oder `null`), `ctx` = `{ paket, gates, verify }`. Liefert `[{ quelle, id, ts, gezaehlt, grund?, gates }]`. Pur bis auf `liesDatei`.
 */
export function laeufeAusTranskript(zeilen, { sessionId, liesDatei, von = null, bis = null, ctx }) {
  const imFenster = (a) => (von == null || a.ts >= von) && (bis == null || a.ts < bis);
  return sammleAufrufe(zeilen).filter(imFenster).map((a) => bewerteAufruf(a, { sessionId, liesDatei, ctx })).filter(Boolean);
}

// ── CI-Log ───────────────────────────────────────────────────────────────────

const CI_ZEILE = /^([^\t]*)\t([^\t]*)\t(\d{4}-\d\d-\d\dT[\d:.]+Z) ?(.*)$/;

function ciSchritte(text) {
  const schritte = [];
  let cur = null;
  for (const roh of sauber(text).split("\n")) {
    const m = CI_ZEILE.exec(roh);
    if (!m) continue;
    if (!cur || cur.job !== m[1] || cur.schritt !== m[2] || m[4].startsWith("##[group]Run ")) {
      cur = { job: m[1], schritt: m[2], zeilen: [] };
      schritte.push(cur);
    }
    cur.zeilen.push({ text: m[4], ms: Date.parse(m[3]) });
  }
  return schritte;
}

/** Regel 5: Läufe aus dem Text von `gh run view --log` oder `--log-failed`; `id` benennt den CI-Lauf, `ctx` = `{ paket, gates, verify }`. Pur. */
export function laeufeAusCiLog(text, { id, ctx }) {
  const laeufe = [];
  for (const s of ciSchritte(text)) {
    if (!hatKopf(s.zeilen, ctx)) continue;
    const lauf = { quelle: "ci", id, ts: s.zeilen[0].ms };
    if (s.zeilen.some((z) => z.text.startsWith("##[error]The operation was canceled."))) {
      laeufe.push({ ...lauf, gezaehlt: false, grund: "abgebrochen", gates: [] });
      continue;
    }
    const exit = Number(s.zeilen.map((z) => /^##\[error\]Process completed with exit code (\d+)\./.exec(z.text)?.[1]).find(Boolean) ?? 0);
    const kopf = bewerteKopfLauf({ zeilen: s.zeilen, exit, ...ctx });
    laeufe.push(kopf?.grund ? { ...lauf, gezaehlt: false, grund: kopf.grund, gates: [] } : { ...lauf, gezaehlt: true, gates: kopf?.gates ?? [] });
  }
  return laeufe;
}

// ── Zählen und Bericht ───────────────────────────────────────────────────────

/** Zahlen je Gate aus den Läufen: erreicht (grün + rot), rot, nicht erreicht, Sessions mit Rot, Median-Sekunden; dazu der Fuß nach Grund. Pur. */
export function zaehle(laeufe, gates) {
  const je = Object.fromEntries(gates.map((g) => [g, { erreicht: 0, rot: 0, nichtErreicht: 0, ids: new Set(), dauern: [] }]));
  const nichtGezaehlt = {};
  let gezaehlt = 0;
  for (const l of laeufe) {
    if (!l.gezaehlt) {
      nichtGezaehlt[l.grund] = (nichtGezaehlt[l.grund] ?? 0) + 1;
      continue;
    }
    gezaehlt++;
    for (const g of l.gates) {
      const z = je[g.name];
      if (!z) continue;
      if (g.ergebnis === "nicht-erreicht") z.nichtErreicht++;
      else z.erreicht++;
      if (g.ergebnis === "rot") {
        z.rot++;
        z.ids.add(`${l.quelle}:${l.id}`);
      }
      if (g.ergebnis !== "nicht-erreicht" && g.sek != null) z.dauern.push(g.sek);
    }
  }
  const tabelle = gates.map((name) => ({
    name, erreicht: je[name].erreicht, rot: je[name].rot, nichtErreicht: je[name].nichtErreicht, sessionsMitRot: je[name].ids.size, medianSek: median(je[name].dauern),
  }));
  return { laeufe: laeufe.length, gezaehlt, nichtGezaehlt, gates: tabelle };
}

const fussText = (nicht) => Object.entries(nicht).map(([g, n]) => `${g} ${n}`).join(", ") || "keine";

/** Textbericht aus `{ kopf, hinweise, quellen: {name: zahlen}, gesamt: zahlen }`; `json` gibt dieselben Zahlen je Quelle getrennt aus. Pur. */
export function bericht(daten, { json = false } = {}) {
  if (json) return JSON.stringify(daten, null, 2);
  const quellen = Object.entries(daten.quellen).map(([n, z]) => `${n}: ${z.gezaehlt} von ${z.laeufe} Läufen gezählt`).join(" · ");
  const zeilen = daten.gesamt.gates.map((g) => {
    const med = g.medianSek == null ? "–" : `${Math.round(g.medianSek)} s`;
    return `${g.name.padEnd(16)} erreicht ${String(g.erreicht).padStart(4)} · rot ${String(g.rot).padStart(3)} · nicht erreicht ${String(g.nichtErreicht).padStart(3)} · Sessions mit Rot ${String(g.sessionsMitRot).padStart(3)} · Median ${med}`;
  });
  return [`Gate-Fundquote · ${daten.kopf}`, quellen || "keine Quelle", ...(daten.hinweise ?? []), "", ...zeilen, "", `nicht gezählt: ${fussText(daten.gesamt.nichtGezaehlt)}`].join("\n");
}

// ── Lauf ─────────────────────────────────────────────────────────────────────

const OPTIONEN = {
  von: { type: "string" }, bis: { type: "string" }, ci: { type: "string" }, json: { type: "boolean" },
  transkript: { type: "string", multiple: true }, "ci-log": { type: "string", multiple: true },
};
const AUFRUF = "Aufruf: node scripts/gate-fundquote.mjs [--von <ISO>] [--bis <ISO>] [--ci <workflow>] [--transkript <datei>]… [--ci-log <datei>]… [--json]";
const TAG = 86_400_000;

function* echteSessions(vonMs) {
  const wurzel = projekteWurzel();
  if (!existsSync(wurzel)) return;
  const slug = projektSlug(hauptrepoWurzel() ?? process.cwd());
  for (const ordner of readdirSync(wurzel)) {
    if (istProjektOrdner(ordner, slug)) yield* ladeSessions(join(wurzel, ordner), new Date(vonMs).toISOString());
  }
}

function transkriptLaeufe(werte, fenster, ctx, d) {
  const explizit = werte.transkript ?? [];
  const sessions = explizit.length ? explizit.map((p) => d.ladeSession(p)) : d.findeSessions(fenster.von);
  const opt = explizit.length ? { von: null, bis: null } : fenster;
  const laeufe = [];
  for (const s of sessions) {
    const zeilen = [...s.main, ...s.subagents.flatMap((a) => a.zeilen)];
    laeufe.push(...laeufeAusTranskript(zeilen, { sessionId: s.id, liesDatei: d.liesDatei, ...opt, ctx }));
  }
  return laeufe;
}

function ciLaeufe(werte, fenster, ctx, d) {
  const laeufe = [];
  const hinweise = [];
  const lesbar = (id, hole) => {
    try {
      laeufe.push(...laeufeAusCiLog(hole(), { id, ctx }));
    } catch {
      laeufe.push({ quelle: "ci", id, gezaehlt: false, grund: "CI-Log nicht lesbar", gates: [] });
    }
  };
  for (const datei of werte["ci-log"] ?? []) lesbar(datei, () => d.liesDatei(datei));
  if (werte.ci) {
    const zeit = (ms) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
    const liste = JSON.parse(d.gh(["run", "list", "--workflow", werte.ci, "--status", "completed", "--created", `${zeit(fenster.von)}..${zeit(fenster.bis)}`, "--limit", "1000", "--json", "databaseId,conclusion,createdAt"]));
    if (liste.length >= 1000) hinweise.push("CI: genau 1000 Läufe, Fenster enger wählen");
    for (const r of liste.filter((x) => Date.parse(x.createdAt) >= fenster.von && Date.parse(x.createdAt) < fenster.bis)) {
      if (r.conclusion === "success" || r.conclusion === "failure") lesbar(String(r.databaseId), () => d.gh(["run", "view", String(r.databaseId), "--log"]));
      else laeufe.push({ quelle: "ci", id: String(r.databaseId), gezaehlt: false, grund: "abgebrochen", gates: [] });
    }
  }
  return { laeufe, hinweise };
}

function fensterAus(werte, jetzt) {
  const bis = werte.bis ? Date.parse(werte.bis) : jetzt;
  const von = werte.von ? Date.parse(werte.von) : bis - 7 * TAG;
  return Number.isNaN(von) || Number.isNaN(bis) ? null : { von, bis };
}

/**
 * Der Lauf als Funktion: liefert den Exit-Code (0 Bericht, 1 `gh` scheitert, 2 Aufruf-Fehler oder kein `verify`), die Zugriffe sind
 * injizierbar (`deps.pkg`, `findeSessions`, `ladeSession`, `gh`, `liesDatei`, `log`, `err`, `jetzt`).
 */
export function main(argv = process.argv.slice(2), deps = {}) {
  const d = {
    pkg: () => JSON.parse(readFileSync("package.json", "utf8")), findeSessions: echteSessions, ladeSession: ladeSessionDatei,
    gh: (args) => ghText(args), liesDatei: (p) => readFileSync(p, "utf8"), log: console.log, err: console.error, jetzt: () => Date.now(), ...deps,
  };
  const { werte, fehler } = flagsLesen(argv, OPTIONEN);
  const fenster = fehler ? null : fensterAus(werte, d.jetzt());
  if (fehler || !fenster) {
    d.err(`${fehler?.text ?? "--von/--bis ist kein Zeitpunkt"}\n${AUFRUF}`);
    return AUFRUF_EXIT;
  }
  let satz;
  try {
    satz = gateSatz(typeof d.pkg === "function" ? d.pkg() : d.pkg);
  } catch (e) {
    d.err(`${e.message}\nDas Skript liest die npm-Kette "verify" aus package.json; ohne sie gibt es keinen Gate-Satz.`);
    return AUFRUF_EXIT;
  }
  const ctx = { paket: satz.paket, gates: satz.gates, verify: satz.verify };
  let ci;
  try {
    ci = ciLaeufe(werte, fenster, ctx, d);
  } catch (e) {
    d.err(`gh: ${String(e.message).split("\n")[0]}`);
    return 1;
  }
  const transkript = transkriptLaeufe(werte, fenster, ctx, d);
  const quellen = { transkript: zaehle(transkript, satz.gates), ci: zaehle(ci.laeufe, satz.gates) };
  const gesamt = zaehle([...transkript, ...ci.laeufe], satz.gates);
  const kopf = `Fenster ${new Date(fenster.von).toISOString()} bis ${new Date(fenster.bis).toISOString()}`;
  d.log(bericht({ kopf, hinweise: ci.hinweise, quellen, gesamt }, { json: werte.json === true }));
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
