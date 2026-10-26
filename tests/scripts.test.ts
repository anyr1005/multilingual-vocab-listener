import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScriptPayload, splitSentences, type Script } from '../src/domain/scripts.js';
import { buildScriptSegments, DEFAULT_SCRIPT_SETTINGS, normalizeScriptSettings, orderScripts,
  sentenceCount } from '../src/logic/scriptPlaylist.js';
import { blocksToParagraphs, extractNotionScriptHeader, scriptLanguage } from '../scripts/notion.js';

const title = (text: string) => ({ type: 'title', title: [{ plain_text: text }] });
const select = (name: string) => ({ type: 'select', select: { name } });
const block = (type: string, text: string) => ({ type, [type]: { rich_text: [{ plain_text: text }] } });

describe('문장 나누기', () => {
  it('중국어 문장부호와 줄바꿈에서 나눈다', () => {
    expect(splitSentences('你好。欢迎来到景福宫！你去过吗？\n第二行', 'zh-CN'))
      .toEqual(['你好。', '欢迎来到景福宫！', '你去过吗？', '第二行']);
  });
  it('문장 끝 뒤의 여는 따옴표를 다음 문장 앞으로 옮긴다', () => {
    expect(splitSentences('建于1395年。“景福”出自《诗经》。', 'zh-CN'))
      .toEqual(['建于1395年。', '“景福”出自《诗经》。']);
  });
  it('영어 문장을 나눈다', () => {
    expect(splitSentences('Welcome to Seoul. It is a big city!', 'en-US'))
      .toEqual(['Welcome to Seoul.', 'It is a big city!']);
  });
});

describe('스크립트 JSON 계약', () => {
  const sample = JSON.parse(readFileSync('examples/scripts.sample.json', 'utf8')) as unknown;
  it('샘플 스크립트를 읽는다', () => {
    const data = parseScriptPayload(sample);
    expect(data.scripts.map(script => script.language)).toEqual(['zh-CN', 'en-US']);
    expect(sentenceCount(data.scripts[0]!)).toBe(5);
  });
  it('0개, 중복 ID, 빈 본문, 잘못된 언어는 적용하지 않는다', () => {
    const script = { id: 'a', title: '제목', language: 'zh-CN', paragraphs: [{ sentences: ['你好。'] }] };
    expect(() => parseScriptPayload({ schemaVersion: 1, scripts: [] })).toThrow();
    expect(() => parseScriptPayload({ schemaVersion: 1, scripts: [script, script] })).toThrow(/중복/);
    expect(() => parseScriptPayload({ schemaVersion: 1, scripts: [{ ...script, paragraphs: [] }] })).toThrow(/본문/);
    expect(() => parseScriptPayload({ schemaVersion: 1,
      scripts: [{ ...script, paragraphs: [{ sentences: ['  '] }] }] })).toThrow(/문장/);
    expect(() => parseScriptPayload({ schemaVersion: 1, scripts: [{ ...script, language: '!!' }] })).toThrow();
  });
  it('언어 코드를 표준형으로 바꾼다', () => {
    const data = parseScriptPayload({ schemaVersion: 1, scripts: [
      { id: 'a', title: '제목', language: 'ZH-cn', paragraphs: [{ sentences: ['你好。'] }] }] });
    expect(data.scripts[0]!.language).toBe('zh-CN');
    expect(data.scripts[0]!.group).toBe('기타');
  });
});

