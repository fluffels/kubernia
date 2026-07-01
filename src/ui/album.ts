import { Game } from "../game";
import { KQContent } from "../content";
import { buildAlbum, albumUnlocked, type Album } from "../album";
import { fmtCmd } from "../markup";
import { part, $, esc } from "./shared";

/* ========== Sammelalbum / Glossar (#278) ==========
 * Ein Nachschlage- & Sammel-Bereich (Sticker-Album): alle eingeführten Befehle
 * und alles Wissen, gruppiert nach Thema als Album-Seiten. Einträge starten
 * „verdeckt" und werden freigeschaltet, sobald man sie im Spiel gelernt hat –
 * mit Fortschrittsanzeige „X von Y gesammelt". Die reine Logik (welche Einträge,
 * welches Thema, freigeschaltet?) liegt in album.ts; hier nur die DOM-Anbindung.
 * Freigeschaltet wie das Logbuch nach Quest 1. */
export const albumUI = part({
  /** Album aus den Content-Daten + bestehendem Spielstand bauen (kein neues Save-Feld):
   *  abgeschlossene Quests + SR-Pool sind die „gesammelt?"-Quellen. */
  buildAlbum(): Album {
    return buildAlbum(KQContent.QUESTS, KQContent.QUEST_TOPICS, KQContent.CRAB_QUIZ, {
      completedQuests: new Set(Game.state.completedQuests),
      reviewIds: new Set(Object.keys(Game.state.review)),
    });
  },

  openAlbum() {
    this.closeOverlays();
    $("overlay-album").classList.remove("hidden");
    this.albumViewTopic = null; // immer auf der Übersicht starten
    this.renderAlbum();
  },

  /** Auf eine Album-Seite (Thema) wechseln. */
  viewAlbumPage(topicId: string) {
    this.albumViewTopic = topicId;
    this.renderAlbum();
  },

  /** Zurück von einer Seite auf die Übersicht. */
  albumBack() {
    this.albumViewTopic = null;
    this.renderAlbum();
  },

  renderAlbum() {
    // Vor Quest 1: nichts zu sammeln – freundlicher Hinweis statt leerer Seiten.
    if (!albumUnlocked(Game.state.completedQuests.length)) {
      $("album-body").innerHTML = `<div class="album-empty">
        <div style="font-size:3em">📖</div>
        <p>Hier sammelst du alles, was du lernst: jeden <b>Befehl</b> und jedes <b>Wissens-Stück</b>.
        Schließe deine erste Quest ab, dann klebt der erste Sticker hier ins Album! 🦀</p></div>`;
      return;
    }

    const album: Album = this.buildAlbum();

    // ----- Seitenansicht: ein Thema mit seinen Einträgen -----
    if (this.albumViewTopic !== null) {
      const page = album.pages.find(p => p.id === this.albumViewTopic);
      if (page) {
        const entries = page.entries.map(e => {
          if (!e.unlocked) {
            return `<div class="album-entry locked"><div class="album-entry-head">🔒 <span class="dim">??? – noch nicht entdeckt</span></div></div>`;
          }
          const icon = e.kind === "command" ? "⌨️" : "💡";
          const example = e.kind === "command" && e.example
            ? `<div class="album-example">Beispiel: <code>${esc(e.example)}</code></div>` : "";
          return `<div class="album-entry"><div class="album-entry-head">${icon} ${e.kind === "command" ? `<code>${esc(e.title)}</code>` : `<b>${e.title}</b>`}</div>
            <div class="album-detail">${fmtCmd(e.detail)}</div>${example}
            <div class="album-where dim">📜 gelernt in: ${esc(e.questTitle)}</div></div>`;
        }).join("");
        $("album-body").innerHTML = `<div class="actions" style="margin-bottom:10px">
            <button class="primary" data-action="albumBack">← Übersicht</button>
          </div>
          <div class="ql-title">${esc(page.label)}</div>
          <div class="album-pageprog dim">${page.collected} von ${page.total} gesammelt</div>
          <div class="album-entries">${entries}</div>`;
        return;
      }
      this.albumViewTopic = null; // unbekanntes Thema → zurück auf die Übersicht
    }

    // ----- Übersicht: alle Album-Seiten mit Sammel-Fortschritt -----
    const pct = album.total > 0 ? Math.round((album.collected / album.total) * 100) : 0;
    let html = `<div class="album-total">📖 <b>${album.collected} von ${album.total}</b> gesammelt (${pct} %)
      <div class="album-bar"><div class="album-bar-fill" style="width:${pct}%"></div></div></div>`;
    html += `<div class="ql-list">`;
    for (const page of album.pages) {
      const done = page.collected === page.total;
      html += `<button class="ql-row album-row${done ? " done" : ""}" data-action="viewAlbumPage" data-arg="${esc(page.id)}">
        <span class="album-row-label">${done ? "🏅" : "📄"} ${esc(page.label)}</span>
        <span class="album-row-prog">${page.collected}/${page.total}</span></button>`;
    }
    html += `</div>`;
    $("album-body").innerHTML = html;
  },

});
