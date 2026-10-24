#!/usr/bin/env node
/**
 * Audit-Einordnung (#1628): wertet den vollen `npm audit` (inkl. Dev) und die offenen Dependabot-Alerts aus und ordnet jedes Advisory ein,
 * das noch niemand kennt (Dedupe über die GHSA-ID):
 *  (a) Normalfall: eine Zeile `- [ ] Audit: …` als Kommentar im jüngsten ungeclaimten Harness-Sammelticket, kein Alarm.
 *  (b) Alarm: Ticket `🔒 Security: <ghsa> in <paket>` ganz oben im Board (`board-place.mjs --notfall security --top`), und zwar nur bei
 *      Schwere critical UND ausgelieferter Produktiv-Abhängigkeit. Dev-Abhängigkeiten lösen nie einen Alarm aus, auch nicht bei critical.
 * Bekannt (also still) ist ein Advisory, wenn seine GHSA in einer offenen Audit-Zeile eines Harness-Sammeltickets, in einem Eintrag
 * `audit-<ghsa>` der `.github/wiedervorlagen.json` oder im Titel eines offenen `🔒 Security:`-Tickets steht.
 *
 * Aufruf: node scripts/audit-einordnung.mjs [--dry-run]   (Workflow: .github/workflows/audit-einordnung.yml)
 * Die Funktionen oben sind pur und getestet (test/audit-einordnung.test.ts); die Aufrufe von npm und gh unten nicht.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fehlerText, ghText } from "./gh-cli.mjs";
import { ladeBoardLibs, inboxStart } from "./inbox-start-lib.mjs";
import { ALARM_PRAEFIX, bekannteGhsa, ghsaIn, vertrauteBodies } from "./ghsa-lib.mjs";

export { ALARM_PRAEFIX, bekannteGhsa, ghsaIn, vertrauteBodies };

const WIEDERVORLAGEN = fileURLToPath(new URL("../.github/wiedervorlagen.json", import.meta.url));

/**
 * Befunde aus einer `npm audit --json`-Ausgabe (Format ab npm 7). Ein Befund je Advisory (`via`-Objekt mit URL), das Paket ist das
 * verwundbare (`via.name`). Kaputte Ausgabe (kein Objekt, keine `vulnerabilities`, Fehlerantwort) wirft. `prod` setzt der Aufrufer. Pur.
 */
export function befundeAusNpmAudit(json) {
  if (json === null || typeof json !== "object" || Array.isArray(json) || json.vulnerabilities === null || typeof json.vulnerabilities !== "object") {
    throw new Error(`Unerwartete npm-audit-Ausgabe: ${JSON.stringify(json)?.slice(0, 200)}`);
  }
  const ergebnis = new Map();
  for (const [name, v] of Object.entries(json.vulnerabilities)) {
    const fix = v?.fixAvailable;
    for (const via of Array.isArray(v?.via) ? v.via : []) {
      const ghsa = typeof via === "object" && via !== null ? ghsaIn(via.url)[0] : undefined;
      if (!ghsa || ergebnis.has(ghsa)) continue;
      ergebnis.set(ghsa, {
        ghsa,
        paket: typeof via.name === "string" ? via.name : name,
        schwere: String(via.severity ?? v?.severity ?? "unknown").toLowerCase(),
        prod: false,
        fixVerfuegbar: Boolean(fix),
        fixVersion: typeof fix === "object" && fix !== null && typeof fix.version === "string" ? fix.version : undefined,
      });
    }
  }
  return [...ergebnis.values()];
}

/**
 * Befunde aus den offenen Dependabot-Alerts (REST-Form). `prod` nur für das Ökosystem npm mit `dependency.scope === "runtime"`;
 * GitHub-Actions und alles andere zählt nie als ausgeliefert. Pur.
 */
