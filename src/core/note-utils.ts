// note-utils.ts
// Utility functions for converting between Hz and note names (C4, F#3, etc.)
// and computing cents deviation.

export interface NoteInfo {
  note: string;          // e.g. "C#4"
  frequency: number;     // exact equal-tempered frequency in Hz
  cents: number;         // deviation from equal-tempered
}

const A4_FREQUENCY = 440; // Fixed in this version
const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Convert frequency (Hz) to note info (name + octave + cents deviation)
 */
export function frequencyToNote(frequency: number): NoteInfo {
  if (!frequency || frequency <= 0) {
    return { note: "Unknown", frequency: 0, cents: 0 };
  }

  // Step 1: Note number relative to MIDI scale
  const noteNumber = 12 * (Math.log2(frequency / A4_FREQUENCY)) + 69;
  const roundedNote = Math.round(noteNumber);
  const cents = Math.round((noteNumber - roundedNote) * 100);

  // Step 2: Name with smart accidental (choose sharp or flat if needed)
  const noteNameSharp = NOTES_SHARP[roundedNote % 12];
  const noteNameFlat  = NOTES_FLAT[roundedNote % 12];
  const noteName = chooseSmartAccidental(noteNameSharp, noteNameFlat);
  const octave = Math.floor(roundedNote / 12) - 1;

  return {
    note: `${noteName}${octave}`,
    frequency,
    cents
  };
}

/**
 * Convert note name like "C4", "A#3", "Db5" or frequency like "442"
 */
export function parseExpectedNote(input: string): number | null {
  // If number → treat as Hz
  if (/^\d+(\.\d+)?$/.test(input.trim())) {
    return parseFloat(input);
  }

  // Note name form
  const match = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(input.trim());
  if (!match) return null;

  const [, letter, accidental, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);

  // Find semitone index
  const name = letter.toUpperCase() + accidental;
  const indexSharp = NOTES_SHARP.indexOf(name);
  const indexFlat  = NOTES_FLAT.indexOf(name);
  const semitone = Math.max(indexSharp, indexFlat); // use whichever matches

  const midi = semitone + (octave + 1) * 12;

  // Convert MIDI to frequency
  return A4_FREQUENCY * Math.pow(2, (midi - 69) / 12);
}

/**
 * Compute cents deviation from expected frequency
 */
export function centsOffFromReference(freq: number, expected: number): number {
  return 1200 * Math.log2(freq / expected);
}

/**
 * Smart accidental logic: choose simple accidental
 */
function chooseSmartAccidental(sharp: string, flat: string): string {
  // Fewer characters → simpler
  if (sharp.length < flat.length) return sharp;
  return flat;
}
