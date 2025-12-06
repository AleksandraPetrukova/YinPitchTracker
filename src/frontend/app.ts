import { PitchEngine } from "../core/pitch-engine.js";
import { defaultDSPConfig } from "../core/dsp/dsp-config.js";

// ---------- DOM refs ----------
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const recordBtn = document.getElementById("recordButton") as HTMLButtonElement;
const stopBtn = document.getElementById("stopButton") as HTMLButtonElement;
const analyzeBtn = document.getElementById("analyzeButton") as HTMLButtonElement;
const expectedNoteInput = document.getElementById("expectedNote") as HTMLInputElement;
const downloadBtn = document.getElementById("downloadButton") as HTMLButtonElement;
const saveWavBtn = document.getElementById("saveWavButton") as HTMLButtonElement;

const countdownLabel = document.getElementById("countdown") as HTMLElement | null;
const pitchOut = document.getElementById("pitch")!;
const noteOut = document.getElementById("note")!;
const confOut = document.getElementById("confidence")!;
const devOut = document.getElementById("deviation")!;
const sourceLabel = document.getElementById("sourceLabel")!;

// Tab UI wiring (matches ids in index.html)
const modeFileTab = document.getElementById("tab-file") as HTMLButtonElement | null;
const modeRecordTab = document.getElementById("tab-record") as HTMLButtonElement | null;
const modeLiveTab = document.getElementById("tab-live") as HTMLButtonElement | null;
const fileModePanel = document.getElementById("fileSection");
const recordModePanel = document.getElementById("recordSection");
const liveModePanel = document.getElementById("liveSection");

const playUploadBtn = document.getElementById("playUploadButton") as HTMLButtonElement | null;
const playRecordBtn = document.getElementById("playRecordButton") as HTMLButtonElement | null;

const liveStartBtn = document.getElementById("liveStartButton") as HTMLButtonElement | null;
const liveStopBtn = document.getElementById("liveStopButton") as HTMLButtonElement | null;

const inputDeviceSelect = document.getElementById("inputDeviceSelect") as HTMLSelectElement | null;
const outputDeviceSelect = document.getElementById("outputDeviceSelect") as HTMLSelectElement | null;
const refreshDevicesBtn = document.getElementById("refreshDevicesButton") as HTMLButtonElement | null;
const currentInputLabel = document.getElementById("currentInputLabel") as HTMLElement | null;
const currentOutputLabel = document.getElementById("currentOutputLabel") as HTMLElement | null;

// ---------- State ----------

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let recording = false;
let recordedSamples: Float32Array[] = []; // chunks of mono PCM
let recordedLength = 0;
const MAX_RECORD_SECONDS = 5;

// Recording graph nodes for mic
let currentProcessor: ScriptProcessorNode | null = null;
let currentSourceNode: MediaStreamAudioSourceNode | null = null;

// Live tuner stream
let liveStream: MediaStream | null = null;
let liveProcessor: ScriptProcessorNode | null = null;
let liveSourceNode: MediaStreamAudioSourceNode | null = null;

// Device selections
let selectedInputId: string | null = null;
let selectedOutputId: string | null = null;
let deviceAccessRequested = false;

// Countdown timer
let countdownIntervalId: number | null = null;

// Live tuner engine
let liveEngine: PitchEngine | null = null;

// Source-specific buffers
let uploadBuffer: Float32Array | null = null;
let uploadSampleRate: number | null = null;
let uploadPlaybackFile: File | null = null;
let playbackUrl: string | null = null;
let playbackAudioEl: HTMLAudioElement | null = null;

let recordBuffer: Float32Array | null = null;
let recordSampleRate: number | null = null;

// Active buffer used for Analyze (derived from mode)
let pendingBuffer: Float32Array | null = null;
let pendingSampleRate: number | null = null;

// Last recorded buffer for WAV export
let lastRecordedPCM: Float32Array | null = null;
let lastRecordedSampleRate: number | null = null;

// Store last analysis results (per mode) for JSON export
let lastResultJson: Record<Mode, any | null> = {
  file: null,
  record: null,
  live: null
};

type ResultDisplay = { pitch: string; note: string; conf: string; dev: string };
const blankResult = (): ResultDisplay => ({ pitch: "---", note: "---", conf: "---", dev: "---" });
const resultsByMode: Record<Mode, ResultDisplay> = {
  file: blankResult(),
  record: blankResult(),
  live: blankResult()
};

