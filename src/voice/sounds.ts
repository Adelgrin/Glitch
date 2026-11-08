import { useSettings } from "../store/settings";

let ctx: AudioContext | null = null;

function tone(freqs: number[], dur = 0.09, gap = 0.07, vol = 0.12) {
  if (!useSettings.getState().voice.sounds) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      const start = t0 + i * gap;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(ctx!.destination);
      o.start(start);
      o.stop(start + dur + 0.02);
    });
  } catch {
    /* sem áudio */
  }
}

export const sounds = {
  join: () => tone([523, 784]),
  leave: () => tone([784, 523]),
  otherJoin: () => tone([660, 880], 0.07, 0.06, 0.07),
  otherLeave: () => tone([880, 660], 0.07, 0.06, 0.07),
  mute: () => tone([440], 0.06),
  unmute: () => tone([660], 0.06),
  streamStart: () => tone([523, 659, 784], 0.08, 0.06, 0.08),
};
