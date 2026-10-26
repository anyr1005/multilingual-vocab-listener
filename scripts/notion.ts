import { parseScriptPayload, splitSentences, type Script, type ScriptParagraph } from '../src/domain/scripts.js';
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

export async function resolveDataSourceId(token: string, id?: string, databaseId?: string,
  envPrefix = 'NOTION'): Promise<string> {
  if (id?.trim()) return id.trim();
  if (!databaseId?.trim()) throw new Error(`${envPrefix}_DATA_SOURCE_ID 또는 ${envPrefix}_DATABASE_ID가 필요합니다.`);
  const database = await notionRequest(token, 'GET', `/databases/${encodeURIComponent(databaseId.trim())}`);
  const sources = Array.isArray(database.data_sources) ? database.data_sources : [];
  if (sources.length !== 1 || typeof record(sources[0])?.id !== 'string') {
    throw new Error(`데이터 소스가 여러 개입니다. ${envPrefix}_DATA_SOURCE_ID를 직접 설정해 주세요.`);
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

/** 스크립트 데이터베이스의 속성. 본문은 속성이 아니라 페이지 안쪽 블록에서 읽습니다. */
const SCRIPT_PROPERTY_NAMES = {
  title: ['제목', '이름', 'Name', 'Title'],
  language: ['언어', 'Language'],
  group: ['대분류', '분류', 'Category'],
} as const;
/** 본문으로 읽는 블록. 그 밖의 블록(이미지, 구분선, 토글 안쪽 등)은 건너뜁니다. */
const SCRIPT_TEXT_BLOCKS = new Set(['paragraph', 'bulleted_list_item', 'numbered_list_item', 'callout']);
const SCRIPT_HEADING_BLOCKS = new Set(['heading_1', 'heading_2', 'heading_3']);

/** `언어` 칸에는 정식 컬럼 이름(`중국어`, `English` …)이나 BCP47 코드를 적습니다. */
export function scriptLanguage(value: string): string | null {
  const name = value.trim();
  const column = LANGUAGE_COLUMNS.find(entry => entry.text.some(alias => alias.toLowerCase() === name.toLowerCase()));
  if (column) return column.locale;
  return name.includes('-') || /^[a-z]{2,3}$/i.test(name) ? canonicalLocale(name) : null;
}
function blockText(block: UnknownRecord, kind: string): string {
  const entries = record(block[kind])?.rich_text;
  if (!Array.isArray(entries)) return '';
  return entries.map(entry => {
    const rich = record(entry);
    return typeof rich?.plain_text === 'string' ? rich.plain_text : String(record(rich?.text)?.content ?? '');
  }).join('').trim();
}
/**
 * 페이지 블록을 문단으로 바꿉니다. 인용 블록은 바로 앞 문단의 한국어 해석으로 붙입니다.
 * 원문과 해석이 문단 단위로 짝지어지므로 Notion에서 원문 아래 `"`로 해석을 적으면 됩니다.
 */
export function blocksToParagraphs(blocks: readonly unknown[], language: string, label: string): ScriptParagraph[] {
  const paragraphs: ScriptParagraph[] = [];
  for (const entry of blocks) {
    const block = record(entry);
    const kind = typeof block?.type === 'string' ? block.type : '';
    if (!block || block.in_trash === true || block.archived === true) continue;
    const text = blockText(block, kind);
    if (!text) continue;
    if (kind === 'quote') {
      const previous = paragraphs.at(-1);
      if (!previous) throw new Error(`${label}: 해석(인용 블록)이 본문보다 먼저 나옵니다.`);
      previous.translation = previous.translation ? `${previous.translation}\n${text}` : text;
    } else if (SCRIPT_TEXT_BLOCKS.has(kind) || SCRIPT_HEADING_BLOCKS.has(kind)) {
      const sentences = splitSentences(text, language);
      if (sentences.length) {
        paragraphs.push({ kind: SCRIPT_HEADING_BLOCKS.has(kind) ? 'heading' : 'text', sentences, translation: '' });
      }
    }
  }
  return paragraphs;
}
/** 속성만 해석합니다. 빈 행이면 null이라 본문 블록을 받으러 가지 않습니다. */
export function extractNotionScriptHeader(page: unknown): Omit<Script, 'paragraphs'> | null {
  const input = record(page);
  if (!input || input.archived === true || input.in_trash === true) return null;
  const id = typeof input.id === 'string' ? input.id : '';
  const props = record(input.properties) ?? {};
  const title = lookup(props, SCRIPT_PROPERTY_NAMES.title);
  const languageRaw = lookup(props, SCRIPT_PROPERTY_NAMES.language);
  if (!title && !languageRaw) return null;
  if (!id || !title) throw new Error(`제목이 없는 스크립트 페이지: ${id || '(ID 없음)'}`);
  if (!languageRaw) throw new Error(`${title}: 스크립트의 언어 칸이 비어 있습니다.`);
  const language = scriptLanguage(languageRaw);
  if (!language) throw new Error(`${title}: 알 수 없는 언어 ${languageRaw}`);
  return { id, title, language, group: lookup(props, SCRIPT_PROPERTY_NAMES.group) || '기타' };
}
async function collectBlocks(token: string, pageId: string): Promise<unknown[]> {
  const blocks: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ page_size: '100' });
    if (cursor) query.set('start_cursor', cursor);
    const response = await notionRequest(token, 'GET', `/blocks/${encodeURIComponent(pageId)}/children?${query}`);
    if (!Array.isArray(response.results)) throw new Error('Notion 블록 결과의 results 필드가 배열이 아닙니다.');
    blocks.push(...response.results);
    if (response.has_more !== true) break;
    cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    if (!cursor || cursors.has(cursor)) throw new Error('Notion 블록 페이지네이션 커서가 잘못되었습니다.');
    cursors.add(cursor);
  }
  return blocks;
}
export async function collectScripts(token: string, sourceId: string): Promise<Script[]> {
  const scripts: Script[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const body: UnknownRecord = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const response = await notionRequest(token, 'POST', `/data_sources/${encodeURIComponent(sourceId)}/query`, body);
    if (!Array.isArray(response.results)) throw new Error('Notion 결과의 results 필드가 배열이 아닙니다.');
    for (const entry of response.results) {
      if (record(entry)?.object !== 'page') continue;
      const header = extractNotionScriptHeader(entry);
      if (!header) continue;
      const paragraphs = blocksToParagraphs(await collectBlocks(token, header.id), header.language, header.title);
      if (!paragraphs.length) throw new Error(`${header.title}: 스크립트 본문이 비어 있습니다.`);
      scripts.push({ ...header, paragraphs });
    }
    if (response.has_more !== true) break;
    cursor = typeof response.next_cursor === 'string' ? response.next_cursor : undefined;
    if (!cursor || cursors.has(cursor)) throw new Error('Notion 페이지네이션 커서가 잘못되었습니다.');
    cursors.add(cursor);
  }
  if (!scripts.length) throw new Error('Notion 스크립트가 0개여서 기존 데이터를 덮어쓰지 않습니다.');
  scripts.sort((a, b) => a.group.localeCompare(b.group, 'ko') || a.title.localeCompare(b.title, 'ko'));
  // 중복 ID 등은 브라우저와 같은 검증으로 걸러냅니다.
  return parseScriptPayload({ schemaVersion: 1, source: 'notion', scripts }).scripts;
}
