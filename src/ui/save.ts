import { Game } from "../game";
import { part } from "./shared";

export const saveUI = part({
  /* ========== Spielstand-Datei ========== */
  exportSave() {
    const data = Game.exportData();
    if (data == null) { this.toast("⚠️ Kein Spielstand zum Sichern gefunden."); return; }
    const blob = new Blob([data], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "kubequest-spielstand.json";
    a.click();
    URL.revokeObjectURL(a.href);
    this.toast("💾 Spielstand als Datei gesichert!");
  },

  importSave(ev: Event) {
    // Das change-Event kommt vom #save-import-Datei-Input (verdrahtet in overlay.ts).
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        // readAsText liefert immer einen String (nie ArrayBuffer/null) – TS weiß das nicht.
        if (typeof reader.result !== "string") throw new Error("kein Text");
        Game.importData(reader.result);
        this.toast("📂 Spielstand geladen – Spiel startet neu …");
        setTimeout(() => location.reload(), 800);
      } catch {
        this.toast("⚠️ Das ist keine gültige KubeQuest-Spielstand-Datei.");
      }
    };
    reader.readAsText(file);
  },

  /* ========== Sonstiges ========== */
  resetGame() {
    if (!confirm("Wirklich den kompletten Spielstand löschen?")) return;
    Game.reset();
    location.reload();
  },
});
