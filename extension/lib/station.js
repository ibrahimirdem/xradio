// İstasyon: radyonun beyni. Gizli (offscreen) belgede çalışır.
// Görevleri: haber akışını almak, triyaj, yayın saati (ne zaman konuşulacak), bölüm hazırlama
// (senaryo + ses), bölümü müziğin uygun anına denk getirip çalmak, hafıza ve geçmiş kaydı.

import { mergeSettings, resolveEngine, TALK_INTERVALS, DEFAULT_MODELS, langInfo } from './config.js';
import { msg } from './messages.js';
import { NewsDesk, hasBreakingKeyword } from './newsdesk.js';
import { GeminiClient, GeminiError, pickModels } from './gemini.js';
import {
  buildTriageSystem, TRIAGE_SCHEMA, buildTriagePrompt, validateTriage,
  SCRIPT_SCHEMA, buildWriterSystem, buildWriterPrompt, validateScript, describeTime,
} from './prompts.js';
import { writeLocalScript } from './localwriter.js';
import { GeminiVoice, BrowserVoice, estimateTimings } from './voice.js';
import { topicSimilarity, truncate } from './textutil.js';
import * as db from './db.js';
import { getWeather } from './weather.js';
import { AudioEngine } from '../audio/engine.js';
import { GenerativeMusic, StreamMusic, SilentMusic } from '../audio/music.js';
import { setTrackLanguage } from '../audio/names.js';
import { YouTubeMusic } from '../audio/youtube-player.js';
import { getFx } from '../audio/fx.js';

const MIN = 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let segCounter = 0;

export class Station {
  constructor({ bridge }) {
    this.bridge = bridge;               // { emit(event, data), request(type, payload), tab: tabBridge }
    this.settings = mergeSettings({});
    this.on = false;
    this.phase = 'off';
    this.desk = new NewsDesk({ settings: this.settings });
    this.queue = [];                    // hazır bölümler
    this.preparing = new Map();         // kind -> Promise
    this.talking = false;
    this.current = null;
    this.memory = [];
    this.captions = [];
    this.usage = { input: 0, output: 0, calls: 0, tts: 0 };
    this.lastTalkAt = 0;
    this.nextTalkAt = 0;
    this.lastIdleAt = 0;
    this.lastTriageAt = 0;
    this.lastHourly = -1;
    this.lastBreakingAt = 0;
    this.openerDone = false;
    this.waitingFeed = false;
    this.sessionStart = 0;
    this.errors = [];
    this.engineMode = 'local';
    this.voiceMode = 'browser';
    this.ttsFailures = 0;
    this.ttsCooldownUntil = 0;
    this.models = null;
    this.musicStatus = { state: 'idle', text: '' };
    this.listenerQueue = [];
    this.playbacks = [];
    this.persistTimer = null;
    this.audioBlocked = false;
    this.browserVoice = new BrowserVoice();
  }

  log(...a) { try { console.log('[XRadio]', ...a); } catch { /* */ } }

  error(where, e) {
    const msg = `${where}: ${e?.message || e}`;
    this.log('HATA', msg);
    this.errors.push({ ts: Date.now(), msg });
    if (this.errors.length > 20) this.errors.shift();
    this.emit('error', { msg });
  }

  emit(event, data = {}) { try { this.bridge.emit(event, data); } catch { /* */ } }

  // ------------------------------------------------------------------ Kurulum
  async init(settings) {
    this.applySettings(settings, true);
    try {
      const saved = await db.kvGet('desk');
      if (saved) this.desk = NewsDesk.fromJSON(saved, { settings: this.settings });
      this.memory = (await db.kvGet('memory')) || [];
      this.meta = (await db.kvGet('meta')) || {};
      const usage = await db.kvGet('usage');
      const today = new Date().toDateString();
      if (usage && usage.day === today) this.usage = usage.data;
      this.usageDay = today;
    } catch (e) { this.error('veritabanı', e); this.meta = {}; }
  }

  applySettings(s, initial = false) {
    const prev = this.settings;
    this.settings = mergeSettings(s);
    setTrackLanguage(this.settings.language);
    this.desk.setSettings(this.settings);
    this.engineMode = resolveEngine(this.settings);
    if (this.engineMode === 'gemini') {
      if (!this.client || prev.apiKey !== this.settings.apiKey || prev.apiBase !== this.settings.apiBase) {
        this.authBlocked = false;
        this.client = new GeminiClient({
          apiKey: this.settings.apiKey,
          base: this.settings.apiBase,
          onUsage: (u) => this.trackUsage(u),
        });
        this.models = null;
        this.voice = new GeminiVoice({ client: this.client, engine: this.engine, getSettings: () => this.effectiveSettings() });
      }
      // Reddedilen anahtar değişmedikçe yerel modda kal (her ayar değişiminde boşuna istek atma)
      if (this.authBlocked) this.engineMode = 'local';
    } else {
      this.client = null;
    }
    if (!initial && this.engine) {
      this.engine.setVolumes({ master: this.settings.masterVolume, music: this.settings.musicVolume, voice: this.settings.voiceVolume });
      const musicChanged = ['musicSource', 'youtubeUrl', 'youtubeMode', 'streamUrl'].some((k) => prev[k] !== this.settings[k]);
      const listChanged = JSON.stringify(prev.myList) !== JSON.stringify(this.settings.myList) || prev.myListShuffle !== this.settings.myListShuffle;
      if (musicChanged && this.on) this.restartMusic().catch((e) => this.error('müzik', e));
      else if (listChanged && this.on && this.settings.musicSource === 'mylist') {
        // Liste düzenlendi: çalan parça kesilmeden yeni sıra uygulanır; liste boştan doluya geçtiyse yeniden başlat
        if (!this.music?.isMyList || !this.music.updateQueue(this.settings.myList, this.settings.myListShuffle)) this.restartMusic().catch((e) => this.error('müzik', e));
      } else if (this.music) {
        this.music.setStyle?.(this.settings.musicStyle);
        if ('followMood' in this.music) this.music.followMood = this.settings.youtubeFollowMood;
      }
    }
  }

