#!/usr/bin/env node
/**
 * Code-Scanning-Inbox (#1436): macht neue offene Code-Scanning-Alerts (CodeQL, Scorecard) zu Board-Arbeit.
 *  (a) Spitze: CodeQL-Alerts mit security-severity high/critical (ohne Stufe: severity error) → EIN Ticket
 *      `🔒 Security: Code-Scanning-Befunde auflösen` ganz oben im Board (`board-place.mjs --notfall security --top`); Dedupe über den Titel,
 *      automatisch geschlossen bei null Funden. Nur CodeQL kann die Spitze nehmen: Scorecard meldet Posture-Funde mit `error`/`high`,
 *      die sie dauerhaft belegen würden.
 *  (b) Alles andere: eine Zeile `- [ ] Code-Scanning: …` je (Tool, Regel) als Kommentar im jüngsten ungeclaimten Harness-Sammelticket.
 * Bekannt (also still) ist ein Alert, wenn seine Nummer in einer offenen Zeile eines Harness-Sammeltickets (nur vertraute Autoren) steht
 * oder seine Regel als `codescanning-<slug>` in `.github/wiedervorlagen.json` steht.
 *
 * Aufruf: node scripts/codescanning-inbox.mjs [--dry-run]   (Workflow: .github/workflows/codescanning-inbox.yml)
 * Die Funktionen oben sind pur und getestet (test/codescanning-inbox.test.ts); die Aufrufe von gh unten nicht.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { REPO, SAMMELTICKET_TITEL, kandidatenSammelticket, normalizeOffene, waehleBestaetigtes } from "./board-lib.mjs";
import { istVertraut } from "./fremdtext-lib.mjs";

export const ZIEL_TITEL = "🔒 Security: Code-Scanning-Befunde auflösen";
const SPITZEN_TOOLS = ["CodeQL"];
const WV_PRAEFIX = "codescanning-";
const WIEDERVORLAGEN = fileURLToPath(new URL("../.github/wiedervorlagen.json", import.meta.url));
const STUFEN_SPITZE = ["high", "critical"];

/** Kleinschreibung, alles außer a-z0-9 wird `-`, Ränder getrimmt (Form der Wiedervorlagen-ID). Pur. */
export const slug = (regel) =>
  String(regel ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Offene Alerts aus der REST-Liste `code-scanning/alerts`, normalisiert zu `{ nummer, tool, regel, stufe, schwere, state }`. Andere Zustände
 * (fixed, dismissed) fallen weg. Kein Array oder eine Nummer ohne Ganzzahl wirft (nie still „keine Funde“). Die Regel-ID wird auf
 * `[A-Za-z0-9/_.-]` geprüft, sonst `unbekannt` (sie landet in Ticket und Zeile). Pur.
 */
export function alertsAus(liste) {
  if (!Array.isArray(liste)) throw new Error("Unerwartete Code-Scanning-Antwort (keine Liste).");
  return liste
    .map((a) => {
      if (!Number.isInteger(a?.number)) throw new Error(`Unerwartete Form eines Alerts: ${JSON.stringify(a)?.slice(0, 120)}`);
      const id = String(a?.rule?.id ?? "");
      const stufe = a?.rule?.security_severity_level;
      return {
        nummer: a.number,
        tool: String(a?.tool?.name ?? "unbekannt"),
        regel: /^[A-Za-z0-9/_.-]+$/.test(id) ? id : "unbekannt",
        stufe: typeof stufe === "string" && stufe !== "" ? stufe.toLowerCase() : null,
        schwere: String(a?.rule?.severity ?? "").toLowerCase(),
        state: String(a?.state ?? ""),
      };
    })
    .filter((a) => a.state === "open");
}

/** `spitze` nur für CodeQL mit security-severity high/critical (ohne Stufe: severity error); alles andere `zeile`. Pur. */
export function klasse(a) {
  if (!SPITZEN_TOOLS.includes(a.tool)) return "zeile";
  if (a.stufe === null) return a.schwere === "error" ? "spitze" : "zeile";
  return STUFEN_SPITZE.includes(a.stufe) ? "spitze" : "zeile";
}

/** Alert-Nummern aus `Alerts 5, 6, 7` bzw. `Alert 5` (nie `#5`: GitHub verlinkt das als Issue). Pur. */
export function nummernIn(text) {
  const nummern = [];
  for (const m of String(text ?? "").matchAll(/\bAlerts?\s+(\d+(?:\s*,\s*\d+)*)/g)) nummern.push(...m[1].split(",").map((n) => Number(n.trim())));
  return nummern;
}

/**
 * Bekannte Alerts: Nummern aus offenen Zeilen `- [ ] Code-Scanning:` in Kommentaren VERTRAUTER Autoren (`istVertraut`), Regeln (als Slug) aus
 * Wiedervorlagen-IDs `codescanning-<slug>`. Pur.
 */
export function bekannteAlerts({ kommentare, owner, wiedervorlagen }) {
  const nummern = new Set();
  const regeln = new Set();
  for (const k of kommentare) {
    if (!istVertraut(k?.user ?? null, owner)) continue;
    for (const z of String(k?.body ?? "").split(/\r?\n/)) {
      if (/^\s*[-*]\s+\[ \]\s+Code-Scanning:/.test(z)) nummernIn(z).forEach((n) => nummern.add(n));
    }
  }
  for (const e of wiedervorlagen) {
    if (typeof e?.id === "string" && e.id.startsWith(WV_PRAEFIX)) regeln.add(e.id.slice(WV_PRAEFIX.length));
  }
  return { nummern, regeln };
}

const alertListe = (g) => `Alerts ${g.nummern.join(", ")}`;

/** Die Zeile für das Sammelticket. Pur. */
export const zeilenText = (g) =>
  `- [ ] Code-Scanning: ${g.tool} ${g.regel} (${g.stufe ?? g.schwere}), ${alertListe(g)}. Vorschlag: beheben, sonst mit Grund dismissen oder Wiedervorlage ${WV_PRAEFIX}${slug(g.regel)}`;

/** Body des Spitzen-Tickets: je Regel eine Zeile, Prüfauftrag, keine Pfade und keine Meldungstexte aus dem Alert. Pur. */
export function issueBody(gruppen) {
  const zeilen = gruppen.map((g) => `- ${g.tool} ${g.regel} (${g.stufe ?? g.schwere}): ${alertListe(g)}`);
  return [
    "Offene CodeQL-Alerts mit security-severity high/critical:",
    "",
    ...zeilen,
    "",
    `Prüfauftrag: je Regel beheben, mit Grund dismissen oder per Wiedervorlage `codescanning-<slug>` zurückstellen. Details: \`gh api repos/${REPO}/code-scanning/alerts/<nummer>\`. Dismiss: \`gh api -X PATCH repos/${REPO}/code-scanning/alerts/<nummer> -f state=dismissed -f dismissed_reason="won't fix" -f dismissed_comment="<Grund, Ticket>"\` (Gründe: \`won't fix\`, \`false positive\`, \`used in tests\`). Die Liste wird wöchentlich aktualisiert; bei null Funden schließt der Lauf dieses Ticket selbst. Mechanik: docs/ticket-reihenfolge.md › Code-Scanning-Inbox.`,
  ].join("\n");
}

/** Gruppiert Alerts nach (Tool, Regel), sortiert (Tool, Regel, Nummern). Pur. */
function gruppiere(alerts) {
  const karte = new Map();
  for (const a of [...alerts].sort((x, y) => x.nummer - y.nummer)) {
    const key = `${a.tool}\u0000${a.regel}`;
    const g = karte.get(key) ?? { tool: a.tool, regel: a.regel, stufe: a.stufe, schwere: a.schwere, nummern: [] };
    g.nummern.push(a.nummer);
    karte.set(key, g);
  }
  return [...karte.values()].sort((x, y) => x.tool.localeCompare(y.tool) || x.regel.localeCompare(y.regel));
}

/**
 * Plan eines Laufs: `{ issue, zeilen }`. Spitze = offene `spitze`-Alerts ohne Regel in `bekannt.regeln`; leer: Issue schließen (falls offen),
 * sonst anlegen bzw. mit geändertem Body aktualisieren (`neue` = Nummern, die der alte Body noch nicht nannte). Zeilen = `zeile`-Alerts ohne
 * bekannte Nummer und ohne bekannte Regel, je (Tool, Regel) eine. Pur, deterministisch.
 */
export function plane({ alerts, bekannt, offenesIssue }) {
  const ohneRegel = alerts.filter((a) => !bekannt.regeln.has(slug(a.regel)));
  const spitze = gruppiere(ohneRegel.filter((a) => klasse(a) === "spitze"));
  const zeilen = gruppiere(ohneRegel.filter((a) => klasse(a) === "zeile" && !bekannt.nummern.has(a.nummer)));
  if (spitze.length === 0) return { issue: offenesIssue ? { art: "schliessen", nummer: offenesIssue.number } : { art: "nichts" }, zeilen };
  const body = issueBody(spitze);
  if (!offenesIssue) return { issue: { art: "anlegen", body }, zeilen };
  if (body === String(offenesIssue.body ?? "").replace(/\r\n/g, "\n")) return { issue: { art: "nichts" }, zeilen };
  const alt = new Set(nummernIn(offenesIssue.body));
  const neue = spitze.flatMap((g) => g.nummern).filter((n) => !alt.has(n)).sort((a, b) => a - b);
  return { issue: { art: "aktualisieren", nummer: offenesIssue.number, body, neue }, zeilen };
}

/**
 * Führt einen Plan mit eingespeister IO aus (`legeIssueAn(titel, body) -> Nummer`, `sortiereEin(nr) -> bool`, `aktualisiere(nr, body)`,
 * `kommentiere(nr, text)`, `schliesse(nr)`, `zielSammelticket() -> Nummer|null`, `postZeilen(nr, text)`, `log`, `projectToken`). Exit-Code:
 * 1 bei fehlgeschlagenem Einsortieren, fehlendem Sammelticket oder einer geworfenen Aktion; ohne `PROJECT_TOKEN` nur eine Warnung. Trockenlauf schreibt nichts.
 */
export function fuehreAus({ plan, io, trocken = false }) {
  const { issue, zeilen } = plan;
  const log = io.log ?? console.log;
  if (trocken) {
    if (issue.art !== "nichts") log(`[dry-run] Ticket: ${issue.art}${issue.nummer ? ` #${issue.nummer}` : ""}`);
    if (issue.body) log(`[dry-run] ${issue.body}`);
    for (const g of zeilen) log(`[dry-run] ${zeilenText(g)}`);
    return 0;
  }
  let rot = false;
  try {
    if (issue.art === "anlegen") {
      const nr = io.legeIssueAn(ZIEL_TITEL, issue.body);
      log(`Ticket angelegt: #${nr}`);
      if (!io.projectToken) log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
      else if (!io.sortiereEin(nr)) {
        log(`::error::Einsortieren von #${nr} an die Board-Spitze fehlgeschlagen.`);
        rot = true;
      }
    } else if (issue.art === "aktualisieren") {
      io.aktualisiere(issue.nummer, issue.body);
      if (issue.neue.length > 0) io.kommentiere(issue.nummer, `Neu seit dem letzten Lauf: Alerts ${issue.neue.join(", ")}`);
      log(`Ticket #${issue.nummer} aktualisiert.`);
    } else if (issue.art === "schliessen") {
      io.schliesse(issue.nummer);
      log(`Ticket #${issue.nummer} geschlossen.`);
    }
  } catch (err) {
    log(`::error::Spitzen-Ticket unvollständig: ${fehlerText(err)}`);
    rot = true;
  }
  if (zeilen.length > 0) {
    try {
      const ziel = io.zielSammelticket();
      if (!ziel) {
        log("::error::Kein ungeclaimtes Harness-Sammelticket für die Code-Scanning-Zeilen.");
        rot = true;
      } else {
        io.postZeilen(ziel, zeilen.map(zeilenText).join("\n"));
        log(`${zeilen.length} Zeile(n) in #${ziel}.`);
      }
    } catch (err) {
      log(`::error::Zeilen nicht gepostet: ${fehlerText(err)}`);
      rot = true;
    }
  }
  return rot ? 1 : 0;
}

/** Ein Lauf: lädt über `io.ladeAlerts()`/`io.ladeKontext()`, plant, führt aus. Nicht lesbare Alerts sind rot und schließen nie ein Ticket (fail-closed). */
export function lauf({ io, trocken = false }) {
  const log = io.log ?? console.log;
  let plan;
  try {
    const alerts = alertsAus(io.ladeAlerts());
    const k = io.ladeKontext();
    plan = plane({ alerts, bekannt: bekannteAlerts(k), offenesIssue: k.offenesIssue });
  } catch (err) {
    log(`::error::Code-Scanning-Alerts nicht lesbar: ${fehlerText(err)}`);
    return 1;
  }
  const code = fuehreAus({ plan, io, trocken });
  if (plan.issue.art === "nichts" && plan.zeilen.length === 0) log("Code-Scanning-Inbox: nichts Neues.");
  return code;
}

// ---- IO (ungetestet) ----

const seiten = (pfad) => JSON.parse(ghText(["api", "--paginate", "--slurp", pfad])).flat();

function main() {
  const trocken = process.argv.includes("--dry-run");
  let offene = [];
  const io = {
    ladeAlerts: () => seiten(`repos/${REPO}/code-scanning/alerts?state=open&per_page=100`),
    ladeKontext: () => {
      offene = normalizeOffene(JSON.parse(ghText(["api", "--paginate", "--slurp", `repos/${REPO}/issues?state=open&per_page=100`])));
      const sammel = offene.filter((i) => i.titel === SAMMELTICKET_TITEL);
      const kommentare = sammel.flatMap((i) => seiten(`repos/${REPO}/issues/${i.number}/comments?per_page=100`).map((k) => ({ user: k.user, body: k.body })));
      const ziele = offene.filter((i) => i.titel === ZIEL_TITEL).sort((a, b) => a.number - b.number);
      if (ziele.length > 1) console.log(`::warning::Mehrere offene Tickets "${ZIEL_TITEL}" (${ziele.map((z) => `#${z.number}`).join(", ")}); nehme das kleinste.`);
      const offenesIssue = ziele[0] ? { number: ziele[0].number, body: String(ghJson(["api", `repos/${REPO}/issues/${ziele[0].number}`]).body ?? "") } : null;
      return { offenesIssue, kommentare, owner: REPO.split("/")[0], wiedervorlagen: JSON.parse(readFileSync(WIEDERVORLAGEN, "utf8")) };
    },
    projectToken: process.env.PROJECT_TOKEN,
    log: console.log,
    legeIssueAn: (titel, body) => ghText(["issue", "create", "--repo", REPO, "--title", titel, "--label", "area:harness", "--body", body]).trim().split("/").pop(),
    sortiereEin: (nr) => {
      try {
        execFileSync(process.execPath, [fileURLToPath(new URL("./board-place.mjs", import.meta.url)), "--notfall", "security", "--top", String(nr)], {
          env: { ...process.env, GH_TOKEN: process.env.PROJECT_TOKEN },
          stdio: "inherit",
        });
        return true;
      } catch {
        return false;
      }
    },
    aktualisiere: (nr, body) => ghText(["api", "-X", "PATCH", `repos/${REPO}/issues/${nr}`, "-f", `body=${body}`]),
    kommentiere: (nr, text) => ghText(["api", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=${text}`]),
    schliesse: (nr) =>
      ghText(["issue", "close", String(nr), "--repo", REPO, "--reason", "completed", "--comment", "Keine offenen Code-Scanning-Befunde high/critical mehr, automatisch geschlossen."]),
    zielSammelticket: () => waehleBestaetigtes(kandidatenSammelticket(offene, SAMMELTICKET_TITEL), (nr) => ghJson(["api", `repos/${REPO}/issues/${nr}`]))?.number ?? null,
    postZeilen: (nr, text) => ghText(["api", `repos/${REPO}/issues/${nr}/comments`, "-f", `body=${text}`]),
  };
  process.exit(lauf({ io, trocken }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
