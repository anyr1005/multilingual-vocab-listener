import type { SpeechPlayer } from './speech.js';
import { saveVoicePreferences } from './storage.js';

/** 단어장과 스크립트 페이지가 함께 쓰는 음성 고르기 상자. 선택은 언어(BCP47)별로 저장됩니다. */
function voiceLabel(voice: SpeechSynthesisVoice, language: string): string {
  const lang = voice.lang.replace('_', '-');
  // 온라인 음성은 네트워크가 끊기면 읽지 못할 수 있어 구분해 둡니다.
  return `${voice.name}${lang.toLowerCase() === language.toLowerCase() ? '' : ` · ${lang}`}${voice.localService ? '' : ' · 온라인'}`;
}

/** 이 언어로 읽을 수 있는 기기 음성만 채웁니다. 기다리는 사이 다른 언어로 바뀌었다면 늦은 결과는 버립니다. */
export async function fillVoiceSelect(element: HTMLSelectElement, speech: SpeechPlayer, language: string,
  preferences: Readonly<Record<string, string>>): Promise<void> {
  element.dataset.language = language;
  const voices = await speech.voicesFor(language);
  if (element.dataset.language !== language) return;
  element.replaceChildren(new Option('자동 (기기 기본)', ''),
    ...voices.map(voice => new Option(voiceLabel(voice, language), voice.voiceURI)));
  const preferred = preferences[language] ?? '';
  element.value = voices.some(voice => voice.voiceURI === preferred) ? preferred : '';
  element.disabled = !voices.length;
}

/** 상자에서 고른 음성을 저장하고 바로 적용한 새 선호 목록을 돌려줍니다. 빈 값은 자동으로 되돌립니다. */
export function chooseVoice(element: HTMLSelectElement, speech: SpeechPlayer,
  preferences: Readonly<Record<string, string>>): Record<string, string> {
  const language = element.dataset.language;
  if (!language) return { ...preferences };
  const { [language]: _previous, ...rest } = preferences;
  const next = element.value ? { ...rest, [language]: element.value } : rest;
  saveVoicePreferences(next);
  speech.setPreferredVoices(next);
  return next;
}
