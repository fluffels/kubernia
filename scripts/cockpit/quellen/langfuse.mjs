// Kein Shebang: Cockpit-Quelle. Langfuse-Erreichbarkeit über den Unterprozess der Vorbedingung (Exit 0 erreichbar, 1 aus, sonst Fehler).
import { ausfall, ok } from "../quelle.mjs";

async function sammeln(ctx) {
  const r = await ctx.lauf("langfuse-vorbedingung");
  if (r.code === 0) return ok({ Health: "erreichbar" }, ctx);
  if (r.code === 1) return ausfall(r.stderr.split(/\r?\n/).find((z) => z.trim() !== "")?.trim() || "Langfuse aus", ctx);
  return ausfall(`Langfuse-Prüfung fehlgeschlagen (Exit ${r.code ?? r.fehler ?? "fehler"})`, ctx);
}

export default { id: "langfuse", titel: "Langfuse-Erreichbarkeit", ttlMs: 30000, sammeln };