  /** Model otomatik algılama sonuçlarını içeren ayarlar. */
  effectiveSettings() {
    const s = { ...this.settings };
    if (this.settings.autoModels && this.models) {
      if (this.models.text) s.textModel = this.models.text;
      if (this.models.triage) s.triageModel = this.models.triage;
      if (this.models.tts) s.ttsModel = this.models.tts;
    }
    return s;
  }

  async detectModels() {
    if (!this.client || !this.settings.autoModels || this.models) return;
    // Aynı anda birden çok çağrı gelirse tek bir model listesi isteği yapılır
    if (!this.modelsP) this.modelsP = this._detectModels().finally(() => { this.modelsP = null; });
    return this.modelsP;
  }

  async _detectModels() {
    try {
      const cached = await db.kvGet('models');
      if (cached && cached.key === this.settings.apiKey.slice(-6) && Date.now() - cached.at < 24 * 3600e3) {
        this.models = cached.models; return;
      }
      const list = await this.client.listModels();
      const picked = pickModels(list);
      this.models = {
        text: picked.text || DEFAULT_MODELS.text,
        triage: picked.triage || picked.text || DEFAULT_MODELS.triage,
        tts: picked.tts || DEFAULT_MODELS.tts,
      };
      await db.kvSet('models', { key: this.settings.apiKey.slice(-6), at: Date.now(), models: this.models });
      this.emit('models', this.models);
    } catch (e) {
      if (e instanceof GeminiError && e.authProblem) this.authFailed(e);
      else this.log('model listesi alınamadı', e.message);
      this.models = { text: this.settings.textModel, triage: this.settings.triageModel, tts: this.settings.ttsModel };
    }
  }

  authFailed(e) {
    if (this.authBlocked) return; // aynı anahtar için tek bildirim
    this.authBlocked = true;
    this.error('Gemini API anahtarı', e);
    this.engineMode = 'local';
    this.emit('notice', { level: 'error', text: msg(this.settings.language, 'authFailed') });
  }

  trackUsage(u) {
    const today = new Date().toDateString();
    if (this.usageDay !== today) { this.usage = { input: 0, output: 0, calls: 0, tts: 0 }; this.usageDay = today; }
    this.usage.input += u.input || 0;
    this.usage.output += u.output || 0;
    this.usage.calls += 1;
    if (u.tag === 'tts') this.usage.tts += 1;
    db.kvSet('usage', { day: today, data: this.usage }).catch(() => {});
  }

