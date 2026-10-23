import { parseWordPayload, type WordPayload } from '../domain/words.js';
import { cacheWords, loadCachedWords } from './storage.js';

export interface LoadedWords {
  payload: WordPayload;
  fromCache: boolean;
  error?: string;
}

export async function fetchWords(): Promise<LoadedWords> {
  try {
    // baseURI 기준 상대 URL: 개발 서버(/)와 GitHub Pages(/repository/) 모두 지원.
    const url = new URL('./data/words.json', document.baseURI);
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
