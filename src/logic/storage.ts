import { parseWordPayload, type WordPayload } from '../domain/words.js';
import { DEFAULT_SETTINGS, normalizeSettings, type ListeningSettings } from './playlist.js';
import { parseScriptSource, type ScriptKey, type ScriptSource } from './scriptCrypto.js';
import { DEFAULT_SCRIPT_SETTINGS, normalizeScriptSettings, type ScriptSettings } from './scriptPlaylist.js';
import { sanitizeProgress, type Progress } from './progress.js';

export { progressKey, readProgress, toggleProgress } from './progress.js';
export type { Familiarity, Progress } from './progress.js';

const PREFIX = 'vocab-listener:v2:';
const LEGACY_PREFIX = 'chinese-vocab:v1:';
function readJSON(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key) ?? localStorage.getItem(LEGACY_PREFIX + key);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch { return null; }
}
function saveJSON(key: string, value: unknown): boolean {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function loadProgress(): Progress {
  return sanitizeProgress(readJSON('progress'));
}
export function saveProgress(value: Progress): boolean { return saveJSON('progress', value); }
export function loadSettings(): ListeningSettings {
  const raw = readJSON('settings');
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? normalizeSettings(raw as Record<string, unknown>) : { ...DEFAULT_SETTINGS };
}
export function saveSettings(value: ListeningSettings): boolean { return saveJSON('settings', value); }
/** 저장된 값이 없으면 null. 어떤 언어로 시작할지는 실제 데이터가 정합니다. */
export function loadTargetLanguage(): string | null {
  try { return localStorage.getItem(PREFIX + 'targetLanguage') || null; }
  catch { return null; }
}
export function saveTargetLanguage(value: string): boolean {
  try { localStorage.setItem(PREFIX + 'targetLanguage', value); return true; }
  catch { return false; }
}
export function loadCachedWords(): WordPayload | null {
  try { return parseWordPayload(readJSON('words')); } catch { return null; }
}
export function cacheWords(value: WordPayload): boolean { return saveJSON('words', value); }
/** 출퇴근 중 앱을 다시 열었을 때 마지막으로 보던 개념부터 이어서 학습합니다. */
export function loadLastConceptId(): string | null {
  try { return localStorage.getItem(PREFIX + 'lastConcept') || null; }
  catch { return null; }
}
export function saveLastConceptId(value: string): boolean {
  try { localStorage.setItem(PREFIX + 'lastConcept', value); return true; }
  catch { return false; }
}
export function loadScriptSettings(): ScriptSettings {
  const raw = readJSON('scriptSettings');
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? normalizeScriptSettings(raw as Record<string, unknown>) : { ...DEFAULT_SCRIPT_SETTINGS };
}
export function saveScriptSettings(value: ScriptSettings): boolean { return saveJSON('scriptSettings', value); }
export function loadCachedScripts(): ScriptSource | null {
  try { return parseScriptSource(readJSON('scripts')); } catch { return null; }
}
export function cacheScripts(value: ScriptSource | null): boolean {
  if (value) return saveJSON('scripts', value);
  try { localStorage.removeItem(PREFIX + 'scripts'); return true; }
  catch { return false; }
}
/** 암호화된 스크립트를 여는 키. '이 기기에서 기억하기'를 골랐을 때만 저장합니다. */
export function loadScriptKey(): ScriptKey | null {
  const raw = readJSON('scriptKey');
  if (!raw || typeof raw !== 'object') return null;
  const { salt, iterations, key } = raw as Record<string, unknown>;
  return typeof salt === 'string' && typeof iterations === 'number' && typeof key === 'string'
    ? { salt, iterations, key } : null;
}
export function saveScriptKey(value: ScriptKey | null): boolean {
  if (value) return saveJSON('scriptKey', value);
  try { localStorage.removeItem(PREFIX + 'scriptKey'); return true; }
  catch { return false; }
}
/** 마지막으로 듣던 스크립트와 문장 위치. 출퇴근 중 끊긴 곳부터 이어 듣습니다. */
export interface ScriptPosition { id: string; sentence: number }
export function loadScriptPosition(): ScriptPosition | null {
  const raw = readJSON('scriptPosition');
  if (!raw || typeof raw !== 'object') return null;
  const { id, sentence } = raw as Record<string, unknown>;
  return typeof id === 'string' && typeof sentence === 'number' && Number.isInteger(sentence) && sentence >= 0
    ? { id, sentence } : null;
}
export function saveScriptPosition(value: ScriptPosition): boolean { return saveJSON('scriptPosition', value); }
/** 언어(BCP47)별로 고른 TTS 음성의 voiceURI. 단어장과 스크립트 페이지가 함께 씁니다. */
export function loadVoicePreferences(): Record<string, string> {
  const raw = readJSON('voices');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && entry[1] !== ''));
}
export function saveVoicePreferences(value: Record<string, string>): boolean { return saveJSON('voices', value); }
