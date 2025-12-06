# YIN Pitch Detection — Implementation Notes

This document explains the YIN pitch detection implementation in `dist/core/yin.js` (class `Yin`). It covers the algorithmic steps, mathematical formulas, how each step maps to the code, performance characteristics, edge cases, and practical improvements.

**Location:** `dist/core/yin.js`

**Entry point:** `new Yin({ sampleRate, threshold }).detectPitch(buffer)`

---

## Overview

- **Algorithm:** YIN (De Cheveigné & Kawahara) — estimates fundamental period (lag τ) using a difference function and a cumulative mean normalized difference (CMND). The first local minimum under a threshold is chosen, refined by parabolic interpolation, then converted to frequency.
- **Input:** mono audio frame as `Float32Array`.
- **Output:** `{ pitch: number | null, probability: number }` where `pitch` is in Hz (or `null` if not found) and `probability` is a simple confidence (1 - normalized difference).

---

## High-level Steps (and code mapping)

1. Difference function — compute how the signal differs from itself shifted by τ

   - Math: d(τ) = Σ\_{i=0}^{M-1} (x[i] - x[i+τ])^2
   - Code: outer loop `for (let tau = 1; tau < halfBufferSize; tau++)` with inner sum over `i` and `yinBuffer[tau] = sum;`

2. Cumulative Mean Normalized Difference (CMND)

   - Math: d'(τ) = d(τ) / ( (1/τ) Σ\_{j=1..τ} d(j) ), with d'(0)=1
   - Code: `yinBuffer[0] = 1; let runningSum = 0; for (let tau = 1; tau < halfBufferSize; tau++) { runningSum += yinBuffer[tau]; yinBuffer[tau] *= tau / runningSum; }`

3. Absolute threshold and local minimum selection

   - Goal: find the first τ where d'(τ) < threshold and then step to the local minimum (while next value decreases).
   - Code: loop starting at `tau = 2` and check `if (yinBuffer[tau] < this.threshold) { while (tau + 1 < halfBufferSize && yinBuffer[tau + 1] < yinBuffer[tau]) tau++; tauEstimate = tau; break; }`
   - If none found the function returns `{ pitch: null, probability: 0 }`.

4. Parabolic interpolation (sub-sample refinement)

   - Purpose: refine integer lag `tauEstimate` to fractional `betterTau` using neighbors.
   - Formula (used in code): betterTau = τ + (s2 - s0) / (2 * (2*s1 - s2 - s0)), where s0 = buffer[τ-1], s1 = buffer[τ], s2 = buffer[τ+1]
   - Code: `parabolicInterpolation(yinBuffer, tauEstimate)` implements this formula and falls back to integer τ when neighbors are invalid.

5. Convert lag → frequency and compute confidence

   - Frequency: `pitch = sampleRate / betterTau`
   - Confidence: `probability = 1 - yinBuffer[tauEstimate]` (empirical)

---

## Key Code Notes

- The implementation uses `halfBufferSize = Math.floor(buffer.length / 2)`. This restricts τ search to half the frame so `i+τ` remains in bounds.
- `threshold` default is `0.10` (set in constructor). Lower values increase sensitivity; higher values are more conservative.
- Time complexity is O(N^2) due to the nested difference loops. Space complexity is O(N) for `yinBuffer`.

---

## Math Reference (compact)

- Difference function: d(τ) = Σ\_{i=0}^{M-1} (x[i] - x[i+τ])^2
- CMND: d'(τ) = d(τ) / ((1/τ) Σ\_{j=1..τ} d(j)); set d'(0) = 1
- Parabolic interpolation offset: Δ = (s2 - s0) / (2*(2*s1 - s2 - s0)), betterTau = τ + Δ

---

## Parameters & Tuning

- `threshold` (default 0.10): trade-off between sensitivity and false positives. Typical range: 0.10–0.20.
- `buffer.length`: larger frames give better low-frequency resolution but increase compute and latency.
- `sampleRate`: used to convert lag → Hz (pitch = sampleRate / tau).

Practical consequence: the lowest detectable frequency ≈ sampleRate / (halfBufferSize). To detect lower pitches, increase the buffer length.

---

## Edge Cases & Behavior

- If no τ passes the threshold, the function returns `{ pitch: null, probability: 0 }`.
- The algorithm finds the first suitable local minimum under threshold — this reduces octave errors in many cases, but may not always select the global minimum.
- `yinBuffer[0]` is set to `1` to avoid division by zero during normalization.

---

## Performance Suggestions

- Limit τ search range to a plausible pitch band (e.g., from `tauMin = sampleRate/maxFreq` to `tauMax = sampleRate/minFreq`) to lower compute and reduce octave errors.
- Reuse the `yinBuffer` across calls (store it on the `Yin` instance) to avoid allocations in real-time contexts.
- Apply a simple pre-filter (DC removal / high-pass) to the input frame to reduce low-frequency noise.
- Consider downsampling high sample-rate audio when detecting low pitches.
- For large buffers, consider an FFT-based approach to compute autocorrelation/difference in O(N log N).

---

## Suggested Code Improvements (quick wins)

- Expose `minFreq` and `maxFreq` in `Yin` config and compute `tauMin`/`tauMax` to limit loops.
- Add optional preprocessing: remove DC (`x[i] -= mean`) and/or apply a Hann window.
- Allow a reusable buffer to be passed in or stored on the instance to reduce GC.
- Improve confidence metric by combining `1 - yinBuffer[tau]` with an amplitude/SNR measure.

---

## Usage Example

```js
import { Yin } from '../../dist/core/yin.js';

const yin = new Yin({ sampleRate: 44100, threshold: 0.12 });
const frame = /* Float32Array audio frame */;
const { pitch, probability } = yin.detectPitch(frame);
if (pitch !== null) console.log(`Detected ${pitch.toFixed(2)} Hz (confidence ${probability.toFixed(2)})`);
else console.log('No pitch detected');
```
