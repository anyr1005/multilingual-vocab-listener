import { BASE_LANGUAGE, canonicalLocale, parseWordPayload, type Vocabulary } from '../src/domain/words.js';

type UnknownRecord = Record<string, unknown>;
const API_ROOT = 'https://api.notion.com/v1';
const API_VERSION = '2025-09-03';

/** 개념 공통 속성. 기존 관광통역안내사 단어장의 컬럼을 그대로 사용할 수 있습니다. */
const PROPERTY_NAMES = {
  kr: ['용어', '한국어', 'Name', '이름', 'Korean'],
  krSpeech: ['한국어 발음 보정', 'Korean TTS'],
  group: ['대분류', 'Category'],
  sub: ['분류', '세부분류', 'Subcategory'],
  note: ['암기포인트', '암기 포인트', '메모', 'Note'],
  tags: ['태그', 'Tags'],
  extra: ['추가 언어 JSON', 'Translations JSON'],
} as const;

/**
 * 정식 컬럼을 가진 언어 목록. 새 언어는 이 배열에 한 항목을 추가하면 되고,
 * 그보다 드물게 쓰는 언어는 `추가 언어 JSON` 컬럼으로 코드 수정 없이 넣을 수 있습니다.
 * `exampleTranslation`은 예문을 기준 언어(한국어)로 옮긴 것입니다.
 * `speechText`는 TTS가 잘못 읽을 때만 채우는 발음 보정 텍스트입니다.
 */
const LANGUAGE_COLUMNS: readonly {
  locale: string;
  text: readonly string[];
  pronunciation: readonly string[];
  example: readonly string[];
  exampleTranslation: readonly string[];
  speechText: readonly string[];
}[] = [
  {
    locale: 'zh-CN',
    text: ['중국어', '中文', 'Chinese'],
    pronunciation: ['병음 (Pinyin)', '병음', 'Pinyin'],
    example: ['중국어 예문', '예문(중국어)', '例句'],
    exampleTranslation: ['중국어 예문 해석', 'Chinese Example Translation'],
    speechText: ['중국어 발음 보정', 'Chinese TTS'],
  },
  {
    locale: 'en-US',
    text: ['영어', 'English'],
    pronunciation: ['영어 발음', '영어 IPA', 'English Pronunciation'],
    example: ['영어 예문', 'English Example'],
    exampleTranslation: ['영어 예문 해석', 'English Example Translation'],
    speechText: ['영어 발음 보정', 'English TTS'],
  },
  {
    locale: 'ja-JP',
    text: ['일본어', '日本語', 'Japanese'],
    pronunciation: ['일본어 읽기', '후리가나', 'Japanese Reading'],
    example: ['일본어 예문', 'Japanese Example'],
    exampleTranslation: ['일본어 예문 해석', 'Japanese Example Translation'],
    speechText: ['일본어 발음 보정', 'Japanese TTS'],
  },
];

