// Lib ohne Direktaufruf-Guard; Hooks und Guards importieren sie (ADR 0022 F3, #1742).
/**
 * Ticket-Namen aus der Projekt-Config: Branch-, Worktree- und Agentennamen samt den Mustern dazu entstehen hier aus
 * `.factory/projekt.json` (`praefixe`, `agenten`), nicht aus Literalen in den Hooks. Alle Präfixe laufen durch `escapeRegex`.
 *
 * Fail-closed-Vertrag: fehlt die Config oder ein Schlüssel, gibt es keinen stillen Standardwert. `ticketNamen` wirft mit
 * Schlüssel und „Fix:“-Zeile; `namenOderGrund` wirft nie und liefert statt der Namen einen Grund, den ein Hook als
 * deny/block ausgibt. Geladen wird nie beim Import eines Hook-Moduls (ein Import-Fehler schaltete den Dispatcher ab).
 *
 * Nur Node-Builtins, `arbeitsplatz-lib.mjs` und `projekt-config-lib.mjs`.
 */
import { repoSegment } from "./arbeitsplatz-lib.mjs";
import { ladeProjektConfig, PFLICHT_AGENTEN, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";

const istText = (v) => typeof v === "string" && v.trim() !== "";

/** Maskiert alle Regex-Metazeichen. Pur. */
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\/-]/g, String.raw`\$&`);
}

/** Der eine fail-closed-Text für Hooks und Wächter, wenn die Projekt-Config nicht nutzbar ist. Pur; `fehler` darf ein Error oder beliebiger Wert sein. */
export function failClosedGrund(werkzeug, fehler) {
  const text = fehler instanceof Error ? fehler.message : String(fehler);
  return `${werkzeug}: Projekt-Config nicht nutzbar, darum blockiert (fail-closed). ${text}`;
}

/** Fehler mit Schlüsseln und Fix-Zeile. */
const unvollstaendig = (fehlend) => new Error(`Projekt-Config unvollständig: ${fehlend.join(", ")} fehlt\nFix: ${fehlend.join(", ")} in ${PROJEKT_CONFIG} ergänzen`);

/**
 * Pur: das rohe Worktree-Präfix, geprüft allein auf `praefixe.worktree` (kein Zwang zu Branch-Präfix oder Agenten). Für Pfad- und Dateinamen,
 * die nur dieses Präfix brauchen; wirft mit Schlüssel und Fix-Zeile.
 */
export function worktreePraefix(config) {
  const worktree = config?.praefixe?.worktree;
  if (!istText(worktree)) throw unvollstaendig(["praefixe.worktree"]);
  return worktree;
}

/** Alle Worktree-Muster aus dem rohen Präfix (einzige Stelle, die es maskiert und baut). Pur. */
function worktreeTeil(worktree) {
  const w = escapeRegex(worktree);
  const lensNameKern = String.raw`(${w}\d+)-lens-[rma]\d+`;
  return {
    /** Muster eines Lens-Worktree-Namens (`<wt><nr>-lens-r<runde>`, `-lens-m<n>` oder `-lens-a<n>`); Gruppe 1 ist `<wt><nr>`. */
    lensNameKern,
    /** Ganzer Lens-Worktree-Name (`^…$`). */
    lensWorktreeMuster: new RegExp(`^${lensNameKern}$`),
    /** Pfadform `/.claude/worktrees/[<Repo>/]<Lens-Name>/` (Repo-Segment im Arbeitsplatz), Groß-/Kleinschreibung egal (Windows-Pfade). */
    lensPfadMuster: new RegExp(String.raw`/\.claude/worktrees/${repoSegment(w, "/")}${lensNameKern}/`, "i"),
    /** Lose Datei `<wt><nr>` gefolgt von `-`, `.` oder Ende; Gruppe 1 ist der Eltern-Worktree. */
    dateiMuster: new RegExp(String.raw`^(${w}\d+)(?=[-.]|$)`),
  };
}