// Track which source is active
type SourceKind = "none" | "recording" | "upload" | "live";
let currentSource: SourceKind = "none";

type Mode = "file" | "record" | "live";
let activeMode: Mode = "file";

// ---------- Utilities ----------

function updateSourceLabel() {
  switch (currentSource) {
    case "recording":
      sourceLabel.textContent = "Microphone recording";
      break;
    case "upload":
      sourceLabel.textContent = "Uploaded WAV file";
      break;
    case "live":
      sourceLabel.textContent = "Live microphone (tuner)";
      break;
    default:
      sourceLabel.textContent = "---";
  }
}

function setError(message: string) {
  updateResultsForMode(activeMode, {
    pitch: "---",
    note: "---",
    conf: "---",
    dev: message ? `Error: ${message}` : "---"
  });
  disableDownloadForMode(activeMode);
}

function clearError() {
  const cur = resultsByMode[activeMode];
  updateResultsForMode(activeMode, { ...cur, dev: "---" });
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

// Decode a WAV file using Web Audio API
async function decodeWavFile(file: File): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const arrayBuf = await file.arrayBuffer();
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
  const mono = toMono(audioBuf);
  const sr = audioBuf.sampleRate;
  ctx.close();
  return { pcm: mono, sampleRate: sr };
}

// WAV encoding helpers for "Save recording as WAV"
function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM
  view.setUint16(20, 1, true);  // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = samples[i];
    s = Math.max(-1, Math.min(1, s));
    const val = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(offset, val, true);
  }

  return buffer;
}

function cleanupPlaybackUrl() {
  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
}

async function playUploadedFile() {
  if (!uploadPlaybackFile) return;
  try {
    cleanupPlaybackUrl();
    playbackUrl = URL.createObjectURL(uploadPlaybackFile);

    if (!playbackAudioEl) {
      playbackAudioEl = new Audio();
    } else {
      playbackAudioEl.pause();
    }

    if (selectedOutputId && typeof (playbackAudioEl as any).setSinkId === "function") {
      try {
        await (playbackAudioEl as any).setSinkId(selectedOutputId);
      } catch (_) {
        // Ignore sinkId failures; fall back to default device.
      }
    }

    playbackAudioEl.src = playbackUrl;
    playbackAudioEl.currentTime = 0;
    await playbackAudioEl.play();
  } catch (e: any) {
    setError(`Playback error: ${e?.message || e}`);
  }
}

async function playRecordedAudio() {
  if (!recordBuffer || !recordSampleRate) return;
  try {
    cleanupPlaybackUrl();
    const wavBuf = encodeWAV(recordBuffer, recordSampleRate);
    const blob = new Blob([wavBuf], { type: "audio/wav" });
    playbackUrl = URL.createObjectURL(blob);

    if (!playbackAudioEl) {
      playbackAudioEl = new Audio();
    } else {
      playbackAudioEl.pause();
    }

    if (selectedOutputId && typeof (playbackAudioEl as any).setSinkId === "function") {
      try {
        await (playbackAudioEl as any).setSinkId(selectedOutputId);
      } catch (_) {
        // Ignore sinkId failures; fall back to default device.
      }
    }

    playbackAudioEl.src = playbackUrl;
    playbackAudioEl.currentTime = 0;
    await playbackAudioEl.play();
  } catch (e: any) {
    setError(`Playback error: ${e?.message || e}`);
  }
}

function enableDownload(result: any) {
  lastResultJson[activeMode] = result;
  if (activeMode === getVisibleMode()) {
    downloadBtn.disabled = false;
  }
}

function disableDownloadForMode(mode: Mode) {
  lastResultJson[mode] = null;
  if (mode === getVisibleMode()) {
    downloadBtn.disabled = true;
  }
}

function resetResultsForMode(mode: Mode) {
  updateResultsForMode(mode, blankResult());
  disableDownloadForMode(mode);
}

function updateResultsForMode(mode: Mode, result: ResultDisplay) {
  resultsByMode[mode] = result;
  if (mode === getVisibleMode()) {
    pitchOut.textContent = result.pitch;
    noteOut.textContent = result.note;
    confOut.textContent = result.conf;
    devOut.textContent = result.dev;
  }
}

