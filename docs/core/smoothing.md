# `src/core/dsp/smoothing.ts` — Smoothing utilities

Contains `MedianSmoother` and `MovingAverage` classes used by the `PitchEngine` to stabilize detected frequency values.

## MedianSmoother

- Maintains a sliding window of recent values and returns the median (middle) value. Good at removing single-sample spikes.
- Implementation uses array sorting per push — OK for small window sizes but not ideal for large windows.

## MovingAverage

- Exponential moving average (EMA) with smoothing factor `alpha` where smaller `alpha` yields smoother output.

## Complexity

- MedianSmoother: O(W log W) per push due to sorting; W is window size.
- MovingAverage: O(1) per push.

## Improvements

- Optimize median by using a binary insertion or a running median data structure to get O(log W) inserts and O(1) median.
- Make smoothing adaptive to confidence (e.g., increase smoothing when `confidence < 0.5`).
