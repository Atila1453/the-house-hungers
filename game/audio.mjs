const AUDIO_KEY = 'the-house-hungers-v2-audio';
const DEFAULT_VOLUME = { music: 35, effects: 75 };

export class GameAudio {
  #context;
  #musicVolume;
  #effectsVolume;
  #duck;
  #volumes = { ...DEFAULT_VOLUME };
  #buffers = new Map();
  #track;
  #musicRequest = 0;
  #playingMusic;
  #playingEffects = new Set();

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(AUDIO_KEY));
      for (const channel of Object.keys(DEFAULT_VOLUME)) {
        const volume = saved?.[channel];
        if (Number.isInteger(volume) && volume >= 0 && volume <= 100) {
          this.#volumes[channel] = volume;
        }
      }
    } catch {
      // Audio controls still work when browser storage is unavailable.
    }

    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) return;
    this.#context = new Context();
    this.#musicVolume = this.#context.createGain();
    this.#effectsVolume = this.#context.createGain();
    this.#duck = this.#context.createGain();
    this.#musicVolume.gain.value = this.#volumes.music / 100;
    this.#effectsVolume.gain.value = this.#volumes.effects / 100;
    this.#duck.connect(this.#musicVolume);
    this.#musicVolume.connect(this.#context.destination);
    this.#effectsVolume.connect(this.#context.destination);
  }

  volume(channel) {
    return this.#volumes[channel];
  }

  setVolume(channel, volume) {
    this.#volumes[channel] = volume;
    const output = channel === 'music' ? this.#musicVolume : this.#effectsVolume;
    if (output) output.gain.setTargetAtTime(volume / 100, this.#context.currentTime, .025);
    try {
      localStorage.setItem(AUDIO_KEY, JSON.stringify(this.#volumes));
    } catch {
      // Keep the new volume for this visit.
    }
  }

  unlock() {
    if (this.#context?.state === 'suspended' || this.#context?.state === 'interrupted') {
      this.#context.resume().catch(() => {});
    }
  }

  preload(tracks) {
    if (this.#context) tracks.forEach(track => this.#load(track));
  }

  #load(track) {
    if (!this.#buffers.has(track)) {
      const url = new URL(`../assets/${track}.mp3`, import.meta.url);
      this.#buffers.set(track, fetch(url).then(response => {
        if (!response.ok) throw new Error(`Audio asset returned ${response.status}`);
        return response.arrayBuffer();
      }).then(bytes => this.#context.decodeAudioData(bytes)).catch(() => {
        this.#buffers.delete(track);
        return null;
      }));
    }
    return this.#buffers.get(track);
  }

  async playMusic(track, fade = 0) {
    if (!this.#context || this.#track === track) return;
    this.#track = track;
    const request = ++this.#musicRequest;
    if (track && this.#playingMusic?.track === track) return;
    const buffer = track ? await this.#load(track) : null;
    if (request !== this.#musicRequest) return;
    if (track && !buffer) this.#track = null;

    const now = this.#context.currentTime;
    const previous = this.#playingMusic;
    this.#playingMusic = null;
    if (previous) {
      if (fade) {
        const gain = previous.envelope.gain;
        const current = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(current, now);
        gain.linearRampToValueAtTime(0, now + fade);
      }
      previous.source.stop(now + fade);
    }
    if (!buffer) return;

    const source = this.#context.createBufferSource();
    const envelope = this.#context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.connect(envelope).connect(this.#duck);
    envelope.gain.setValueAtTime(fade ? 0 : 1, now);
    if (fade) envelope.gain.linearRampToValueAtTime(1, now + fade);
    source.onended = () => envelope.disconnect();
    source.start(now);
    this.#playingMusic = { track, source, envelope };
  }

  playScene(cues = []) {
    if (!this.#context) return;
    for (const source of this.#playingEffects) source.stop();
    const playing = new Set();
    this.#playingEffects = playing;
    const entered = this.#context.currentTime;
    const duck = this.#duck.gain;
    duck.cancelScheduledValues(entered);
    duck.setValueAtTime(1, entered);

    for (const { track, delay = 0, duckMusic = false } of cues) {
      this.#load(track).then(buffer => {
        if (!buffer || this.#playingEffects !== playing) return;
        const start = Math.max(entered + delay, this.#context.currentTime);
        const source = this.#context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.#effectsVolume);
        source.onended = () => playing.delete(source);
        playing.add(source);
        if (duckMusic) {
          duck.setValueAtTime(1, start);
          duck.linearRampToValueAtTime(.35, start + .08);
          duck.setValueAtTime(.35, start + buffer.duration);
          duck.linearRampToValueAtTime(1, start + buffer.duration + .35);
        }
        source.start(start);
      });
    }
  }
}
