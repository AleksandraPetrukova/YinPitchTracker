// frontend/app.ts
//
// Minimal browser app that:
// - Records microphone (max 5s) OR loads a WAV file
// - Runs your PitchEngine (DSP + YIN)
// - Outputs Hz, note, confidence
// - If an expected note is given (C4 or Hz), outputs cents deviation
// - Allows downloading the result as JSON
//
// No external libraries are used. WAV uploads are decoded via Web Audio API.
// Stereo is auto-converted to mono. One-shot analysis on button click.

import { PitchEngine } from "../core/pitch-engine.js";
import { defaultDSPConfig } from "../core/dsp/dsp-config.js";

// ---------- DOM refs ----------
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const recordBtn = document.getElementById("recordButton") as HTMLButtonElement;
const stopBtn = document.getElementById("stopButton") as HTMLButtonElement;
const analyzeBtn = document.getElementById("analyzeButton") as HTMLButtonElement;
const expectedNoteInput = document.getElementById("expectedNote") as HTMLInputElement;
const downloadBtn = document.getElementById("downloadButton") as HTMLButtonElement;

const pitchOut = document.getElementById("pitch")!;
const noteOut = document.getElementById("note")!;
const confOut = document.getElementById("confidence")!;
const devOut = document.getElementById("deviation")!;

// ---------- State ----------
let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let recording = false;
let recordedSamples: Float32Array[] = []; // chunks of mono PCM
let recordedLength = 0;
const MAX_RECORD_SECONDS = 5;

// Buffer from last chosen input (either recorded or uploaded)
let pendingBuffer: Float32Array | null = null;
let pendingSampleRate: number | null = null;

// Store last results for JSON export
let lastResultJson: any = null;

// ---------- Utilities ----------

function setError(message: string) {
  // Show errors in the same "Results" area for clarity
  pitchOut.textContent = "---";
  noteOut.textContent = "---";
  confOut.textContent = "---";
  devOut.textContent = message ? `Error: ${message}` : "---";
  downloadBtn.disabled = true;
}

function clearError() {
  devOut.textContent = "---";
}

function concatFloat32(chunks: Float32Array[], totalLen: number): Float32Array {
  const out = new Float32Array(totalLen);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.getChannelData(1);
  const N = Math.min(ch0.length, ch1.length);
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    mono[i] = 0.5 * (ch0[i] + ch1[i]);
  }
  return mono;
}

// Decode a WAV file using Web Audio API (built-in, no deps)
async function decodeWavFile(file: File): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const arrayBuf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0)); // slice to detach
  const mono = toMono(audioBuf);
  const sr = audioBuf.sampleRate;
  ctx.close(); // we used a temp context just for decoding
  return { pcm: mono, sampleRate: sr };
}

// ---------- Microphone recording (one-shot, max 5s) ----------
// We use a ScriptProcessorNode to grab raw PCM and store it.

async function startRecording() {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const source = audioContext.createMediaStreamSource(micStream);

    // ScriptProcessorNode is deprecated but widely supported; suitable for our simple one-shot.
    const frameSize = 2048; // matches default in core
    const sp = (audioContext as any).createScriptProcessor
      ? (audioContext as any).createScriptProcessor(frameSize, 1, 1)
      : null;

    if (!sp) {
      setError("Recording not supported in this browser (no ScriptProcessor).");
      return;
    }

    recordedSamples = [];
    recordedLength = 0;
    recording = true;

    sp.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!recording) return;
      const input = ev.inputBuffer;
      // Mix to mono if needed
      const mono = toMono(input);
      recordedSamples.push(new Float32Array(mono)); // copy
      recordedLength += mono.length;
    };

    source.connect(sp);
    sp.connect(audioContext.destination); // required in some browsers

    // auto-stop after MAX_RECORD_SECONDS
    setTimeout(() => {
      if (recording) stopRecordingInternal(sp, source);
    }, MAX_RECORD_SECONDS * 1000);

  } catch (e: any) {
    setError(`Mic error: ${e?.message || e}`);
  }
}

function stopRecordingInternal(sp: ScriptProcessorNode, source: MediaStreamAudioSourceNode) {
  recording = false;
  try {
    sp.disconnect();
    source.disconnect();
  } catch (_) {}
  // collect buffered audio
  const pcm = concatFloat32(recordedSamples, recordedLength);
  pendingBuffer = pcm;
  pendingSampleRate = audioContext?.sampleRate ?? null;

  // release mic
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
  // keep audioContext open; harmless
}

async function stopRecording() {
  // stop will be handled by timeout or explicit click
  // nothing else needed here
}

// ---------- Analysis ----------

