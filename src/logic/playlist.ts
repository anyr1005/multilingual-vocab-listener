import { BASE_LANGUAGE, getTerm, speechTextOf, type Vocabulary } from '../domain/words.js';

export type PlaybackOrder = 'ko-target' | 'target-ko' | 'target' | 'ko' | 'all';
/**
 * 재생 계획의 한 단계. 특정 언어를 고정하거나(`'ja-JP'`) 역할로 가리킵니다.
 * `$others`는 한 개념에 등록된 나머지 언어 전부를 뜻합니다.
 */
export type StepLocale = '$base' | '$target' | '$others' | (string & {});
export interface PlaybackStep {
  locale: StepLocale;
  repeats: number;
}
/** 기존 5개 프리셋을 단계 목록으로 표현한 것. 프리셋 선택은 이 값을 고르는 일입니다. */
export const ORDER_PRESETS: Record<PlaybackOrder, readonly StepLocale[]> = {
  'ko-target': ['$base', '$target'],
  'target-ko': ['$target', '$base'],
  'target': ['$target'],
  'ko': ['$base'],
  'all': ['$base', '$target', '$others'],
};
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
  /**
   * 지정하면 `order`와 반복 노브 대신 이 목록이 재생 순서를 결정합니다.
   * 목표 언어를 여러 개 섞거나 임의 순서로 듣기 위한 확장 지점입니다.
   */
  steps?: PlaybackStep[];
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
/** 저장된 단계 목록을 검증합니다. 쓸 수 있는 단계가 없으면 프리셋으로 되돌아갑니다. */
function normalizeSteps(value: unknown): PlaybackStep[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const steps = value.flatMap((entry): PlaybackStep[] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const { locale, repeats } = entry as Record<string, unknown>;
    if (typeof locale !== 'string' || !locale.trim()) return [];
    return [{
      locale: locale.trim(),
      repeats: typeof repeats === 'number' && Number.isFinite(repeats)
        ? Math.max(0, Math.min(5, Math.round(repeats))) : 1,
    }];
  });
  return steps.length ? steps : undefined;
}
export function normalizeSettings(value: Record<string, unknown> | null | undefined): ListeningSettings {
  const pickInt = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
  const pickBool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
  const migrated = value?.order === 'ko-zh' ? 'ko-target' : value?.order === 'zh-ko' ? 'target-ko'
    : value?.order === 'zh' ? 'target' : value?.order;
  const orders: PlaybackOrder[] = ['ko-target', 'target-ko', 'target', 'ko', 'all'];
  const steps = normalizeSteps(value?.steps);
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
    ...(steps ? { steps } : {}),
  };
}
/**
 * 설정을 언어·반복 횟수의 단계 목록으로 펼칩니다.
 * 프리셋이든 직접 지정한 단계든 여기를 거치므로 재생 로직은 한 갈래만 남습니다.
 */
export function resolveSteps(
  word: Vocabulary, settings: ListeningSettings, target: string,
): PlaybackStep[] {
  const repeatsFor = (locale: string): number =>
    locale === BASE_LANGUAGE ? settings.koreanRepeats
      : locale === target ? settings.targetRepeats : settings.otherRepeats;
  const plan = settings.steps ?? ORDER_PRESETS[settings.order]
    .map(locale => ({ locale, repeats: repeatsFor(
      locale === '$base' ? BASE_LANGUAGE : locale === '$target' ? target : '') }));
  const others = (): string[] => Object.keys(word.terms)
    .filter(code => code !== BASE_LANGUAGE && code !== target).sort();
  return plan.flatMap(step => {
    if (step.locale === '$others') {
      return others().map(locale => ({ locale, repeats: step.repeats }));
    }
    const locale = step.locale === '$base' ? BASE_LANGUAGE
      : step.locale === '$target' ? target : step.locale;
    return [{ locale, repeats: step.repeats }];
  });
}
/** 학습 대상 언어를 선택할 수 있으며, 'all'은 한 개념의 모든 번역을 순서대로 읽습니다. */
export function buildSegments(word: Vocabulary, settings: ListeningSettings, target: string): SpeechSegment[] {
  if (target === BASE_LANGUAGE || !getTerm(word, target)) return [];
  const segments: SpeechSegment[] = [];
  for (const { locale: language, repeats } of resolveSteps(word, settings, target)) {
    const term = getTerm(word, language);
    if (!term) continue;
    for (let n = 0; n < repeats; n++) {
      segments.push({ language, text: speechTextOf(term), waitAfterMs: 250 });
    }
  }
  for (let i = 0; i + 1 < segments.length; i++) {
    if (segments[i]!.language !== segments[i + 1]!.language) segments[i]!.waitAfterMs = settings.thoughtDelayMs;
  }
  if (segments.length) segments[segments.length - 1]!.waitAfterMs = settings.wordDelayMs;
  return segments;
}
