// Kein Shebang: wird von board-takt.mjs importiert UND von test/langfuse-takt.test.ts.
/**
 * Status-Ticket „Langfuse-Status überprüfen“ (#1351, ADR 0016: wöchentlich plus nach Aktivität, Push-Ruhe Fr–So): die pure Entscheidung (`entscheideTakt`),
 * der Body (`statusBody`) und das Anlegen bzw. Hochschieben (`fuehreStatusAus`). Gestartet wird der Takt nicht hier, sondern vom
 * generischen Board-Takt `scripts/board-takt.mjs` (Workflow `.github/workflows/board-takt.yml`, #1390), der auch das Harness-Sammelticket
 * pflegt und die Commit-Fenster berechnet. Die Entscheidung ist pur und getestet (test/langfuse-takt.test.ts), nur die gh-Aufrufe in
 * `fuehreStatusAus` sind es nicht.
 *
 * Nur Node-Builtins, board-lib.mjs und gh-cli.mjs (keine Importe aus board-takt.mjs: der Import läuft in die andere Richtung).
 */
import { LANGFUSE_SAMMELTICKET_TITEL, REPO, STATUS_TITEL, TAG_MS, addToBoardTodo, alsDatum, boardFuerRolle, boardRolleFuer, ghJson, imKopf, setPosition } from "./board-lib.mjs";
import { fehlerMeldung, fehlerText } from "./gh-cli.mjs";
import { labelAus } from "./projekt-config-lib.mjs";

export { STATUS_TITEL };
export const SAMMEL_TITEL = LANGFUSE_SAMMELTICKET_TITEL;
/** Aktivitäts-Untergrenze: so viele Commits auf main seit dem Anlegen des jüngsten Status-Tickets (Zählfenster, #1628), sonst kein neues Ticket. */
export const MIN_MERGES = 5;
/** Push-Auslöser (Aktivität): so viele Ticket-Merges (ohne Bots) seit dem Anlegen des jüngsten Status-Tickets legen das Status-Ticket an bzw. holen es nach oben. */
export const MIN_TICKET_MERGES_PUSH = 50;
/** Wochentage (UTC, `getUTCDay`: So=0 … Sa=6), an denen der Push-Auslöser ruht: Fr, Sa, So. Der Montags-Cron setzt das Fenster zurück. */
export const PUSH_RUHETAGE = [5, 6, 0];
/** Mindestabstand in Stunden zwischen dem Abschluss des Vorgängers und einem neu angelegten Status-Ticket (beide Auslöser; „nach-oben“ ist ausgenommen). */
export const MIN_ABSTAND_STUNDEN = 24;

/**
 * Was tut der Lauf mit dem Status-Ticket? `offene` aus normalizeOffene (board-lib.mjs), `mergesSeit` = Zahl der Commits auf main im Fenster,
 * `ticketMerges` = davon Ticket-Merges ohne Bots, `ausloeser` = Workflow-Event (`push` zählt nur Aktivität: mindestens
 * `MIN_TICKET_MERGES_PUSH` Ticket-Merges, sonst nichts; alles andere ist der Wochen-Cron mit `MIN_MERGES`).
 * `stundenSeitAbschluss` = Stunden seit dem Abschluss des Vorgängers (null/fehlt: kein Vorgänger); das Anlegen braucht mindestens
 * `MIN_ABSTAND_STUNDEN`. `jetzt` (Datum oder ISO-String, optional) bestimmt den Wochentag (UTC): an `PUSH_RUHETAGE` (Fr–So) ruht der
 * Push-Auslöser ganz (auch das Hochschieben), der Cron nicht. Ungültiges `jetzt` wirft.
 * Liefert `{ aktion: "anlegen" | "nach-oben" | "nichts", nr?, grund, warnungen }`. Pur.
 */
