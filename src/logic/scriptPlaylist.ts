import type { Script } from '../domain/scripts.js';
import type { SpeechSegment } from './playlist.js';

export interface ScriptSettings {
  /** 전문을 몇 번 읽을지. 0이면 멈출 때까지 계속 반복합니다. */
  repeats: number;
  sentenceDelayMs: number;
  paragraphDelayMs: number;
  rate: number;
  showTranslation: boolean;
}
/** 재생할 문장 하나. `sentence`는 스크립트 전체에서의 순번이라 화면 강조에 그대로 씁니다. */
export interface ScriptSegment extends SpeechSegment {
  sentence: number;
}
export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = {
  repeats: 1, sentenceDelayMs: 400, paragraphDelayMs: 1200, rate: 0.9, showTranslation: true,
};
export function normalizeScriptSettings(value: Record<string, unknown> | null | undefined): ScriptSettings {
  const pickInt = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback;
  return {
    repeats: pickInt(value?.repeats, DEFAULT_SCRIPT_SETTINGS.repeats, 0, 5),
    sentenceDelayMs: pickInt(value?.sentenceDelayMs, DEFAULT_SCRIPT_SETTINGS.sentenceDelayMs, 0, 10000),
    paragraphDelayMs: pickInt(value?.paragraphDelayMs, DEFAULT_SCRIPT_SETTINGS.paragraphDelayMs, 0, 15000),
    rate: typeof value?.rate === 'number' && Number.isFinite(value.rate)
      ? Math.max(0.5, Math.min(1.5, value.rate)) : DEFAULT_SCRIPT_SETTINGS.rate,
    showTranslation: typeof value?.showTranslation === 'boolean'
      ? value.showTranslation : DEFAULT_SCRIPT_SETTINGS.showTranslation,
  };
}
export const sentenceCount = (script: Script): number =>
  script.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.length, 0);
/**
 * 전문을 한 번 읽는 재생 계획. 문단이 바뀌는 곳에서 조금 더 쉬고,
 * 마지막 문장 뒤에도 문단 대기를 두어 반복할 때 처음으로 자연스럽게 넘어갑니다.
 */
export function buildScriptSegments(script: Script, settings: ScriptSettings, start = 0): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let index = 0;
  for (const paragraph of script.paragraphs) {
    paragraph.sentences.forEach((text, n) => {
      const last = n === paragraph.sentences.length - 1;
      if (index >= start) {
        segments.push({ language: script.language, text, sentence: index,
          waitAfterMs: last ? settings.paragraphDelayMs : settings.sentenceDelayMs });
      }
      index++;
    });
  }
  return segments;
}
