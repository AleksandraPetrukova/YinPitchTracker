// yin.ts
// Core YIN pitch detection algorithm in TypeScript

export interface YinResult {
  pitch: number | null;       // Detected fundamental frequency (Hz)
  probability: number;        // Confidence (0–1)
}

export interface YinConfig {
  sampleRate: number;
  threshold?: number;        // Absolute threshold recommendation = 0.10
}

export class Yin {
  private threshold: number;
  private sampleRate: number;

  constructor(config: YinConfig) {
    this.sampleRate = config.sampleRate;
    this.threshold = config.threshold ?? 0.10;
  }

  /**
   * YIN Pitch Detection
   * @param buffer Input audio frame (Float32Array, mono)
   */
  detectPitch(buffer: Float32Array): YinResult {
    const bufferSize = buffer.length;
    const halfBufferSize = Math.floor(bufferSize / 2);
    const yinBuffer = new Float32Array(halfBufferSize);

    // Step 1: Difference function
    for (let tau = 1; tau < halfBufferSize; tau++) {
      let sum = 0;
      for (let i = 0; i < halfBufferSize; i++) {
        const delta = buffer[i] - buffer[i + tau];
        sum += delta * delta;
      }
      yinBuffer[tau] = sum;
    }

    // Step 2: Cumulative mean normalized difference
    yinBuffer[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau < halfBufferSize; tau++) {
      runningSum += yinBuffer[tau];
      yinBuffer[tau] *= tau / runningSum;
    }

    // Step 3: Absolute threshold check
    let tauEstimate = -1;
    for (let tau = 2; tau < halfBufferSize; tau++) {
      if (yinBuffer[tau] < this.threshold) {
        while (tau + 1 < halfBufferSize && yinBuffer[tau + 1] < yinBuffer[tau]) {
          tau++;
        }
        tauEstimate = tau;
        break;
      }
    }

    // If no tau found, return null pitch
    if (tauEstimate === -1) {
      return { pitch: null, probability: 0 };
    }

    // Step 4: Parabolic interpolation
    const betterTau = this.parabolicInterpolation(yinBuffer, tauEstimate);

    // Step 5: Convert lag -> frequency
    const pitch = this.sampleRate / betterTau;
    const probability = 1 - yinBuffer[tauEstimate]; // YIN confidence measure

    return { pitch, probability };
  }

  private parabolicInterpolation(buffer: Float32Array, tau: number): number {
    const x0 = tau < 1 ? tau : tau - 1;
    const x2 = tau + 1 < buffer.length ? tau + 1 : tau;
    if (x0 === tau || x2 === tau) return tau;
    const s0 = buffer[x0];
    const s1 = buffer[tau];
    const s2 = buffer[x2];
    return tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));
  }
}
