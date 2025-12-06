# `src/core/note-utils.ts` — Frequency ⇄ Note Utilities

Utilities for converting frequencies (Hz) to musical note names (e.g., `C#4`), parsing user-provided expected notes (e.g., `A4`, `440`), and computing cents deviation.

## Key functions

- `frequencyToNote(frequency)` → returns `{ note, frequency, cents }`.
- `parseExpectedNote(input)` → accepts numeric Hz or note name and returns frequency in Hz.
- `centsOffFromReference(freq, expected)` → returns cents difference.

## Theory & math

- Conversion uses MIDI note number: noteNumber = 12 \* log2(frequency / 440) + 69.
- Rounded MIDI note maps to a note name + octave. Cents computed as (noteNumber - roundedNote) \* 100.
- Cents calculation for deviation: cents = 1200 \* log2(freq / expected).

## Complexity

- All operations are O(1) (constant time) per call.

## Edge cases & behavior

- `parseExpectedNote` accepts pure numbers (Hz) and note-name forms like `C4`, `Bb3`.
- The function returns `null` for invalid formats.

## Improvements

- Allow multi-digit octaves (e.g., `C10`) by adjusting the regex.
- Add support for alternative A4 tuning (non-440 reference) as an option.
- Return a richer representation with both sharp/flat preference and MIDI number for downstream usage.