function formatHz(hz: number | null): string {
  return hz && isFinite(hz) ? `${hz.toFixed(2)} Hz` : "---";
}

function formatConfidence(p: number): string {
  if (p == null || !isFinite(p)) return "---";
  return `${(p * 100).toFixed(1)}%`;
}

function enableDownload(result: any) {
  lastResultJson = result;
  downloadBtn.disabled = false;
}

function disableDownload() {
  lastResultJson = null;
  downloadBtn.disabled = true;
}

async function analyzeOnce() {
  clearError();
  disableDownload();

  try {
    if (!pendingBuffer || !pendingSampleRate) {
      setError("No audio to analyze. Please record up to 5 seconds or upload a WAV first.");
      return;
    }

    // Build engine bound to current sample rate
    const engine = new PitchEngine(pendingSampleRate, defaultDSPConfig);

    // Use the same frame size as the engine config
    const frameSize = defaultDSPConfig.frameSize;

    // Strategy: scan whole buffer in non-overlapping frames and pick the "best stable" one:
    // We select the frame with highest confidence; this matches your CLI "strongest stable region".
    let best: ReturnType<typeof engine.processFrame> | null = null;

    // Skip initial 0.3 s attack for cleaner estimate (same as CLI)
    const attackSkip = Math.floor(pendingSampleRate * 0.3);
    const buf = pendingBuffer.subarray(Math.min(attackSkip, pendingBuffer.length));

    // Optional expected note
    const expectedRaw = expectedNoteInput.value.trim();
    const expectedOpt = expectedRaw.length ? expectedRaw : undefined;

    for (let i = 0; i + frameSize <= buf.length; i += frameSize) {
      const frame = buf.subarray(i, i + frameSize);
      const r = engine.processFrame(frame, {
        expectedNote: expectedOpt,
        smoothing: true
      });

      // Keep best by confidence
      if (r.frequency !== null) {
        if (!best || r.confidence > best.confidence) best = r;
      }
    }

    if (!best) {
      setError("No stable pitch detected.");
      return;
    }

    // Update UI
    pitchOut.textContent = formatHz(best.frequency);
    noteOut.textContent = best.note ?? "---";
    confOut.textContent = formatConfidence(best.confidence);
    devOut.textContent = best.deviation ?? "---";

    // Prepare JSON export
    const exportPayload = {
      frequency: best.frequency,
      note: best.note ?? null,
      confidence: best.confidence,
      expectedNote: best.expectedNote ?? null,
      deviation: best.deviation ?? null,
      sampleRate: pendingSampleRate,
      frameRMS: best.frameRMS ?? null,
      timestamp: new Date().toISOString()
    };
    enableDownload(exportPayload);

  } catch (e: any) {
    setError(e?.message || String(e));
  }
}

// ---------- Event wiring ----------

recordBtn.addEventListener("click", async () => {
  if (recording) return;
  // Reset previous input
  pendingBuffer = null;
  pendingSampleRate = null;
  disableDownload();
  clearError();

  recordBtn.disabled = true;
  stopBtn.disabled = false;

  await startRecording();

  // Re-enable "Record" after MAX seconds by the auto stop
  setTimeout(() => {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  }, MAX_RECORD_SECONDS * 1000 + 100);
});

// stopBtn.addEventListener("click", async () => {
//   if (!recording || !audioContext) return;
//   recordBtn.disabled = false;
//   stopBtn.disabled = true;

//   // Find the processor and source via context graph is not trivial; they are closed in timeout handler.
//   // Here we just flip the flag; the timeout handler calls stopRecordingInternal.
//   recording = false;
// });
stopBtn.addEventListener("click", async () => {
  if (!recording || !audioContext || !micStream) return;
  recording = false;
  recordBtn.disabled = false;
  stopBtn.disabled = true;

  // Immediately process recorded audio (manual stop)
  const tracks = micStream.getTracks();
  tracks.forEach(t => t.stop());
  micStream = null;

  const pcm = concatFloat32(recordedSamples, recordedLength);
  pendingBuffer = pcm;
  pendingSampleRate = audioContext.sampleRate;
});


fileInput.addEventListener("change", async () => {
  disableDownload();
  clearError();
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const { pcm, sampleRate } = await decodeWavFile(file);
    pendingBuffer = pcm;
    pendingSampleRate = sampleRate;
  } catch (e: any) {
    setError(`WAV decode failed: ${e?.message || e}`);
  }
});

analyzeBtn.addEventListener("click", async () => {
  await analyzeOnce();
});

downloadBtn.addEventListener("click", () => {
  if (!lastResultJson) return;
  const blob = new Blob([JSON.stringify(lastResultJson, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = `pitch_result_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
