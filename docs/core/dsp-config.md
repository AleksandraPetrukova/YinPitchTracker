# `src/core/dsp/dsp-config.ts` — DSP Configuration

Defines shared DSP parameters used across filtering, noise control, normalization, and smoothing. This centralizes tuning and makes behavior consistent across components.

## Key config fields

- `highPassCutoff` / `lowPassCutoff` — filter cutoffs (Hz).
- `noiseGateThreshold` / `enableNoiseGate` — control soft gating behavior.
- `enableNormalization` / `normalizationTargetRMS` — amplitude normalization target.
- Smoothing: `enableMedianSmoothing`, `medianWindowSize`, `enableMovingAverage`, `movingAverageAlpha`.
- `frameSize` — recommended power-of-two buffer sizes (e.g., 2048).

## Notes

- Defaults favor removing low-frequency rumble (`highPassCutoff: 50`) and no default LPF.
- Normalization target RMS = 0.25 maps to a comfortable mid-level signal.

## Improvements

- Consider adding `minFreq`/`maxFreq` for the entire pipeline so that components (YIN, filters) can use the same pitch-range assumptions.
- Add a `profile` mode to switch conservative/aggressive detection presets.