function getVisibleMode(): Mode {
  return activeMode;
}

function applyResultsForActiveMode() {
  const res = resultsByMode[activeMode] ?? blankResult();
  pitchOut.textContent = res.pitch;
  noteOut.textContent = res.note;
  confOut.textContent = res.conf;
  devOut.textContent = res.dev;
  downloadBtn.disabled = !lastResultJson[activeMode];
}

function refreshPlaybackButtons() {
  if (playUploadBtn) {
    playUploadBtn.disabled = !uploadBuffer;
  }
  if (playRecordBtn) {
    playRecordBtn.disabled = !recordBuffer;
  }
}

// ---------- Mode & pending buffer ----------

function syncPendingToMode() {
  if (activeMode === "file") {
    pendingBuffer = uploadBuffer;
    pendingSampleRate = uploadSampleRate;
    currentSource = uploadBuffer ? "upload" as SourceKind : "none";
  } else if (activeMode === "record") {
    pendingBuffer = recordBuffer;
    pendingSampleRate = recordSampleRate;
    currentSource = recordBuffer ? "recording" as SourceKind : "none";
  } else {
    // Live mode doesn't use pending buffers
    pendingBuffer = null;
    pendingSampleRate = null;
    currentSource = "live";
  }
  updateSourceLabel();
}

function setActiveMode(mode: Mode) {
  // Stop live tuner if leaving live mode
  if (mode !== "live") {
    stopLiveMode();
  }

  // Stop recording if user navigates away during capture
  if (mode !== "record" && recording) {
    stopRecordingInternal();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  }

  activeMode = mode;

  // Show/hide mode panels independently so a missing element doesn't block the other
  if (fileModePanel) {
    fileModePanel.style.display = mode === "file" ? "block" : "none";
  }
  if (recordModePanel) {
    recordModePanel.style.display = mode === "record" ? "block" : "none";
  }
  if (liveModePanel) {
    liveModePanel.style.display = mode === "live" ? "block" : "none";
  }

  if (modeFileTab) {
    modeFileTab.classList.toggle("active", mode === "file");
  }
  if (modeRecordTab) {
    modeRecordTab.classList.toggle("active", mode === "record");
  }
  if (modeLiveTab) {
    modeLiveTab.classList.toggle("active", mode === "live");
  }

  syncPendingToMode();
  applyResultsForActiveMode();
  refreshPlaybackButtons();
}

// ---------- Devices ----------

function setSelectOptions(select: HTMLSelectElement, options: { value: string; label: string }[], selectedValue: string | null) {
  select.innerHTML = "";
  for (const opt of options) {
    const optionEl = document.createElement("option");
    optionEl.value = opt.value;
    optionEl.textContent = opt.label;
    if (opt.value === selectedValue) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  if (selectedValue && !options.find(o => o.value === selectedValue)) {
    select.selectedIndex = 0;
  }
}

function updateDeviceLabels() {
  if (currentInputLabel) {
    const text = inputDeviceSelect && inputDeviceSelect.selectedOptions[0]
      ? inputDeviceSelect.selectedOptions[0].textContent
      : "Default";
    currentInputLabel.textContent = text || "Default";
  }
  if (currentOutputLabel) {
    const text = outputDeviceSelect && outputDeviceSelect.selectedOptions[0]
      ? outputDeviceSelect.selectedOptions[0].textContent
      : "Default";
    currentOutputLabel.textContent = text || "Default";
  }
}

async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    if (!deviceAccessRequested && navigator.mediaDevices.getUserMedia) {
      deviceAccessRequested = true;
      try {
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        probe.getTracks().forEach(t => t.stop());
      } catch (_) {
        // permission denied or unavailable; continue and attempt enumerate anyway
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === "audioinput");
    const audioOutputs = devices.filter(d => d.kind === "audiooutput");

    const inputOpts = audioInputs.map((d, idx) => ({
      value: d.deviceId,
      label: d.label || `Microphone ${idx + 1}`
    }));
    const outputOpts = audioOutputs.map((d, idx) => ({
      value: d.deviceId,
      label: d.label || `Speaker ${idx + 1}`
    }));
    if (inputOpts.length === 0) {
      inputOpts.push({ value: "", label: "Default microphone" });
    }
    if (outputOpts.length === 0) {
      outputOpts.push({ value: "", label: "Default speaker" });
    }

    if (inputDeviceSelect) {
      setSelectOptions(inputDeviceSelect, inputOpts, selectedInputId);
    }
    if (outputDeviceSelect) {
      setSelectOptions(outputDeviceSelect, outputOpts, selectedOutputId);
    }
    selectedInputId = inputDeviceSelect?.value || null;
    selectedOutputId = outputDeviceSelect?.value || null;
    updateDeviceLabels();
  } catch (_) {
    // Ignore device enumeration errors (permission may be required)
  }
}