function record(input: unknown): UnknownRecord | null {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as UnknownRecord : null;
}
function notionText(value: unknown): string {
  const prop = record(value);
  if (!prop) return '';
  const kind = prop.type;
  if (kind === 'title' || kind === 'rich_text') {
    const entries = prop[kind];
    if (!Array.isArray(entries)) return '';
    return entries.map(entry => {
      const rich = record(entry);
      const plain = rich?.plain_text;
      if (typeof plain === 'string') return plain;
      return String(record(rich?.text)?.content ?? '');
    }).join('');
  }
  if (kind === 'select' || kind === 'status') return String(record(prop[kind])?.name ?? '');
  if (kind === 'multi_select' && Array.isArray(prop.multi_select)) {
    return prop.multi_select.map(entry => String(record(entry)?.name ?? '')).filter(Boolean).join(', ');
  }
  if (kind === 'formula') return String(record(prop.formula)?.string ?? '');
  if (kind === 'number' && typeof prop.number === 'number') return String(prop.number);
  return '';
}
function lookup(props: UnknownRecord, aliases: readonly string[]): string {
  for (const name of aliases) {
    if (Object.hasOwn(props, name)) {
      const value = notionText(props[name]).trim();
      if (value) return value;
    }
  }
  return '';
}
export function extractNotionWord(page: unknown): Vocabulary | null {
  const input = record(page);
  if (!input || input.archived === true || input.in_trash === true) return null;
  const id = typeof input.id === 'string' ? input.id : '';
  const props = record(input.properties) ?? {};
  const korean = lookup(props, PROPERTY_NAMES.kr);
  const extraRaw = lookup(props, PROPERTY_NAMES.extra);
  const translations = LANGUAGE_COLUMNS
    .map(column => ({ column, text: lookup(props, column.text) }))
    .filter(entry => entry.text);
  if (!korean && !translations.length && !extraRaw) return null;
  if (!id || !korean) throw new Error(`한국어 기준 표현이 없는 Notion 페이지: ${id || '(ID 없음)'}`);
  const terms: Vocabulary['terms'] = { [BASE_LANGUAGE]: {
    text: korean, pronunciation: '', example: '', exampleTranslation: '',
    speechText: lookup(props, PROPERTY_NAMES.krSpeech),
  } };
  for (const { column, text } of translations) {
    terms[column.locale] = {
      text,
      pronunciation: lookup(props, column.pronunciation),
      example: lookup(props, column.example),
      exampleTranslation: lookup(props, column.exampleTranslation),
      speechText: lookup(props, column.speechText),
    };
  }
  if (extraRaw) {
    let extra: unknown;
    try { extra = JSON.parse(extraRaw) as unknown; }
    catch { throw new Error(`${id}: 추가 언어 JSON이 올바르지 않습니다.`); }
    const extraObject = record(extra);
    if (!extraObject) throw new Error(`${id}: 추가 언어 JSON은 객체여야 합니다.`);
    for (const [code, rawTerm] of Object.entries(extraObject)) {
      // 표준형으로 비교해야 'ZH-cn'이 기본 컬럼의 'zh-CN'과 중복인 것을 잡아냅니다.
      const locale = canonicalLocale(code);
      if (!locale) throw new Error(`${id}: 유효하지 않은 언어 코드 ${code}`);
      if (locale === BASE_LANGUAGE || Object.hasOwn(terms, locale)) {
        throw new Error(`${id}: ${locale}는 기본 컬럼과 중복되어 추가 언어 JSON에 넣을 수 없습니다.`);
      }
      const term = record(rawTerm);
      if (!term || typeof term.text !== 'string') throw new Error(`${id}/${code}: text 필드가 필요합니다.`);
      terms[locale] = {
        text: term.text,
        pronunciation: typeof term.pronunciation === 'string' ? term.pronunciation : '',
        example: typeof term.example === 'string' ? term.example : '',
        exampleTranslation: typeof term.exampleTranslation === 'string' ? term.exampleTranslation : '',
        speechText: typeof term.speechText === 'string' ? term.speechText : '',
      };
    }
  }
  const value: Vocabulary = {
    id, terms,
    group: lookup(props, PROPERTY_NAMES.group) || '기타',
    sub: lookup(props, PROPERTY_NAMES.sub) || '미분류',
    note: lookup(props, PROPERTY_NAMES.note),
    tags: lookup(props, PROPERTY_NAMES.tags).split(',').map(s => s.trim()).filter(Boolean),
  };
  // 스키마 런타임 검증은 Notion 동기화 단계와 브라우저에서 동일하게 적용합니다.
  return parseWordPayload({ schemaVersion: 2, source: 'notion', words: [value] }).words[0]!;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function notionRequest(token: string, method: 'GET' | 'POST', path: string,
  body?: UnknownRecord): Promise<UnknownRecord> {
  for (let attempt = 0; attempt < 5; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': API_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
    } catch (error) {
      if (attempt === 4) throw error;
      await wait(Math.min(1000 * 2 ** attempt, 12000));
      continue;
    }
    if (response.ok) {
      const result = record(await response.json() as unknown);
      if (!result) throw new Error('Notion API가 유효하지 않은 JSON을 반환했습니다.');
      return result;
    }
    const retry = response.status === 429 || response.status >= 500;
    if (!retry || attempt === 4) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`Notion API HTTP ${response.status}: ${detail}`);
    }
    const retryAfter = Number(response.headers.get('Retry-After'));
    const ms = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(1000 * 2 ** attempt, 12000);
    await wait(ms);
  }
  throw new Error('Notion API 요청을 완료하지 못했습니다.');
}

export async function resolveDataSourceId(token: string, id?: string, databaseId?: string): Promise<string> {
  if (id?.trim()) return id.trim();
  if (!databaseId?.trim()) throw new Error('NOTION_DATA_SOURCE_ID 또는 NOTION_DATABASE_ID가 필요합니다.');
  const database = await notionRequest(token, 'GET', `/databases/${encodeURIComponent(databaseId.trim())}`);
  const sources = Array.isArray(database.data_sources) ? database.data_sources : [];
  if (sources.length !== 1 || typeof record(sources[0])?.id !== 'string') {
    throw new Error('데이터 소스가 여러 개입니다. NOTION_DATA_SOURCE_ID를 직접 설정해 주세요.');
  }
  return String(record(sources[0])!.id);
}

export async function collectWords(token: string, sourceId: string): Promise<Vocabulary[]> {
  const words: Vocabulary[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const body: UnknownRecord = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const response = await notionRequest(token, 'POST', `/data_sources/${encodeURIComponent(sourceId)}/query`, body);
    if (!Array.isArray(response.results)) throw new Error('Notion 결과의 results 필드가 배열이 아닙니다.');
    for (const entry of response.results) {
      if (record(entry)?.object !== 'page') continue;
      const word = extractNotionWord(entry);
      if (!word) continue;
      if (ids.has(word.id)) throw new Error(`중복된 Notion 페이지 ID: ${word.id}`);
      ids.add(word.id);
      words.push(word);
    }
    if (response.has_more !== true) break;
    cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    if (!cursor || cursors.has(cursor)) throw new Error('Notion 페이지네이션 커서가 잘못되었습니다.');
    cursors.add(cursor);
  }
  if (!words.length) throw new Error('Notion 결과가 0개여서 기존 데이터를 덮어쓰지 않습니다.');
  // 데이터 정렬이 변해도 빌드 결과 순서가 안정적이도록 합니다.
  words.sort((a, b) => a.group.localeCompare(b.group, 'ko')
    || a.sub.localeCompare(b.sub, 'ko')
    || a.terms[BASE_LANGUAGE]!.text.localeCompare(b.terms[BASE_LANGUAGE]!.text, 'ko'));
  return words;
}
