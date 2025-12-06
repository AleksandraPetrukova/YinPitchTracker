// core/dsp/filters.ts
// High-pass and Low-pass Biquad filters

import type { DSPConfig } from "./dsp-config.js";

/**
 * Base Biquad Filter Class
 */
class BiquadFilter {
  private a0 = 1;
  private a1 = 0;
  private a2 = 0;
  private b1 = 0;
  private b2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(a0: number, a1: number, a2: number, b1: number, b2: number) {
    this.a0 = a0;
    this.a1 = a1;
    this.a2 = a2;
    this.b1 = b1;
    this.b2 = b2;
  }

  processFrame(frame: Float32Array): Float32Array {
    const out = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      const input = frame[i];
      const output = input * this.a0 + this.z1;
      this.z1 = input * this.a1 + this.z2 - this.b1 * output;
      this.z2 = input * this.a2 - this.b2 * output;
      out[i] = output;
    }
    return out;
  }
}

/**
 * Create High-Pass Filter
 */
export function createHighPassFilter(
  cutoff: number,
  sampleRate: number,
  Q: number = 0.707
): BiquadFilter {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);

  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  return new BiquadFilter(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/**
 * Create Low-Pass Filter
 */
export function createLowPassFilter(
  cutoff: number,
  sampleRate: number,
  Q: number = 0.707
): BiquadFilter {
  const w0 = (2 * Math.PI * cutoff) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Q);

  const b0 = (1 - cos) / 2;
  const b1 = 1 - cos;
  const b2 = (1 - cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;

  return new BiquadFilter(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
}

/**
 * Apply both filters based on config
 */
export function applyFilters(
  frame: Float32Array,
  sampleRate: number,
  config: DSPConfig
): Float32Array {
  let processed = frame;

  if (config.highPassCutoff > 0) {
    const hp = createHighPassFilter(
      config.highPassCutoff,
      sampleRate,
      config.highPassQ ?? 0.707
    );
    processed = hp.processFrame(processed);
  }

  if (config.lowPassCutoff > 0) {
    const lp = createLowPassFilter(
      config.lowPassCutoff,
      sampleRate,
      config.lowPassQ ?? 0.707
    );
    processed = lp.processFrame(processed);
  }

  return processed;
}