describe('Notion 스크립트 변환', () => {
  it('언어 칸은 정식 컬럼 이름이나 BCP47 코드를 받는다', () => {
    expect(scriptLanguage('중국어')).toBe('zh-CN');
    expect(scriptLanguage('english')).toBe('en-US');
    expect(scriptLanguage('es-ES')).toBe('es-ES');
    expect(scriptLanguage('스페인어')).toBeNull();
  });
  it('속성을 읽고, 빈 행은 건너뛰고, 언어가 없으면 실패한다', () => {
    expect(extractNotionScriptHeader({ id: 'p1', properties: {
      '제목': title('경복궁 안내'), '언어': select('중국어'), '대분류': select('궁궐') } }))
      .toEqual({ id: 'p1', title: '경복궁 안내', language: 'zh-CN', group: '궁궐' });
    expect(extractNotionScriptHeader({ id: 'p2', properties: { '제목': title('') } })).toBeNull();
    expect(extractNotionScriptHeader({ id: 'p3', in_trash: true })).toBeNull();
    expect(() => extractNotionScriptHeader({ id: 'p4', properties: { '제목': title('안내') } })).toThrow(/언어/);
  });
  it('본문 블록을 문단으로, 인용 블록을 앞 문단의 해석으로 읽는다', () => {
    const paragraphs = blocksToParagraphs([
      block('heading_2', '景福宫'),
      block('paragraph', '大家好。欢迎来到景福宫。'),
      block('quote', '여러분 안녕하세요.'),
      block('quote', '경복궁에 오신 것을 환영합니다.'),
      block('paragraph', ''),
      { type: 'divider', divider: {} },
      block('bulleted_list_item', '建于1395年。'),
    ], 'zh-CN', '테스트');
    expect(paragraphs).toEqual([
      { kind: 'heading', sentences: ['景福宫'], translation: '' },
      { kind: 'text', sentences: ['大家好。', '欢迎来到景福宫。'],
        translation: '여러분 안녕하세요.\n경복궁에 오신 것을 환영합니다.' },
      { kind: 'text', sentences: ['建于1395年。'], translation: '' },
    ]);
  });
  it('본문보다 먼저 나온 해석은 오류다', () => {
    expect(() => blocksToParagraphs([block('quote', '해석')], 'zh-CN', '테스트')).toThrow(/해석/);
  });
});

describe('스크립트 재생 계획', () => {
  const script: Script = { id: 's', title: '제목', language: 'zh-CN', group: '기타', paragraphs: [
    { kind: 'text', sentences: ['一。', '二。'], translation: '' },
    { kind: 'text', sentences: ['三。'], translation: '' },
  ] };
  const settings = { ...DEFAULT_SCRIPT_SETTINGS, sentenceDelayMs: 100, paragraphDelayMs: 900 };
  it('문장마다 스크립트 언어로 읽고, 문단 끝에서 더 쉰다', () => {
    expect(buildScriptSegments(script, settings)).toEqual([
      { language: 'zh-CN', text: '一。', sentence: 0, waitAfterMs: 100 },
      { language: 'zh-CN', text: '二。', sentence: 1, waitAfterMs: 900 },
      { language: 'zh-CN', text: '三。', sentence: 2, waitAfterMs: 900 },
    ]);
  });
  it('중간 문장부터 시작할 수 있다', () => {
    expect(buildScriptSegments(script, settings, 1).map(segment => segment.sentence)).toEqual([1, 2]);
  });
  it('설정 값을 범위 안으로 맞춘다', () => {
    expect(normalizeScriptSettings({ repeats: 99, rate: 9, sentenceDelayMs: -5 }))
      .toMatchObject({ repeats: 5, rate: 1.5, sentenceDelayMs: 0, showTranslation: true, playAll: false });
    expect(normalizeScriptSettings({ playAll: true }).playAll).toBe(true);
    expect(normalizeScriptSettings(null)).toEqual(DEFAULT_SCRIPT_SETTINGS);
  });
  it('모든 스크립트는 언어별로 묶되 언어 안에서는 원래 순서를 지킨다', () => {
    const make = (id: string, language: string): Script => ({ ...script, id, language });
    const ordered = orderScripts([make('a', 'zh-CN'), make('b', 'ja-JP'), make('c', 'zh-CN'), make('d', 'ja-JP')]);
    expect(ordered.map(item => item.id)).toEqual(['a', 'c', 'b', 'd']);
  });
});
