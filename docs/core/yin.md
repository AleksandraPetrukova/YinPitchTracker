# `src/core/yin.ts` — YIN Pitch Detector

This document explains the implementation of the YIN pitch detection algorithm in `src/core/yin.ts`.

**Entry point:** `new Yin({ sampleRate, threshold }).detectPitch(buffer)`

## What it does

- Computes the YIN difference function and cumulative mean normalized difference (CMND) to estimate the fundamental period (lag τ).
- Picks the first local minimum below a threshold, refines the lag with parabolic interpolation, and converts lag → frequency.

## Algorithm summary

1. Difference function: d(τ) = Σ\_{i=0}^{M-1} (x[i] - x[i+τ])^2
2. CMND: d'(τ) = d(τ) / ((1/τ) Σ\_{j=1..τ} d(j)), set d'(0)=1
3. Find first τ where d'(τ) < threshold; step to local minimum
4. Parabolic interpolation for sub-sample τ
5. Frequency = sampleRate / betterTau

## Key implementation details

- The code limits τ search to `halfBufferSize = Math.floor(buffer.length/2)` so indexing `i+τ` remains valid.
- Default threshold is 0.10 (configurable). The function returns `{ pitch: null, probability: 0 }` if no τ meets threshold.
- Confidence proxy = `1 - yinBuffer[tauEstimate]`.

## Computational complexity

- Time: O(N^2) due to the nested loops computing the difference function (dominant) where N = frame length.
- Space: O(N) for the `yinBuffer` array.

## Limitations & edge cases

- Finds the first acceptable local minimum — may not be the global minimum (intentional trade-off to avoid octave errors).
- Very sensitive to buffer size and audio quality; low SNR can yield incorrect τ.

## Practical improvements

- Limit search range to [tauMin, tauMax] derived from expected `minFreq`/`maxFreq` to reduce CPU and octave errors.
- Reuse `yinBuffer` across calls to avoid allocations.
- Preprocess frames: DC removal, band-pass, or windowing (Hann) to reduce artifacts.
- Consider FFT-based autocorrelation for large frames to reduce runtime to O(N log N).

## Where to change

- `threshold` in constructor; add `minFreq`/`maxFreq` to `YinConfig` and compute tau bounds before loops.
- Move `const yinBuffer = new Float32Array(halfBufferSize)` to instance scope for reuse.
