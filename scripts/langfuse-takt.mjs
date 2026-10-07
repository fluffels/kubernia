#!/usr/bin/env node
// Kein weiterer Shebang-Zwang: wird vom Workflow gestartet UND von test/langfuse-takt.test.ts importiert.
/**
 * Wöchentlicher Takt für „Langfuse-Status überprüfen“ (#1351, ADR 0016). Der Workflow
 * `.github/workflows/langfuse-takt.yml` ruft dieses Skript; die Entscheidung ist pur und getestet
 * (test/langfuse-takt.test.ts), nur die gh-Aufrufe ganz unten sind es nicht.
 *
 * Idempotent und ohne gespeicherten Zähler: jedes Mal wird aus den offenen Issues und der Commit-Liste von
 * main abgeleitet, was zu tun ist. Zwei Läufe hintereinander (der Workflow serialisiert sie über seine
 * Concurrency-Group) legen darum nie zwei Tickets an und lassen die Position nicht springen.
 *
 * Nur Node-Builtins, analog zu board-lib.mjs.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { PROJECT_ID, STATUS_FIELD_NODE_ID, TODO_OPTION_ID } from "./board-lib.mjs";

export const STATUS_TITEL = "Langfuse-Status überprüfen";
export const SAMMEL_TITEL = "Langfuse-Befunde (gesammelt)";
/** Aktivitäts-Untergrenze: so viele Commits auf main seit dem Abschluss des Vorgängers, sonst kein neues Ticket. */
export const MIN_MERGES = 5;

const TAG_MS = 24 * 60 * 60 * 1000;

const alsDatum = (wert, name) => {
  const d = wert instanceof Date ? wert : new Date(wert);
  if (Number.isNaN(d.getTime())) throw new Error(`Ungültiges Datum für ${name}: ${String(wert)}`);
  return d;
};

/**
 * Antwort von `gh api --paginate --slurp repos/<repo>/issues?state=open` (Liste von Seiten) → offene Issues
 * `{ number, titel, assignees, createdAt }`. Pull Requests fliegen raus. Wirft bei unerwarteter Form, statt still
 * ein Ticket zu übersehen (das führte zu einem Doppel-Ticket).
 */
export function normalizeOffene(pages) {
  if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) {
    throw new Error("Unerwartete Antwortform der offenen Issues (keine Liste von Seiten).");
  }
  return pages
    .flat()
    .filter((i) => !i?.pull_request)
    .map((i) => {
      if (!Number.isInteger(i?.number) || typeof i.title !== "string" || typeof i.created_at !== "string") {
        throw new Error(`Unerwartete Form eines Issues: ${JSON.stringify(i)?.slice(0, 120)}`);
      }
      return {
        number: i.number,
        titel: i.title,
        assignees: Array.isArray(i.assignees) ? i.assignees.map((a) => a?.login).filter((l) => typeof l === "string") : [],
        createdAt: i.created_at,
      };
    });
}

/**
 * Beginn des Aktivitätsfensters: 60 s nach dem Abschluss des Vorgängers (dessen eigener Squash-Commit soll nicht
 * zählen), ohne Vorgänger 7 Tage vor `jetzt`.
 */
export function mergeFensterAb(letzterAbschluss, jetzt) {
  const j = alsDatum(jetzt, "jetzt");
  if (letzterAbschluss === null || letzterAbschluss === undefined) return new Date(j.getTime() - 7 * TAG_MS);
  return new Date(alsDatum(letzterAbschluss, "letzterAbschluss").getTime() + 60_000);
}

/**
 * Was tut der Wochenlauf? `offene` aus normalizeOffene, `mergesSeit` = Zahl der Commits auf main im Fenster.
 * Liefert `{ aktion: "anlegen" | "nach-oben" | "nichts", nr?, grund, warnungen }`. Pur.
 */
