// Fester Fall-Satz für die Golden-Tests der Messskripte (#1745): Eingaben mit den Namen der übergebenen Config (Agenten, Worktree-Präfix,
// Branch-Präfix, Ticket-Skill; die Tests nehmen die Fremd-Config `FREMD`) und die Ausgaben als Text, die zwischen Vorher und Nachher byte-gleich bleiben müssen.
// `S` trägt die Funktionen der Messskripte schon in der Aufrufform des jeweiligen Stands; diese Datei kennt keine Signatur.
// Neu erzeugen nur über `messGoldenFaelle(S, FREMD)` mit dem Shim aus `mess-ausgaben-golden.test.ts`, geschrieben als
// `JSON.stringify(ist, null, 2)` plus Zeilenumbruch aus einem Wegwerf-Skript, nie von Hand.
import { basename } from "node:path";
import { toolEventsFromTranscript } from "../../scripts/brain-metrics.mjs";
import { callsFromTranscript } from "../../scripts/transkript-calls.mjs";

const t = (min, tag = 7) => new Date(Date.UTC(2026, 9, tag, 10, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const user = (min, text, tag = 7) => ({ type: "user", timestamp: t(min, tag), message: { role: "user", content: text } });
const call = (min, o = {}) => {
  seq += 1;
  const { tool, input = {}, ctx = 1000, cacheRead = 0, model = "claude-opus-5-5", branch } = o;
  return {
    type: "assistant",
    timestamp: t(min),
    uuid: `g${seq}`,
    ...(branch ? { gitBranch: branch, sessionId: "s1" } : {}),
    message: {
      id: `gm${seq}`,
      model,
      usage: { input_tokens: ctx, output_tokens: 10, cache_creation_input_tokens: ctx - cacheRead, cache_read_input_tokens: cacheRead },
      content: tool ? [{ type: "tool_use", id: `gt${seq}`, name: tool, input }] : [{ type: "text", text: "x" }],
    },
  };
};
const ergebnis = (min, id, text = "ok") => ({ type: "user", timestamp: t(min), message: { content: [{ type: "tool_result", tool_use_id: id, content: text }] } });
const mitTool = (min, tool, input, text = "ok") => {
  const c = call(min, { tool, input });
  return [c, ergebnis(min + 0.1, c.message.content[0].id, text)];
};
const wtPfad = (config) => `C:/dev/x/.claude/worktrees/${config.praefixe.worktree}12`;

function laufzeitFaelle(S, config) {
  const WT = wtPfad(config);
  const { planer, lens: lensName } = config.agenten;
  const wtp = config.praefixe.worktree;
  const lauf = (agentType, prompt, beschreibung) => ({
    meta: { agentType, ...(beschreibung ? { description: beschreibung } : {}) },
    zeilen: [user(0, prompt), call(0.1), ...mitTool(2, "Read", { file_path: `${WT}/src/a.ts` }), call(9)],
  });
  const laeufe = [
    lauf(planer, `Ticket #12: Titel (gesammelt)\nWorktree: ${WT}\nPatch: C:/tmp/${wtp}12-r1.patch`),
    lauf(lensName, `Lens\nPatch: C:/tmp/${wtp}12-r2.patch\nDelta-Patch: C:/tmp/${wtp}12-r2-delta.patch`, "Lens Test-Adäquanz R2"),
    lauf("Explore", `suche etwas in worktrees/${wtp}99/src`),
  ];
  const fenster = { von: t(-5), bis: t(60) };
  const r = S.laufzeiten({ laeufe, ...fenster, schnitt: t(1) });
  const lens = S.laufzeiten({ laeufe, agent: lensName, ...fenster });
  const typen = S.typenUebersicht({ laeufe, ...fenster });
  return {
    "laufzeit-markdown": S.laufzeitMarkdown(r),
    "laufzeit-json": JSON.stringify(r, null, 2),
    "laufzeit-lens-json": JSON.stringify(lens, null, 2),
    "laufzeit-typen-json": JSON.stringify(typen, null, 2),
    "laufzeit-typen-markdown": S.laufzeitTypen(typen),
  };
}

function kontextFaelle(S, config) {
  const WT = wtPfad(config);
  const { planer, umsetzer, lens: lensName } = config.agenten;
  const verify = mitTool(3, "Bash", { command: `cd ${WT} && npm run verify:kompakt` }, "x".repeat(800));
  const linse = call(5, { tool: "Agent", input: { subagent_type: lensName, description: "Lens Architektur R1" } });
  const fix = mitTool(15, "Edit", { file_path: `${WT}/src/a.ts` });
  const zeilen = [
    user(0, `Ticket #12: Titel\nWorktree: ${WT}`),
    call(0.5),
    ...mitTool(1, "Read", { file_path: `${WT}/src/a.ts` }, "y".repeat(2000)),
    ...mitTool(2, "Edit", { file_path: `${WT}/src/b.ts` }),
    ...verify,
    linse,
    ergebnis(5.2, linse.message.content[0].id),
    call(5.5, { ctx: 60_000, cacheRead: 59_000 }),
    call(12, { ctx: 100_000, cacheRead: 1000 }),
    ...fix,
    ...mitTool(16, "Bash", { command: "gh pr create --title x" }),
    ...mitTool(17, "Bash", { command: "node scripts/pr-warten.mjs 5" }),
    call(30),
  ];
  const laeufe = [{ meta: { agentType: umsetzer }, zeilen }, { meta: { agentType: planer }, zeilen: [user(0, "Ticket #13: x"), call(1)] }];
  const r = S.kontextTreiber({ laeufe, von: t(-5), bis: t(60), wurzel: "C:/dev/x" });
  const lens = S.kontextTreiber({ laeufe, agent: lensName, von: t(-5), bis: t(60), wurzel: "C:/dev/x" });
  const phasen = S.phaseDerCalls(zeilen);
  return {
    "kontext-markdown": S.kontextMarkdown(r),
    "kontext-json": JSON.stringify(r, null, 2),
    "kontext-leer-json": JSON.stringify(lens, null, 2),
    "kontext-phasen-json": JSON.stringify(phasen),
  };
}

function hauptchatFaelle(S, config) {
  const { umsetzer, lens: lensName } = config.agenten;
  const skill = config.agenten.ticketSkill;
  const slash = user(10, `<command-message>${skill}</command-message>\n<command-name>/${skill}</command-name>`);
  const main = [
    user(0, "frag mal was"),
    call(1, { model: "claude-opus-5-5" }),
    slash,
    call(11, { model: "claude-sonnet-5-5", tool: "Bash", input: { command: "gh issue edit 7 --add-assignee @me" } }),
    ergebnis(12, "x"),
    call(13, { model: "claude-sonnet-5-5" }),
    call(31, { model: "claude-opus-5-5" }),
  ];
  const sub = (meta, min) => ({ meta, zeilen: [call(min, { model: "claude-sonnet-5-5" }), call(min + 1, { model: "claude-sonnet-5-5" })] });
  const subagents = [sub({ agentType: umsetzer }, 14), sub({ agentType: lensName, description: "Lens Doku R1" }, 16), sub({ agentType: "Explore" }, 18), sub({ agentType: "general-purpose", parentAgentId: "p1" }, 20)];
  const r = S.zerlegeHauptchat({ sessions: [{ id: "s1", main, subagents }], closedAtOf: (nr) => (nr === 7 ? t(30) : null) });
  return {
    "hauptchat-markdown": S.hauptchatMarkdown(r),
    "hauptchat-json": JSON.stringify(r, null, 2),
  };
}

function baselineFaelle(S, config) {
  const { umsetzer, lens: lensName } = config.agenten;
  const hauptZeilen = [user(0, "los"), call(1, { model: "claude-opus-5-5" }), ...mitTool(2, "Bash", { command: "echo hallo" }), call(5, { model: "claude-opus-5-5" })];
  const rolle = (agentType, description) => ({ agentId: `a-${agentType}`, agentType, description, parentAgentId: undefined });
  const calls = [
    ...callsFromTranscript(hauptZeilen, null).calls,
    ...callsFromTranscript([user(2, "x"), call(3, { model: "claude-sonnet-5-5" }), call(4, { model: "claude-sonnet-5-5" })], rolle(umsetzer, "Umsetzung")).calls,
    ...callsFromTranscript([user(3, "x"), call(6, { model: "claude-opus-5-5" })], rolle(lensName, "Lens Architektur R1")).calls,
  ];
  const events = toolEventsFromTranscript(hauptZeilen);
  const summary = S.summarize({ calls, events, questions: 1 }, {});
  const loop = { nachweis: { runden: 2, plan: true }, failedPushes: 0, mergedAt: t(60) };
  return {
    "baseline-markdown": S.baselineMarkdown(summary, loop),
    "baseline-markdown-heuristik": S.baselineMarkdown(summary, {}),
    "baseline-json": JSON.stringify(summary, null, 2),
  };
}

function langfuseFaelle(S, config) {
  const branch = `${config.praefixe.branch}1562-x`;
  const planer = config.agenten.planer;
  const rows = (branch) => [call(0, { branch, model: "claude-opus-5-5" }), call(1, { branch, model: "claude-opus-5-5" })];
  const sitzung = {
    id: "s1",
    main: rows(branch),
    subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: planer, description: "Plan" }, zeilen: rows(branch) }],
  };
  const soll = S.sollEintraege(sitzung, { session: "s1" });
  const ohneTicket = S.sollEintraege({ id: "s2", main: rows("main"), subagents: [] }, { session: "s2" });
  const payloads = S.bauePayloads("s1", soll, { soll, env: {}, project: "proj" });
  return {
    "langfuse-soll-json": JSON.stringify(soll, null, 2),
    "langfuse-ohne-ticket-json": JSON.stringify(ohneTicket.map((e) => e.ticket)),
    "langfuse-payload-json": JSON.stringify(payloads, null, 2),
    "kontingent-logdatei": basename(S.logPfad({})),
    "kontingent-logdatei-env": S.logPfad({ FACTORY_GH_KOSTEN_LOG: "X:/eigen.jsonl" }),
  };
}

/** Alle Fälle als `{ name: text }`; die Namen sind die Schlüssel der Golden-Datei. */
export function messGoldenFaelle(S, config) {
  return { ...laufzeitFaelle(S, config), ...kontextFaelle(S, config), ...hauptchatFaelle(S, config), ...baselineFaelle(S, config), ...langfuseFaelle(S, config) };
}