  // ------------------------------------------------------------------ Başlat / durdur
  async start() {
    if (this.on) return this.getState();
    this.on = true;
    this.phase = 'starting';
    this.sessionStart = Date.now();
    this.openerDone = false;
    this.lastBreakingAt = 0;
    // Başlangıç sırasında gelen paylaşımlar erken bir "ara sohbet" tetiklemesin
    this.lastTalkAt = Date.now();
    this.nextTalkAt = Date.now() + this.talkInterval();
    this.emitState();
    if (!this.engine) {
      this.engine = new AudioEngine();
      if (this.client) this.voice = new GeminiVoice({ client: this.client, engine: this.engine, getSettings: () => this.effectiveSettings() });
    }
    this.engine.setVolumes({ master: this.settings.masterVolume, music: this.settings.musicVolume, voice: this.settings.voiceVolume });
    const ok = await this.engine.resume();
    this.audioBlocked = !ok;
    if (!ok) this.emit('notice', { level: 'warn', text: msg(this.settings.language, 'audioBlocked') });

    await this.drainInbox();
    this.detectModels().catch(() => {});
    this.playFx('logo').catch(() => {});
    await this.startMusic();
    this.phase = 'music';

    this.lastTalkAt = Date.now();
    this.nextTalkAt = Date.now() + this.talkInterval();
    const awayMinutes = this.meta?.lastStopAt ? Math.round((Date.now() - this.meta.lastStopAt) / MIN) : null;
    this.prepare('opener', { firstEver: !this.meta?.firstRunDone, awayMinutes }).catch((e) => { this.error('açılış', e); this.openerDone = true; });

    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick().catch((e) => this.error('tick', e)), 2000);
    this.emitState();
    return this.getState();
  }

  async stop() {
    if (!this.on) return this.getState();
    this.on = false;
    this.phase = 'off';
    clearInterval(this.ticker);
    this.abortCtrl?.abort();
    this.browserVoice.cancel();
    this.stopPlaybacks();
    for (const seg of this.queue) this.desk.release(seg.id);
    this.queue = [];
    try { this.music?.stop(); } catch { /* */ }
    this.music = null;
    this.talking = false;
    this.current = null;
    this.meta = { ...(this.meta || {}), lastStopAt: Date.now(), firstRunDone: true };
    await db.kvSet('meta', this.meta).catch(() => {});
    await this.persist(true);
    try { await this.engine?.ctx.suspend(); } catch { /* */ }
    this.emitState();
    return this.getState();
  }

  talkInterval() {
    const base = (TALK_INTERVALS[this.settings.talkiness] || 7) * MIN;
    return base * (0.85 + Math.random() * 0.3);
  }

  // ------------------------------------------------------------------ Müzik
  async startMusic() {
    const s = this.settings;
    const onTrack = (meta) => { this.emit('track', meta); this.emitState(); };
    const onStatus = (st) => {
      this.musicStatus = st;
      this.emit('musicStatus', st);
      if (st.state === 'dead') this.fallbackMusic(st.reason).catch(() => {});
    };
    if (s.musicSource === 'mylist' && s.myList?.length) {
      this.music = new YouTubeMusic(this.engine, {
        queue: s.myList, shuffle: s.myListShuffle, startId: this.pendingTrack, mode: 'embed',
        onTrack, onStatus, log: (...a) => this.log(...a), tabBridge: this.bridge.tab,
      });
      this.pendingTrack = null;
    } else if (s.musicSource === 'youtube' || s.musicSource === 'mylist') {
      // 'mylist' ama liste boş: hazır yayınla başla
      this.music = new YouTubeMusic(this.engine, {
        url: s.youtubeUrl, mode: s.youtubeMode, followMood: s.youtubeFollowMood,
        onTrack, onStatus, log: (...a) => this.log(...a), tabBridge: this.bridge.tab,
      });
    } else if (s.musicSource === 'stream' && s.streamUrl) {
      this.music = new StreamMusic(this.engine, { url: s.streamUrl, onTrack, log: (...a) => this.log(...a) });
      this.engine.onLevels(({ music, duck, seconds }) => this.music?.setLevels?.(music, duck, seconds));
    } else if (s.musicSource === 'none') {
      this.music = new SilentMusic();
    } else {
      this.music = new GenerativeMusic(this.engine, { style: s.musicStyle, onTrack, log: (...a) => this.log(...a) });
    }
    try {
      await this.music.start();
    } catch (e) {
      this.error('müzik başlatılamadı', e);
      await this.fallbackMusic(e.message);
    }
  }

  async fallbackMusic(reason) {
    if (!this.on || this.music instanceof GenerativeMusic) return;
    this.emit('notice', { level: 'warn', text: msg(this.settings.language, 'musicFallback', { reason: reason || msg(this.settings.language, 'unknown') }) });
    this.ytDebugLast = this.music?.debug?.() || null;
    try { this.music?.stop(); } catch { /* */ }
    this.music = new GenerativeMusic(this.engine, { style: this.settings.musicStyle, onTrack: (m) => { this.emit('track', m); this.emitState(); }, log: (...a) => this.log(...a) });
    this.musicStatus = { state: 'playing', text: 'Yerleşik yedek müzik' };
    await this.music.start();
  }

  /** Müzik sekmesinden "şimdi çal": kişisel listedeki parçaya geç (liste henüz yüklenmediyse başlarken kullanılır). */
  async playTrack(id) {
    if (this.music?.isMyList && this.music.playId(id)) { this.emitState(); return { ok: true }; }
    this.pendingTrack = id;
    if (this.on && this.settings.musicSource === 'mylist' && this.settings.myList.some((t) => t.id === id)) await this.restartMusic();
    return { ok: true, pending: true };
  }

  async restartMusic() {
    try { this.music?.stop(); } catch { /* */ }
    this.music = null;
    await this.startMusic();
    this.emitState();
  }

  async playFx(name, { wait = true, gain = 1 } = {}) {
    if (!this.engine) return;
    const buf = await getFx(name, this.engine.ctx.sampleRate);
    const h = this.engine.play(buf, { bus: 'fx', gain });
    if (wait) await Promise.race([h.ended, sleep((buf.duration + 2) * 1000)]); // ses bağlamı askıdaysa takılma
    return h;
  }

  // ------------------------------------------------------------------ Haber alımı ve triyaj
  async drainInbox() {
    let tweets = [];
    try { tweets = await db.inboxDrain(); } catch (e) { this.error('gelen kutusu', e); }
    if (!tweets.length) return 0;
    const { fresh } = this.desk.ingest(tweets);
    if (fresh.length) {
      this.emit('board', {});
      const urgent = fresh.some((t) => hasBreakingKeyword(t.text));
      if (urgent) this.lastTriageAt = 0;
    }
    this.persist();
    return fresh.length;
  }

  async runTriage() {
    if (this.preparing.has('triage')) return this.preparing.get('triage');
    const ids = [...this.desk.untriaged].slice(0, 35);
    if (!ids.length) return;
    const p = (async () => {
      this.lastTriageAt = Date.now();
      if (this.engineMode === 'gemini' && this.client) {
        try {
          await this.detectModels();
          const tweets = ids.map((id) => this.desk.tweets.get(id)).filter(Boolean);
          const json = await this.client.generateJson({
            model: this.effectiveSettings().triageModel,
            system: buildTriageSystem(this.settings.language),
            prompt: buildTriagePrompt({ tweets, storyIndex: this.desk.storyIndex(), now: Date.now() }),
            schema: TRIAGE_SCHEMA,
            temperature: 0.2,
            thinking: 'low',
            tag: 'triage',
          });
          const items = validateTriage(json, new Set(ids));
          this.desk.applyTriage(items, 'ai');
          // Yapay zekânın atladığı tweet'ler yerel kurallarla işlenir
          const left = ids.filter((id) => this.desk.untriaged.has(id));
          if (left.length) this.desk.triageLocal(left);
        } catch (e) {
          if (e instanceof GeminiError && e.authProblem) this.authFailed(e);
          else this.error('triyaj (yerel kurallara geçildi)', e);
          this.desk.triageLocal(ids);
        }
      } else {
        this.desk.triageLocal(ids);
      }
      this.persist();
      this.emit('board', {});
    })();
    this.preparing.set('triage', p);
    try { await p; } finally { this.preparing.delete('triage'); }
  }

  persist(now = false) {
    clearTimeout(this.persistTimer);
    const save = () => db.kvSet('desk', this.desk.toJSON()).catch((e) => this.log('persist', e));
    if (now) return save();
    this.persistTimer = setTimeout(save, 1500);
    return null;
  }

  // ------------------------------------------------------------------ Yayın saati
  async tick() {
    if (!this.on || this.phase === 'starting') return;
    const now = Date.now();
    const s = this.settings;

    // Triyaj: yeni tweet varsa en geç 40 sn'de bir
    if (this.desk.untriaged.size && now - this.lastTriageAt > 40e3) this.runTriage().catch((e) => this.error('triyaj', e));

    // Açılış yayınlanmadan başka bölüm hazırlanmaz: birikmiş haberler açılışta topluca anlatılır
    if (!this.openerDone) {
      if (!this.talking && this.queue.length && this.shouldPlayNow(this.queue[0], now)) {
        const seg = this.queue.shift();
        this.playSegment(seg).catch((e) => { this.error('yayın', e); this.talking = false; this.engine?.unduck(); });
      } else if (!this.preparing.has('opener') && !this.queue.length && now - this.sessionStart > 3 * MIN) {
        this.openerDone = true; // açılış hazırlanamadıysa yayını kilitleme
      }
      return;
    }

    // Son dakika: bir seferde tek hikâye, iki son dakika arasında en az 10 dakika.
    // Bekleyen diğer acil haberler sıradaki normal gündem arasında anlatılır.
    const breaking = this.desk.breakingStories();
    if (breaking.length && now - this.lastBreakingAt >= 10 * MIN && !this.talking
      && !this.preparing.has('breaking') && !this.queue.some((q) => q.kind === 'breaking')) {
      this.lastBreakingAt = now;
      this.prepare('breaking', { stories: breaking.slice(0, 1) }).catch((e) => this.error('son dakika', e));
    }

    // Dinleyici mesajları
    if (this.listenerQueue.length && !this.preparing.has('listener')) {
      const message = this.listenerQueue.shift();
      this.prepare('listener', { message }).catch((e) => this.error('dinleyici', e));
    }

    // Hazır bölüm varsa uygun anı bekle
    if (!this.talking && this.queue.length) {
      this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      const seg = this.queue[0];
      if (this.shouldPlayNow(seg, now)) {
        this.queue.shift();
        this.playSegment(seg).catch((e) => { this.error('yayın', e); this.talking = false; this.engine?.unduck(); });
        return;
      }
    }

    // Saat başı özeti
    const d = new Date(now);
    if (d.getMinutes() < 2 && this.lastHourly !== d.getHours() && now - this.sessionStart > 20 * MIN
      && !this.preparing.has('hourly') && !this.queue.some((q) => q.kind === 'hourly')) {
      this.lastHourly = d.getHours();
      if (this.desk.coveredSince(now - 60 * MIN).length >= 2) this.prepare('hourly', {}).catch((e) => this.error('saat başı', e));
    }

    // Normal arayı hazırlamaya başla (Gemini için konuşmadan ~35 sn önce)
    const lead = this.engineMode === 'gemini' ? 35e3 : 5e3;
    const busy = ['regular', 'idle', 'opener', 'recap'].some((k) => this.preparing.has(k)) || this.queue.some((q) => ['regular', 'idle', 'opener'].includes(q.kind));
    if (!this.talking && !busy && now >= this.nextTalkAt - lead) {
      const pending = this.desk.pendingStories({ limit: 5 });
      if (pending.length) {
        this.prepare('regular', { stories: pending }).catch((e) => this.error('gündem arası', e));
      } else {
        const quiet = now - this.lastTalkAt;
        const interval = (TALK_INTERVALS[s.talkiness] || 7) * MIN;
        if (quiet > Math.max(2.2 * interval, 14 * MIN) && now - this.lastIdleAt > 25 * MIN) {
          this.lastIdleAt = now;
          this.prepare('idle', { quietMinutes: Math.round(quiet / MIN) }).catch((e) => this.error('ara sohbet', e));
        } else {
          this.nextTalkAt = now + MIN; // bir dakika sonra yeniden bak
        }
      }
    }
  }

  /**
   * Açılıştan önce X'ten ilk verinin gelmesini bekler.
   * Dönüş: 'ok' (veri geldi), 'demo', 'loggedOut' (X oturumu yok), 'timeout' (henüz gelmedi).
   */
  async waitForFirstFeed(maxMs = 75e3) {
    if (this.settings.demoMode) return 'demo';
    const since = this.sessionStart - 2 * MIN;
    const fresh = () => {
      for (const t of this.desk.tweets.values()) if (Math.max(t.seenAt || 0, t.lastSeenAt || 0) > since) return true;
      return false;
    };
    const t0 = Date.now();
    this.waitingFeed = true;
    this.emitState();
    try {
      while (this.on && Date.now() - t0 < maxMs) {
        await this.drainInbox();
        const st = await this.bridge.request('collectorStatus').catch(() => null);
        if (fresh() || (st?.lastAt && st.lastAt > since)) {
          // İlk parti JSON + sayfa yapısı olarak birkaç saniyede tamamlanır
          await sleep(5000);
          await this.drainInbox();
          return 'ok';
        }
        if (st?.loggedIn === false) return 'loggedOut';
        await sleep(2000);
      }
      return 'timeout';
    } finally {
      this.waitingFeed = false;
      this.emitState();
    }
  }

  shouldPlayNow(seg, now) {
    // Açılış: radyo gibi önce müzik girsin, DJ'ler müziğin üstüne konuşsun (YouTube en fazla 12 sn beklenir)
    if (seg.kind === 'opener' && this.music && 'playing' in this.music && !this.music.playing && now - seg.readyAt < 12000) return false;
    if (seg.force || ['breaking', 'opener', 'listener'].includes(seg.kind)) return true;
    if (now < this.nextTalkAt && seg.kind !== 'hourly') return false;
    const waited = now - seg.readyAt;
    const left = this.music?.timeToTrackEnd?.() ?? Infinity;
    if (left === Infinity) return true;          // canlı yayın / akış: hemen
    if (left < 9) return true;                   // parça bitiyor: DJ girişi
    return waited > 70e3;                        // en fazla 70 sn bekle
  }

  // ------------------------------------------------------------------ Bölüm hazırlama
  async prepare(kind, opts = {}) {
    if (this.preparing.has(kind)) return this.preparing.get(kind);
    const segId = `seg${Date.now().toString(36)}${(++segCounter).toString(36)}`;
    const p = this._prepare(kind, segId, opts)
      .catch((e) => { this.desk.release(segId); throw e; })
      .finally(() => { this.preparing.delete(kind); this.emitState(); });
    this.preparing.set(kind, p);
    this.emitState();
    return p;
  }

  async _prepare(kind, segId, opts) {
    const s = this.effectiveSettings();
    const now = Date.now();
    let stories = opts.stories || [];
    if (kind === 'opener') {
      // 1) X toplayıcı sekmesi yeni açıldıysa ilk verinin gelmesini müzik eşliğinde bekle (en fazla ~75 sn)
      opts.feed = await this.waitForFirstFeed();
      // 2) "Sen yokken neler oldu" özeti için birikmiş paylaşımları sınıflandır (en fazla ~45 sn)
      await this.drainInbox();
      const deadline = Date.now() + 45e3;
      while (this.desk.untriaged.size && Date.now() < deadline && this.on) {
        await Promise.race([this.runTriage(), sleep(Math.max(1000, deadline - Date.now()))]);
      }
      stories = this.desk.pendingStories({ limit: 5 });
    }
    if (kind === 'hourly') stories = this.desk.pendingStories({ limit: 2 });
    if (kind === 'listener') stories = this.relevantStories(opts.message);
    if (kind === 'recap') stories = [];
    this.desk.reserve(stories.map((x) => x.id), segId);
    const packets = stories.map((x) => this.desk.storyPacket(x));

    // Müzik bilgisi
    let nextTrack = null;
    if (this.music instanceof GenerativeMusic) {
      nextTrack = await this.music.planNext(null).catch(() => null);
      if (nextTrack) nextTrack.kind = 'next';
    } else if (this.music?.nowPlaying) {
      const np = this.music.nowPlaying();
      if (np && np.title) nextTrack = { ...np, kind: 'current' };
    }

    const ctx = {
      kind,
      stories: packets,
      now,
      settings: s,
      memory: this.memory.slice(-6),
      nextTrack,
      weather: ['opener', 'hourly', 'idle'].includes(kind) ? await getWeather(s.city).catch(() => null) : null,
      shieldCount: await this.shieldCount(),
      quietMinutes: opts.quietMinutes,
      firstEver: opts.firstEver,
      awayMinutes: opts.awayMinutes,
      feed: opts.feed,
      message: opts.message,
      recentHeadlines: this.desk.coveredSince(now - 3 * 3600e3).map((x) => x.headline),
      demo: !!this.settings.demoMode,
    };

    // 1) Senaryo
    let script = null;
    let writer = 'local';
    if (this.engineMode === 'gemini' && this.client) {
      try {
        await this.detectModels();
        const json = await this.client.generateJson({
          model: s.textModel,
          system: buildWriterSystem(s),
          prompt: buildWriterPrompt(ctx),
          schema: SCRIPT_SCHEMA,
          temperature: kind === 'breaking' ? 0.6 : 1.0,
          thinking: kind === 'breaking' ? 'minimal' : 'low',
          tag: 'writer',
        });
        // Son dakika ya da yalnızca ciddi hikâyelerden oluşan bölümde gülme etiketleri ayıklanır
        const serious = kind === 'breaking' || (packets.length > 0 && packets.every((x) => x.tone === 'serious'));
        script = validateScript(json, { settings: s, storyIds: packets.map((x) => x.id), serious });
        if (script) writer = 'gemini';
        if (script?.dropped?.length) this.log(`yayın dili koruması ${script.dropped.length} satırı ayıkladı`, script.dropped);
        // Geçersiz senaryo ya da ayıklamadan sonra fazla kısalmış senaryo: yerel yazara geç (yalnızca o zaman uyar)
        if (!script) this.error('senaryo', new Error('geçersiz senaryo, yerel yazara geçildi'));
        else if (script.lines.length < 3) { script = null; writer = 'local'; this.error('senaryo', new Error('senaryo çok kısaldı, yerel yazara geçildi')); }
      } catch (e) {
        if (e instanceof GeminiError && e.authProblem) this.authFailed(e);
        else this.error('senaryo (yerel yazara geçildi)', e);
      }
    }
    if (!script) script = writeLocalScript(ctx);
    if (!script.covered.length && packets.length && writer === 'local') script.covered = packets.map((x) => x.id);

    // 2) Ses
    let audio = null;
    let voice = 'browser';
    if (this.engineMode === 'gemini' && this.voice && Date.now() > this.ttsCooldownUntil) {
      const controller = new AbortController();
      const chunks = this.voice.synthesize(script, { kind, signal: controller.signal });
      try {
        // Son dakika: ilk parça hazır olunca başla. Diğerleri: tamamı hazır olunca.
        if (kind === 'breaking' || kind === 'listener') await chunks[0];
        else await Promise.all(chunks);
        audio = chunks;
        voice = 'gemini';
        this.ttsFailures = 0;
      } catch (e) {
        controller.abort();
        this.ttsFailures++;
        if (this.ttsFailures >= 3) { this.ttsCooldownUntil = Date.now() + 10 * MIN; this.ttsFailures = 0; }
        if (e instanceof GeminiError && e.authProblem) this.authFailed(e);
        else this.error('seslendirme (tarayıcı sesine geçildi)', e);
      }
    }

    const seg = {
      id: segId,
      kind,
      title: script.title,
      script,
      audio,
      voice,
      writer,
      stories: packets,
      nextTrack,
      createdAt: now,
      readyAt: Date.now(),
      priority: { breaking: 100, listener: 80, opener: 70, hourly: 50, regular: 40, recap: 35, idle: 10 }[kind] ?? 30,
      force: !!opts.force,
    };
    if (!this.on) { this.desk.release(segId); return null; }
    this.queue.push(seg);
    this.emitState();
    return seg;
  }

  relevantStories(message) {
    const all = [...this.desk.stories.values()].filter((x) => !x.muted);
    const scored = all.map((x) => ({ x, sc: topicSimilarity(message || '', `${x.headline} ${x.summary}`) }))
      .filter((o) => o.sc > 0.12).sort((a, b) => b.sc - a.sc).slice(0, 2).map((o) => o.x);
    return scored;
  }

  async shieldCount() {
    try { const r = await this.bridge.request('shieldCount'); return r?.count || 0; } catch { return 0; }
  }

  // ------------------------------------------------------------------ Yayın
  async playSegment(seg) {
    if (!this.on) return;
    this.talking = true;
    this.current = seg;
    this.phase = 'talking';
    this.abortCtrl = new AbortController();
    const signal = this.abortCtrl.signal;
    const s = this.settings;
    this.emit('segment', { state: 'start', id: seg.id, kind: seg.kind, title: seg.title, stories: seg.stories.map((x) => ({ id: x.id, headline: x.headline })), voice: seg.voice, writer: seg.writer });
    this.emitState();

    try {
      const duck = seg.kind === 'breaking' ? 0.05 : s.duckLevel;
      if (seg.kind === 'breaking') {
        this.engine.duckTo(0.03, 0.35);
        await this.playFx('breaking');
      } else if (seg.kind === 'hourly') {
        this.engine.duckTo(duck, 0.8);
        await this.playFx('pips');
        await this.playFx('logo', { gain: 0.8 });
      } else if (seg.kind === 'listener') {
        this.engine.duckTo(duck, 0.8);
        await this.playFx('ping');
      } else {
        this.engine.duckTo(duck, 1.2);
        this.playFx('sweeper', { wait: false, gain: 0.7 }).catch(() => {});
        await sleep(1100);
      }
      if (seg.kind === 'breaking') this.engine.duckTo(duck, 0.5);
      if (this.music instanceof GenerativeMusic && seg.nextTrack?.kind === 'next') this.music.transitionTo({ fade: 3, delay: 1.5 }).catch(() => {});

      const lines = seg.script.lines;
      let spoken = 0;
      if (seg.audio) {
        // Parçalar boşluksuz zamanlanır: sonraki parça, öncekinin bittiği ana (küçük bir nefes payıyla) kurulur.
        let nextStart = 0;
        let lastEnd = Promise.resolve();
        let lastDuration = 0;
        const timers = [];
        for (const chunkP of seg.audio) {
          if (signal.aborted) break;
          let chunk;
          try { chunk = await chunkP; } catch (e) {
            this.error('seslendirme parçası', e);
            break;
          }
          if (signal.aborted) break;
          const h = this.engine.play(chunk.buffer, { bus: 'voice', when: nextStart });
          this.playbacks.push(h);
          const timings = estimateTimings(chunk.lines, chunk.buffer.duration);
          const base = spoken;
          for (const [i, tm] of timings.entries()) {
            timers.push(setTimeout(() => this.caption(seg, base + i), Math.max(0, (h.startAt - this.engine.ctx.currentTime + tm.start) * 1000)));
          }
          nextStart = h.startAt + chunk.buffer.duration + 0.06;
          lastEnd = h.ended;
          lastDuration = Math.max(0, nextStart - this.engine.ctx.currentTime);
          spoken += chunk.lines.length;
        }
        await Promise.race([lastEnd, sleep((lastDuration + 3) * 1000)]);
        if (signal.aborted) timers.forEach(clearTimeout);
      }
      if (spoken < lines.length && !signal.aborted) {
        // Tarayıcı sesiyle (tamamı ya da kalan satırlar)
        const rest = lines.slice(spoken);
        const offset = spoken;
        await this.browserVoice.speak(rest, { onLine: (i) => this.caption(seg, offset + i), signal, lang: this.settings.language, bcp47: langInfo(this.settings.language).bcp47 });
      }
    } finally {
      this.playbacks = [];
      if (this.on) this.engine.unduck(2.2);
      this.finishSegment(seg, signal.aborted);
    }
  }

  /** Zamanlanmış tüm DJ ses parçalarını durdurur. */
  stopPlaybacks() {
    for (const p of this.playbacks || []) { try { p.stop(); } catch { /* */ } }
    this.playbacks = [];
  }

  caption(seg, idx) {
    const l = seg.script.lines[idx];
    if (!l) return;
    const name = l.speaker === 'A' ? this.settings.hostA.name : this.settings.hostB.name;
    const c = { segId: seg.id, idx, speaker: l.speaker, name, text: l.text, ts: Date.now() };
    this.captions.push(c);
    if (this.captions.length > 60) this.captions.shift();
    this.emit('caption', c);
  }

  finishSegment(seg, aborted) {
    if (seg.kind === 'opener') this.openerDone = true;
    this.talking = false;
    this.current = null;
    this.phase = this.on ? 'music' : 'off';
    if (!aborted) {
      this.desk.markCovered(seg.script.covered);
      this.desk.release(seg.id);
      const t = new Date();
      const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const note = seg.script.memoryNote || (seg.stories.length ? `Konuşulan: ${seg.stories.map((x) => x.headline).join('; ')}` : '');
      if (note) {
        this.memory.push(`${hhmm} — ${truncate(seg.title, 60)}: ${truncate(note, 200)}`);
        if (this.memory.length > 12) this.memory = this.memory.slice(-12);
        db.kvSet('memory', this.memory).catch(() => {});
      }
      this.lastTalkAt = Date.now();
      if (['regular', 'idle', 'opener', 'hourly', 'recap'].includes(seg.kind)) this.nextTalkAt = Date.now() + this.talkInterval();
      else this.nextTalkAt = Math.max(this.nextTalkAt, Date.now() + 2.5 * MIN);
      if (seg.script.musicMood && this.music?.planNext && !(this.music instanceof GenerativeMusic)) this.music.setMood?.(seg.script.musicMood);
      if (this.music instanceof GenerativeMusic && seg.script.musicMood) this.music.mood = seg.script.musicMood;
      db.logAdd({
        id: seg.id,
        ts: Date.now(),
        kind: seg.kind,
        title: seg.title,
        writer: seg.writer,
        voice: seg.voice,
        lines: seg.script.lines.map((l) => ({ speaker: l.speaker, text: l.text })),
        hosts: { A: this.settings.hostA.name, B: this.settings.hostB.name },
        stories: seg.stories.map((x) => ({
          id: x.id, headline: x.headline, category: x.category, importance: x.importance,
          tweets: x.tweets.map((t) => ({ url: t.url, name: t.author?.name, handle: t.author?.handle, text: truncate(t.text, 280), createdAt: t.createdAt })),
        })),
      }).catch((e) => this.log('log', e));
      this.persist();
      if (seg.kind === 'opener') {
        this.openerDone = true;
        this.meta = { ...(this.meta || {}), firstRunDone: true };
        db.kvSet('meta', this.meta).catch(() => {});
      }
    } else {
      this.desk.release(seg.id);
    }
    this.emit('segment', { state: 'end', id: seg.id, kind: seg.kind });
    this.emit('board', {});
    this.emitState();
  }

  // ------------------------------------------------------------------ Komutlar
  async talkNow() {
    if (!this.on) await this.start();
    const ready = this.queue.find((q) => q.kind !== 'idle');
    if (ready) { ready.force = true; return { ok: true, text: 'Hazır bölüm yayına alınıyor' }; }
    const pending = this.desk.pendingStories({ limit: 5, minImportance: 2 });
    const kind = pending.length ? 'regular' : (this.desk.coveredSince(Date.now() - 6 * 3600e3).length ? 'recap' : 'idle');
    this.prepare(kind, { stories: pending, force: true, quietMinutes: Math.round((Date.now() - this.lastTalkAt) / MIN) })
      .then((seg) => { if (seg) seg.force = true; })
      .catch((e) => this.error('şimdi anlat', e));
    return { ok: true, text: pending.length ? 'DJ\'ler gündemi hazırlıyor…' : 'Yeni haber yok; DJ\'ler kısa bir özet hazırlıyor…' };
  }

  async listenerMessage(text) {
    const msg = String(text || '').trim().slice(0, 400);
    if (!msg) return { ok: false };
    if (!this.on) await this.start();
    this.listenerQueue.push(msg);
    return { ok: true, text: 'Mesajın stüdyoya iletildi' };
  }

  async skip() {
    if (this.talking) {
      this.abortCtrl?.abort();
      this.browserVoice.cancel();
      this.stopPlaybacks();
      return { ok: true, text: 'Konuşma atlandı' };
    }
    const meta = await this.music?.skip?.();
    return { ok: true, text: 'Sıradaki parça', track: meta };
  }

  /** Tüm hafızayı (bellek + veritabanı) sıfırlar. */
  async resetMemory() {
    await this.stop();
    this.desk = new NewsDesk({ settings: this.settings });
    this.memory = [];
    this.captions = [];
    this.errors = [];
    this.queue = [];
    this.listenerQueue = [];
    this.meta = {};
    this.usage = { input: 0, output: 0, calls: 0, tts: 0 };
    this.models = null;
    this.authBlocked = false;
    this.ttsFailures = 0;
    this.ttsCooldownUntil = 0;
    this.lastHourly = -1;
    this.engineMode = resolveEngine(this.settings);
    await db.clearAll();
    this.emit('board', {});
    this.emitState();
    return { ok: true };
  }

  muteStory(id) {
    this.desk.muteStory(id, true);
    this.persist();
    this.emit('board', {});
  }

  async onTabStatus(st) { this.music?.onTabStatus?.(st); }

  // ------------------------------------------------------------------ Durum
  getState() {
    const np = this.music?.nowPlaying?.() || null;
    const s = this.settings;
    return {
      on: this.on,
      phase: this.phase,
      engine: this.engineMode,
      models: this.engineMode === 'gemini' ? this.effectiveSettings() && { text: this.effectiveSettings().textModel, tts: this.effectiveSettings().ttsModel, triage: this.effectiveSettings().triageModel } : null,
      voiceMode: this.engineMode === 'gemini' && Date.now() > this.ttsCooldownUntil ? 'gemini' : 'browser',
      nowPlaying: np,
      musicStatus: this.musicStatus,
      musicSource: s.musicSource,
      segment: this.current ? { id: this.current.id, kind: this.current.kind, title: this.current.title, stories: this.current.stories.map((x) => ({ id: x.id, headline: x.headline })) } : null,
      captions: this.captions.slice(-12),
      queue: this.queue.map((q) => ({ kind: q.kind, title: q.title })),
      preparing: [...this.preparing.keys()],
      nextTalkAt: this.nextTalkAt,
      stats: this.desk.stats(),
      usage: this.usage,
      errors: this.errors.slice(-5),
      audioBlocked: this.audioBlocked,
      waitingFeed: this.waitingFeed,
      openerDone: this.openerDone,
      duck: this.engine?.duckValue ?? 1,
      musicVolumeNow: typeof this.music?.volume === 'number' ? this.music.volume : null,
      hosts: { A: { name: s.hostA.name, voice: s.hostA.voice }, B: { name: s.hostB.name, voice: s.hostB.voice } },
      browserVoices: this.browserVoice.available ? this.browserVoice.pick(this.settings.language).names : null,
      language: this.settings.language,
      demo: !!s.demoMode,
      time: describeTime(new Date()),
    };
  }

  emitState() { this.emit('state', this.getState()); }

  /** Stüdyo panosu için hikâyeler. */
  getBoard() { return this.desk.board(); }

  levels() { return this.engine ? this.engine.bands(24) : null; }

  async diagnostics() {
    const out = { audioContext: this.engine?.ctx.state || 'yok', sampleRate: this.engine?.ctx.sampleRate || 0 };
    try { await this.browserVoice.ready; out.browserVoices = this.browserVoice.pick(this.settings.language); out.browserVoices = { ...out.browserVoices.names, turkish: out.browserVoices.native, native: out.browserVoices.native, lang: this.settings.language, count: this.browserVoice.voices.length }; } catch (e) { out.browserVoices = 'hata: ' + e.message; }
    out.music = { source: this.settings.musicSource, status: this.musicStatus, nowPlaying: this.music?.nowPlaying?.() || null, youtube: this.music?.debug?.() || this.ytDebugLast || null };
    out.engine = this.engineMode;
    out.levels = this.engine ? { master: this.engine.masterLevel, music: this.engine.musicLevel, voice: this.engine.voiceLevel } : null;
    out.models = this.models;
    out.stats = this.desk.stats();
    out.errors = this.errors.slice(-8);
    return out;
  }
}