export function befundeAusAlerts(alerts) {
  if (!Array.isArray(alerts)) throw new Error("Unerwartete Dependabot-Antwort (keine Liste).");
  return alerts.flatMap((a) => {
    const ghsa = ghsaIn(a?.security_advisory?.ghsa_id)[0];
    if (!ghsa) return [];
    const fix = a?.security_vulnerability?.first_patched_version?.identifier;
    return [
      {
        ghsa,
        paket: String(a?.dependency?.package?.name ?? "unbekannt"),
        schwere: String(a?.security_advisory?.severity ?? "unknown").toLowerCase(),
        prod: a?.dependency?.package?.ecosystem === "npm" && a?.dependency?.scope === "runtime",
        fixVerfuegbar: typeof fix === "string" && fix !== "",
        fixVersion: typeof fix === "string" && fix !== "" ? fix : undefined,
      },
    ];
  });
}

/** Markiert in `voll` die Befunde als `prod`, deren GHSA auch im Audit ohne Dev-Abhängigkeiten (`prodBefunde`) steht. Pur. */
export const markiereProd = (voll, prodBefunde) => {
  const prod = new Set(prodBefunde.map((b) => b.ghsa));
  return voll.map((b) => ({ ...b, prod: b.prod || prod.has(b.ghsa) }));
};

/** Dieselbe GHSA aus mehreren Quellen wird ein Befund: prod, wenn eine Quelle es sagt; Fix, wenn eine einen kennt. Pur. */
export function vereine(befunde) {
  const karte = new Map();
  for (const b of befunde) {
    const alt = karte.get(b.ghsa);
    if (!alt) karte.set(b.ghsa, { ...b });
    else {
      alt.prod ||= b.prod;
      if (!alt.fixVerfuegbar && b.fixVerfuegbar) Object.assign(alt, { fixVerfuegbar: true, fixVersion: b.fixVersion });
    }
  }
  return [...karte.values()];
}

/** Der Alarm gilt nur bei critical UND ausgelieferter Produktiv-Abhängigkeit. Pur. */
export const istAlarm = (b) => b.schwere === "critical" && b.prod === true;

/** Die Zeile für das Sammelticket. Pur. */
export function zeilenText(b) {
  const fix = b.fixVerfuegbar ? `ja${b.fixVersion ? ` v${b.fixVersion}` : ""}` : "nein";
  const vorschlag = b.fixVerfuegbar
    ? `npm update bzw. overrides auf ${b.fixVersion ? `v${b.fixVersion}` : "den gepatchten Stand"}`
    : `bewusst akzeptieren mit Wiedervorlage audit-${b.ghsa.toLowerCase()}, fällig +30 Tage`;
  return `- [ ] Audit: ${b.ghsa} ${b.paket} (${b.schwere}, ${b.prod ? "prod" : "dev"}), Fix: ${fix}. Vorschlag: ${vorschlag}`;
}

/** Titel und Body des Alarm-Tickets. Pur. */
export function alarmText(b) {
  return {
    titel: `${ALARM_PRAEFIX} ${b.ghsa} in ${b.paket}`,
    body: `${b.ghsa}: ${b.paket} (critical, ausgelieferte Produktiv-Abhängigkeit). Fix: ${b.fixVerfuegbar ? `ja${b.fixVersion ? ` v${b.fixVersion}` : ""}` : "nein"}.\n\nPrüfauftrag: im Spielkontext ausnutzbar? Wenn ja: fixen (Update/overrides). Wenn nein: Eintrag \`audit-${b.ghsa.toLowerCase()}\` in \`.github/wiedervorlagen.json\` anlegen (fällig +30 Tage) und dieses Ticket schließen. Mechanik: docs/ticket-reihenfolge.md › Audit-Einordnung.`,
  };
}

/**
 * Ordnet die Befunde ein. `bekannt` = Menge der bereits bekannten GHSA-IDs (beliebige Schreibweise). Je unbekanntem Befund (nach dem Vereinen
 * der Quellen) entweder `{ art: "alarm", befund, titel, body }` oder `{ art: "zeile", befund, text }`. Pur.
 */
