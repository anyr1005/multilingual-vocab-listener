import { describe, expect, it } from 'vitest';
import { extractNotionWord } from '../scripts/notion.js';

const title = (text: string) => ({ type: 'title', title: [{ plain_text: text }] });
const rich = (text: string) => ({ type: 'rich_text', rich_text: [{ plain_text: text }] });

describe('Notion 다국어 속성 변환', () => {
  it('기존 Notion 관광통역안내사 컬럼을 v2 형태로 읽는다', () => {
    const word = extractNotionWord({ object: 'page', id: 'notion-001', properties: {
      '용어': title('창덕궁'), '중국어': rich('昌德宫'),
      '병음 (Pinyin)': rich('chāng dé gōng'),
      '대분류': { type: 'select', select: { name: '고유명사' } },
      '분류': { type: 'select', select: { name: '궁궐' } },
    } });
    expect(word?.terms['ko-KR']?.text).toBe('창덕궁');
    expect(word?.terms['zh-CN']?.text).toBe('昌德宫');
    expect(word?.terms['zh-CN']?.pronunciation).toBe('chāng dé gōng');
    expect(word?.group).toBe('고유명사');
  });
  it('한 Notion 행에 중국어·영어·일본어를 동시에 등록한다', () => {
    const word = extractNotionWord({ object: 'page', id: 'notion-002', properties: {
      '용어': title('사과'), '중국어': rich('苹果'), '병음': rich('píngguǒ'),
      '영어': rich('apple'), '일본어': rich('りんご'), '일본어 읽기': rich('ringo'),
    } });
    expect(Object.keys(word!.terms)).toHaveLength(4);
    expect(word?.terms['en-US']?.text).toBe('apple');
    expect(word?.terms['ja-JP']?.pronunciation).toBe('ringo');
  });
  it('추가 언어 JSON으로 새로운 BCP47 언어를 연결한다', () => {
    const word = extractNotionWord({ id: 'notion-003', properties: {
      '용어': title('사과'), '중국어': rich('苹果'),
      '추가 언어 JSON': rich('{"es-ES":{"text":"manzana","pronunciation":""}}'),
    } });
    expect(word?.terms['es-ES']?.text).toBe('manzana');
  });
  it('삭제/빈 행 건너뛰기, 한국어만 있는 행 오류', () => {
    expect(extractNotionWord({ id: '1', in_trash: true })).toBeNull();
    expect(extractNotionWord({ id: '2', properties: { '용어': title('') } })).toBeNull();
    expect(() => extractNotionWord({ id: '3', properties: { '용어': title('사과') } })).toThrow();
  });
});

describe('언어별 예문 해석', () => {
  it('중국어·영어·일본어가 각자의 예문 해석을 가진다', () => {
    const word = extractNotionWord({ object: 'page', id: 'notion-004', properties: {
      '용어': title('사과'),
      '중국어': rich('苹果'), '중국어 예문': rich('我吃苹果。'), '중국어 예문 해석': rich('나는 사과를 먹는다.'),
      '영어': rich('apple'), '영어 예문': rich('I eat an apple.'), '영어 예문 해석': rich('나는 사과 하나를 먹는다.'),
      '일본어': rich('りんご'), '일본어 예문': rich('りんごを食べます。'), '일본어 예문 해석': rich('사과를 먹습니다.'),
    } });
    expect(word?.terms['zh-CN']?.exampleTranslation).toBe('나는 사과를 먹는다.');
    expect(word?.terms['en-US']?.exampleTranslation).toBe('나는 사과 하나를 먹는다.');
    expect(word?.terms['ja-JP']?.exampleTranslation).toBe('사과를 먹습니다.');
  });
  it('해석 컬럼이 없으면 빈 문자열이고 동기화는 계속된다', () => {
    const word = extractNotionWord({ id: 'notion-005', properties: {
      '용어': title('사과'), '영어': rich('apple'), '영어 예문': rich('I eat an apple.'),
    } });
    expect(word?.terms['en-US']?.example).toBe('I eat an apple.');
    expect(word?.terms['en-US']?.exampleTranslation).toBe('');
  });
  it('추가 언어 JSON의 대소문자가 달라도 기본 컬럼과 중복으로 걸러진다', () => {
    expect(() => extractNotionWord({ id: 'notion-006', properties: {
      '용어': title('사과'), '중국어': rich('苹果'),
      '추가 언어 JSON': rich('{"ZH-cn":{"text":"苹果"}}'),
    } })).toThrow('중복');
  });
});
