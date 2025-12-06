# `src/core/dsp/rms.ts` — RMS Utilities

Simple utilities to compute RMS and silence detection.

## Functions

- `calculateRMS(frame)` — returns sqrt(mean(square(samples))).
- `frameIsSilent(frame, threshold)` — boolean check if RMS < threshold.

## Complexity

- O(N) per frame.

## Improvements

- Optionally accept an existing buffer to avoid new allocations when used in combination with other in-place processing.
