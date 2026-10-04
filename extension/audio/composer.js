// Besteci: stil ve havaya göre bir parçanın planını çıkarır (akorlar, tempo, bölümler).
// Saf JS — ses API'si kullanmaz, Node'da test edilebilir.

import { mulberry32, hashSeed, choice, irange, range, chance } from './rng.js';
import { trackTitle, trackArtist, localStyleLabel } from './names.js';

export const CHORD_TYPES = {
  maj: [0, 4, 7], min: [0, 3, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14],
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], six9: [0, 4, 9, 14],
  min7: [0, 3, 7, 10], min9: [0, 3, 7, 10, 14], min11: [0, 3, 7, 10, 14, 17],
  dom7: [0, 4, 7, 10], dom9: [0, 4, 7, 10, 14], dom13: [0, 4, 10, 14, 21], m7b5: [0, 3, 6, 10],
};

const C = (root, type) => ({ root, type });

// Majör tonda ilerlemeler (kök: tona göre yarım ses)
const PROG_MAJOR = [
  [C(2, 'min9'), C(7, 'dom13'), C(0, 'maj9'), C(9, 'min9')],
  [C(0, 'maj7'), C(9, 'min7'), C(2, 'min7'), C(7, 'dom9')],
  [C(5, 'maj9'), C(4, 'min7'), C(9, 'min9'), C(0, 'maj7')],
  [C(0, 'maj9'), C(5, 'maj9'), C(4, 'min7'), C(9, 'min9')],
  [C(9, 'min9'), C(5, 'maj7'), C(0, 'maj7'), C(7, 'dom9')],
  [C(5, 'maj7'), C(7, 'dom9'), C(4, 'min7'), C(9, 'min7')],
];
// Minör tonda ilerlemeler
const PROG_MINOR = [
  [C(0, 'min9'), C(5, 'min9'), C(10, 'dom9'), C(3, 'maj7')],
  [C(0, 'min9'), C(8, 'maj7'), C(3, 'maj7'), C(10, 'dom9')],
  [C(0, 'min9'), C(5, 'min9'), C(7, 'min7'), C(0, 'min9')],
  [C(2, 'm7b5'), C(7, 'dom7'), C(0, 'min9'), C(0, 'min11')],
  [C(0, 'min11'), C(10, 'six9'), C(8, 'maj9'), C(7, 'min7')],
];
const PROG_EPIC = [
  [C(0, 'min'), C(8, 'maj'), C(3, 'maj'), C(10, 'maj')],
  [C(0, 'min'), C(10, 'maj'), C(8, 'maj'), C(10, 'maj')],
  [C(0, 'min'), C(3, 'maj'), C(10, 'maj'), C(5, 'min')],
  [C(8, 'maj7'), C(10, 'maj'), C(0, 'min'), C(0, 'min')],
];
const PROG_AMBIENT = [
  [C(0, 'maj9'), C(5, 'maj9')],
  [C(0, 'add9'), C(9, 'min9'), C(5, 'maj9'), C(7, 'sus2')],
  [C(0, 'min11'), C(8, 'maj9')],
  [C(5, 'maj9'), C(0, 'six9')],
];

export const STYLES = {
  lofi: { label: 'lo-fi', bpm: [72, 88], swing: [0.1, 0.2], minor: 0.45, progs: 'jazzy', chordBars: 1, targetSec: [150, 200] },
  jazz: { label: 'caz', bpm: [104, 132], swing: [0.28, 0.36], minor: 0.35, progs: 'jazzy', chordBars: 1, targetSec: [150, 200] },
  house: { label: 'deep house', bpm: [118, 124], swing: [0.02, 0.08], minor: 0.8, progs: 'minor', chordBars: 1, targetSec: [170, 220] },
  synthwave: { label: 'synthwave', bpm: [94, 110], swing: [0, 0], minor: 1, progs: 'epic', chordBars: 1, targetSec: [160, 210] },
  ambient: { label: 'ambient', bpm: [62, 72], swing: [0, 0], minor: 0.3, progs: 'ambient', chordBars: 2, targetSec: [150, 210] },
};

export const MOOD_TO_STYLE = {
  chill: 'lofi', upbeat: 'house', dreamy: 'ambient', groovy: 'jazz', tense: 'synthwave', night: 'lofi',
};

/** Ayar + hava + saat → stil. */
export function chooseStyle(setting, mood, hour = new Date().getHours(), rnd = Math.random) {
  if (setting && setting !== 'auto' && STYLES[setting]) return setting;
  if (mood && MOOD_TO_STYLE[mood]) {
    if (mood === 'night') return chance(rnd, 0.5) ? 'ambient' : 'lofi';
    return MOOD_TO_STYLE[mood];
  }
  if (hour < 6) return choice(rnd, ['ambient', 'lofi', 'lofi']);
  if (hour < 11) return choice(rnd, ['jazz', 'lofi', 'lofi', 'house']);
  if (hour < 17) return choice(rnd, ['lofi', 'lofi', 'house', 'jazz', 'synthwave']);
  if (hour < 22) return choice(rnd, ['jazz', 'synthwave', 'lofi', 'house']);
  return choice(rnd, ['lofi', 'ambient', 'jazz']);
}

function progsFor(kind, minor) {
  if (kind === 'epic') return PROG_EPIC;
  if (kind === 'ambient') return PROG_AMBIENT;
  if (kind === 'minor') return PROG_MINOR;
  return minor ? PROG_MINOR : PROG_MAJOR;
}

