// Kein Shebang: wird von board-takt.mjs importiert UND von test/langfuse-takt.test.ts.
/**
 * Status-Ticket „Langfuse-Status überprüfen“ (#1351, ADR 0016: wöchentlich plus nach Aktivität): die pure Entscheidung (`entscheideTakt`),
 * der Body (`statusBody`) und das Anlegen bzw. Hochschieben (`fuehreStatusAus`). Gestartet wird der Takt nicht hier, sondern vom
 * generischen Board-Takt `scripts/board-takt.mjs` (Workflow `.github/workflows/board-takt.yml`, #1390), der auch das Harness-Sammelticket
 * pflegt und die Commit-Fenster berechnet. Die Entscheidung ist pur und getestet (test/langfuse-takt.test.ts), nur die gh-Aufrufe in
 * `fuehreStatusAus` sind es nicht.
 *
 * Nur Node-Builtins und board-lib.mjs (keine Importe aus board-takt.mjs: der Import läuft in die andere Richtung).
 */
import { execFileSync } from "node:child_process";
import { LANGFUSE_SAMMELTICKET_TITEL, STATUS_TITEL, TAG_MS, addToBoardTodo, alsDatum, imKopf, setPosition } from "./board-lib.mjs";

export { STATUS_TITEL };
export const SAMMEL_TITEL = LANGFUSE_SAMMELTICKET_TITEL;
/** Aktivitäts-Untergrenze: so viele Commits auf main seit dem Abschluss des Vorgängers, sonst kein neues Ticket. */
export const MIN_MERGES = 5;
/** Push-Auslöser (Aktivität): so viele Ticket-Merges (ohne Bots) seit dem Abschluss des Vorgängers legen das Status-Ticket an bzw. holen es nach oben. */
export const MIN_TICKET_MERGES_PUSH = 8;

/**
 * Was tut der Lauf mit dem Status-Ticket? `offene` aus normalizeOffene (board-takt.mjs), `mergesSeit` = Zahl der Commits auf main im Fenster,
 * `ticketMerges` = davon Ticket-Merges ohne Bots, `ausloeser` = Workflow-Event (`push` zählt nur Aktivität: mindestens
 * `MIN_TICKET_MERGES_PUSH` Ticket-Merges, sonst nichts; alles andere ist der Wochen-Cron mit `MIN_MERGES`).
 * Liefert `{ aktion: "anlegen" | "nach-oben" | "nichts", nr?, grund, warnungen }`. Pur.
 */
export function entscheideTakt({ offene, mergesSeit, ticketMerges = 0, ausloeser = "schedule" }) {
  if (!Array.isArray(offene)) throw new Error("offene muss eine Liste sein.");
  if (!Number.isInteger(mergesSeit) || mergesSeit < 0) throw new Error(`mergesSeit muss eine ganze Zahl ≥ 0 sein, war ${String(mergesSeit)}`);
  const treffer = offene
    .filter((i) => i.titel === STATUS_TITEL)
    .sort((a, b) => alsDatum(a.createdAt, "createdAt") - alsDatum(b.createdAt, "createdAt") || a.number - b.number);
  const warnungen = [];
  if (treffer.length > 1) {
    warnungen.push(`Mehrere offene „${STATUS_TITEL}“ (${treffer.map((t) => `#${t.number}`).join(", ")}): der Lauf arbeitet mit dem ältesten und schließt nichts selbst.`);
  }
  const push = ausloeser === "push";
  if (push && ticketMerges < MIN_TICKET_MERGES_PUSH) {
    return { aktion: "nichts", grund: `Push: nur ${ticketMerges} Ticket-Merges seit dem letzten Abschluss (Untergrenze ${MIN_TICKET_MERGES_PUSH})`, warnungen };
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

/** Soll das Status-Ticket bewegt werden? `nach-oben` nur, wenn es nicht schon im Kopf von `items` steht; anlegen bewegt immer. Pur. */
export function sollBewegen(e, items) {
  return !(e.aktion === "nach-oben" && imKopf(items, e.nr));
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
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const ghJson = (args) => JSON.parse(gh(args));

/**
 * Status-Ticket anlegen bzw. nach oben schieben. `items` = die schon geladene Board-Liste (der Aufrufer lädt sie einmal je Lauf).
 * Liefert `{ ok, nr, itemId }`: `ok` bei Erfolg (oder fehlendem Token, das nur warnt), `itemId` nur, wenn das Item an die Spitze gesetzt
 * wurde (der Aufrufer zieht seine Liste damit im Speicher nach); `nr` ist die Nummer des Tickets.
 */
export function fuehreStatusAus(e, { repo, vorgaenger, jetzt, token, items = [] }) {
  let node;
  let nr = e.nr;
  if (e.aktion === "anlegen") {
    const neu = ghJson([
      "api", "-X", "POST", `repos/${repo}/issues`,
      "-f", `title=${STATUS_TITEL}`, "-f", `body=${statusBody({ vorgaenger, jetzt })}`, "-f", "labels[]=area:harness",
    ]);
    console.log(`Angelegt: #${neu.number}`);
    node = neu.node_id;
    nr = neu.number;
  } else {
    node = ghJson(["api", `repos/${repo}/issues/${e.nr}`]).node_id;
  }
  if (!token) {
    console.log("::warning::PROJECT_TOKEN fehlt, Board-Position nicht gesetzt (das Ticket steht dann nicht im Board, der nächste Lauf trägt es nach, sofern es ungeclaimt und der Token gesetzt ist; nach dem Setzen des Tokens auch sofort per workflow_dispatch).");
    return { ok: true, nr, itemId: null };
  }
  try {
    if (!sollBewegen(e, items)) {
      console.log("Status-Ticket steht schon im Kopf, Position bleibt.");
      return { ok: true, nr, itemId: null };
    }
    const itemId = addToBoardTodo(node, { token });
    setPosition(itemId, null, { token });
    console.log("Board-Position oben gesetzt.");
    return { ok: true, nr, itemId };
  } catch (err) {
    console.log(`::error::Board-Position nicht gesetzt: ${String(err.message).split("\n")[0]}. Die Wiederholung ist idempotent und legt kein zweites Ticket an.`);
    return { ok: false, nr, itemId: null };
  }
}
