# `src/core/dsp/noise.ts` — Normalization & Soft Noise Gate

Utilities to normalize frame RMS and apply a gentle noise gate (attenuation rather than hard mute).

## Functions

- `normalizeFrame(frame, targetRMS)` — scales frame to reach target RMS.
- `softNoiseGate(frame, threshold)` — attenuates frames whose RMS is below threshold by scale `rms/threshold`.
- `applyNoiseControl(frame, config)` — wrapper combining normalization and noise gate based on config.

## Math

- RMS computed by `calculateRMS`, gain = `targetRMS / rms`.
- Soft gate attenuation = `rms / threshold` when rms < threshold.

## Complexity

- O(N) per frame for all operations.

## Improvements

- Avoid allocating new arrays when possible; perform in-place scaling.
- Use smoother gating curves (e.g., sigmoid) to avoid abrupt changes in perceived loudness.
- Add per-frame hysteresis to avoid rapid gate open/close around threshold.
