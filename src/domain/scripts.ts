import { canonicalLocale } from './words.js';

/**
 * 스크립트는 단어(개념)와 별개인, 한 언어로 쓰인 긴 글입니다. 관광 안내 멘트나 면접 답변처럼
 * 처음부터 끝까지 이어 듣는 용도이며 문단 → 문장 단위로 나눠 TTS가 한 문장씩 읽습니다.
 */
export interface ScriptParagraph {
  kind: 'heading' | 'text';
  /** 동기화 시점에 나눈 문장. 모바일 TTS가 긴 발화를 중간에 끊는 일을 피하려는 단위입니다. */
  sentences: string[];
  /** 이 문단의 한국어 해석. 화면에만 표시하고 읽지 않습니다. */
  translation: string;
}
export interface Script {
  id: string;
  title: string;
  language: string;
  group: string;
  paragraphs: ScriptParagraph[];
}
export interface ScriptPayload {
  schemaVersion: 1;
  source: 'seed' | 'notion';
  updatedAt: string;
  count: number;
  scripts: Script[];
}

// 문장 끝 바로 뒤의 여는 따옴표·괄호를 ICU가 앞 문장에 붙이는 경우가 있습니다. (`…年。“景福”…`)
const OPENERS = '“‘「『（《【〈([{';
const segmenters = new Map<string, Intl.Segmenter>();
/** 언어 규칙에 맞춰 문장을 나눕니다. 줄바꿈도 문장 경계로 봅니다. */
export function splitSentences(text: string, language: string): string[] {
  let segmenter = segmenters.get(language);
  if (!segmenter) {
    segmenter = new Intl.Segmenter(language, { granularity: 'sentence' });
    segmenters.set(language, segmenter);
  }
  const sentences: string[] = [];
  let carry = '';
  for (const { segment } of segmenter.segment(text)) {
    const sentence = carry + segment.trim();
    let cut = sentence.length;
    while (cut > 0 && OPENERS.includes(sentence[cut - 1]!)) cut--;
    carry = sentence.slice(cut);
    const body = sentence.slice(0, cut).trim();
    if (body) sentences.push(body);
  }
  if (carry) sentences.push(carry);
  return sentences;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 값이 없어요.`);
  return value.trim();
}
function paragraph(value: unknown, label: string): ScriptParagraph {
  if (!object(value) || !Array.isArray(value.sentences)) throw new Error(`${label} 문단이 올바르지 않습니다.`);
  const sentences = value.sentences.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  if (!sentences.length) throw new Error(`${label} 문단에 문장이 없습니다.`);
  return {
    kind: value.kind === 'heading' ? 'heading' : 'text',
    sentences,
    translation: typeof value.translation === 'string' ? value.translation.trim() : '',
  };
}
export function parseScriptPayload(raw: unknown): ScriptPayload {
  if (!object(raw) || raw.schemaVersion !== 1 || !Array.isArray(raw.scripts)) {
    throw new Error('지원하지 않는 스크립트 데이터 형식입니다.');
  }
  if (raw.scripts.length === 0) throw new Error('스크립트가 0개인 데이터는 적용하지 않습니다.');
  if (raw.count != null && raw.count !== raw.scripts.length) throw new Error('스크립트 수 정보가 실제 목록과 다릅니다.');
  const seen = new Set<string>();
  const scripts = raw.scripts.map((input: unknown, index: number): Script => {
    if (!object(input)) throw new Error(`${index + 1}번째 스크립트 데이터가 올바르지 않습니다.`);
    const id = required(input.id, '스크립트 ID');
    if (seen.has(id)) throw new Error(`중복된 스크립트 ID: ${id}`);
    seen.add(id);
    const language = canonicalLocale(required(input.language, `${id} 언어`));
    if (!language) throw new Error(`${id}: 유효하지 않은 언어 코드 ${String(input.language)}`);
    if (!Array.isArray(input.paragraphs) || !input.paragraphs.length) throw new Error(`${id}: 본문이 없습니다.`);
    return {
      id,
      title: required(input.title, `${id} 제목`),
      language,
      group: typeof input.group === 'string' && input.group.trim() ? input.group.trim() : '기타',
      paragraphs: input.paragraphs.map((item: unknown, n: number) => paragraph(item, `${id} ${n + 1}번째`)),
    };
  });
  return {
    schemaVersion: 1,
    source: raw.source === 'notion' ? 'notion' : 'seed',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt.trim() : '',
    count: scripts.length,
    scripts,
  };
}
