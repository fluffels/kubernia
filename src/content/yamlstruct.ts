/* ===== Inhalte: Minispiel „YAML-Bausteine richtig verschachteln" (#568) =====
 * Übt Reihenfolge + Einrücktiefe von YAML-Manifesten als Bau-Puzzle. Die Ziel-
 * Manifeste sind KEINE eigene Kopie, sondern kommen aus der Manifest-Bibliothek
 * (#514, `manifest-lib.ts`) – derselben Quelle, die Ada in der Quest
 * "k8s-apply-manifests" bereits per `cat` zeigt. Reine Domäne (kein Phaser,
 * unit-testbar): Rundendaten + die Struktur-Prüf-Logik, die `src/ui/yamlstruct.ts`
 * für Sofort-Feedback nutzt.
 */
import { getManifest } from "./manifest-lib";

/** Eine YAML-Zeile ohne führende Leerzeichen + ihre Ziel-Tiefe (0 = Top-Level). */
export interface YamlLine {
  text: string;
  depth: number;
}

export interface YamlStructRound {
  name: string;
  /** Manifest-ID aus der Bibliothek (`manifest-lib.ts`) – EINE Quelle statt Kopie. */
  manifestId: string;
  /** HTML-Lektion, gezeigt nach geschaffter Runde. */
  tip: string;
}

/* Runden sind nach Verschachtelungstiefe AUFSTEIGEND sortiert (Vorbild #218
 * STACK_ROUNDS): erst ein flacher Pod, dann ein Deployment mit
 * `spec.template.spec.containers` – genau die Tiefe, die Ada in
 * "k8s-apply-manifests" schon zeigt (`deployment-lager`, dort per `cat` gelesen). */
export const YAML_STRUCT_ROUNDS: YamlStructRound[] = [
  {
    name: "Pod (flach)",
    manifestId: "pod-leuchtfeuer",
    tip: "Ein <b>Pod</b> ist flach: Unter <code>spec</code> liegen die <code>containers</code> direkt. Wenig Verschachtelung, leicht zu überblicken.",
  },
  {
    name: "Deployment (verschachtelt)",
    manifestId: "deployment-lager",
    tip: "Ein <b>Deployment</b> verpackt seinen Pod: <code>containers</code> liegt tief unter <code>spec.template.spec</code> – dem „Pod-Bauplan im Bauplan“. Genau diese Verschachtelung hat Ada dir schon gezeigt.",
  },
];

/** Sentinel: Spieler hat für eine Zeile <b>Tab</b> statt Leerzeichen gewählt. YAML
 *  verbietet Tabs zur Einrückung – das ist immer falsch, unabhängig von der Tiefe. */
export const TAB_INDENT = -1;

/** Zerlegt den Manifest-Text einer Runde in Zeilen + Ziel-Tiefe (zwei Leerzeichen =
 *  eine Ebene, wie in der Manifest-Bibliothek durchgängig geschrieben). Leerzeilen
 *  entfallen (keine eigene Bau-Aufgabe). */
export function yamlStructLines(manifestId: string): YamlLine[] {
  return getManifest(manifestId)
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ text: line.trim(), depth: (line.length - line.trimStart().length) / 2 }));
}

export interface YamlCheck {
  ok: boolean;
  reason?: string;
}

/** Prüft, ob `text` gerade die als Nächstes fällige Zeile ist (Reihenfolge) –
 *  unabhängig von der Tiefe, die erst danach separat gewählt wird. */
export function checkYamlOrder(target: YamlLine[], placed: number, text: string): YamlCheck {
  const expected = target[placed];
  if (!expected) return { ok: false, reason: "Das Manifest ist schon vollständig." };
  if (expected.text !== text) {
    return { ok: false, reason: `„${text}" ist noch nicht dran – als Nächstes fehlt „${expected.text}".` };
  }
  return { ok: true };
}

/** Prüft die gewählte Einrücktiefe für die (laut `checkYamlOrder` bereits
 *  richtige) nächste Zeile. */
export function checkYamlDepth(expectedDepth: number, depth: number): YamlCheck {
  if (depth === TAB_INDENT) {
    return { ok: false, reason: "YAML kennt nur <b>Leerzeichen</b> zur Einrückung – ein <b>Tab</b> hier würde vom Cluster mit einem Parse-Fehler abgewiesen." };
  }
  if (depth !== expectedDepth) {
    const dir = depth > expectedDepth ? "weiter außen (weniger eingerückt)" : "weiter innen (mehr eingerückt)";
    return { ok: false, reason: `Diese Zeile gehört ${dir} – Ebene ${expectedDepth} statt ${depth}.` };
  }
  return { ok: true };
}
