// ── Web Speech API — Japanese TTS ─────────────────────────────────────────
let _jaVoice = null;
let _voicesLoaded = false;

function loadVoices() {
  if (_voicesLoaded) return;
  const voices = speechSynthesis.getVoices();
  if (voices.length) {
    _jaVoice = voices.find(v => v.lang === 'ja-JP')
            || voices.find(v => v.lang.startsWith('ja'))
            || null;
    _voicesLoaded = true;
  }
}

if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
  loadVoices();
}

export function speakJapanese(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'ja-JP';
  utt.rate = 0.85;
  loadVoices();
  if (_jaVoice) utt.voice = _jaVoice;
  speechSynthesis.speak(utt);
}
