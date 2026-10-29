import { parseWordPayload, type WordPayload } from '../domain/words.js';
import { appUrl } from './page.js';
import { parseScriptSource, type ScriptSource } from './scriptCrypto.js';
import { cacheScripts, cacheWords, loadCachedScripts, loadCachedWords } from './storage.js';

export interface LoadedWords {
  payload: WordPayload;
  fromCache: boolean;
  error?: string;
}

export async function fetchWords(): Promise<LoadedWords> {
  try {
    const url = appUrl('data/words.json');
    url.searchParams.set('_', String(Date.now()));
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = parseWordPayload(await response.json() as unknown);
    cacheWords(payload); // 저장 실패는 학습 자체를 막지 않습니다.
    return { payload, fromCache: false };
  } catch (error) {
    const cache = loadCachedWords();
    if (cache) {
      return { payload: cache, fromCache: true,
        error: error instanceof Error ? error.message : '네트워크 오류' };
    }
    throw error;
  }
}

/**
 * 스크립트는 선택 기능이라 파일이 없으면(404) 오류가 아니라 '스크립트 없음'입니다.
 * 네트워크 오류일 때만 저장해 둔 스크립트로 대신합니다. 암호화된 파일은 연 내용이 아니라 받은 그대로 저장합니다.
 */
export async function fetchScripts(): Promise<ScriptSource | null> {
  let response: Response;
  try {
    const url = appUrl('data/scripts.json');
    url.searchParams.set('_', String(Date.now()));
    response = await fetch(url, { cache: 'no-store' });
  } catch { return loadCachedScripts(); }
  if (response.status === 404) { cacheScripts(null); return null; }
  try {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const source = parseScriptSource(await response.json() as unknown);
    cacheScripts(source);
    return source;
  } catch { return loadCachedScripts(); }
}