const SECTION_PROFILE = {
  intro: { drums: 0, bass: 0, keys: 1, pad: 1, melody: 0, sweep: true },
  A: { drums: 1, bass: 1, keys: 1, pad: 0, melody: 0 },
  A2: { drums: 1, bass: 1, keys: 1, pad: 0, melody: 1 },
  B: { drums: 2, bass: 1, keys: 1, pad: 1, melody: 1 },
  break: { drums: 0, bass: 0, keys: 1, pad: 1, melody: 1, sparse: true },
  outro: { drums: 1, bass: 1, keys: 1, pad: 1, melody: 0, fadeOut: true },
};

let trackCounter = 0;

/**
 * Bir parça planı üretir.
 * opts: { style, mood, seed, station }
 */
export function composeTrack({ style = 'lofi', mood = null, seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0 } = {}) {
  const st = STYLES[style] || STYLES.lofi;
  const rnd = mulberry32(hashSeed(seed, style, mood || ''));
  const minor = rnd() < st.minor || mood === 'tense' || mood === 'night';
  let bpm = Math.round(range(rnd, st.bpm[0], st.bpm[1]));
  if (mood === 'upbeat') bpm = Math.round(bpm * 1.06);
  if (mood === 'night' || mood === 'dreamy') bpm = Math.round(bpm * 0.94);
  const swing = range(rnd, st.swing[0], st.swing[1]);
  const key = irange(rnd, 0, 11);
  const progs = progsFor(st.progs, minor);
  const progA = choice(rnd, progs);
  let progB = choice(rnd, progs);
  for (let i = 0; i < 4 && progB === progA; i++) progB = choice(rnd, progs);
  const expand = (p) => p.flatMap((c) => Array(st.chordBars).fill(c));

  const barDur = 240 / bpm;
  const targetBars = Math.round(range(rnd, st.targetSec[0], st.targetSec[1]) / barDur / 4) * 4;
  const plan = ['intro', 'A', 'B', 'A2', 'break', 'B', 'A2', 'B', 'A2', 'B', 'A2'];
  const sections = [];
  let bars = 0;
  for (const type of plan) {
    const len = type === 'intro' || type === 'break' ? 4 : 8;
    if (bars + len + 4 > targetBars && sections.length >= 3) break;
    const prog = expand(type === 'B' || type === 'break' ? progB : progA);
    sections.push({ type, bars: len, prog, ...SECTION_PROFILE[type] });
    bars += len;
  }
  sections.push({ type: 'outro', bars: 4, prog: expand(progA), ...SECTION_PROFILE.outro });
  bars += 4;

  const chunks = [];
  sections.forEach((sec, si) => {
    for (let b = 0; b < sec.bars; b += 4) chunks.push({ section: si, barOffset: b, bars: Math.min(4, sec.bars - b), last: b + 4 >= sec.bars });
  });

  trackCounter++;
  const title = trackTitle(rnd, style);
  const artist = trackArtist(rnd, style);
  return {
    id: `t${Date.now().toString(36)}${trackCounter}`,
    seed: hashSeed(seed, 'r'),
    style,
    styleLabel: localStyleLabel(style, st.label),
    mood: mood || (minor ? 'night' : 'chill'),
    title,
    artist,
    bpm,
    swing,
    key,
    minor,
    barDur,
    sections,
    chunks,
    bars,
    duration: bars * barDur,
    instruments: {
      keys: style === 'house' ? 'organ' : style === 'synthwave' ? 'pad' : style === 'ambient' ? 'pad' : choice(rnd, ['rhodes', 'rhodes', 'wurli']),
      lead: style === 'synthwave' ? 'arp' : style === 'house' ? 'none' : style === 'ambient' ? 'bell' : choice(rnd, ['bell', 'pluck', 'vibes']),
      bass: style === 'synthwave' ? 'saw' : style === 'jazz' ? 'upright' : style === 'ambient' ? 'sub' : 'round',
      brightness: range(rnd, 0.4, 0.9) * (mood === 'night' ? 0.8 : 1),
      crackle: style === 'lofi' ? range(rnd, 0.5, 1) : style === 'jazz' ? range(rnd, 0, 0.4) : 0,
    },
  };
}

export function trackMeta(t) {
  if (!t) return null;
  return { id: t.id, title: t.title, artist: t.artist, style: t.style, styleLabel: t.styleLabel, mood: t.mood, bpm: t.bpm, duration: Math.round(t.duration) };
}

/** Akoru belirli bir aralıkta, kökü olmadan (bas kökü çalar) seslendirir. */
export function voiceChord(key, chord, { low = 55, high = 76, rootless = true } = {}) {
  const ints = CHORD_TYPES[chord.type] || CHORD_TYPES.maj7;
  const root = 48 + ((key + chord.root) % 12);
  let notes = ints.filter((i, idx) => !(rootless && idx === 0 && ints.length > 3)).map((i) => root + i);
  notes = notes.map((n) => { while (n < low) n += 12; while (n > high) n -= 12; return n; });
  return [...new Set(notes)].sort((a, b) => a - b);
}

export function bassNote(key, chord, low = 36) {
  let n = low + ((key + chord.root) % 12);
  if (n > low + 9) n -= 12;
  return n;
}

export function scaleNotes(key, minor) {
  const pent = minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const out = [];
  for (let oct = 5; oct <= 6; oct++) for (const p of pent) out.push(12 * oct + key + p);
  return out.filter((n) => n >= 62 && n <= 86);
}