// ---------- Recording helpers ----------

function clearCountdown() {
  if (countdownIntervalId !== null) {
    clearInterval(countdownIntervalId);
    countdownIntervalId = null;
  }
  if (countdownLabel) {
    countdownLabel.textContent = "--";
  }
}

function startCountdown() {
  clearCountdown();
  if (!countdownLabel) return;

  let remaining = MAX_RECORD_SECONDS;
  countdownLabel.textContent = `${remaining}`;

  countdownIntervalId = window.setInterval(() => {
    if (!recording) {
      clearCountdown();
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      countdownLabel.textContent = "0";
      clearCountdown();
      stopRecordingInternal();
    } else {
      countdownLabel.textContent = `${remaining}`;
    }
  }, 1000);
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Mic error: getUserMedia is not available. Check browser environment.");
      return;
    }

    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioConstraint: MediaTrackConstraints | boolean = selectedInputId
      ? { deviceId: { exact: selectedInputId } }
      : true;
    micStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
    const source = audioContext.createMediaStreamSource(micStream);

    const frameSize = defaultDSPConfig.frameSize ?? 2048;
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
    currentProcessor = sp;
    currentSourceNode = source;

    sp.onaudioprocess = (ev: AudioProcessingEvent) => {
      if (!recording) return;
      const input = ev.inputBuffer;
      const mono = toMono(input);

      recordedSamples.push(new Float32Array(mono));
      recordedLength += mono.length;
    };

    source.connect(sp);
    sp.connect(audioContext.destination);

    // New recording: clear only recording-related state
    recordBuffer = null;
    recordSampleRate = null;
    lastRecordedPCM = null;
    lastRecordedSampleRate = null;
    saveWavBtn.disabled = true;

    if (playRecordBtn) playRecordBtn.disabled = true;

    disableDownloadForMode("record");
    clearError();
    resetResultsForMode("record");

    // Switch mode to recording and sync buffers
    setActiveMode("record");

    startCountdown();
  } catch (e: any) {
    setError(`Mic error: ${e?.message || e}`);
  }
}

function stopRecordingInternal() {
  if (!recording) return;
  recording = false;

  clearCountdown();

  const sp = currentProcessor;
  const source = currentSourceNode;
  currentProcessor = null;
  currentSourceNode = null;

  try {
    if (sp) sp.disconnect();
    if (source) source.disconnect();
  } catch (_) {}

  if (recordedLength > 0 && audioContext) {
    const pcm = concatFloat32(recordedSamples, recordedLength);
    recordBuffer = pcm;
    recordSampleRate = audioContext.sampleRate;

    lastRecordedPCM = pcm;
    lastRecordedSampleRate = recordSampleRate;

    if (activeMode === "record") {
      pendingBuffer = recordBuffer;
      pendingSampleRate = recordSampleRate;
      currentSource = "recording";
      updateSourceLabel();
    }

    if (lastRecordedPCM && lastRecordedSampleRate) {
      saveWavBtn.disabled = false;
    }
    if (playRecordBtn) {
      playRecordBtn.disabled = false;
    }
    recordBtn.textContent = "Record Another";
  } else {
    recordBtn.textContent = "Record";
  }
  refreshPlaybackButtons();

  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  recordBtn.disabled = false;
  stopBtn.disabled = true;
}

async function stopRecording() {
  stopRecordingInternal();
}

// ---------- Analysis ----------