export function entscheideTakt({ offene, mergesSeit }) {
  if (!Array.isArray(offene)) throw new Error("offene muss eine Liste sein.");
  if (!Number.isInteger(mergesSeit) || mergesSeit < 0) throw new Error(`mergesSeit muss eine ganze Zahl ≥ 0 sein, war ${String(mergesSeit)}`);
  const treffer = offene
    .filter((i) => i.titel === STATUS_TITEL)
    .sort((a, b) => alsDatum(a.createdAt, "createdAt") - alsDatum(b.createdAt, "createdAt") || a.number - b.number);
  const warnungen = [];
  if (treffer.length > 1) {
    warnungen.push(`Mehrere offene „${STATUS_TITEL}“ (${treffer.map((t) => `#${t.number}`).join(", ")}): der Lauf arbeitet mit dem ältesten und schließt nichts selbst.`);
  }
  if (treffer.length > 0) {
    const geclaimt = treffer.find((t) => t.assignees.length > 0);
    if (geclaimt) return { aktion: "nichts", grund: `#${geclaimt.number} ist geclaimt und läuft schon`, warnungen };
    return { aktion: "nach-oben", nr: treffer[0].number, grund: `#${treffer[0].number} ist offen und ungeclaimt, kommt an die Spitze`, warnungen };
  }
  if (mergesSeit < MIN_MERGES) {
    return { aktion: "nichts", grund: `nur ${mergesSeit} Merges seit dem letzten Abschluss (Untergrenze ${MIN_MERGES})`, warnungen };
  }
  return { aktion: "anlegen", grund: `${mergesSeit} Merges seit dem letzten Abschluss, kein offenes Status-Ticket`, warnungen };
}

/** Montag 00:00 UTC der Kalenderwoche, in der `d` liegt. */
const wochenStart = (d) => {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const tag = (new Date(t).getUTCDay() + 6) % 7; // Mo=0
  return t - tag * TAG_MS;
};

/** Letzte volle Kalenderwoche (Mo–So UTC) vor `jetzt` und die davor, als `YYYY-MM-DD`. Pur. */
export function wochenFenster(jetzt) {
  const mo = wochenStart(alsDatum(jetzt, "jetzt"));
  const tag = (ms) => new Date(ms).toISOString().slice(0, 10);
  const woche = (start) => ({ von: tag(start), bis: tag(start + 6 * TAG_MS) });
  return { letzte: woche(mo - 7 * TAG_MS), davor: woche(mo - 14 * TAG_MS) };
}

/** Body des neu angelegten Status-Tickets. `vorgaenger` = `{ number, closedAt }` oder null. Pur. */
export function statusBody({ vorgaenger, jetzt }) {
  const w = wochenFenster(jetzt);
  const zeitraum = vorgaenger
    ? `seit dem Abschluss von #${vorgaenger.number} (${vorgaenger.closedAt}) bis zum Claim`
    : "seit dem Merge von #1293 bis zum Claim";
  const repo = "https://github.com/fluffels/kubernia/blob/main/docs";
  return [
    "Wiederkehrende Auswertung der Langfuse-Daten, vom Wochen-Workflow angelegt (kein Agent legt dieses Ticket an).",
    "",
    `- **Zeitraum:** ${zeitraum}.`,
    `- **Wochenbudget:** letzte volle Woche ${w.letzte.von} bis ${w.letzte.bis} (Mo–So UTC) gegen die Woche davor ${w.davor.von} bis ${w.davor.bis}.`,
    `- **Checkliste:** [docs/model-routing.md › Langfuse-Status überprüfen](${repo}/model-routing.md#langfuse-status-überprüfen-1293).`,
    `- **Mechanik:** [docs/ticket-reihenfolge.md](${repo}/ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293).`,
    `- **Abschluss:** Bericht-Kommentar geschrieben, große Befunde als Issues, kleine als Zeilen ins Sammelticket „${SAMMEL_TITEL}“ (danach per \`board-place.mjs --top\` nach oben), PR mit Verdichtungszeile und \`Closes\`.`,
  ].join("\n");
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
const gh = (args, env = {}) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
const ghJson = (args) => JSON.parse(gh(args));

/** Item hinzufügen (idempotent), Status Todo setzen, an die Spitze schieben. Wirft bei jedem Fehler einer Mutation. */
function setzeBoardSpitze(nodeId, projectToken) {
  const env = { GH_TOKEN: projectToken };
  const mutation = (query, vars) => {
    const args = ["api", "graphql", "-f", `query=${query}`];
    for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
    return JSON.parse(gh(args, env));
  };
  const item = mutation("mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }", { p: PROJECT_ID, c: nodeId });
  const itemId = item.data.addProjectV2ItemById.item.id;
  mutation(
    "mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }",
    { p: PROJECT_ID, i: itemId, f: STATUS_FIELD_NODE_ID, o: TODO_OPTION_ID },
  );
  mutation("mutation($p:ID!,$i:ID!){ updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i}){ items(first:1){ nodes{ id } } } }", { p: PROJECT_ID, i: itemId });
}

function main() {
  const dry = process.argv.includes("--dry-run");
  const repo = process.env.GITHUB_REPOSITORY || "fluffels/kubernia";
  const jetzt = new Date();
  const offene = normalizeOffene(ghJson(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]));
  const seit = new Date(jetzt.getTime() - 90 * TAG_MS).toISOString();
  const geschlossen = ghJson(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=closed&labels=area:harness&since=${seit}&per_page=100`])
    .flat()
    .filter((i) => !i.pull_request && i.title === STATUS_TITEL && typeof i.closed_at === "string")
    .sort((a, b) => new Date(b.closed_at) - new Date(a.closed_at));
  const vorgaenger = geschlossen[0] ? { number: geschlossen[0].number, closedAt: geschlossen[0].closed_at } : null;
  const ab = mergeFensterAb(vorgaenger?.closedAt ?? null, jetzt).toISOString();
  const commits = ghJson(["api", `repos/${repo}/commits?sha=main&since=${ab}&per_page=${MIN_MERGES}`]);
  if (!Array.isArray(commits)) throw new Error("Unerwartete Antwortform der Commit-Liste.");
  const e = entscheideTakt({ offene, mergesSeit: commits.length });
  for (const w of e.warnungen) console.log(`::warning::${w}`);
  console.log(`Entscheidung: ${e.aktion}${e.nr ? ` #${e.nr}` : ""} (${e.grund}); Fenster ab ${ab}`);
  if (dry || e.aktion === "nichts") return;

  let nodeId;
  if (e.aktion === "anlegen") {
    const neu = ghJson([
      "api", "-X", "POST", `repos/${repo}/issues`,
      "-f", `title=${STATUS_TITEL}`, "-f", `body=${statusBody({ vorgaenger, jetzt })}`, "-f", "labels[]=area:harness",
    ]);
    console.log(`Angelegt: #${neu.number}`);
    nodeId = neu.node_id;
  } else {
    nodeId = ghJson(["api", `repos/${repo}/issues/${e.nr}`]).node_id;
  }
  const token = process.env.PROJECT_TOKEN;
  if (!token) {
    console.log("::warning::PROJECT_TOKEN fehlt, Board-Position nicht gesetzt (das Ticket steht dann nicht im Board, der nächste Lauf trägt es nach, sofern es ungeclaimt und der Token gesetzt ist, oder sofort per workflow_dispatch).");
    return;
  }
  try {
    setzeBoardSpitze(nodeId, token);
    console.log("Board-Position oben gesetzt.");
  } catch (err) {
    console.log(`::error::Board-Position nicht gesetzt: ${String(err.message).split("\n")[0]}. Die Wiederholung ist idempotent und legt kein zweites Ticket an.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
