/**
 * 하나의 개념(concept)에 여러 언어 표현을 연결합니다.
 * id는 개념 식별자이므로 표현을 바꿔도 학습 기록이 이어집니다.
 */
export interface Expression {
  text: string;
  pronunciation: string;
  example: string;
  exampleTranslation: string;
}
export interface Vocabulary {
  id: string;
  terms: Record<string, Expression>;
  group: string;
  sub: string;
  note: string;
  tags: string[];
}
export interface WordPayload {
  schemaVersion: 2;
  source: 'seed' | 'notion';
  updatedAt: string;
  count: number;
  words: Vocabulary[];
}
export const BASE_LANGUAGE = 'ko-KR';
export const LANGUAGE_NAMES: Record<string, string> = {
  'ko-KR': '한국어',
  'zh-CN': '중국어',
  'en-US': '영어',
  'ja-JP': '일본어',
  'es-ES': '스페인어',
  'fr-FR': '프랑스어',
  'de-DE': '독일어',
};
export const languageName = (code: string): string => LANGUAGE_NAMES[code] ?? code;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 값이 없어요.`);
  return value.trim();
}
function optional(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}
function tags(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error('태그는 문자열 배열이어야 합니다.');
  }
  return [...new Set(value.map(item => (item as string).trim()).filter(Boolean))];
}
function validLocale(code: string): boolean {
  try { return Intl.getCanonicalLocales(code).length === 1; } catch { return false; }
}
function expression(value: unknown, label: string): Expression {
  if (!object(value)) throw new Error(`${label} 표현이 올바르지 않습니다.`);
  return {
    text: required(value.text, `${label} 단어`),
    pronunciation: optional(value.pronunciation),
    example: optional(value.example),
    exampleTranslation: optional(value.exampleTranslation),
  };
}
/** v1 중국어 전용 JSON은 프런트엔드에서 읽을 수 있으나 동기화 결과는 항상 v2로 저장합니다. */
function migrateLegacy(value: Record<string, unknown>): Record<string, unknown> {
  return {
    id: value.id,
    terms: {
      'ko-KR': { text: value.kr },
      'zh-CN': {
        text: value.cn,
        pronunciation: value.py,
        example: value.exampleCn,
        exampleTranslation: value.exampleKr,
      },
    },
    group: value.group,
    sub: value.sub,
    note: value.note,
    tags: value.tags,
  };
}
export function parseWordPayload(raw: unknown): WordPayload {
  if (!object(raw) || (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) || !Array.isArray(raw.words)) {
    throw new Error('지원하지 않는 단어 데이터 형식입니다.');
  }
  if (raw.words.length === 0) throw new Error('단어가 0개인 데이터는 적용하지 않습니다.');
  if (raw.words.length > 100000) throw new Error('단어 수가 예상 범위를 초과했습니다.');
  if (raw.count != null && raw.count !== raw.words.length) throw new Error('단어 수 정보가 실제 목록과 다릅니다.');
  const seen = new Set<string>();
  const words = raw.words.map((input: unknown, index: number): Vocabulary => {
    if (!object(input)) throw new Error(`${index + 1}번째 개념 데이터가 올바르지 않습니다.`);
    const value = raw.schemaVersion === 1 ? migrateLegacy(input) : input;
    const id = required(value.id, '개념 ID');
    if (seen.has(id)) throw new Error(`중복된 개념 ID: ${id}`);
    seen.add(id);
    if (!object(value.terms)) throw new Error(`${id}: 언어별 표현이 없습니다.`);
    const terms: Record<string, Expression> = {};
    for (const [code, term] of Object.entries(value.terms)) {
      if (!validLocale(code)) throw new Error(`${id}: 유효하지 않은 언어 코드 ${code}`);
      terms[code] = expression(term, `${id}/${code}`);
    }
    if (!terms[BASE_LANGUAGE]) throw new Error(`${id}: 한국어 기준 표현이 없습니다.`);
    if (Object.keys(terms).length < 2) throw new Error(`${id}: 번역 언어가 하나 이상 필요합니다.`);
    return {
      id, terms,
      group: optional(value.group, '기타') || '기타',
      sub: optional(value.sub, '미분류') || '미분류',
      note: optional(value.note),
      tags: tags(value.tags),
    };
  });
  return {
    schemaVersion: 2,
    source: raw.source === 'notion' ? 'notion' : 'seed',
    updatedAt: optional(raw.updatedAt),
    count: words.length,
    words,
  };
}
export function getTerm(word: Vocabulary, language: string): Expression | undefined {
  return word.terms[language];
}
export function targetLanguages(words: Vocabulary[]): string[] {
  const codes = new Set(words.flatMap(word => Object.keys(word.terms)).filter(code => code !== BASE_LANGUAGE));
  const preferred = ['zh-CN', 'en-US', 'ja-JP'];
  return [...codes].sort((a, b) => {
    const ia = preferred.indexOf(a), ib = preferred.indexOf(b);
    return (ia < 0 ? 100 : ia) - (ib < 0 ? 100 : ib) || a.localeCompare(b);
  });
}
export function wordSearchText(word: Vocabulary): string {
  return [word.group, word.sub, word.note, ...word.tags,
    ...Object.entries(word.terms).flatMap(([locale, term]) =>
      [languageName(locale), term.text, term.pronunciation, term.example, term.exampleTranslation])]
    .join(' ').toLocaleLowerCase();
}
