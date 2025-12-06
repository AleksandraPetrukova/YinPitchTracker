// core/dsp/noise.ts
// Noise suppression and normalization utilities

import { calculateRMS } from "./rms.js";
import type { DSPConfig } from "./dsp-config.js";
import { defaultDSPConfig } from "./dsp-config.js";

/**
 * Normalize audio frame RMS to a target level
 * Helps keep consistent amplitude for pitch detection
 */
export function normalizeFrame(
  frame: Float32Array,
  targetRMS?: number
): Float32Array {
  // Use supplied targetRMS when provided, otherwise fall back to DSP defaults
  const desired = targetRMS ?? defaultDSPConfig.normalizationTargetRMS;
  const rms = calculateRMS(frame);
  if (rms === 0) return frame; // avoid division by zero
  const gain = desired / rms;

  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = frame[i] * gain;
  }
  return out;
}

/**
 * Smooth noise gate
 * Instead of muting silent frames, gently reduces volume
 */
export function softNoiseGate(
  frame: Float32Array,
  threshold?: number
): Float32Array {
  // Use supplied threshold when provided, otherwise fall back to DSP defaults
  const thr = threshold ?? defaultDSPConfig.noiseGateThreshold;
  const rms = calculateRMS(frame);
  if (rms >= thr) return frame;

  // Below threshold → attenuate
  const attenuation = rms / thr; // scale 0 → 1
  const out = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    out[i] = frame[i] * attenuation;
  }
  return out;
}

/**
 * Full noise utility wrapper (optional helper)
 */
export function applyNoiseControl(
  frame: Float32Array,
  config: DSPConfig
): Float32Array {
  let processed = frame;

  if (config.enableNormalization) {
    processed = normalizeFrame(processed, config.normalizationTargetRMS);
  }

  if (config.enableNoiseGate) {
    processed = softNoiseGate(processed, config.noiseGateThreshold);
  }

  return processed;
}