export function entscheideTakt({ offene, mergesSeit, ticketMerges = 0, ausloeser = "schedule", stundenSeitAbschluss = null, jetzt = undefined }) {
  const wochentag = jetzt === undefined ? null : alsDatum(jetzt, "jetzt").getUTCDay();
  if (!Array.isArray(offene)) throw new Error("offene muss eine Liste sein.");
  if (!Number.isInteger(mergesSeit) || mergesSeit < 0) throw new Error(`mergesSeit muss eine ganze Zahl ≥ 0 sein, war ${String(mergesSeit)}`);
  const treffer = offene
    .filter((i) => i.titel === STATUS_TITEL)
    .sort((a, b) => alsDatum(a.createdAt, "createdAt") - alsDatum(b.createdAt, "createdAt") || a.number - b.number);
  if (stundenSeitAbschluss !== null && !(Number.isFinite(stundenSeitAbschluss) && stundenSeitAbschluss >= 0)) {
    throw new Error(`stundenSeitAbschluss muss null oder eine Zahl ≥ 0 sein, war ${String(stundenSeitAbschluss)}`);
  }
  const warnungen = [];
  if (treffer.length > 1) {
    warnungen.push(`Mehrere offene „${STATUS_TITEL}“ (${treffer.map((t) => `#${t.number}`).join(", ")}): der Lauf arbeitet mit dem ältesten und schließt nichts selbst.`);
  }
  const push = ausloeser === "push";
  if (push && wochentag !== null && PUSH_RUHETAGE.includes(wochentag)) {
    return { aktion: "nichts", grund: "Push ruht Fr–So, der Montag setzt zurück", warnungen };
  }
  if (push && ticketMerges < MIN_TICKET_MERGES_PUSH) {
    return { aktion: "nichts", grund: `Push: nur ${ticketMerges} Ticket-Merges seit dem Anlegen des jüngsten Status-Tickets (Untergrenze ${MIN_TICKET_MERGES_PUSH})`, warnungen };
  }
  if (treffer.length > 0) {
    const geclaimt = treffer.find((t) => t.assignees.length > 0);
    if (geclaimt) return { aktion: "nichts", grund: `#${geclaimt.number} ist geclaimt und läuft schon`, warnungen };
    return { aktion: "nach-oben", nr: treffer[0].number, grund: `#${treffer[0].number} ist offen und ungeclaimt, kommt an die Spitze`, warnungen };
  }
  if (mergesSeit < MIN_MERGES) {
    return { aktion: "nichts", grund: `nur ${mergesSeit} Merges seit dem Anlegen des jüngsten Status-Tickets (Untergrenze ${MIN_MERGES})`, warnungen };
  }
  if (typeof stundenSeitAbschluss === "number" && stundenSeitAbschluss < MIN_ABSTAND_STUNDEN) {
    return { aktion: "nichts", grund: `erst ${stundenSeitAbschluss.toFixed(1)} h seit dem Abschluss des Vorgängers (Mindestabstand ${MIN_ABSTAND_STUNDEN} h)`, warnungen };
  }
  return { aktion: "anlegen", grund: `${mergesSeit} Merges seit dem Anlegen des jüngsten Status-Tickets, kein offenes Status-Ticket`, warnungen };
}

/**
 * Zweitabfrage vor dem Anlegen (fail-closed): die REST-Liste der offenen Issues hinkt bei frischen Tickets nach, ein zweites Status-Ticket
 * entstand so schon. Nur bei `aktion: "anlegen"` fragt `zweit()` (liefert `[{ number, titel }]`, z.B. `frischeOffeneIssues`) einen zweiten
 * Weg: kennt er ein offenes `STATUS_TITEL` oder wirft er, wird daraus `nichts` mit Warnung. Jede andere Aktion bleibt unberührt. Pur
 * (`zweit` ist injiziert); liefert eine neue Entscheidung.
 */
export function bestaetigeAnlegen(e, { zweit }) {
  if (e.aktion !== "anlegen") return e;
  let frisch;
  try {
    frisch = zweit();
    if (!Array.isArray(frisch)) throw new Error("Antwort ist keine Liste.");
  } catch (err) {
    return { aktion: "nichts", grund: "Anlegen abgebrochen: die Zweitabfrage über GraphQL ist fehlgeschlagen (fail-closed, der nächste Lauf versucht es erneut)", warnungen: [...e.warnungen, `Zweitabfrage vor dem Anlegen fehlgeschlagen: ${fehlerText(err)}`] };
  }
  const da = frisch.filter((i) => i.titel === STATUS_TITEL).map((i) => `#${i.number}`);
  if (da.length === 0) return e;
  return { aktion: "nichts", grund: `Anlegen abgebrochen: die REST-Liste kannte ${da.join(", ")} noch nicht, GraphQL schon (frisch angelegt)`, warnungen: [...e.warnungen, `REST-Liste hinkt: offenes „${STATUS_TITEL}“ ${da.join(", ")} nur per GraphQL gefunden.`] };
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

/** Body des neu angelegten Status-Tickets. `vorgaenger` = `{ number, closedAt, createdAt? }` oder null; war der Vorgänger in derselben Kalenderwoche angelegt, hat er die letzte volle Woche schon gemessen (fehlt `createdAt`, wird gemessen). Pur. */
export function statusBody({ vorgaenger, jetzt, repo = REPO }) {
  const w = wochenFenster(jetzt);
  const zeitraum = vorgaenger
    ? `seit dem Abschluss von #${vorgaenger.number} (${vorgaenger.closedAt}) bis zum Claim`
    : "seit dem Merge von #1293 bis zum Claim";
  const schonGemessen = vorgaenger?.createdAt && wochenFenster(vorgaenger.createdAt).letzte.von === w.letzte.von;
  const budget = schonGemessen
    ? `- **Wochenbudget:** entfällt, Woche ${w.letzte.von} bis ${w.letzte.bis} hat #${vorgaenger.number} schon gemessen (Checkliste Punkt 7 überspringen).`
    : `- **Wochenbudget:** letzte volle Woche ${w.letzte.von} bis ${w.letzte.bis} (Mo–So UTC) gegen die Woche davor ${w.davor.von} bis ${w.davor.bis}.`;
  const docs = `https://github.com/${repo}/blob/main/docs`;
  return [
    "Wiederkehrende Auswertung der Langfuse-Daten, vom Wochen-Workflow angelegt (kein Agent legt dieses Ticket an).",
    "",
    `- **Zeitraum:** ${zeitraum}.`,
    budget,
    `- **Factory-Kennzahlen:** \`node scripts/factory-kennzahlen.mjs --von ${vorgaenger?.closedAt ?? "<Start des Zeitraums>"} --bis <Claim-Zeit>\`, den Block unverändert in den Bericht-Kommentar (Checkliste Punkt 10).`,
    `- **Checkliste:** [docs/model-routing.md › Langfuse-Status überprüfen](${docs}/model-routing.md#langfuse-status-überprüfen-1293).`,
    `- **Mechanik:** [docs/ticket-reihenfolge.md](${docs}/ticket-reihenfolge.md#wiederkehrendes-ticket-langfuse-status-überprüfen-1293).`,
    `- **Abschluss:** Bericht-Kommentar geschrieben, große Befunde als Issues, kleine als Zeilen ins Sammelticket „${SAMMEL_TITEL}“ (danach per \`board-place.mjs --top\` nach oben), PR mit Verdichtungszeile und \`Closes\`.`,
  ].join("\n");
}

// ── gh-Anbindung (nur CLI, nicht Teil der getesteten Logik) ─────────────────
/**
 * Status-Ticket anlegen bzw. nach oben schieben. `items` = die schon geladene Board-Liste (der Aufrufer lädt sie einmal je Lauf).
 * Liefert `{ ok, nr, itemId }`: `ok` bei Erfolg (oder fehlendem Token, das nur warnt), `itemId` nur, wenn das Item an die Spitze gesetzt
 * wurde (der Aufrufer zieht seine Liste damit im Speicher nach); `nr` ist die Nummer des Tickets.
 */
export function fuehreStatusAus(e, { repo, vorgaenger, jetzt, token, items = [], io = {}, config }) {
  // Zwei Boards (ADR 0022 F11): Status- und Sammeltickets tragen das Harness-Label der Config und stehen laut Trennregel auf dem Factory-Board.
  const harness = labelAus(config, "harness");
  const board = boardFuerRolle(boardRolleFuer([harness], config));
  const { gh = ghJson, imBoardAnlegen = (nodeId, opts) => addToBoardTodo(board, nodeId, opts), setze = (id, afterId, opts) => setPosition(board, id, afterId, opts) } = io; // im Test injizierbar
  let node;
  let nr = e.nr;
  if (e.aktion === "anlegen") {
    const neu = gh([
      "api", "-X", "POST", `repos/${repo}/issues`,
      "-f", `title=${STATUS_TITEL}`, "-f", `body=${statusBody({ vorgaenger, jetzt, repo })}`, "-f", `labels[]=${harness}`,
    ]);
    console.log(`Angelegt: #${neu.number}`);
    node = neu.node_id;
    nr = neu.number;
  } else {
    node = gh(["api", `repos/${repo}/issues/${e.nr}`]).node_id;
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
    const itemId = imBoardAnlegen(node, { token });
    setze(itemId, null, { token });
    console.log("Board-Position oben gesetzt.");
    return { ok: true, nr, itemId };
  } catch (err) {
    console.log(fehlerMeldung(err, { praefix: "Board-Position nicht gesetzt: ", zusatz: "Die Wiederholung ist idempotent und legt kein zweites Ticket an." }));
    return { ok: false, nr, itemId: null };
  }
}