async function startLiveMode() {
  if (activeMode !== "live") {
    setActiveMode("live");
  }
  stopLiveMode();
  resetResultsForMode("live");
  applyResultsForActiveMode();

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Mic error: getUserMedia is not available. Check browser environment.");
      return;
    }
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const audioConstraint: MediaTrackConstraints | boolean = selectedInputId
      ? { deviceId: { exact: selectedInputId } }
      : true;
    liveStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false });
    const source = audioContext.createMediaStreamSource(liveStream);

    const frameSize = defaultDSPConfig.frameSize ?? 2048;
    const sp = (audioContext as any).createScriptProcessor
      ? (audioContext as any).createScriptProcessor(frameSize, 1, 1)
      : null;

    if (!sp) {
      setError("Live tuner not supported in this browser (no ScriptProcessor).");
      return;
    }

    liveEngine = new PitchEngine(audioContext.sampleRate, defaultDSPConfig);
    liveProcessor = sp;
    liveSourceNode = source;
    currentSource = "live";
    updateSourceLabel();

    sp.onaudioprocess = (ev: AudioProcessingEvent) => {
      const input = ev.inputBuffer;
      const mono = toMono(input);
      const expectedRaw = expectedNoteInput.value.trim();
      const expectedOpt = expectedRaw.length ? expectedRaw : undefined;
      const res = liveEngine!.processFrame(mono, {
        expectedNote: expectedOpt,
        smoothing: true
      });

      if (res.frequency !== null && res.confidence >= 0.6) {
        updateResultsForMode("live", {
          pitch: `${res.frequency.toFixed(2)} Hz`,
          note: res.note ?? "---",
          conf: `${(res.confidence * 100).toFixed(1)}%`,
          dev: res.deviation ?? "---"
        });
      }
    };

    source.connect(sp);
    sp.connect(audioContext.destination);

    if (liveStartBtn) liveStartBtn.disabled = true;
    if (liveStopBtn) liveStopBtn.disabled = false;
  } catch (e: any) {
    setError(`Live tuner error: ${e?.message || e}`);
  }
}

function stopLiveMode() {
  if (liveProcessor) {
    try {
      liveProcessor.disconnect();
    } catch (_) {}
  }
  if (liveSourceNode) {
    try {
      liveSourceNode.disconnect();
    } catch (_) {}
  }
  if (liveStream) {
    liveStream.getTracks().forEach(t => t.stop());
  }

  liveProcessor = null;
  liveSourceNode = null;
  liveStream = null;
  liveEngine = null;

  if (liveStartBtn) liveStartBtn.disabled = false;
  if (liveStopBtn) liveStopBtn.disabled = true;
  if (activeMode === "live") {
    currentSource = "live";
    updateSourceLabel();
  }
}

function formatHz(hz: number | null): string {
  return hz && isFinite(hz) ? `${hz.toFixed(2)} Hz` : "---";
}

function formatConfidence(p: number): string {
  if (p == null || !isFinite(p)) return "---";
  return `${(p * 100).toFixed(1)}%`;
}

async function analyzeOnce() {
  clearError();
  disableDownloadForMode(activeMode);

  if (!pendingBuffer || !pendingSampleRate) {
    const msg =
      activeMode === "file"
        ? "No audio to analyze in File mode. Choose a WAV first."
        : activeMode === "record"
          ? "No audio to analyze in Record mode. Please record first."
          : "Live mode analyzes continuously. Start live tuner first.";
    setError(msg);
    return;
  }

  try {
    const engine = new PitchEngine(pendingSampleRate, defaultDSPConfig);
    const frameSize = defaultDSPConfig.frameSize;
    let best: ReturnType<typeof engine.processFrame> | null = null;

    const attackSkip = Math.floor(pendingSampleRate * 0.3);
    const buf = pendingBuffer.subarray(Math.min(attackSkip, pendingBuffer.length));

    const expectedRaw = expectedNoteInput.value.trim();
    const expectedOpt = expectedRaw.length ? expectedRaw : undefined;

    for (let i = 0; i + frameSize <= buf.length; i += frameSize) {
      const frame = buf.subarray(i, i + frameSize);
      const r = engine.processFrame(frame, {
        expectedNote: expectedOpt,
        smoothing: true
      });

      if (r.frequency !== null) {
        if (!best || r.confidence > best.confidence) best = r;
      }
    }

    if (!best) {
      setError("No stable pitch detected.");
      return;
    }

    updateResultsForMode(activeMode, {
      pitch: formatHz(best.frequency),
      note: best.note ?? "---",
      conf: formatConfidence(best.confidence),
      dev: best.deviation ?? "---"
    });

    const exportPayload = {
      frequency: best.frequency,
      note: best.note ?? null,
      confidence: best.confidence,
      expectedNote: best.expectedNote ?? null,
      deviation: best.deviation ?? null,
      sampleRate: pendingSampleRate,
      frameRMS: best.frameRMS ?? null,
      source: currentSource,
      mode: activeMode,
      timestamp: new Date().toISOString()
    };
    enableDownload(exportPayload);
  } catch (e: any) {
    setError(e?.message || String(e));
  }
}

