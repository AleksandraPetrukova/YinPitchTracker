# Frontend → Pitch Detection Flow

Shows how an input in the browser travels from the UI to the YIN detector and back to the UI.

## High-level steps

1. User action  
   - File mode: choose WAV → decoded to mono via `decodeWavFile`.  
   - Record mode: mic chunks captured in a `ScriptProcessor`, concatenated after stop.  
   - Live mode: `ScriptProcessor` consumes mic audio continuously.
2. Buffer setup  
   - Sets `pendingBuffer`/`pendingSampleRate` (file/record) or streams frames directly (live).
3. PitchEngine  
   - `PitchEngine.processFrame` runs filters, RMS, normalization/noise gate, then `Yin.detectPitch`.
4. Readout  
   - Smoothing → note/deviation calculation → result object `{ frequency, confidence, note, deviation, frameRMS }`.
5. UI + export  
   - Displays per mode; file/record modes also assemble JSON payload for download.

## Diagram (Mermaid)

```mermaid
flowchart LR
  U[User action<br/>File / Record / Live] --> UI[Frontend UI<br/>buttons, inputs]

  UI -->|File choose| Dec[decodeWavFile → mono PCM<br/>pendingBuffer + sampleRate]
  UI -->|Record start/stop| Rec[Mic chunks via ScriptProcessor<br/>concat → pendingBuffer]
  UI -->|Live start| Live[ScriptProcessor frames<br/>streamed immediately]

  subgraph PitchEngine path
    PE[PitchEngine.processFrame]
    DSP[Filters / RMS / normalize / noise gate]
    YIN[Yin.detectPitch<br/>diff → CMND → threshold → parabola]
    SM[Median + moving average smoothing]
    NOTE[Note utils<br/>Hz ↔ note + cents deviation]
    PE --> DSP --> YIN --> SM --> NOTE
  end

  Dec --> PE
  Rec --> PE
  Live --> PE

  NOTE --> UIUpdate[UI update<br/>pitch, note, confidence, deviation]
  NOTE --> Export[JSON export (file/record modes)]
```

## Code map

- UI and wiring: `src/frontend/app.ts` (`decodeWavFile`, `startRecording`/`stopRecording`, `startLiveMode`, `analyzeOnce`).
- Pitch pipeline: `src/core/pitch-engine.ts` (filters, noise control, smoothing, note math).
- Detector: `src/core/yin.ts` (lag search, CMND, parabolic interpolation).
- Note helpers: `src/core/note-utils.ts`.
- DSP config: `src/core/dsp/dsp-config.ts`.
