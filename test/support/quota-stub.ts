/* Test-Harness: localStorage-Stub, dessen Init-Probe durchläuft, aber jeder
 * ECHTE Schreibvorgang scheitert – simuliert ein zur Laufzeit volles Kontingent
 * (QuotaExceeded). Nur für die Persistenz-Schreibsicherheitstests (store.test.ts). */
import type { LocalStorageStub } from "./browser-env";

export function makeQuotaStub(): LocalStorageStub {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (k === "__kubernia_probe__") { map.set(k, String(v)); return; } // Init-Probe darf durch
      throw new Error("QuotaExceededError"); // echte Saves scheitern zur Laufzeit
    },
    removeItem: (k: string) => { map.delete(k); },
    _map: map,
  };
}
