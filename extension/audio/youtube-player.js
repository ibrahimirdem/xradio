// YouTube müzik kaynağı.
// Varsayılan: gizli (offscreen) belgede gömülü YouTube oynatıcısı; IFrame API'nin postMessage protokolüyle
// kontrol edilir (harici betik yüklemeden). Gömmeye izin vermeyen bağlantılarda otomatik olarak
// sabitlenmiş bir YouTube sekmesine geçilir (tabBridge üzerinden arka plan betiği yönetir).

import { parseYouTubeUrl, embedUrl, watchUrl, isUnembeddable, ytErrorText, YT_PRESETS, MOOD_TO_GROUP } from '../lib/youtube.js';

const YT_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];

export class YouTubeMusic {
  constructor(engine, { url, mode = 'auto', followMood = false, onTrack = () => {}, onStatus = () => {}, log = () => {}, tabBridge = null } = {}) {
    this.engine = engine;
    this.url = url || YT_PRESETS[0].url;
    this.mode = mode;
    this.followMood = followMood;
    this.onTrack = onTrack;
    this.onStatus = onStatus;
    this.log = log;
    this.tabBridge = tabBridge;
    this.iframe = null;
    this.active = null;          // 'embed' | 'tab'
    this.info = {};              // son bilinen oynatıcı bilgisi
    this.infoAt = 0;
    this.state = -1;
    this.lastTitle = '';
    this.volume = -1;
    this.tween = null;
    this.failures = 0;
    this.tried = new Set();
    this.events = [];          // tanı için son olaylar
    this.t0 = performance.now();
    this.onMessage = this.onMessage.bind(this);
    this.unsub = engine.onLevels(({ seconds }) => this.applyVolume(seconds));
  }

  setStyle() {}

  targetVolume() {
    const e = this.engine;
    return Math.round(Math.max(0, Math.min(1, e.musicLevel * e.duckValue * (e.masterLevel / 0.9))) * 100);
  }

  async start() {
    const parsed = parseYouTubeUrl(this.url);
    this.parsed = parsed || parseYouTubeUrl(YT_PRESETS[0].url);
    this.tried.add(this.url);
    if (this.mode === 'tab' || !embedUrl(this.parsed)) return this.startTab();
    return this.startEmbed();
  }

