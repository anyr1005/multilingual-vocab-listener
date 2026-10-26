/** 단어장(/)과 스크립트(script/) 두 페이지가 함께 쓰는 DOM·브라우저 헬퍼. */
export function dom<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`화면 요소가 없습니다: #${id}`);
  return node as T;
}
export const select = (id: string): HTMLSelectElement => dom<HTMLSelectElement>(id);
export const input = (id: string): HTMLInputElement => dom<HTMLInputElement>(id);

/**
 * 앱 루트 기준 URL. 하위 페이지는 `<meta name="app-root" content="../">`로 루트를 알려 줍니다.
 * 개발 서버(/)와 GitHub Pages(/repository/) 모두 상대 경로로 동작합니다.
 */
export function appUrl(path: string): URL {
  const root = document.querySelector<HTMLMetaElement>('meta[name="app-root"]')?.content ?? './';
  return new URL(path, new URL(root, document.baseURI));
}

let wakeLock: WakeLockSentinel | null = null;
/**
 * 연속 재생 중에는 화면이 꺼지지 않게 합니다. 글자를 보면서 듣는 사용 방식에 맞춥니다.
 * 지원하지 않는 브라우저(iOS Safari 등)에서는 조용히 무시됩니다.
 */
export async function keepScreenAwake(): Promise<void> {
  try { wakeLock = (await navigator.wakeLock?.request('screen')) ?? null; }
  catch { wakeLock = null; }
}
export function releaseScreen(): void {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}
/** 화면이 꺼졌다 돌아오면 wake lock이 해제돼 있으므로 재생 중이면 다시 요청합니다. */
export function restoreScreenWake(playing: boolean): void {
  if (!document.hidden && playing && !wakeLock) void keepScreenAwake();
}

/** 오프라인 캐시. 개발 서버에서는 낡은 번들이 남지 않도록 등록하지 않습니다. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(appUrl('sw.js'))
      .catch(() => undefined); // 등록 실패는 학습을 막지 않습니다.
  });
}
