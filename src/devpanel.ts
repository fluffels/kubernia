/* ===== KubeQuest – Dev-/Test-Panel (#325) =====
 * Komfortschicht über die #329-Jump-API: ein klickbares (Maus ODER Tastatur)
 * Panel, mit dem man zu einem beliebigen Quest-/Story-Stand springen und
 * Erststart vs. Zurücksetzen gezielt herstellen kann – statt sich jedes Mal von
 * vorn durchzuspielen.
 *
 * GATING (zwei Bausteine, siehe Issue #325):
 *  1. DEV/Mode-Stripping: `mountDevPanel()` wird AUSSCHLIESSLICH aus dem
 *     `import.meta.env.DEV`-Block in main.ts dynamisch importiert. Im Prod-/
 *     Offline-Build (`import.meta.env.DEV === false`) fällt dieser Aufruf samt
 *     dynamischem Import weg – das ganze Modul (Panel-Markup, Passwort-Logik,
 *     Strings) ist im ausgelieferten Bundle nicht enthalten.
 *  2. Weiches Env-Passwort: Der Einstieg per Taste (F9) verlangt ein Passwort,
 *     verglichen gegen `import.meta.env.VITE_KQ_DEVPANEL_PW`. Der WERT liegt nur
 *     in einer gitignored `.env` (nie im Repo). Ohne gesetztes Passwort bleibt
 *     das Panel gesperrt – wer das öffentliche Repo klont, kommt nicht rein.
 *
 * Schichtung wie im Rest des Projekts: die pure, unit-testbare Logik
 * (Passwort-Prüfung, Roadmap→Anzeige-Mapping) steht oben und ist Phaser-/DOM-
 * frei; `mountDevPanel()` ist die dünne DOM-Anbindung. Die Tastatur-Navigation
 * über die Zeilen nutzt das bestehende `resolveOverlayKey` (overlaykbd.ts).
 */
import { Game } from "./game";
import { SaveStore } from "./store";
import { resolveOverlayKey } from "./hud/overlaykbd";

/* ---------- Pure Logik (Phaser-/DOM-frei, unit-getestet) ---------- */

/** Ein Eintrag der aus dem Content abgeleiteten Quest-Roadmap (Form von
 *  {@link Game.getQuestRoadmap}). Hier eigenständig getypt, damit die pure
 *  Logik unabhängig vom Spielstand testbar bleibt. */
export interface QuestRoadmapEntry {
  idx: number;
  id: string;
  title: string;
  giver: string;
  giverName: string;
  steps: number;
  completed: boolean;
}

/** Eine fertige Anzeige-Zeile des Panels. */
export interface DevPanelRow {
  /** Quest-Index = Sprungziel für `Game.jumpToQuest(idx)`. */
  idx: number;
  /** Vorgefertigtes Label „idx · Titel · Giver". */
  label: string;
  /** Ist diese Quest laut Spielstand schon abgeschlossen? */
  completed: boolean;
  /** Ist das die aktuell laufende Quest (questIdx)? */
  current: boolean;
}

/**
 * Prüft das eingegebene Dev-Panel-Passwort gegen den erwarteten Wert (aus
 * `import.meta.env.VITE_KQ_DEVPANEL_PW`).
 *
 * Die „weiche Sperre" gegen versehentliches Reinrutschen – KEIN Krypto-Schutz
 * (bei einem Client-Spiel ist das auch gar nicht möglich, siehe #325). Bewusst:
 * - Ist KEIN Passwort konfiguriert (`undefined`/leer), gibt es kein gültiges
 *   Passwort → immer `false`. So bleibt das Panel für jeden gesperrt, der das
 *   Repo klont, ohne sich selbst eine `.env` mit dem Wert anzulegen.
 * - Exakter, case-sensitiver Vergleich (kein Trim) – ein Passwort eben.
 */
export function checkDevPanelPassword(input: string, expected: string | undefined): boolean {
  if (!expected) return false; // kein/leeres Passwort konfiguriert → gesperrt
  return input === expected;
}

