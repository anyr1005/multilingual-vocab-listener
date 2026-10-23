import { BASE_LANGUAGE, getTerm, type Vocabulary } from '../domain/words.js';

export type PlaybackOrder = 'ko-target' | 'target-ko' | 'target' | 'ko' | 'all';
export interface ListeningSettings {
  order: PlaybackOrder;
  koreanRepeats: number;
  targetRepeats: number;
  otherRepeats: number;
  thoughtDelayMs: number;
  wordDelayMs: number;
  rate: number;
  showKorean: boolean;
  showTarget: boolean;
  showPronunciation: boolean;
  showOtherLanguages: boolean;
}
export interface SpeechSegment {
  language: string;
  text: string;
  waitAfterMs: number;
}
export const DEFAULT_SETTINGS: ListeningSettings = {
  order: 'ko-target', koreanRepeats: 1, targetRepeats: 2, otherRepeats: 1,
  thoughtDelayMs: 1200, wordDelayMs: 850, rate: 0.9,
  showKorean: true, showTarget: true, showPronunciation: true, showOtherLanguages: true,
};
export function normalizeSettings(value: Record<string, unknown> | null | undefined): ListeningSettings {
  const pickInt = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
  const pickBool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
  const migrated = value?.order === 'ko-zh' ? 'ko-target' : value?.order === 'zh-ko' ? 'target-ko'
    : value?.order === 'zh' ? 'target' : value?.order;
  const orders: PlaybackOrder[] = ['ko-target', 'target-ko', 'target', 'ko', 'all'];
  return {
    order: orders.includes(migrated as PlaybackOrder) ? migrated as PlaybackOrder : DEFAULT_SETTINGS.order,
    koreanRepeats: pickInt(value?.koreanRepeats, 1, 0, 5),
    targetRepeats: pickInt(value?.targetRepeats ?? value?.chineseRepeats, 2, 0, 5),
    otherRepeats: pickInt(value?.otherRepeats, 1, 0, 5),
    thoughtDelayMs: pickInt(value?.thoughtDelayMs, 1200, 0, 10000),
    wordDelayMs: pickInt(value?.wordDelayMs, 850, 0, 15000),
    rate: typeof value?.rate === 'number' && Number.isFinite(value.rate)
      ? Math.max(0.5, Math.min(1.5, value.rate)) : DEFAULT_SETTINGS.rate,
    showKorean: pickBool(value?.showKorean, true),
    showTarget: pickBool(value?.showTarget ?? value?.showChinese, true),
    showPronunciation: pickBool(value?.showPronunciation ?? value?.showPinyin, true),
    showOtherLanguages: pickBool(value?.showOtherLanguages, true),
  };
}
/** 학습 대상 언어를 선택할 수 있으며, 'all'은 한 개념의 모든 번역을 순서대로 읽습니다. */
export function buildSegments(word: Vocabulary, settings: ListeningSettings, target: string): SpeechSegment[] {
  if (target === BASE_LANGUAGE || !getTerm(word, target)) return [];
  const languages = settings.order === 'ko-target' ? [BASE_LANGUAGE, target]
    : settings.order === 'target-ko' ? [target, BASE_LANGUAGE]
      : settings.order === 'target' ? [target]
        : settings.order === 'ko' ? [BASE_LANGUAGE]
          : [BASE_LANGUAGE, target, ...Object.keys(word.terms).filter(code => code !== BASE_LANGUAGE && code !== target).sort()];
  const segments: SpeechSegment[] = [];
  for (const language of languages) {
    const term = getTerm(word, language);
    if (!term) continue;
    const repeats = language === BASE_LANGUAGE ? settings.koreanRepeats
      : language === target ? settings.targetRepeats : settings.otherRepeats;
    for (let n = 0; n < repeats; n++) {
      segments.push({ language, text: term.text, waitAfterMs: 250 });
    }
  }
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i]!.language !== segments[i + 1]!.language) segments[i]!.waitAfterMs = settings.thoughtDelayMs;
  }
  if (segments.length) segments[segments.length - 1]!.waitAfterMs = settings.wordDelayMs;
  return segments;
}
