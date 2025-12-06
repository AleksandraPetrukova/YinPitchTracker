# `src/core/pitch-engine.ts` — Pitch processing pipeline

This file orchestrates DSP preprocessing, pitch detection (YIN), smoothing, and musical readout (note, cents, expected-note deviation).

**Entry point:** `new PitchEngine(sampleRate).processFrame(frame, opts)`

## Responsibilities

- Apply filters (HPF/LPF).
- Compute frame RMS for visibility.
- Apply normalization and soft noise gate.
- Use `Yin.detectPitch` to get frequency and probability.
- Smooth frequency with `MedianSmoother` + `MovingAverage`.
- Convert frequency to musical note and compute deviation if expected note provided.

## Flow & mapping to code

1. `applyFilters` — band-limits input based on `DSPConfig`.
2. `calculateRMS` — measure amplitude after filtering.
3. `applyNoiseControl` — optional normalization + soft gate.
4. `yin.detectPitch` — core F0 detection.
5. Smoothing — median (to remove spikes) then EMA (trend smoothing).
6. `frequencyToNote` / `centsOffFromReference` — convert frequency into human-friendly outputs.

## Complexity

- Filters: O(N) per filter (process each sample once).
- YIN: O(N^2) inside `detectPitch` (dominant cost).
- Smoothing structures: O(W log W) for median sort per push (W is median window size) — small.

Overall runtime per frame: dominated by YIN’s O(N^2). For small frames (e.g., 2048) this is acceptable, but larger frames or high-throughput contexts will need optimization.

## Design notes & improvements

- Smoothing only affects the returned `frequency`, not `confidence` — good separation.
- `ProcessOptions` supports `expectedNote` and advanced DSP overrides.

Improvements:

- Expose an option to skip YIN and use a cheaper fallback (autocorrelation FFT-based) for low-CPU mode.
- Make smoothing adaptive: enable more smoothing on low-confidence frames and less smoothing when confidence is high.
- Run DSP pre-filters in-place or with reusable buffers to reduce GC.
- Provide hooks to collect diagnostics (timing, intermediate buffers) for debugging and profiling.