/** Ist überhaupt ein (nicht-leeres) Passwort konfiguriert? Nur dann ist das
 *  Panel benutzbar – sonst ein klarer Hinweis statt einer nutzlosen Abfrage. */
export function isDevPanelConfigured(expected: string | undefined): boolean {
  return !!expected;
}

/* ---------- Laufzeit-Konfiguration (#334) ---------- */

/**
 * Laufzeit-Konfiguration, die ein Serve-Container VOR dem Spiel-Bundle in die
 * Seite injiziert (`window.__KQ_CONFIG__`). Damit kann EIN Dev-Panel-Image mit
 * verschiedenen Passwörtern laufen (`docker run -e VITE_KQ_DEVPANEL_PW=…`), ohne
 * neu zu bauen (#334) – bei einer statischen SPA wird `import.meta.env.*` sonst
 * fest zur BUILD-Zeit eingebacken (#331) und ließe sich zur Laufzeit nicht mehr
 * ändern.
 */
export interface KqRuntimeConfig {
  /**
   * Base64-kodiertes Dev-Panel-Passwort (UTF-8). Bewusst Base64, damit der
   * Container-Entrypoint ein beliebiges Passwort ohne HTML-/JS-Escaping-Fallen in
   * die Seite schreiben kann: kein `</script>`-Ausbruch, kein Anführungszeichen-
   * Bruch, sed-sicher (Base64 = `A–Z a–z 0–9 + / =`).
   */
  devPanelPwB64?: string;
}

/**
 * Dekodiert einen Base64-String (UTF-8) wieder zu Klartext. Leerer/fehlender
 * Input ⇒ `undefined`. Kaputtes Base64 ⇒ `undefined` (bewusst nie werfen – ein
 * fehlerhaft injiziertes Config-Snippet soll das Panel nur gesperrt lassen, nicht
 * den Boot stören). UTF-8-fest über `TextDecoder`, damit auch Umlaute im Passwort
 * korrekt ankommen (atob allein liefert Latin-1).
 */
