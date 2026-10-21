// Kein Shebang: Cockpit-Quelle. Langfuse-Erreichbarkeit über den Unterprozess der Vorbedingung mit --json (stdout `{ erreichbar, grund }`; Exit 0 erreichbar, 1 aus, sonst Fehler).
import { ausfall, ok } from "../quelle.mjs";

const UNLESBAR = "Langfuse-Prüfung fehlgeschlagen (unlesbare Ausgabe)";

function lies(stdout) {
  try {
    const j = JSON.parse(stdout);
    return j && typeof j.erreichbar === "boolean" ? j : null;
  } catch {
    return null;
  }
}

async function sammeln(ctx) {
  const r = await ctx.lauf("langfuse-vorbedingung");
  if (r.code !== 0 && r.code !== 1) return ausfall(`Langfuse-Prüfung fehlgeschlagen (Exit ${r.code ?? r.fehler ?? "fehler"})`, ctx);
  const j = lies(r.stdout);
  if (!j || j.erreichbar !== (r.code === 0)) return ausfall(UNLESBAR, ctx);
  if (j.erreichbar) return ok({ Health: "erreichbar" }, ctx);
  return ausfall(typeof j.grund === "string" && j.grund.trim() !== "" ? j.grund.trim() : "Langfuse aus", ctx);
}

export default { id: "langfuse", titel: "Langfuse-Erreichbarkeit", ttlMs: 30000, sammeln };
