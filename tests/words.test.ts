import { describe, expect, it } from 'vitest';
import { getTerm, parseWordPayload, targetLanguages, wordSearchText, type Vocabulary } from '../src/domain/words.js';
import { buildSegments, DEFAULT_SETTINGS } from '../src/logic/playlist.js';

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
