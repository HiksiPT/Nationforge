// Procedural audio with the Web Audio API: wind, surf and rain ambience from filtered noise, a slow generative
// music pad, and short UI sounds. Nothing is downloaded. Starts on the first user gesture.

import type { Settings } from '../app/settings';

class Audio {
  ctx: AudioContext | null = null;
  master!: GainNode;
  amb!: GainNode;
  music!: GainNode;
  sfx!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private surf!: { gain: GainNode; lfo: OscillatorNode };
  private rain!: { gain: GainNode };
  private musicTimer: number | null = null;
  private vols = { master: 0.7, amb: 0.7, music: 0.35, sfx: 0.7 };

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.amb = c.createGain();
    this.music = c.createGain();
    this.sfx = c.createGain();
    for (const g of [this.amb, this.music, this.sfx]) g.connect(this.master);
    const noise = this.noiseBuffer();
    // wind: band-passed noise with slow gusts
    const ws = c.createBufferSource();
    ws.buffer = noise;
    ws.loop = true;
    const wf = c.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 400;
    wf.Q.value = 0.6;
    const wg = c.createGain();
    wg.gain.value = 0;
    ws.connect(wf).connect(wg).connect(this.amb);
    ws.start();
    this.wind = { gain: wg, filter: wf };
    // surf: low-passed noise swelling with an LFO
    const ss = c.createBufferSource();
    ss.buffer = noise;
    ss.loop = true;
    ss.playbackRate.value = 0.7;
    const sf = c.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 700;
    const sg = c.createGain();
    sg.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = c.createGain();
    lg.gain.value = 0.04;
    lfo.connect(lg).connect(sg.gain);
    lfo.start();
    ss.connect(sf).connect(sg).connect(this.amb);
    ss.start();
    this.surf = { gain: sg, lfo };
    // rain: high-passed noise
    const rs = c.createBufferSource();
    rs.buffer = noise;
    rs.loop = true;
    rs.playbackRate.value = 1.3;
    const rf = c.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 2500;
    const rg = c.createGain();
    rg.gain.value = 0;
    rs.connect(rf).connect(rg).connect(this.amb);
    rs.start();
    this.rain = { gain: rg };
    this.applyVolumes();
    this.scheduleMusic();
  }

  private noiseBuffer(): AudioBuffer {
    const c = this.ctx!;
    const b = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brown-ish
      d[i] = last * 3.5 + w * 0.15;
    }
    return b;
  }

  setVolumes(s: Settings) {
    this.vols = { master: s.masterVolume, amb: s.ambienceVolume, music: s.musicVolume, sfx: s.sfxVolume };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vols.master, t, 0.1);
    this.amb.gain.setTargetAtTime(this.vols.amb, t, 0.1);
    this.music.gain.setTargetAtTime(this.vols.music * 0.5, t, 0.1);
    this.sfx.gain.setTargetAtTime(this.vols.sfx, t, 0.1);
  }

  setWeather(wind: number, rain: number, storm: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.5, 0.02 + wind * 0.018 + (storm ? 0.15 : 0)), t, 0.8);
    this.wind.filter.frequency.setTargetAtTime(250 + wind * 40, t, 1);
    this.rain.gain.gain.setTargetAtTime(Math.min(0.35, rain * 0.02), t, 0.8);
    this.surf.gain.gain.setTargetAtTime(0.04 + Math.min(0.12, wind * 0.006), t, 1);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = c.currentTime + delay;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  click() {
    this.tone(880, 0.06, 'triangle', 0.12);
  }
  confirm() {
    this.tone(523, 0.12, 'triangle', 0.15);
    this.tone(784, 0.18, 'triangle', 0.15, 0.08);
  }
  error() {
    this.tone(200, 0.2, 'square', 0.08);
  }
  notify() {
    this.tone(660, 0.15, 'sine', 0.12);
    this.tone(990, 0.25, 'sine', 0.1, 0.1);
  }
  demolish() {
    if (!this.ctx) return;
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuffer();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 1.2);
    s.connect(f).connect(g).connect(this.sfx);
    s.start();
    s.stop(c.currentTime + 1.3);
  }

  /** Slow generative pad: a pentatonic chord every few seconds. */
  private scheduleMusic() {
    const scale = [0, 2, 4, 7, 9, 12, 14, 16];
    const root = 196;
    const play = () => {
      if (!this.ctx) return;
      const c = this.ctx;
      const n = 3;
      for (let i = 0; i < n; i++) {
        const semi = scale[Math.floor(Math.random() * scale.length)];
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = root * Math.pow(2, semi / 12) * (i === 0 ? 0.5 : 1);
        const t = c.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 2.5);
        g.gain.linearRampToValueAtTime(0, t + 7);
        o.connect(g).connect(this.music);
        o.start(t);
        o.stop(t + 7.2);
      }
      this.musicTimer = window.setTimeout(play, 5000 + Math.random() * 4000);
    };
    play();
  }

  stop() {
    if (this.musicTimer != null) clearTimeout(this.musicTimer);
    this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new Audio();
