/* ===== Inhalte: Minispiel & Sturm-Helfer =====
 * Stapel-Spiel (Docker-Image-Schichten in die richtige Reihenfolge bringen)
 * und ein kleiner Helfer, der Image-Namen für Sturm-Events verfälscht.
 */

/* ---------- Stapel-Spiel: Docker-Image-Schichten ---------- */
/* Runden sind nach Schichtzahl AUFSTEIGEND sortiert (#218): erst wenige Schichten
 * (Anfänger nicht überfordern), dann mehr. Jede Runde trägt einen eigenen
 * `cacheTip` – eine konkrete Cache-/Build-Lektion an genau diesem Beispiel, die
 * nach geschaffter Runde gezeigt wird, damit „Cache" und „Build" nicht nur im
 * Merksatz fallen, sondern durch Wiederholung wirklich sitzen. */
export const STACK_ROUNDS = [
  {
    name: "Statische Webseite",
    layers: ["FROM nginx (Basis: fertiger Webserver)", "COPY index.html (deine Webseite)", "EXPOSE 80 (Port freigeben)"],
    cacheTip: "Ein <b>Build</b> ist das Zusammenbauen des Images Schicht für Schicht nach dem Bauplan. Die Basis <code>nginx</code> ändert sich praktisch nie – Docker holt sie aus dem <b>Cache</b> (dem Lager schon gebauter Schichten), statt sie neu zu laden. Nur deine <code>index.html</code> wird wirklich frisch kopiert.",
  },
  {
    name: "Webserver-Image",
    layers: ["FROM ubuntu (Basis-Betriebssystem)", "RUN apt install nginx (Software installieren)", "COPY index.html (deine Dateien)", "CMD nginx (Startbefehl)"],
    cacheTip: "<code>apt install nginx</code> dauert lange. Weil es unter der selten geänderten Basis liegt, bleibt es im <b>Cache</b>: Ein <b>Build</b> nach einer reinen <code>index.html</code>-Änderung überspringt die Installation komplett – nur die oberste, geänderte Schicht wird neu gebaut.",
  },
  {
    name: "Java-Dienst",
    layers: ["FROM eclipse-temurin (Basis mit Java)", "COPY build/libs/app.jar (das fertige Programm)", "EXPOSE 8080 (Port freigeben)", "CMD java -jar app.jar (Startbefehl)"],
    cacheTip: "Die Java-Basis liegt unten und bleibt im <b>Cache</b>; nur die neue <code>app.jar</code> oben muss beim nächsten <b>Build</b> wieder rein. Genau dafür steht das Veränderliche (dein Programm) oben und das Stabile (die Basis) unten.",
  },
  {
    name: "Python-App",
    layers: ["FROM python:3.12 (Basis mit Python)", "COPY requirements.txt (Abhängigkeiten-Liste)", "RUN pip install (Bibliotheken installieren)", "COPY app.py (dein Code)", "CMD python app.py (Startbefehl)"],
    cacheTip: "Profi-Trick: erst <code>requirements.txt</code> kopieren, dann <code>pip install</code>, DANN den Code. So bleibt das langsame <code>pip install</code> im <b>Cache</b>, solange sich die Abhängigkeiten nicht ändern – obwohl du deinen <code>app.py</code>-Code ständig anpasst. Das macht den <b>Build</b> bei jeder Code-Änderung blitzschnell.",
  },
  {
    name: "Node.js-App",
    layers: ["FROM node:20 (Basis mit Node.js)", "COPY package.json (Abhängigkeiten-Liste)", "RUN npm install (Pakete installieren)", "COPY src/ (dein Code)", "EXPOSE 3000 (Port freigeben)", "CMD node server.js (Startbefehl)"],
    cacheTip: "Gleiches Muster wie bei Python: <code>package.json</code> + <code>npm install</code> zuerst (bleiben im <b>Cache</b>), dein <code>src/</code>-Code zuletzt. Eine Code-Änderung = schneller <b>Build</b>, weil <code>npm install</code> nicht erneut laufen muss. Falsche Reihenfolge = jeder Build installiert alles neu.",
  },
];

/** Buchstabendreher für Sturm-Events: macht aus jedem Image-Namen garantiert einen anderen. */
export function corruptImage(img: string) {
  for (let i = 1; i < img.length - 1; i++) {
    if (img[i] !== img[i + 1]) return img.slice(0, i) + img[i + 1] + img[i] + img.slice(i + 2);
  }
  return img + "x";
}