/** Pur: leitet die Namen aus einer Config ab; wirft mit Schlüssel und Fix-Zeile, wenn ein benötigter Schlüssel fehlt. */
export function ticketNamen(config) {
  const fehlend = [];
  const branch = config?.praefixe?.branch;
  const worktree = config?.praefixe?.worktree;
  if (!istText(branch)) fehlend.push("praefixe.branch");
  if (!istText(worktree)) fehlend.push("praefixe.worktree");
  for (const rolle of PFLICHT_AGENTEN) {
    if (!istText(config?.agenten?.[rolle])) fehlend.push(`agenten.${rolle}`);
  }
  if (fehlend.length) {
    throw unvollstaendig(fehlend);
  }
  const b = escapeRegex(branch);
  const w = escapeRegex(worktree);
  const ende = String.raw`(?=$|[-/\\\s])`;
  const ticketRef = new RegExp(String.raw`(?:${b}|worktrees[\\/]${repoSegment(w, String.raw`[\\/]`)}${w})(\d+)${ende}`);
  return {
    praefixe: { branch, worktree },
    agenten: { ...config.agenten },
    worktreeName: (nr) => `${worktree}${nr}`,
    branchName: (nr, slug) => `${branch}${nr}-${slug}`,
    ...worktreeTeil(worktree),
    /** Ticket-Branch `<branch><nr>` am Namensanfang. */
    ticketBranchMuster: new RegExp(String.raw`^${b}\d+`),
    /** Ticketnummer aus Branch-, Worktree- oder Ref-Namen; sonst null. */
    ticketAus: (text) => {
      const m = ticketRef.exec(String(text ?? ""));
      return m ? Number(m[1]) : null;
    },
    /** Muster für Patch-Dateien `<wt><nr>-r<runde>[-delta].patch`; `ticketRunde` (Gruppe 1 Ticket, 2 Runde) läuft auf dem Basename. */
    patchMuster: {
      ticketRunde: new RegExp(String.raw`${w}(\d+)-r(\d+)`, "i"),
      voll: new RegExp(String.raw`\S*${w}\d+-r\d+\.patch(?![\w-])`, "i"),
      delta: new RegExp(String.raw`\S*${w}\d+-r\d+-delta\.patch(?![\w-])`, "i"),
    },
  };
}

/**
 * Wie `namenOderGrund`, aber nur mit dem Worktree-Präfix: `{ namen: { praefixe: { worktree }, <Worktree-Muster> } }` oder `{ grund }`. Für Werkzeuge, die nur
 * Worktree-Ordner aufräumen (Stop des Hauptchats): ein fehlender Agentenname soll sie nicht blockieren, darum liest sie die Config ohne Schema-Prüfung
 * (`deps.pfad` ersetzt den Pfad, `deps.config` das Laden; Test) und prüft allein `praefixe.worktree`. Das Teilobjekt trägt nur `praefixe.worktree` und die Worktree-Muster (`lensNameKern`, `lensWorktreeMuster`, `lensPfadMuster`, `dateiMuster`):
 * Empfänger dürfen keine anderen Felder lesen. Wirft nie.
 */
export function worktreeNamenOderGrund(werkzeug, deps = {}) {
  try {
    const config = deps.config ?? ladeProjektConfig({ pruefen: false, ...(deps.pfad ? { pfad: deps.pfad } : {}) });
    const worktree = worktreePraefix(config);
    return { namen: { praefixe: { worktree }, ...worktreeTeil(worktree) } };
  } catch (e) {
    return { grund: failClosedGrund(werkzeug, e) };
  }
}

/** Lädt die Config und leitet die Namen ab; wirft wie `ladeProjektConfig` bzw. `ticketNamen`. */
export function ladeTicketNamen(opts) {
  return ticketNamen(ladeProjektConfig(opts));
}

/**
 * Wirft nie: `{ namen, config }` oder `{ grund }` (Text für deny/block, mit Fix-Zeile). `deps.config` ersetzt das Laden, `deps.pfad` den Config-Pfad (Test).
 */
export function namenOderGrund(werkzeug, deps = {}) {
  try {
    const config = deps.config ?? ladeProjektConfig(deps.pfad ? { pfad: deps.pfad } : undefined);
    return { namen: ticketNamen(config), config };
  } catch (e) {
    return { grund: failClosedGrund(werkzeug, e) };
  }
}
