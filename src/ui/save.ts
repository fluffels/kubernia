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
        this.toast("⚠️ Das ist keine gültige Kubernia-Spielstand-Datei.");
      }
    };
    reader.readAsText(file);
  },

  /* ========== Mehrere Spielstände / Save-Slots (#306) ==========
   * Slot-Wechsel/-Neu/-Löschen-des-aktiven laden die Seite neu (wie der Datei-Import):
   * nach dem Reload hydriert SaveStore.init() den jetzt aktiven Slot. Die kleine
   * Verzögerung gibt dem fire-and-forget-IndexedDB-Schreiben Zeit zu committen. */
  newSlot() {
    const name = prompt("Name für den neuen Spielstand:", "Neuer Spielstand");
    if (name === null) return; // abgebrochen
    Game.newSlot(name);
    this.toast("✨ Neuer Spielstand angelegt – Spiel startet neu …");
    setTimeout(() => location.reload(), 800);
  },

  loadSlot(id: string) {
    if (!Game.switchSlot(id)) return;
    this.toast("📂 Spielstand gewechselt – Spiel startet neu …");
    setTimeout(() => location.reload(), 800);
  },

  renameSlot(id: string) {
    const cur = Game.slots().find(s => s.id === id);
    const name = prompt("Neuer Name für den Spielstand:", cur ? cur.name : "");
    if (name === null) return;
    if (Game.renameSlot(id, name)) this.renderSlots(); // Liste im offenen Menü aktualisieren
  },

  deleteSlot(id: string) {
    const s = Game.slots().find(x => x.id === id);
    if (!confirm("Spielstand „" + (s ? s.name : id) + "“ wirklich löschen? Das lässt sich nicht rückgängig machen.")) return;
    const res = Game.deleteSlot(id);
    if (res.reload) { location.reload(); return; } // der aktive Slot wurde gelöscht
    if (res.ok) this.renderSlots();
  },

  /* ========== Sonstiges ========== */
  resetGame() {
    if (!confirm("Wirklich diesen Spielstand zurücksetzen? Das lässt sich nicht rückgängig machen. (Andere Spielstände bleiben erhalten.)")) return;
    Game.reset();
    location.reload();
  },
});
