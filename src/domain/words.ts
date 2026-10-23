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
/** Intl.DisplayNames를 쓸 수 없거나 이름을 모르는 코드에 대비한 폴백입니다. */
export const LANGUAGE_NAMES: Record<string, string> = {
  'ko-KR': '한국어',
  'zh-CN': '중국어',
  'en-US': '영어',
  'ja-JP': '일본어',
  'es-ES': '스페인어',
  'fr-FR': '프랑스어',
  'de-DE': '독일어',
};
const languageDisplay = ((): Intl.DisplayNames | null => {
  try { return new Intl.DisplayNames([BASE_LANGUAGE], { type: 'language' }); }
  catch { return null; }
})();
const baseTag = (code: string): string => code.split('-')[0]!;
function displayOf(tag: string): string | null {
  try {
    const name = languageDisplay?.of(tag);
    // 모르는 코드면 입력을 그대로 돌려주므로, 그때는 폴백으로 넘깁니다.
    return name && name !== tag ? name : null;
  } catch { return null; }
}
/**
 * 'zh-CN' → '중국어'. Intl은 'zh-CN'을 '중국어(중국)'으로 풀어 쓰는데
 * 라벨이 길어지므로 기본 언어 태그('zh')의 이름을 씁니다.
 */
export const languageName = (code: string): string =>
  displayOf(baseTag(code)) ?? LANGUAGE_NAMES[code] ?? code;
/**
 * 여러 언어를 한 화면에 늘어놓을 때 쓰는 이름표.
 * 같은 언어의 다른 지역이 함께 있을 때만 지역을 덧붙입니다.
 * (zh-CN과 zh-TW가 모두 있으면 '중국어(중국)' / '중국어(대만)')
 */
export function languageNames(codes: readonly string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(baseTag(code), (counts.get(baseTag(code)) ?? 0) + 1);
  return new Map(codes.map(code => {
    const ambiguous = (counts.get(baseTag(code)) ?? 0) > 1;
    return [code, (ambiguous ? displayOf(code) : null) ?? languageName(code)];
  }));
}

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
/**
 * 'ZH-cn'과 'zh-CN'이 서로 다른 언어로 갈라지지 않도록 BCP47 표준형으로 통일합니다.
 * 표기가 잘못되어 해석할 수 없으면 null을 돌려줍니다.
 */
export function canonicalLocale(code: string): string | null {
  try {
    const canonical = Intl.getCanonicalLocales(code);
    return canonical.length === 1 ? canonical[0]! : null;
  } catch { return null; }
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
      const locale = canonicalLocale(code);
      if (!locale) throw new Error(`${id}: 유효하지 않은 언어 코드 ${code}`);
      // 표준형으로 바꾼 뒤에 겹치는지 본다. 'zh-CN'과 'ZH-cn'은 같은 언어다.
      if (Object.hasOwn(terms, locale)) throw new Error(`${id}: 중복된 언어 ${locale}`);
      terms[locale] = expression(term, `${id}/${locale}`);
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
      [locale, languageName(locale), term.text, term.pronunciation,
        term.example, term.exampleTranslation])]
    .join(' ').toLocaleLowerCase();
}
