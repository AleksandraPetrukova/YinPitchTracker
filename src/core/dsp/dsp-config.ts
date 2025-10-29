// core/dsp/dsp-config.ts
// DSP configuration used across filters, noise gate, smoothing, etc.

export interface DSPConfig {
  // Filtering
  highPassCutoff: number; // Hz
  lowPassCutoff: number;  // Hz (set to 0 to disable)

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

export const defaultDSPConfig: DSPConfig = {
  highPassCutoff: 50,       // Remove rumble
  lowPassCutoff: 0,         // No LPF by default
  noiseGateThreshold: 0.02, // Ignore frames with very low signal
  enableNoiseGate: true,

  enableNormalization: true,
  normalizationTargetRMS: 0.25,

  enableMedianSmoothing: true,
  medianWindowSize: 5,

  enableMovingAverage: true,
  movingAverageAlpha: 0.35,

  frameSize: 2048
};
