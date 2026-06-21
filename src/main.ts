/* ===== KubeQuest 3.0 – Start =====
 * Spielstand laden, Phaser starten, Tastatur verdrahten.
 */
import Phaser from "phaser";
import { Game } from "./game";
import { UI } from "./ui";
import { KQScenes } from "./scenes";
import { SFX } from "./sfx";
import { SaveStore } from "./store";
import { keys, clearKeys } from "./runtime";

  // Wie in ui.ts: die DOM-Knoten liegen fest in index.html, darum nicht-nullbar.
  const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

  /* Fester Spielcharakter: Die Spielfigur ist immer der PixelLab-Sprite
   * `char_player` (4 Richtungen, siehe scenes.ts). Die frühere Charakterwahl
   * setzte nur kurz eine `dungeon`-Textur, die der Bewegungs-Loop sofort wieder
   * mit `char_player` überschrieb – Vorschau ≠ Spielfigur (#45). Das Feld
   * `character` bleibt nur als „schon onboarded?"-Marker (null = erster Start)
   * und als Andockpunkt für späteres Customizing à la Stardew erhalten. */
  const FIXED_CHARACTER = 0;

  function wireKeyboard() {
    window.addEventListener("keydown", e => {
      SFX.ensure();
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") { UI.closeOverlays(); (e.target as HTMLElement).blur(); }
        return;
      }
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = true;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();

      if (k === "Escape") { if (UI.blocking()) UI.closeOverlays(); else UI.openMenu(); return; }
      // Wissensrunde per Tastatur (#258): Quiz-Auswahl (1–n, ↑/↓+Enter) & „Weiter".
      // Die Befehls-Eingabe (INPUT) ist oben schon abgefangen, landet hier nicht.
      if (!$("overlay-review").classList.contains("hidden")) {
        if (UI.reviewKey(k, e)) return;
      }
      if (UI.dialogue) {
        if (UI.hasChoices()) {
          // Antwort-Auswahl per Tastatur: ↑/↓ (oder W/S) navigieren, Enter/E/Leer bestätigen, 1–4 direkt
          if (k === "ArrowUp" || k === "w") { UI.dlgMoveSel(-1); e.preventDefault(); return; }
          if (k === "ArrowDown" || k === "s") { UI.dlgMoveSel(1); e.preventDefault(); return; }
          if (k === "e" || k === "Enter" || k === " ") { UI.dlgActivateSel(); e.preventDefault(); return; }
          if (["1", "2", "3", "4"].includes(k)) { UI.dlgPickNumber(parseInt(k, 10)); e.preventDefault(); return; }
          return;
        }
        // #310: Lese-Rückblick – ← / Backspace blättert eine Zeile zurück (reines
        // Nachlesen, ohne Spielzustand zu ändern), E/Enter/Leer wieder vorwärts.
        if (k === "ArrowLeft" || k === "Backspace") { UI.dialogueBack(); e.preventDefault(); return; }
        if (k === "e" || k === "Enter" || k === " ") { UI.advanceDialogue(); e.preventDefault(); }
        return;
      }
      if (k === "t") { UI.toggleTerminal(); e.preventDefault(); return; }
      if (k === "j") {
        if ($("overlay-quest").classList.contains("hidden")) UI.openQuestLog();
        else UI.closeOverlays();
        e.preventDefault();
        return;
      }
      // Generische Tastatur-Bedienung blockierender Modals ohne eigene Navigation (#283):
      // Stapel-Spiel, Shop, Logbuch, Menü per ↑/↓ + Enter/Leer steuern (Primär-Button als Default).
      if (UI.overlayKey(k, e)) return;
      if (!UI.blocking() && (k === "e" || k === "Enter" || k === " ")) { UI.interact(); e.preventDefault(); }
    });
    window.addEventListener("keyup", e => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = false;
    });
    window.addEventListener("blur", () => clearKeys());

    $("term-input").addEventListener("keydown", e => {
      if (e.key === "Enter") {
        UI.termSubmit((e.target as HTMLInputElement).value);
        (e.target as HTMLInputElement).value = "";
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // #316: durch die Befehlshistorie blättern (sobald freigeschaltet). preventDefault
        // verhindert, dass ↑ den Cursor an den Zeilenanfang springen lässt.
        if (UI.termHistoryNav(e.key === "ArrowUp" ? -1 : 1)) e.preventDefault();
      }
    });
  }

  async function boot() {
    // Dev-Sicherheitsnetz: Inhalts-Schema beim Start prüfen und Querverweis-Fehler
    // (unbekannte NPCs/Drills/Quests/reviewIds …) sofort in der Konsole melden.
    // Nur im Dev-Server aktiv – `import.meta.env.DEV` ist im Prod-Build `false`,
    // der ganze Block fällt beim Bauen weg (kein Gameplay-Einfluss, #81).
    if (import.meta.env.DEV) {
      // Bewusst nicht awaiten (`void`): eine Dev-only-Diagnose, die nur in die
      // Konsole loggt – sie soll den Boot nicht aufhalten (#389/no-floating-promises).
      void Promise.all([import("./content/validate"), import("./content")]).then(([{ validateContent }, { KQContent }]) => {
        const probleme = validateContent(KQContent);
        if (probleme.length) console.error("⚠️ KubeQuest-Inhalte inkonsistent (#81):\n" + probleme.join("\n"));
      });
    }
    // Persistenz auf IndexedDB hochziehen, BEVOR der Stand geladen wird (#350): init()
    // hydriert den synchronen Cache aus IndexedDB (und migriert einen alten localStorage-
    // Stand einmalig hinein). Wirft nie und fällt ohne IndexedDB auf localStorage zurück,
    // darum hält das await den Boot nicht auf, wenn kein IndexedDB da ist.
    await SaveStore.init();
    // Eviction-Schutz (#401): Browser-Speicher ist "geliehen" – ohne `persist()` kann der
    // Browser unter Speicherdruck den ganzen Origin (inkl. IndexedDB-Spielstand) per LRU
    // löschen. Wir fordern dauerhaften Speicher an (best effort, feature-detected) und warnen
    // früh, wenn das Kontingent knapp wird, bevor ein QuotaExceededError den Auto-Save reißt.
    // Bewusst NICHT awaitet (`void`): das soll den Boot nicht aufhalten (#389/no-floating-promises).
    void SaveStore.requestPersistentStorage().then(health => {
      if (health.nearQuota) {
        UI.toast("⚠️ <b>Browser-Speicher wird knapp.</b> Sichere deinen Fortschritt über Menü → Spielstand exportieren.");
      }
    });
    Game.load();
    wireKeyboard();
    UI.bindEvents();

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game-container",
      backgroundColor: "#356dab",
      pixelArt: true,
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene: [KQScenes.BootScene, KQScenes.WorldScene, KQScenes.InteriorScene, ...KQScenes.REGION_SCENES, KQScenes.TilemapTestScene],
    });

    // Dev-Affordance: die laufende Phaser-Instanz fürs manuelle Verifizieren im
    // Browser greifbar machen (Szenen-Wechsel/Teleport testen). Im Prod-Build fällt
    // der ganze Block weg (import.meta.env.DEV === false), kein Gameplay-Einfluss.
    if (import.meta.env.DEV) {
      const dev = window as unknown as { kqGame: Phaser.Game; kqDev: unknown };
      dev.kqGame = game;
      // Dev-/Test-Sprung (#329): zu beliebigem Quest-Stand springen + Erststart/
      // Reset gezielt herstellen, ohne sich von vorn durchzuspielen. Konsolen-Tool;
      // das klickbare, passwortgated Panel kommt in #325. Fällt im Prod-Build weg.
      dev.kqDev = {
        /** Roadmap aller Quests als Tabelle in die Konsole (idx → Quest). */
        roadmap: () => { console.table(Game.getQuestRoadmap()); return Game.getQuestRoadmap(); },
        /** An den Anfang von Quest `idx` springen (Stand + Cluster + Spawn) und neu laden. */
        jump: (idx: number) => {
          if (Game.jumpToQuest(idx)) location.reload();
          else console.warn(`kqDev.jump: ungültiger Quest-Index ${idx} (0…${Game.getQuestRoadmap().length})`);
        },
        /** Echter Erststart: Save löschen + neu laden → frischer Stand inkl. Intro. */
        freshStart: () => { SaveStore.remove(); location.reload(); },
        /** Bestehender Reset-Pfad (wie Menü → Zurücksetzen) + neu laden. */
        reset: () => { Game.reset(); location.reload(); },
      };
      console.info("🛠️ kqDev bereit: kqDev.roadmap() · kqDev.jump(idx) · kqDev.freshStart() · kqDev.reset()");
    }

    // Klickbares, passwortgegatetes Dev-Panel (#325) – die Komfortschicht auf der
    // kqDev-API. Aktiv im Dev-Server (import.meta.env.DEV) ODER im dedizierten
    // Dev-Panel-Build (#331, __KQ_DEVPANEL__). In den normalen Prod-/Offline-Builds
    // sind beide Flags statisch `false` → dieser Block samt dynamischem Import ist
    // toter Code und wird komplett rausgestrippt (das Panel-Modul mit Passwort-
    // Logik landet nie im ausgelieferten `build`/`build:offline`).
    if (import.meta.env.DEV || __KQ_DEVPANEL__) {
      // Bewusst nicht awaiten (`void`): der Panel-Mount ist eine optionale
      // Komfortschicht und soll den Boot nicht serialisieren (#389).
      void import("./devpanel").then(({ mountDevPanel }) => mountDevPanel());
    }

    UI.refreshHud();
    if (Game.state.character === null) {
      // Erster Start: fester Charakter, kein Auswahl-Dialog mehr (#45).
      // Statt nur eines Toasts kommt jetzt die einmalige Begrüßung mit Steuerung
      // und erstem Ziel "geh zu Ole" (#288); der Dialog setzt zugleich den
      // "!"-Marker über Ole in Szene. introSeen verhindert eine Wiederholung.
      Game.state.character = FIXED_CHARACTER;
      Game.state.introSeen = true;
      Game.save();
      setTimeout(() => UI.showIntro(), 600);
    } else if (!Game.state.introSeen) {
      // Bestandsspieler von vor #288 (Charakter schon gesetzt): das Intro nicht
      // nachträglich aufdrängen – sie kennen das Spiel – nur als gesehen merken.
      Game.state.introSeen = true;
      Game.save();
    }
    if (Game.offlineEarnings > 0) {
      setTimeout(() => UI.toast("🌙 Während du weg warst, hat dein Hafen <b>+" + Game.offlineEarnings + " 🪙</b> verdient!"), 1200);
    }
    // Einmaliger Erklär-Toast: was die 🔥-Flamme im HUD bedeutet (auch ohne Maus sichtbar).
    if (!Game.state.streakHintShown) {
      setTimeout(() => UI.toast("🔥 <b>Tages-Streak:</b> Spiele täglich für bis zu <b>+50 % Dublonen</b> auf deine Belohnungen!"), 2600);
      Game.state.streakHintShown = true;
      Game.save();
    }

    // Spielstand regelmäßig sichern
    setInterval(() => Game.save(), 5000);

    // Boot-Markierung fürs Sicherheitsnetz in index.html (früher: window.Game)
    document.body.dataset.kqBooted = "1";

    // #301: Im Dev-Server unterdrückt das Vite-Plugin `kq-dev-no-full-reload`
    // den störenden Auto-Reload bei Code-Änderungen (sonst riss er mitten im
    // Spiel laufende Gespräche weg + blaues Flackern). Statt stillschweigend
    // nicht zu aktualisieren, sagen wir es dem Menschen am Schirm: ein Toast,
    // dass eine Code-Änderung vorliegt und ein bewusstes Neuladen sie holt.
    // `import.meta.hot` existiert nur im Dev-Build und wird im Prod-/Offline-
    // Build samt diesem Block weggestrippt – kein Gameplay-Einfluss.
    if (import.meta.hot) {
      import.meta.hot.on("kq:code-changed", () => {
        UI.toast("🔄 Code geändert – zum Übernehmen neu laden (F5). Spielstand &amp; laufendes Gespräch bleiben erhalten.");
      });
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
