// core/dsp/rms.ts
// Utility functions for amplitude analysis (RMS)

export function calculateRMS(frame: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < frame.length; i++) {
    const sample = frame[i];
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / frame.length);
}

/**
 * Determine if a frame is too quiet (likely noise/silence)
 */
export function frameIsSilent(frame: Float32Array, threshold: number): boolean {
  return calculateRMS(frame) < threshold;
}
