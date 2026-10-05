/**
 * speech.js — Web Speech API wrapper for STT + TTS
 * Works in Chrome/Edge (partial support in Firefox)
 */

const Speech = (() => {
  // ─── STATE ──────────────────────────────────────────────
  let recognition = null;
  let synthesis = window.speechSynthesis;
  let isListening = false;
  let isSpeaking = false;
  let onResultCallback = null;
  let onEndCallback = null;

  // Voice preferences per agent — strictly separating male and female personas
  const VOICE_PREFS = {
    arjun: { lang: 'en-IN', pitch: 0.88, rate: 0.95, preferMale: true, preferredNames: ['arjun', 'prabhat', 'david', 'mark', 'george', 'alex'] },
    meera: { lang: 'en-IN', pitch: 1.15, rate: 1.00, preferMale: false, preferredNames: ['meera', 'heera', 'hazel', 'susan', 'katherine'] },
    ravi:  { lang: 'en-IN', pitch: 0.82, rate: 0.90, preferMale: true, preferredNames: ['ravi', 'mark', 'david', 'guy', 'daniel'] },
    priya: { lang: 'en-IN', pitch: 1.10, rate: 1.02, preferMale: false, preferredNames: ['priya', 'neerja', 'zira', 'samantha', 'jenny'] },
    vikram: { lang: 'en-IN', pitch: 0.85, rate: 0.92, preferMale: true, preferredNames: ['vikram', 'neel', 'george', 'james', 'david', 'alex'] },
    ananya: { lang: 'en-IN', pitch: 1.06, rate: 1.00, preferMale: false, preferredNames: ['ananya', 'swara', 'aria', 'samantha', 'zira', 'katherine'] },
    neha:   { lang: 'en-IN', pitch: 1.12, rate: 1.05, preferMale: false, preferredNames: ['neha', 'pooja', 'aditi', 'kavya', 'susan'] },
    karthik:{ lang: 'en-IN', pitch: 0.84, rate: 0.94, preferMale: true,  preferredNames: ['karthik', 'amit', 'rohan', 'brian', 'steven'] },
    sneha:  { lang: 'en-IN', pitch: 1.08, rate: 0.98, preferMale: false, preferredNames: ['sneha', 'sita', 'sarah', 'emma', 'hazel'] },
    rahul:  { lang: 'en-IN', pitch: 0.86, rate: 1.02, preferMale: true,  preferredNames: ['rahul', 'deepak', 'john', 'paul', 'edward'] },
    default: { lang: 'en-US', pitch: 1.00, rate: 1.00, preferMale: false, preferredNames: [] }
  };

  // Known voice name patterns for reliable gender classification
  const MALE_VOICE_REGEX = /male|man|boy|\bdavid\b|\bmark\b|\bgeorge\b|\bguy\b|\balex\b|\bdaniel\b|\bjames\b|\bjohn\b|\bbrian\b|\brichard\b|\bpaul\b|\bpeter\b|\bsteven\b|\bandrew\b|\bedward\b|\bchristopher\b|\bravi\b|\bprabhat\b|\braj\b|\barjun\b|\brohan\b|\bvikram\b|\bdeepak\b|\bamit\b|\bgaurav\b|\bneel\b/i;
  const FEMALE_VOICE_REGEX = /female|woman|girl|\bzira\b|\bheera\b|\bneerja\b|\bhazel\b|\bsusan\b|\bsamantha\b|\bkatherine\b|\bvictoria\b|\bkaren\b|\bmoira\b|\bfiona\b|\bveena\b|\bleena\b|\bkalpana\b|\bpriya\b|\bmeera\b|\bsita\b|\bananya\b|\bswara\b|\baditi\b|\bkavya\b|\bpooja\b|\bjenny\b|\baria\b|\bava\b|\bemma\b|\bsarah\b/i;

  let cachedVoices = [];

  function updateVoicesCache() {
    if (synthesis) {
      cachedVoices = synthesis.getVoices() || [];
    }
  }

  // ─── SPEECH RECOGNITION (STT) ───────────────────────────
  function isSTTSupported() {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  function startListening(onResult, onEnd, continuous = false) {
    if (!isSTTSupported()) {
      console.warn('Speech recognition not supported in this browser');
      if (onEnd) onEnd('', false, 'not_supported');
      return false;
    }

    if (isListening) stopListening();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    recognition.lang = 'en-IN';
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    onResultCallback = onResult;
    onEndCallback = onEnd;

    let finalTranscript = '';
    let interimTranscript = '';

    recognition.onstart = () => {
      isListening = true;
      console.log('🎤 Listening...');
    };

    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }
      if (onResultCallback) {
        onResultCallback(finalTranscript, interimTranscript);
      }
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error:', event.error);
      isListening = false;
      if (onEndCallback) onEndCallback(finalTranscript, false, event.error);
    };

    recognition.onend = () => {
      isListening = false;
      if (onEndCallback) onEndCallback(finalTranscript, true, null);
      finalTranscript = '';
    };

    try {
      recognition.start();
      return true;
    } catch (err) {
      console.error('Failed to start recognition:', err);
      return false;
    }
  }

  function stopListening() {
    if (recognition && isListening) {
      recognition.stop();
      isListening = false;
    }
  }

  // ─── TEXT TO SPEECH (TTS) ────────────────────────────────
  function isTTSSupported() {
    return 'speechSynthesis' in window;
  }

  function getVoice(prefs) {
    updateVoicesCache();
    const voices = cachedVoices.length ? cachedVoices : (synthesis ? synthesis.getVoices() : []);
    if (!voices || !voices.length) return null;

    const isMale = !!prefs.preferMale;
    const preferredNames = prefs.preferredNames || [];

    // 1. Strict filtering by gender:
    // A male agent MUST NOT be assigned a female voice.
    // A female agent MUST NOT be assigned a male voice.
    let genderMatchingVoices = voices.filter(v => {
      const name = v.name || '';
      if (isMale) {
        if (FEMALE_VOICE_REGEX.test(name)) return false;
        if (MALE_VOICE_REGEX.test(name)) return true;
        return false;
      } else {
        if (MALE_VOICE_REGEX.test(name)) return false;
        if (FEMALE_VOICE_REGEX.test(name)) return true;
        return false;
      }
    });

    // 2. If no strictly matching gender voice was found by keyword, fallback to voices that do NOT contradict the gender
    if (!genderMatchingVoices.length) {
      genderMatchingVoices = voices.filter(v => {
        const name = v.name || '';
        return isMale ? !FEMALE_VOICE_REGEX.test(name) : !MALE_VOICE_REGEX.test(name);
      });
    }

    // 3. Fallback to all voices if system has only one generic voice
    const pool = genderMatchingVoices.length ? genderMatchingVoices : voices;

    // Check preferred names for this specific persona
    for (const prefName of preferredNames) {
      const match = pool.find(v => (v.name || '').toLowerCase().includes(prefName.toLowerCase()));
      if (match) return match;
    }

    // Next, check for Indian English voice matching gender
    const indianVoice = pool.find(v => (v.lang || '').toLowerCase().includes('en-in'));
    if (indianVoice) return indianVoice;

    // Next, check for any English voice matching gender
    const englishVoice = pool.find(v => (v.lang || '').toLowerCase().startsWith('en'));
    if (englishVoice) return englishVoice;

    return pool[0] || null;
  }

  function speak(text, agentId = 'default', onDone = null) {
    if (!isTTSSupported() || !text) {
      if (onDone) onDone();
      return;
    }

    // Cancel any ongoing speech
    synthesis.cancel();

    const prefs = VOICE_PREFS[agentId] || VOICE_PREFS.default;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = prefs.lang || 'en-US';
    utterance.rate = prefs.rate || 1.0;
    utterance.volume = 1;

    // Set gender-appropriate voice
    const voice = getVoice({ ...prefs, agentId });
    if (voice) utterance.voice = voice;

    // Adjust pitch to guarantee gender distinction even on single-voice systems
    let finalPitch = prefs.pitch;
    if (prefs.preferMale) {
      // If the selected voice happens to have a feminine name fallback, drastically lower pitch
      if (voice && FEMALE_VOICE_REGEX.test(voice.name)) {
        finalPitch = 0.72;
      } else {
        finalPitch = Math.min(prefs.pitch || 0.88, 0.92);
      }
    } else {
      // Female voice: ensure feminine pitch register
      if (voice && MALE_VOICE_REGEX.test(voice.name)) {
        finalPitch = 1.25;
      } else {
        finalPitch = Math.max(prefs.pitch || 1.12, 1.05);
      }
    }
    utterance.pitch = finalPitch;

    utterance.onstart = () => { isSpeaking = true; };
    utterance.onend = () => {
      isSpeaking = false;
      if (onDone) onDone();
    };
    utterance.onerror = () => {
      isSpeaking = false;
      if (onDone) onDone();
    };

    isSpeaking = true;
    synthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (synthesis) {
      synthesis.cancel();
      isSpeaking = false;
    }
  }

  // Load voices (Chrome loads them async)
  if (isTTSSupported()) {
    updateVoicesCache();
    synthesis.onvoiceschanged = () => { updateVoicesCache(); };
  }

  // ─── FILLER WORD DETECTION ───────────────────────────────
  const FILLER_WORDS = ['um', 'uh', 'like', 'you know', 'basically', 'actually', 'literally', 'right', 'okay so', 'i mean', 'kind of', 'sort of'];

  function detectFillerWords(text) {
    const lower = text.toLowerCase();
    const found = [];
    for (const filler of FILLER_WORDS) {
      const regex = new RegExp(`\\b${filler}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) {
        found.push({ word: filler, count: matches.length });
      }
    }
    return found;
  }

  return {
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    isListening: () => isListening,
    isSpeaking: () => isSpeaking,
    isSTTSupported,
    isTTSSupported,
    detectFillerWords
  };
})();

window.Speech = Speech;
