// core/dsp/smoothing.ts
// Pitch smoothing utilities to reduce jitter and fluctuations

/**
 * Median smoothing for jitter removal
 * Keeps the middle value in a sliding window
 */
export class MedianSmoother {
  private window: number[] = [];
  private maxSize: number;

  constructor(maxSize: number = 5) {
    this.maxSize = maxSize;
  }

  push(value: number): number {
    if (!isFinite(value)) return value;

    this.window.push(value);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }

    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

/**
 * Moving average smoother (trend stabilizer)
 */
export class MovingAverage {
  private alpha: number;
  private smoothed: number | null = null;

  constructor(alpha: number = 0.35) {
    this.alpha = alpha;
  }

  push(value: number): number {
    if (this.smoothed === null) {
      this.smoothed = value;
    } else {
      this.smoothed = this.alpha * value + (1 - this.alpha) * this.smoothed;
    }
    return this.smoothed;
  }
}
