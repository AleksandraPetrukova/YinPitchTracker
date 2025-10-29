// core/pitch-engine.ts
// Main pitch engine: DSP preprocessing → YIN → musical readout (Hz, note, cents, confidence)

import { Yin } from "./yin.js";
import { frequencyToNote, parseExpectedNote, centsOffFromReference } from "./note-utils.js";
import { defaultDSPConfig } from "./dsp/dsp-config.js";
import type { DSPConfig } from "./dsp/dsp-config.js";
import { applyFilters } from "./dsp/filters.js";
import { applyNoiseControl } from "./dsp/noise.js";
import { calculateRMS } from "./dsp/rms.js";
import { MedianSmoother, MovingAverage } from "./dsp/smoothing.js";

export interface ProcessOptions {
  /** Optional expected note: "C4", "Bb3" or a numeric Hz string/number like "440" or 430 */
  expectedNote?: string | number;
  /** Override DSP config (advanced mode). Omit to use defaults. */
  advancedConfig?: Partial<DSPConfig>;
  /** Enable/disable pitch smoothing on this call (default true). */
  smoothing?: boolean;
}

export interface PitchResult {
  /** Detected fundamental frequency in Hz (null if none) */
  frequency: number | null;
  /** Best-effort note name for detected frequency (e.g., "C#4"), if frequency present */
  note?: string;
  /** YIN probability 0–1 (confidence). We NEVER hide low-confidence frames. */
  confidence: number;
  /** Frame RMS (post-filters, pre-normalization gate) for visibility */
  frameRMS: number;
  /** If the user provided an expectation, we echo it back in normalized form */
  expectedNote?: string;        // e.g., "C4" or "440 Hz"
  /** Human-friendly deviation text if expectation given, e.g., "+5.2 cents sharp" */
  deviation?: string;
}

/**
 * PitchEngine
 * - Runs optional DSP (HPF/LPF + normalization + soft gate)
 * - Applies YIN to detect F0
 * - Optionally smooths detected pitch (median + EMA)
 * - Converts to note + cents deviation if an expected note was given
 */
export class PitchEngine {
  private readonly sampleRate: number;
  private dspConfig: DSPConfig;
  private yin: Yin;
  private median: MedianSmoother;
  private ema: MovingAverage;

  constructor(sampleRate: number, config: Partial<DSPConfig> = {}) {
    this.sampleRate = sampleRate;
    this.dspConfig = { ...defaultDSPConfig, ...config };
    this.yin = new Yin({ sampleRate: this.sampleRate, threshold: 0.10 });
    // Smoothers for detected frequency, not samples
    this.median = new MedianSmoother(this.dspConfig.medianWindowSize);
    this.ema = new MovingAverage(this.dspConfig.movingAverageAlpha);
  }

  /**
   * Process one mono audio frame
   */
  processFrame(frame: Float32Array, opts: ProcessOptions = {}): PitchResult {
    const cfg = { ...this.dspConfig, ...(opts.advancedConfig ?? {}) };

    // 1) Filters (HPF/LPF), then RMS (for visibility), then normalization + soft gate
    let processed = frame;
    processed = applyFilters(processed, this.sampleRate, cfg);

    // Measure RMS after filters (more meaningful)
    const frameRMS = calculateRMS(processed);

    processed = applyNoiseControl(processed, cfg);

    // 2) YIN pitch detection on processed frame
    const { pitch, probability } = this.yin.detectPitch(processed);

    // 3) Optional smoothing on detected pitch (not applied to confidence)
    let smoothedPitch = pitch;
    const doSmooth = opts.smoothing ?? true;
    if (doSmooth && pitch && isFinite(pitch)) {
      const m = this.median.push(pitch);
      smoothedPitch = this.ema.push(m);
    }

    // 4) Build base result
    let result: PitchResult = {
      frequency: smoothedPitch ?? null,
      confidence: probability ?? 0,
      frameRMS
    };

    // 5) Attach detected musical note (from detected frequency), if any
    if (result.frequency && result.frequency > 0) {
      const { note } = frequencyToNote(result.frequency);
      result.note = note;
    }

    // 6) If user provided an expected note, compute human-friendly cents deviation
    if (opts.expectedNote !== undefined && opts.expectedNote !== null) {
      const expectedHz = this.normalizeExpected(opts.expectedNote);
      if (expectedHz && result.frequency && result.frequency > 0) {
        const cents = centsOffFromReference(result.frequency, expectedHz);
        result.expectedNote = this.describeExpected(opts.expectedNote, expectedHz);
        result.deviation = this.formatDeviation(cents);
      } else {
        // User sent something we couldn't parse; still echo intent
        result.expectedNote = typeof opts.expectedNote === "number"
          ? `${opts.expectedNote.toFixed(2)} Hz`
          : String(opts.expectedNote);
      }
    }

    return result;
  }

  /**
   * Normalize expected note input into Hz
   * Accepts: "C4", "Bb3", "440", 430, etc.
   */
  private normalizeExpected(input: string | number): number | null {
    if (typeof input === "number") return input > 0 ? input : null;
    const parsed = parseExpectedNote(input);
    return parsed && parsed > 0 ? parsed : null;
  }

  /**
   * Human description of expected: prefer musical note if given as note,
   * otherwise show Hz form.
   */
  private describeExpected(input: string | number, hz: number): string {
    if (typeof input === "string" && /[A-Ga-g]/.test(input)) {
      // Keep user's musical notation (C4, Bb3)
      return input.trim();
    }
    return `${hz.toFixed(2)} Hz`;
  }

  /**
   * Format cents deviation like "+5.2 cents sharp" / "-12.1 cents flat"
   */
  private formatDeviation(cents: number): string {
    const sign = cents >= 0 ? "+" : "";
    const mag = Math.abs(cents).toFixed(1);
    const dir = cents >= 0 ? "sharp" : "flat";
    return `${sign}${mag} cents ${dir}`;
  }

  /**
   * Replace DSP defaults at runtime (Advanced Mode)
   */
  updateConfig(config: Partial<DSPConfig>) {
    this.dspConfig = { ...this.dspConfig, ...config };
    // keep smoother parameters in sync if provided
    if (config.medianWindowSize) this.median = new MedianSmoother(config.medianWindowSize);
    if (config.movingAverageAlpha) this.ema = new MovingAverage(config.movingAverageAlpha);
  }
}
