# `src/core/dsp/filters.ts` — Biquad Filters (HPF/LPF)

Implements simple biquad IIR filters (high-pass and low-pass) and an `applyFilters` helper that applies configured filters to a frame.

## Implementation details

- `BiquadFilter` contains Direct Form 1 style processing with internal state `z1` and `z2`.
- `createHighPassFilter` and `createLowPassFilter` compute biquad coefficients using a standard digital design (w0, cos, sin, Q=0.707).
- `applyFilters` conditionally constructs and applies filters based on `DSPConfig`.

## Complexity

- O(N) per filter per frame (single pass over samples).
- Memory: output frame is newly allocated when filtering; can be optimized to process in-place.

## Numerical / stability notes

- Using fixed Q=0.707 (Butterworth) is a reasonable default; exposing `Q` allows sharper or smoother cut behavior.
- Filters are stateful; repeated calls should maintain filter instances for continuity between frames (currently created per call in `applyFilters`).

## Configurable parameters

- `highPassQ` / `lowPassQ`: Q factor for each biquad filter. Default is `0.707` (Butterworth). These can be set via `dsp-config.json` or programmatically by updating the `DSPConfig` used by the pipeline.

## Improvements

- Create and cache `BiquadFilter` instances on the engine or filter manager rather than recreating per-frame to preserve state and reduce allocation.
- Provide option to process in-place to reduce memory churn.
- Expose `Q` and filter order options.
- Add unit tests with known impulse/step responses and stability checks.
