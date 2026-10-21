/** Reine Hilfen des Perf-Smokes (ohne Playwright, im Node-Test prüfbar). */

/** Median einer nicht leeren Liste (ungerade: der mittlere, gerade: der untere der beiden mittleren); die Eingabe bleibt unverändert. */
export function medianAus(werte: readonly number[]): number {
  if (werte.length === 0) throw new Error("medianAus: leere Liste");
  const sortiert = [...werte].sort((a, b) => a - b);
  return sortiert[Math.floor((sortiert.length - 1) / 2)];
}

export interface FpsProbe {
  fps: number;
  frames: number;
}

/**
 * Median der Proben, die noch in Phasers Anlauf (`panicMax`, höchstens `anlaufFrames` Frames) liegen; `null`, wenn keine
 * Probe dort liegt. Dann misst der Sampler schon den echten Wert des Runners, den der eingeschwungene Boden prüft.
 */
export function anlaufMedian(proben: readonly FpsProbe[], anlaufFrames: number): number | null {
  const imAnlauf = proben.filter((p) => p.frames <= anlaufFrames).map((p) => p.fps);
  return imAnlauf.length === 0 ? null : medianAus(imAnlauf);
}
