// cli/analyze.ts
// Command-line tuner for analyzing WAV files using the PitchEngine

import fs from "fs";
import { decode } from "wav-decoder";
import { Command } from "commander";
import { PitchEngine } from "../core/pitch-engine";
import { defaultDSPConfig } from "../core/dsp/dsp-config";

// CLI Setup
const program = new Command();
program
  .name("tuner-analyze")
  .description("Analyze pitch from a WAV file using YIN + DSP")
  .argument("<file>", "Path to WAV file")
  .option("-e, --expected <note>", "Expected note (ex: C4 or 440)")
  .option("-v, --verbose", "Show frame-by-frame analysis")
  .option("--json", "Output raw JSON instead of human format")
  .parse(process.argv);

const options = program.opts();
const filePath = program.args[0];

if (!filePath || !fs.existsSync(filePath)) {
  console.error("Error: WAV file not found:", filePath);
  process.exit(1);
}

// Load WAV file
(async () => {
  const buffer = fs.readFileSync(filePath);
  const decoded = await decode(buffer);
  const sampleRate = decoded.sampleRate;
  const engine = new PitchEngine(sampleRate, defaultDSPConfig);

  console.log(`Analyzing: ${filePath}`);
  console.log(`Sample Rate: ${sampleRate} Hz`);

  // Convert stereo → mono
  let audio: Float32Array | number[] = decoded.channelData[0];
if (decoded.channelData.length > 1) {
  audio = decoded.channelData[0].map((v: number, i: number) =>
    (decoded.channelData[0][i] + decoded.channelData[1][i]) / 2
  );
}

  // Skip initial transient attack (0.3 sec)
  const attackSkip = Math.floor(sampleRate * 0.3);
  audio = audio.slice(attackSkip);

  // Frame scanning
  const frameSize = defaultDSPConfig.frameSize;
  let bestFrame: any = null;

  for (let i = 0; i < audio.length - frameSize; i += frameSize) {
    const frame = audio.slice(i, i + frameSize);
    const result = engine.processFrame(new Float32Array(frame), {
      expectedNote: options.expected,
      smoothing: true,
    });

    if (options.verbose) {
      console.log(
        `Frame ${i}: ${result.frequency?.toFixed(2) || "null"} Hz | Conf=${result.confidence.toFixed(2)}`
      );
    }

    // Track best candidate
    if (
      result.frequency !== null &&
      (!bestFrame || result.confidence > bestFrame.confidence)
    ) {
      bestFrame = result;
    }
  }

  if (!bestFrame) {
    console.log("No stable pitch detected.");
    process.exit(0);
  }

  // Output result
  if (options.json) {
    console.log(JSON.stringify(bestFrame, null, 2));
  } else {
    console.log(`\n✅ Best Stable Pitch Found`);
    console.log(`Detected Pitch: ${bestFrame.frequency.toFixed(2)} Hz`);
    if (bestFrame.note) console.log(`Note: ${bestFrame.note}`);
    if (bestFrame.deviation) console.log(`Deviation: ${bestFrame.deviation}`);
    console.log(`Confidence: ${(bestFrame.confidence * 100).toFixed(1)}%`);
  }
})();
