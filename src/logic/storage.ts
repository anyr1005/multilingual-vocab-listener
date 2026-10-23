import { parseWordPayload, type WordPayload } from '../domain/words.js';
import { DEFAULT_SETTINGS, normalizeSettings, type ListeningSettings } from './playlist.js';
export type Familiarity = 'known' | 'unknown';
export type Progress = Record<string, Familiarity>;

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
/** 같은 개념을 여러 언어로 학습하므로 암기 기록은 개념ID + 학습언어별로 구분. */
export const progressKey = (id: string, target: string): string => `${id}|${target}`;
export function loadProgress(): Progress {
  const value = readJSON('progress');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([id, state]) =>
    id.length > 0 && (state === 'known' || state === 'unknown'))) as Progress;
}
export function saveProgress(value: Progress): boolean { return saveJSON('progress', value); }
export function loadSettings(): ListeningSettings {
  const raw = readJSON('settings');
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? normalizeSettings(raw as Record<string, unknown>) : { ...DEFAULT_SETTINGS };
}
export function saveSettings(value: ListeningSettings): boolean { return saveJSON('settings', value); }
export function loadTargetLanguage(): string {
  try { return localStorage.getItem(PREFIX + 'targetLanguage') || 'zh-CN'; }
  catch { return 'zh-CN'; }
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
