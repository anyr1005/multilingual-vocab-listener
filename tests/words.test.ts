import { describe, expect, it } from 'vitest';
import { canonicalLocale, getTerm, languageName, languageNames, parseWordPayload,
  targetLanguages, wordSearchText, type Vocabulary } from '../src/domain/words.js';
import { buildSegments, DEFAULT_SETTINGS, normalizeSettings, resolveSteps } from '../src/logic/playlist.js';

const concept: Vocabulary = {
  id: 'apple',
  terms: {
    'ko-KR': { text: '사과', pronunciation: '', example: '', exampleTranslation: '' },
    'zh-CN': { text: '苹果', pronunciation: 'píngguǒ', example: '', exampleTranslation: '' },
    'en-US': { text: 'apple', pronunciation: '/ˈæpəl/', example: '', exampleTranslation: '' },
    'ja-JP': { text: 'りんご', pronunciation: 'ringo', example: '', exampleTranslation: '' },
  },
  group: '일상', sub: '명사', note: '', tags: [],
};
const payload = { schemaVersion: 2, source: 'seed', count: 1, words: [concept] };

describe('다국어 개념 JSON 계약', () => {
  it('한 개념 안에 여러 언어 표현을 연결할 수 있다', () => {
    const data = parseWordPayload(payload);
    expect(data.words).toHaveLength(1);
    expect(getTerm(data.words[0]!, 'zh-CN')?.text).toBe('苹果');
    expect(getTerm(data.words[0]!, 'en-US')?.text).toBe('apple');
    expect(getTerm(data.words[0]!, 'ja-JP')?.text).toBe('りんご');
    expect(targetLanguages(data.words)).toEqual(['zh-CN', 'en-US', 'ja-JP']);
    expect(wordSearchText(data.words[0]!)).toContain('píngguǒ');
  });
  it('기존 v1 168단어도 자동으로 읽어들이고 v2 형태로 바꾼다', () => {
    const data = parseWordPayload({ schemaVersion: 1, source: 'seed', count: 1,
      words: [{ id: 'a', kr: '창덕궁', cn: '昌德宫', py: 'chāngdégōng', group: '관광' }] });
    expect(data.schemaVersion).toBe(2);
    expect(data.words[0]!.terms['zh-CN']?.pronunciation).toBe('chāngdégōng');
  });
  it('ID 중복, 번역 없는 개념, 올바르지 않은 언어코드를 거부한다', () => {
    expect(() => parseWordPayload({ schemaVersion: 2, words: [] })).toThrow();
    expect(() => parseWordPayload({ schemaVersion: 2, words: [concept, concept] })).toThrow('중복');
    expect(() => parseWordPayload({ schemaVersion: 2, words: [{ id: 'bad', terms: { 'ko-KR': { text: '사과' } } }] })).toThrow('번역');
    expect(() => parseWordPayload({ schemaVersion: 2, words: [{ ...concept, terms: {
      ...concept.terms, 'not a locale': { text: 'x' },
    } }] })).toThrow('언어 코드');
  });
});

describe('다국어 재생 순서', () => {
  it('기본으로 한국어 1회 → 중국어 2회를 유지한다', () => {
    const segments = buildSegments(concept, DEFAULT_SETTINGS, 'zh-CN');
    expect(segments.map(s => `${s.language}:${s.text}`)).toEqual([
      'ko-KR:사과', 'zh-CN:苹果', 'zh-CN:苹果',
    ]);
    expect(segments[0]!.waitAfterMs).toBe(DEFAULT_SETTINGS.thoughtDelayMs);
    expect(segments[2]!.waitAfterMs).toBe(DEFAULT_SETTINGS.wordDelayMs);
  });
  it('영어를 선택하면 TTS 언어가 영어로 바뀐다', () => {
    const segments = buildSegments(concept, DEFAULT_SETTINGS, 'en-US');
    expect(segments.map(s => s.language)).toEqual(['ko-KR', 'en-US', 'en-US']);
  });
  it('모두 듣기에서는 각 언어를 한 번에 함께 학습할 수 있다', () => {
    const segments = buildSegments(concept, { ...DEFAULT_SETTINGS, order: 'all', targetRepeats: 1 }, 'zh-CN');
    expect(segments.map(s => s.language)).toEqual(['ko-KR', 'zh-CN', 'en-US', 'ja-JP']);
  });
  it('해당 언어 번역이 없는 단어는 재생하지 않는다', () => {
    const onlyChinese = { ...concept, terms: { 'ko-KR': concept.terms['ko-KR']!, 'zh-CN': concept.terms['zh-CN']! } };
    expect(buildSegments(onlyChinese, DEFAULT_SETTINGS, 'en-US')).toEqual([]);
  });
});