// ---------- Event wiring ----------

// Mode tab buttons (optional; safe if not present)
if (modeFileTab) {
  modeFileTab.addEventListener("click", () => {
    setActiveMode("file");
  });
}
if (modeRecordTab) {
  modeRecordTab.addEventListener("click", () => {
    setActiveMode("record");
  });
}
if (modeLiveTab) {
  modeLiveTab.addEventListener("click", () => {
    setActiveMode("live");
  });
}

recordBtn.addEventListener("click", async () => {
  if (recording) return;

  recordBtn.disabled = true;
  stopBtn.disabled = false;
  recordBtn.textContent = "Recording...";

  await startRecording();

  // If startRecording bailed due to error, re-enable button
  if (!recording) {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    recordBtn.textContent = recordBuffer ? "Record Another" : "Record";
  }
});

stopBtn.addEventListener("click", async () => {
  if (!recording) return;
  await stopRecording();
  recordBtn.disabled = false;
  stopBtn.disabled = true;
});

fileInput.addEventListener("change", async () => {
  disableDownloadForMode("file");
  clearError();
  resetResultsForMode("file");
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const { pcm, sampleRate } = await decodeWavFile(file);
    uploadBuffer = pcm;
    uploadSampleRate = sampleRate;
    uploadPlaybackFile = file;
    if (playUploadBtn) playUploadBtn.disabled = false;

    // If in file mode, this becomes active buffer
    if (activeMode === "file") {
      pendingBuffer = uploadBuffer;
      pendingSampleRate = uploadSampleRate;
      currentSource = "upload";
      updateSourceLabel();
    }

    // Uploaded file is NOT treated as "recorded"
    lastRecordedPCM = null;
    lastRecordedSampleRate = null;
    saveWavBtn.disabled = true;
  } catch (e: any) {
    setError(`WAV decode failed: ${e?.message || e}`);
  }
  refreshPlaybackButtons();
});

analyzeBtn.addEventListener("click", async () => {
  await analyzeOnce();
});

downloadBtn.addEventListener("click", () => {
  const res = lastResultJson[activeMode];
  if (!res) return;
  const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
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

if (playUploadBtn) {
  playUploadBtn.addEventListener("click", async () => {
    await playUploadedFile();
  });
}

if (playRecordBtn) {
  playRecordBtn.addEventListener("click", async () => {
    await playRecordedAudio();
  });
}

if (liveStartBtn) {
  liveStartBtn.addEventListener("click", async () => {
    await startLiveMode();
  });
}

if (liveStopBtn) {
  liveStopBtn.addEventListener("click", () => {
    stopLiveMode();
  });
}

if (inputDeviceSelect) {
  inputDeviceSelect.addEventListener("change", () => {
    selectedInputId = inputDeviceSelect.value || null;
    updateDeviceLabels();
  });
}

if (outputDeviceSelect) {
  outputDeviceSelect.addEventListener("change", () => {
    selectedOutputId = outputDeviceSelect.value || null;
    updateDeviceLabels();
  });
}

if (refreshDevicesBtn) {
  refreshDevicesBtn.addEventListener("click", () => {
    refreshDevices();
  });
}

saveWavBtn.addEventListener("click", () => {
  if (!lastRecordedPCM || !lastRecordedSampleRate) return;
  const wavBuf = encodeWAV(lastRecordedPCM, lastRecordedSampleRate);
  const blob = new Blob([wavBuf], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const name = `recording_${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Initial mode sync
setActiveMode("file");
refreshDevices().catch(() => {
  /* ignore */
});
updateDeviceLabels();
