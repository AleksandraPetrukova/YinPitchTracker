// core/dsp/dsp-config.ts
// DSP configuration used across filters, noise gate, smoothing, etc.

export interface DSPConfig {
  // Filtering
  highPassCutoff: number; // Hz
  lowPassCutoff: number; // Hz (set to 0 to disable)
  highPassQ?: number; // Q factor for HPF (Butterworth default ~0.707)
  lowPassQ?: number; // Q factor for LPF

  // Noise control
  noiseGateThreshold: number; // RMS threshold [0–1]
  enableNoiseGate: boolean;

  // Normalization
  enableNormalization: boolean;
  normalizationTargetRMS: number; // e.g. normalize to -12 dB ≈ 0.25 RMS

  // Smoothing
  enableMedianSmoothing: boolean;
  medianWindowSize: number;
  enableMovingAverage: boolean;
  movingAverageAlpha: number; // [0–1] lower = smoother

  // Frame settings
  frameSize: number; // Must be power of 2 for YIN (e.g. 1024, 2048, 4096)
}
// Embedded defaults used when no external JSON is available
const EMBEDDED_DEFAULTS: DSPConfig = {
  highPassCutoff: 50, // Remove rumble
  lowPassCutoff: 0, // No LPF by default
  highPassQ: 0.707,
  lowPassQ: 0.707,
  noiseGateThreshold: 0.02, // Ignore frames with very low signal
  enableNoiseGate: true,

  enableNormalization: true,
  normalizationTargetRMS: 0.25,

  enableMedianSmoothing: true,
  medianWindowSize: 5,

  enableMovingAverage: true,
  movingAverageAlpha: 0.35,

  frameSize: 2048,
};

/**
 * Load `dsp-config.json` from project root when running under Node.js.
 * If not found or on non-Node environments (browser), fall back to embedded defaults.
 * The JSON is shallow-merged over the embedded defaults so missing fields keep safe values.
 */
export const defaultDSPConfig: DSPConfig = (() => {
  try {
    // Detect Node.js runtime via globalThis to avoid referencing 'process' directly
    const g: any = globalThis as any;
    if (g && g.process && g.process.versions && g.process.versions.node) {
      // Obtain require in a way that avoids TypeScript compile-time errors
      let fs: any;
      let path: any;
      try {
        if (typeof g.require === "function") {
          fs = g.require("fs");
          path = g.require("path");
        } else if (typeof eval === "function") {
          // eslint-disable-next-line no-eval
          const req: any = eval("require");
          fs = req("fs");
          path = req("path");
        }
      } catch (err) {
        // If we can't obtain require, fall back to embedded defaults
        return EMBEDDED_DEFAULTS;
      }

      const filePath = path.resolve(g.process.cwd(), "dsp-config.json");
      if (fs && fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        // Shallow merge: values in JSON override embedded defaults
        return { ...EMBEDDED_DEFAULTS, ...parsed } as DSPConfig;
      }
    }
  } catch (e) {
    // Ignore errors and fall back to embedded defaults
  }
  return EMBEDDED_DEFAULTS;
})();
