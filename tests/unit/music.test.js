import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl, embedUrl, watchUrl, YT_PRESETS, isUnembeddable } from '../../extension/lib/youtube.js';
import { composeTrack, chooseStyle, voiceChord, STYLES } from '../../extension/audio/composer.js';
import { DEFAULT_SETTINGS, mergeSettings, resolveEngine, GEMINI_VOICES } from '../../extension/lib/config.js';

test('YouTube bağlantı çözümleme', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=rFZHOHl-L8A'), { videoId: 'rFZHOHl-L8A', listId: null, channelId: null, handle: null, music: false });
  assert.equal(parseYouTubeUrl('https://youtu.be/rFZHOHl-L8A?t=4').videoId, 'rFZHOHl-L8A');
  assert.equal(parseYouTubeUrl('youtube.com/live/rFZHOHl-L8A').videoId, 'rFZHOHl-L8A');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ').listId, 'PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ');
  const both = parseYouTubeUrl('https://www.youtube.com/watch?v=rFZHOHl-L8A&list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ');
  assert.ok(both.videoId && both.listId);
  assert.equal(parseYouTubeUrl('https://music.youtube.com/watch?v=rFZHOHl-L8A').music, true);
  assert.equal(parseYouTubeUrl('https://www.youtube.com/@LofiGirl').handle, '@LofiGirl');
  assert.equal(parseYouTubeUrl('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow').channelId, 'UCSJ4gkVC6NrvII8umztf0Ow');
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=rFZHOHl-L8A'), null);
  assert.equal(parseYouTubeUrl(''), null);
  assert.equal(parseYouTubeUrl('rFZHOHl-L8A').videoId, 'rFZHOHl-L8A');
});

test('gömme ve izleme adresleri', () => {
  const v = embedUrl(parseYouTubeUrl('https://www.youtube.com/watch?v=rFZHOHl-L8A'));
  assert.match(v, /^https:\/\/www\.youtube\.com\/embed\/rFZHOHl-L8A\?/);
  assert.match(v, /enablejsapi=1/);
  assert.match(v, /autoplay=1/);
  const l = embedUrl(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ'), { shuffle: true });
  assert.match(l, /embed\/videoseries\?.*list=PLF3eNE6vR-4WsBf8qnJLqBywqX39QczxJ/);
  assert.match(l, /shuffle=1/);
  assert.match(embedUrl(parseYouTubeUrl('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow')), /embed\/live_stream\?.*channel=UCSJ4gkVC6NrvII8umztf0Ow/);
  assert.equal(embedUrl(parseYouTubeUrl('https://www.youtube.com/@LofiGirl')), null, 'handle gömülemez → sekme modu');
  assert.equal(watchUrl(parseYouTubeUrl('https://www.youtube.com/@LofiGirl')), 'https://www.youtube.com/@LofiGirl/live');
  assert.ok(isUnembeddable(150) && isUnembeddable('153') && !isUnembeddable(100));
});

test('hazır YouTube seçenekleri geçerli ve varsayılan ayar onlardan biri', () => {
  for (const p of YT_PRESETS) assert.ok(embedUrl(parseYouTubeUrl(p.url)), p.id);
  assert.ok(YT_PRESETS.some((p) => p.url === DEFAULT_SETTINGS.youtubeUrl));
  assert.equal(DEFAULT_SETTINGS.musicSource, 'youtube');
});

test('ayarlar birleştirme ve motor seçimi', () => {
  const s = mergeSettings({ hostA: { name: 'Zeynep' }, muteWords: 'kripto, bahis\nçekiliş' });
  assert.equal(s.hostA.name, 'Zeynep');
  assert.equal(s.hostA.voice, DEFAULT_SETTINGS.hostA.voice);
  assert.deepEqual(s.muteWords, ['kripto', 'bahis', 'çekiliş']);
  assert.equal(resolveEngine(mergeSettings({})), 'local');
  assert.equal(resolveEngine(mergeSettings({ apiKey: 'x' })), 'gemini');
  assert.equal(resolveEngine(mergeSettings({ apiKey: 'x', engine: 'local' })), 'local');
  assert.equal(GEMINI_VOICES.length, 30);
  assert.equal(GEMINI_VOICES.find((v) => v.id === DEFAULT_SETTINGS.hostA.voice).gender, 'f');
  assert.equal(GEMINI_VOICES.find((v) => v.id === DEFAULT_SETTINGS.hostB.voice).gender, 'm');
});

test('besteci (yedek müzik): yapı, süre, parçalar', () => {
  for (const style of Object.keys(STYLES)) {
    const t = composeTrack({ style, seed: 42 });
    assert.ok(t.duration > 100 && t.duration < 320, `${style} süre ${t.duration}`);
    assert.equal(t.sections[0].type, 'intro');
    assert.equal(t.sections.at(-1).type, 'outro');
    const bars = t.chunks.reduce((a, c) => a + c.bars, 0);
    assert.equal(bars, t.bars);
    assert.ok(t.title.length > 2);
  }
  const a = composeTrack({ style: 'lofi', seed: 7 });
  const b = composeTrack({ style: 'lofi', seed: 7 });
  assert.equal(a.title, b.title, 'aynı tohum aynı parça');
  assert.equal(chooseStyle('jazz', 'upbeat'), 'jazz');
  assert.equal(chooseStyle('auto', 'groovy'), 'jazz');
  const v = voiceChord(0, { root: 2, type: 'min9' });
  assert.ok(v.every((n) => n >= 55 && n <= 76));
});