describe('언어 코드 정규화', () => {
  it('표기가 달라도 같은 언어로 모은다', () => {
    const data = parseWordPayload({ schemaVersion: 2, words: [{ ...concept, terms: {
      'ko-KR': concept.terms['ko-KR']!, 'ZH-cn': concept.terms['zh-CN']!,
    } }] });
    expect(Object.keys(data.words[0]!.terms)).toEqual(['ko-KR', 'zh-CN']);
  });
  it('같은 언어를 다른 표기로 두 번 넣으면 거부한다', () => {
    expect(() => parseWordPayload({ schemaVersion: 2, words: [{ ...concept, terms: {
      'ko-KR': concept.terms['ko-KR']!,
      'zh-CN': concept.terms['zh-CN']!,
      'ZH-cn': concept.terms['zh-CN']!,
    } }] })).toThrow('중복된 언어');
  });
  it('해석할 수 없는 코드는 null', () => {
    expect(canonicalLocale('ZH-cn')).toBe('zh-CN');
    expect(canonicalLocale('zh_CN')).toBeNull();
    expect(canonicalLocale('not a locale')).toBeNull();
  });
});

describe('언어 이름', () => {
  it('지역을 붙이지 않은 짧은 이름을 쓴다', () => {
    expect(languageName('zh-CN')).toBe('중국어');
    expect(languageName('en-US')).toBe('영어');
  });
  it('이름 맵에 없는 언어도 Intl이 풀어 준다', () => {
    expect(languageName('vi-VN')).toBe('베트남어');
  });
  it('같은 언어의 다른 지역이 함께 있을 때만 지역을 덧붙인다', () => {
    const names = languageNames(['zh-CN', 'zh-TW', 'en-US']);
    expect(names.get('zh-CN')).toBe('중국어(중국)');
    expect(names.get('zh-TW')).toBe('중국어(대만)');
    expect(names.get('en-US')).toBe('영어');
  });
});

describe('재생 계획 단계 목록', () => {
  it('프리셋은 단계 목록으로 풀린다', () => {
    expect(resolveSteps(concept, DEFAULT_SETTINGS, 'zh-CN')).toEqual([
      { locale: 'ko-KR', repeats: 1 },
      { locale: 'zh-CN', repeats: 2 },
    ]);
  });
  it('steps를 주면 프리셋 대신 그 순서로 읽는다', () => {
    const settings = { ...DEFAULT_SETTINGS, order: 'ko-target' as const, steps: [
      { locale: 'ja-JP', repeats: 1 },
      { locale: '$base', repeats: 1 },
      { locale: '$target', repeats: 2 },
    ] };
    expect(buildSegments(concept, settings, 'en-US').map(s => s.language))
      .toEqual(['ja-JP', 'ko-KR', 'en-US', 'en-US']);
  });
  it('$others는 목표·기준 언어를 뺀 나머지로 펼쳐진다', () => {
    const settings = { ...DEFAULT_SETTINGS, steps: [{ locale: '$others', repeats: 1 }] };
    expect(resolveSteps(concept, settings, 'zh-CN'))
      .toEqual([{ locale: 'en-US', repeats: 1 }, { locale: 'ja-JP', repeats: 1 }]);
  });
  it('등록되지 않은 언어 단계는 건너뛴다', () => {
    const settings = { ...DEFAULT_SETTINGS, steps: [
      { locale: 'fr-FR', repeats: 2 }, { locale: '$target', repeats: 1 },
    ] };
    expect(buildSegments(concept, settings, 'zh-CN').map(s => s.language)).toEqual(['zh-CN']);
  });
  it('저장된 steps를 복원하고, 형식이 깨진 항목은 버린다', () => {
    const restored = normalizeSettings({ steps: [
      { locale: 'ja-JP', repeats: 9 }, { locale: '', repeats: 1 }, 'nope', { repeats: 1 },
    ] });
    expect(restored.steps).toEqual([{ locale: 'ja-JP', repeats: 5 }]); // 9 → 상한 5
  });
  it('steps가 없거나 전부 쓸 수 없으면 프리셋으로 되돌아간다', () => {
    expect(normalizeSettings({ order: 'all' }).steps).toBeUndefined();
    expect(normalizeSettings({ steps: ['nope'] }).steps).toBeUndefined();
    expect(normalizeSettings({ steps: [] }).steps).toBeUndefined();
  });
});