export function decodeBase64Utf8(b64: string | undefined): string | undefined {
  if (!b64) return undefined;
  try {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Bestimmt das wirksame Dev-Panel-Passwort. Die zur LAUFZEIT injizierte Config
 * (#334, Docker) hat Vorrang vor dem zur BUILD-Zeit eingebackenen Wert (#331);
 * ein leerer/fehlender Laufzeitwert fällt auf den Build-Wert zurück. So
 * funktionieren beide Distributionswege nebeneinander (Abgrenzung im Ticket).
 */
export function resolveDevPanelPassword(
  runtimePw: string | undefined,
  buildTimePw: string | undefined,
): string | undefined {
  return runtimePw || buildTimePw;
}

/**
 * Liest das zur Laufzeit injizierte Passwort aus `window.__KQ_CONFIG__` (#334)
 * und dekodiert es. Kapselt den `window`-Zugriff, damit die Vorrang-Logik
 * (`resolveDevPanelPassword`) und die Dekodierung (`decodeBase64Utf8`) je für
 * sich pur und unit-testbar bleiben.
 */
function readRuntimeDevPanelPassword(): string | undefined {
  const cfg = (window as unknown as { __KQ_CONFIG__?: KqRuntimeConfig }).__KQ_CONFIG__;
  return decodeBase64Utf8(cfg?.devPanelPwB64);
}

/**
 * Wandelt die Quest-Roadmap in Anzeige-Zeilen: ein vorgefertigtes Label plus die
 * Marker `completed` (aus dem Spielstand) und `current` (= laufende Quest).
 * `currentIdx` jenseits der Liste (Endzustand, alles durch) ⇒ keine current-Zeile.
 */
export function roadmapToRows(roadmap: QuestRoadmapEntry[], currentIdx: number): DevPanelRow[] {
  return roadmap.map(q => ({
    idx: q.idx,
    label: `${q.idx} · ${q.title} · ${q.giverName}`,
    completed: q.completed,
    current: q.idx === currentIdx,
  }));
}

/* ---------- DOM-Anbindung (NUR unter import.meta.env.DEV aufgerufen) ---------- */

/** Minimaler HTML-Escape für die ins Panel gerenderten Quest-Titel. */
function esc(s: unknown): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Hängt das Dev-Panel in die laufende Seite ein: baut das Overlay dynamisch
 * (kein Markup in index.html → auch dort keine Spur im Prod-Build), verdrahtet
 * Öffnen-Keybind (F9, mit Passwortabfrage), Maus-Klicks und Tastatur-Navigation
 * und stellt `window.kqDev.panel()` zum Öffnen aus der Konsole bereit.
 *
 * Wird ausschließlich aus dem `import.meta.env.DEV`-Block in main.ts dynamisch
 * importiert – im Prod-/Offline-Build existiert dieser Aufruf nicht.
 */
export function mountDevPanel(): void {
  // Laufzeit-Injektion (#334, Docker) vor Build-Zeit-Wert (#331); siehe
  // resolveDevPanelPassword. So gilt EIN Image, viele Passwörter, ohne Rebuild –
  // mit dem eingebackenen Wert als Fallback.
  const expected = resolveDevPanelPassword(
    readRuntimeDevPanelPassword(),
    import.meta.env.VITE_KQ_DEVPANEL_PW,
  );

  // Eigene, minimale Styles (bleiben im Dev-Chunk – kein Dev-CSS im Prod-Stylesheet).
  const style = document.createElement("style");
  style.textContent = `
    #overlay-devpanel .devpanel-list { display:flex; flex-direction:column; gap:4px; margin:8px 0; }
    #overlay-devpanel .devpanel-row { text-align:left; width:100%; padding:6px 10px; }
    #overlay-devpanel .devpanel-row.current { outline:2px solid #f0c020; }
    #overlay-devpanel .devpanel-row.sel { background:rgba(240,192,32,.25); }
    #overlay-devpanel .devpanel-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }`;
  document.head.appendChild(style);

  // Overlay-Grundgerüst (nutzt die generischen Panel-Klassen aus style.css).
  const overlay = document.createElement("div");
  overlay.id = "overlay-devpanel";
  overlay.className = "panel hidden";
  overlay.innerHTML =
    '<div class="panel-head">🛠️ Dev-/Test-Panel' +
    '<button class="close-btn" data-dev="close">✕ (Esc)</button></div>' +
    '<div class="panel-body"><div id="devpanel-body"></div></div>';
  document.body.appendChild(overlay);
  const body = overlay.querySelector("#devpanel-body") as HTMLElement;

  let open = false;
  let unlocked = false; // einmal korrektes Passwort = für diese Sitzung frei (kein Nerven)

  function render(): void {
    const rows = roadmapToRows(Game.getQuestRoadmap(), Game.state.questIdx);
    let html =
      '<p class="dim">Springe an den <b>Anfang einer Quest</b> (Stand + Cluster + Spawn werden gesetzt). ' +
      "↑/↓ wählen, Enter springt – oder klicken.</p>" +
      '<div class="devpanel-list">';
    for (const r of rows) {
      const mark = r.completed ? "✅" : r.current ? "▶️" : "▫️";
      html +=
        `<button class="devpanel-row${r.current ? " current" : ""}" data-dev="jump" data-idx="${r.idx}">` +
        `${mark} ${esc(r.label)}</button>`;
    }
    // Endzustand (alles durch): jumpToQuest akzeptiert idx === Anzahl Quests.
    html +=
      `<button class="devpanel-row" data-dev="jump" data-idx="${rows.length}">🏁 ${rows.length} · Endzustand (alles durch)</button>` +
      "</div>" +
      '<div class="devpanel-actions">' +
      '<button data-dev="fresh">🌱 Neustart (echter Erststart)</button>' +
      '<button class="danger" data-dev="reset">♻️ Zurücksetzen</button>' +
      "</div>" +
      '<div class="dim" style="margin-top:8px">„Neustart“ löscht den Save und lädt wie ein frischer Erststart (mit Intro). ' +
      "„Zurücksetzen“ geht über den bestehenden Reset-Pfad – genau der Unterschied aus #295/#296.</div>";
    body.innerHTML = html;
  }

  function show(): void {
    if (open) return;
    if (!unlocked) {
      if (!isDevPanelConfigured(expected)) {
        window.alert(
          "🛠️ Dev-Panel gesperrt: kein Passwort gesetzt.\n\nLege eine gitignored .env mit VITE_KQ_DEVPANEL_PW=<deinWert> an (siehe .env.example) und starte den Dev-Server neu.",
        );
        return;
      }
      const input = window.prompt("🛠️ Dev-Panel – Passwort:");
      if (input === null) return; // abgebrochen
      if (!checkDevPanelPassword(input, expected)) {
        window.alert("Falsches Passwort.");
        return;
      }
      unlocked = true;
    }
    render();
    overlay.classList.remove("hidden");
    open = true;
  }

  function hide(): void {
    overlay.classList.add("hidden");
    open = false;
  }

  // Maus: ein delegierter Listener am Overlay (eigenes data-dev, getrennt von der
  // data-action-Delegation in ui.ts – kein Eingriff dort nötig).
  overlay.addEventListener("click", ev => {
    const el = (ev.target as HTMLElement).closest("[data-dev]") as HTMLElement | null;
    if (!el) return;
    const action = el.dataset.dev;
    if (action === "close") {
      hide();
    } else if (action === "jump") {
      const idx = Number(el.dataset.idx);
      // jumpToQuest setzt Stand/Cluster/Spawn; der Reload wendet ihn an (wie kqDev.jump).
      if (Game.jumpToQuest(idx)) location.reload();
      else window.alert(`Ungültiges Sprungziel: ${idx}`);
    } else if (action === "fresh") {
      // Echter Erststart: Save löschen → frischer Default inkl. Intro.
      SaveStore.remove();
      location.reload();
    } else if (action === "reset") {
      // Bestehender Reset-Pfad (wie Menü → Zurücksetzen).
      Game.reset();
      location.reload();
    }
  });

  // Tastatur in der Capture-Phase: solange das Panel offen ist, gehören die Tasten
  // uns (sonst liefe die Spielfigur hinter dem Modal weiter, weil der globale
  // Handler in main.ts das Panel nicht kennt). F9 öffnet/schließt; ↑/↓ + Enter
  // navigieren über `resolveOverlayKey` (overlaykbd.ts); alles andere wird
  // geschluckt, damit nichts ins Spiel durchsickert.
  window.addEventListener(
    "keydown",
    ev => {
      const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      if (!open) {
        if (k === "F9") {
          ev.preventDefault();
          show();
        }
        return; // Panel zu: alle anderen Tasten gehören dem Spiel
      }
      // Panel offen → Tasten abfangen
      ev.preventDefault();
      ev.stopImmediatePropagation();
      if (k === "Escape" || k === "F9") {
        hide();
        return;
      }
      const btns = Array.from(overlay.querySelectorAll("button")) as HTMLButtonElement[];
      if (!btns.length) return;
      const current = btns.findIndex(b => b.classList.contains("sel"));
      const res = resolveOverlayKey(
        btns.map(b => ({ disabled: b.disabled, primary: b.classList.contains("primary") })),
        current,
        k,
      );
      if (!res) return; // irrelevante Taste – schon geschluckt
      if (res.kind === "nav") {
        btns.forEach((b, i) => b.classList.toggle("sel", i === res.sel));
        btns[res.sel].focus();
      } else {
        btns[res.index].click();
      }
    },
    true, // capture
  );

  // Konsolen-Affordance: aus der DevTools heraus ohne Passwort öffnen (wer die
  // Konsole hat, hat ohnehin vollen Zugriff – das Passwort gated nur den Tasten-
  // Einstieg gegen versehentliches Reinrutschen).
  const dev = window as unknown as { kqDev?: Record<string, unknown> };
  if (dev.kqDev) {
    dev.kqDev.panel = () => {
      unlocked = true;
      show();
    };
  }
  console.info("🛠️ Dev-Panel bereit: Taste F9 (Passwort) · kqDev.panel() (Konsole, ohne Passwort)");
}
