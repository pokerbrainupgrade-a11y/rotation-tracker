/**
 * Rest-complete tone, generated with the Web Audio API.
 *
 * No asset file: a bundled sound would need caching, a fetch path, and an
 * offline story, for one short beep. Off by default; the Settings toggle lands
 * in Phase 6.
 *
 * Deliberately no haptic path — the Vibration API is not supported in iOS
 * Safari, so a "vibrate on rest complete" control would be a dead switch.
 */
let ctx: AudioContext | null = null;

type AudioCtor = typeof AudioContext;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor: AudioCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function playRestComplete(): void {
  const audio = context();
  if (!audio) return;
  try {
    // iOS suspends the context until a user gesture; a session is full of them.
    if (audio.state === 'suspended') void audio.resume();

    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.36);
  } catch {
    // Audio is a nicety; never let it break a session.
  }
}