  startEmbed() {
    this.stopEmbed();
    this.active = 'embed';
    this.state = -1;
    window.addEventListener('message', this.onMessage);
    const f = document.createElement('iframe');
    f.id = 'xradio-yt';
    f.width = '480'; f.height = '270';
    f.allow = 'autoplay; encrypted-media';
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    f.src = embedUrl(this.parsed, { shuffle: !!this.parsed.listId && !this.parsed.videoId });
    (document.getElementById('yt-host') || document.body).appendChild(f);
    this.iframe = f;
    this.note('iframe ' + f.src.replace(/\?.*/, ''));
    f.addEventListener('load', () => {
      this.note('iframe load');
      this.post({ event: 'listening', id: 'xradio', channel: 'widget' });
      for (const ev of ['onReady', 'onStateChange', 'onError']) this.post({ event: 'command', func: 'addEventListener', args: [ev], id: 'xradio', channel: 'widget' });
      setTimeout(() => this.kick(), 1200);
    });
    this.status('loading', 'YouTube yükleniyor…');
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.checkStarted(1), 4000);
  }

  kick() {
    this.applyVolume(0, true);
    this.post({ event: 'command', func: 'unMute', args: [] });
    this.post({ event: 'command', func: 'playVideo', args: [] });
  }

  /**
   * Oynatıcı hazır olsa da (özellikle çalma listelerinde) ilk "oynat" komutu yoksayılabiliyor.
   * Çalma başlayana kadar ~3 sn arayla yeniden dener; ~45 sn'de hâlâ başlamadıysa yedeğe geçer.
   */
  checkStarted(round) {
    if (this.active !== 'embed' || this.state === 1 || this.state === 3) return;
    if (round < 14) {
      this.kick();
      this.watchdog = setTimeout(() => this.checkStarted(round + 1), 3000);
      return;
    }
    this.log('youtube: oynatma başlamadı');
    this.fail('Oynatma başlamadı', false);
  }

  post(obj) {
    try { this.iframe?.contentWindow?.postMessage(JSON.stringify(obj), '*'); } catch { /* */ }
  }

  onMessage(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow || !YT_ORIGINS.includes(e.origin)) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (!d || !d.event) return;
    if (d.event === 'onReady') { this.note('onReady'); this.kick(); return; }
    if (d.event === 'onStateChange') { this.note('onStateChange ' + d.info); this.setState(Number(d.info)); return; }
    if (d.event === 'onError') { this.note('onError ' + d.info); this.onPlayerError(d.info); return; }
    if (d.event === 'initialDelivery' || (d.event === 'infoDelivery' && d.info?.playerState !== undefined)) this.note(`${d.event} state=${d.info?.playerState}`);
    if (d.event === 'infoDelivery' && d.info) {
      Object.assign(this.info, d.info);
      this.infoAt = performance.now();
      if (d.info.playerState !== undefined) this.setState(Number(d.info.playerState));
      if (d.info.videoData) this.checkTitle();
    }
    if (d.event === 'initialDelivery' && d.info) { Object.assign(this.info, d.info); this.checkTitle(); }
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    // Başlamadı (-1) / hazırlandı (5): kısa süre sonra yeniden "oynat" de
    if ((s === -1 || s === 5) && this.active === 'embed') setTimeout(() => { if (this.state === -1 || this.state === 5) this.kick(); }, 900);
    if (s === 1) {
      this.failures = 0;
      this.status('playing', 'YouTube çalıyor');
      this.applyVolume(0.5, true);
      this.checkTitle();
    }
    if (s === 0 && this.parsed?.videoId && !this.parsed.listId) {
      // Tek video bitti → başa sar (canlı olmayanlar için döngü)
      this.post({ event: 'command', func: 'seekTo', args: [0, true] });
      this.post({ event: 'command', func: 'playVideo', args: [] });
    }
  }

  checkTitle() {
    const vd = this.info.videoData || {};
    const title = vd.title || '';
    if (title && title !== this.lastTitle) {
      this.lastTitle = title;
      this.onTrack(this.nowPlaying());
    }
  }

  onPlayerError(code) {
    this.log('youtube error', code);
    const unembeddable = isUnembeddable(code);
    this.fail(ytErrorText(code), unembeddable);
  }

  /** Hata: gömülemiyorsa sekme moduna, yoksa aynı gruptaki sonraki hazır yayına geç. */
  fail(reason, unembeddable) {
    clearTimeout(this.watchdog);
    this.failures++;
    if (unembeddable && this.mode !== 'embed' && this.tabBridge && this.active === 'embed') {
      this.status('fallback', `${reason} — YouTube sekmesine geçiliyor`);
      this.startTab();
      return;
    }
    const next = this.nextPreset();
    if (next && this.failures < 6) {
      this.status('fallback', `${reason} — "${next.label}" deneniyor`);
      this.switchTo(next.url);
      return;
    }
    this.status('error', reason);
    this.onStatus({ state: 'dead', reason });
  }

  currentGroup() {
    const p = YT_PRESETS.find((x) => x.url === this.url);
    return p ? p.group : 'Lo-fi';
  }

  nextPreset(group = this.currentGroup()) {
    const inGroup = YT_PRESETS.filter((p) => p.group === group && !this.tried.has(p.url));
    if (inGroup.length) return inGroup[0];
    return YT_PRESETS.find((p) => !this.tried.has(p.url)) || null;
  }

  async switchTo(url) {
    this.url = url;
    this.tried.add(url);
    this.parsed = parseYouTubeUrl(url);
    this.lastTitle = '';
    this.info = {};
    if (this.active === 'tab' && this.tabBridge) return this.startTab();
    return this.startEmbed();
  }

  async startTab() {
    this.stopEmbed();
    if (!this.tabBridge) { this.status('error', 'Sekme modu kullanılamıyor'); return; }
    this.active = 'tab';
    this.status('loading', 'YouTube sekmesi açılıyor…');
    const url = watchUrl(this.parsed) || this.url;
    try {
      await this.tabBridge.open(url, this.targetVolume());
    } catch (e) {
      this.status('error', 'YouTube sekmesi açılamadı: ' + e.message);
    }
  }

  /** Sekmedeki içerik betiğinden gelen durum. */
  onTabStatus(st) {
    if (this.active !== 'tab' || !st) return;
    this.info = { videoData: { title: st.title, author: st.author, isLive: st.live }, currentTime: st.currentTime, duration: st.duration };
    this.infoAt = performance.now();
    this.setState(st.paused ? 2 : 1);
    if (st.needsGesture) this.status('needs-gesture', 'YouTube sekmesine bir kez tıklayıp oynatmayı başlat');
    this.checkTitle();
  }

  applyVolume(seconds = 0.6, force = false) {
    const target = this.targetVolume();
    if (this.active === 'tab') {
      this.tabBridge?.command('volume', { volume: target, seconds }).catch(() => {});
      this.volume = target;
      return;
    }
    if (!this.iframe) return;
    clearInterval(this.tween);
    const from = this.volume < 0 ? target : this.volume;
    if (force || seconds <= 0.05 || from === target) {
      this.volume = target;
      this.post({ event: 'command', func: 'setVolume', args: [target] });
      return;
    }
    const steps = Math.max(2, Math.round(seconds * 20));
    let i = 0;
    this.tween = setInterval(() => {
      i++;
      const v = Math.round(from + (target - from) * (i / steps));
      this.volume = v;
      this.post({ event: 'command', func: 'setVolume', args: [v] });
      if (i >= steps) clearInterval(this.tween);
    }, 50);
  }

  status(state, text) { this.note(`durum:${state} ${text || ''}`); this.onStatus({ state, text, mode: this.active }); }

  note(msg) {
    this.events.push(`${((performance.now() - this.t0) / 1000).toFixed(1)}s ${msg}`);
    if (this.events.length > 40) this.events.shift();
  }

  debug() {
    return { active: this.active, url: this.url, src: this.iframe?.src || null, state: this.state, volume: this.volume, title: this.info.videoData?.title || null, events: this.events.slice(-25) };
  }

  stopEmbed() {
    clearTimeout(this.watchdog);
    clearInterval(this.tween);
    window.removeEventListener('message', this.onMessage);
    if (this.iframe) {
      try { this.post({ event: 'command', func: 'stopVideo', args: [] }); } catch { /* */ }
      this.iframe.remove();
      this.iframe = null;
    }
  }

  stop() {
    this.stopEmbed();
    if (this.active === 'tab') this.tabBridge?.close().catch(() => {});
    this.active = null;
    this.unsub?.();
  }

  async skip() {
    if (this.parsed?.listId) {
      if (this.active === 'tab') await this.tabBridge?.command('next', {}).catch(() => {});
      else this.post({ event: 'command', func: 'nextVideo', args: [] });
      return this.nowPlaying();
    }
    // Tek yayın: aynı gruptaki bir sonraki hazır yayına geç
    const group = this.currentGroup();
    const list = YT_PRESETS.filter((p) => p.group === group);
    const idx = list.findIndex((p) => p.url === this.url);
    const next = list[(idx + 1) % list.length] || YT_PRESETS[0];
    this.failures = 0;
    await this.switchTo(next.url);
    return this.nowPlaying();
  }

  /** DJ'lerin müzik önerisi (isteğe bağlı): uygun hazır gruba geç. */
  async setMood(mood) {
    if (!this.followMood || !mood) return;
    const group = MOOD_TO_GROUP[mood];
    if (!group || group === this.currentGroup()) return;
    const p = YT_PRESETS.find((x) => x.group === group);
    if (p) { this.failures = 0; await this.switchTo(p.url); }
  }

  async planNext(mood) { await this.setMood(mood); return this.nowPlaying(); }
  async transitionTo() { return this.nowPlaying(); }
  plannedMeta() { return this.nowPlaying(); }

  nowPlaying() {
    const vd = this.info.videoData || {};
    const preset = YT_PRESETS.find((x) => x.url === this.url);
    const live = !this.parsed?.listId && !!(vd.isLive || preset?.live || Number(this.info.currentTime) > 2 * 86400
      || (this.info.duration !== undefined && !(Number(this.info.duration) > 0)));
    if (!vd.title && !this.active) return null;
    return {
      id: 'yt:' + (vd.video_id || this.parsed?.videoId || this.parsed?.listId || ''),
      title: vd.title || 'YouTube',
      artist: vd.author || 'YouTube',
      style: 'youtube',
      styleLabel: live ? 'YouTube canlı yayını' : 'YouTube',
      live,
      url: this.url,
      mode: this.active,
      duration: Math.round(this.info.duration || 0),
      position: Math.round(this.currentTime()),
    };
  }

  currentTime() {
    const t = Number(this.info.currentTime) || 0;
    if (this.state !== 1) return t;
    return t + (performance.now() - this.infoAt) / 1000;
  }

  timeToTrackEnd() {
    const d = Number(this.info.duration) || 0;
    const np = this.nowPlaying();
    if (!d || np?.live) return Infinity;
    return Math.max(0, d - this.currentTime());
  }

  get playing() { return this.state === 1; }
}