export function ordneEin({ befunde, bekannt }) {
  const kenne = new Set([...bekannt].map((g) => String(g).toLowerCase()));
  return vereine(befunde)
    .filter((b) => !kenne.has(b.ghsa.toLowerCase()))
    .map((b) => (istAlarm(b) ? { art: "alarm", befund: b, ...alarmText(b) } : { art: "zeile", befund: b, text: zeilenText(b) }));
}

// ---- IO (ungetestet) ----

/** `npm audit --json` liefert bei Funden Exit 1 mit gültigem JSON auf stdout. */
function npmAudit(extra = []) {
  let text;
  try {
    text = execFileSync("npm", ["audit", "--json", ...extra], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  } catch (err) {
    text = err?.stdout ? String(err.stdout) : "";
    if (!text) throw err;
  }
  return JSON.parse(text);
}

function ladeAlerts(repo) {
  try {
    return JSON.parse(ghText(["api", "--paginate", "--slurp", `repos/${repo}/dependabot/alerts?state=open&per_page=100`])).flat();
  } catch (err) {
    console.log(`::warning::Dependabot-Alerts nicht lesbar (${fehlerText(err, 200)}); weiter mit npm audit allein.`);
    return [];
  }
}

/** Einstieg. `deps` (Tests): `ladeLibs()` (liefert `REPO` und die Inbox-Bausteine), `npmAuditLaden(extra)`, `alertsLaden(repo)`, `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { ladeLibs = ladeBoardLibs, npmAuditLaden = npmAudit, alertsLaden = ladeAlerts, log = console.log, err = console.error } = {}) {
  const start = await inboxStart(argv, { skript: "audit-einordnung", praefix: "Audit-Einordnung: Projekt-Config nicht lesbar: ", ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, libs } = start;
  const { OWNER, REPO, ladeSammelKontext, offeneTitel, platziereOben, postZeilen, waehleSammelticket } = libs;
  const { rohe, offene, kommentare } = ladeSammelKontext();
  const bekannt = bekannteGhsa({
    kommentare: vertrauteBodies(kommentare, OWNER),
    wiedervorlagen: JSON.parse(readFileSync(WIEDERVORLAGEN, "utf8")),
    // Nur Titel vertrauter Autoren: ein Fremder darf mit einem „🔒 Security: GHSA-…“-Titel keinen Alarm unterdrücken.
    offeneTitel: offeneTitel(rohe, OWNER),
  });
  const voll = markiereProd(befundeAusNpmAudit(npmAuditLaden()), befundeAusNpmAudit(npmAuditLaden(["--omit=dev"])));
  const aktionen = ordneEin({ befunde: [...voll, ...befundeAusAlerts(alertsLaden(REPO))], bekannt });
  if (aktionen.length === 0) {
    log("Audit-Einordnung: nichts Neues.");
    return 0;
  }

  const zeilen = aktionen.filter((a) => a.art === "zeile");
  const alarme = aktionen.filter((a) => a.art === "alarm");
  if (trocken) {
    for (const a of aktionen) log(a.art === "alarm" ? `[dry-run] Alarm: ${a.titel}` : `[dry-run] ${a.text}`);
    return 0;
  }
  let rot = false;
  for (const a of alarme) {
    try {
      const url = ghText(["issue", "create", "--repo", REPO, "--title", a.titel, "--body", a.body]).trim();
      const nr = url.split("/").pop();
      log(`Alarm angelegt: #${nr} (${a.befund.ghsa})`);
      platziereOben(nr, "security");
    } catch (fehl) {
      log(`::error::Alarm für ${a.befund.ghsa} unvollständig: ${fehlerText(fehl)}`);
      rot = true;
    }
  }
  if (zeilen.length > 0) {
    const ziel = waehleSammelticket(offene);
    if (!ziel) {
      log("::error::Kein ungeclaimtes Harness-Sammelticket für die Audit-Zeilen.");
      rot = true;
    } else {
      postZeilen(ziel.number, zeilen.map((z) => z.text).join("\n"));
      log(`${zeilen.length} Zeile(n) in #${ziel.number}.`);
    }
  }
  return rot ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
