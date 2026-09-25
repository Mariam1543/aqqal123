// Press-to-talk into the composer. Hidden unless the agent reports a speech model.
import { emit } from './state.js';

let rec = null, chunks = [], available = false;

export async function initVoice() {
  try {
    const r = await fetch('/api/voice/status');
    const s = await r.json();
    available = !!s.available;
    document.getElementById('btn-mic').hidden = !available;
  } catch (e) { available = false; }
}
export const voiceAvailable = () => available;

export async function startTalking() {
  if (!available || rec) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream);
    chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      for (const t of rec.stream.getTracks()) t.stop();
      rec = null;
      try {
        const res = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: blob });
        if (!res.ok) return;
        const { text } = await res.json();
        const input = document.getElementById('chat-input');
        if (input && text) { input.value = (input.value ? input.value + ' ' : '') + text; input.focus(); }
      } catch (e) { /* nothing arrives in the composer */ }
    };
    rec.start();
  } catch (e) { rec = null; }
}
export function stopTalking() { if (rec && rec.state === 'recording') rec.stop(); }
