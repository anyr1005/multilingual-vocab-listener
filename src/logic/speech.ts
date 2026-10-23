
export class SpeechUnavailableError extends Error {
  constructor() { super('이 브라우저에서는 음성 합성을 사용할 수 없습니다.'); }
}

/**
 * 음성 재생만 담당합니다. 순서/반복 로직은 playlist.ts가 결정합니다.
 * 취소 시 진행 중인 Promise까지 정리하여 재생 루프가 멈추도록 합니다.
 */
export class SpeechPlayer {
  private readonly synthesis: SpeechSynthesis | null;
  private activeCancel: (() => void) | null = null;

  constructor() {
    this.synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis : null;
  }
  get isSupported(): boolean { return this.synthesis !== null; }

  cancel(): void {
    this.activeCancel?.();
    this.activeCancel = null;
    this.synthesis?.cancel();
  }

  speak(text: string, language: string, rate: number, signal: AbortSignal): Promise<void> {
    const synth = this.synthesis;
    if (!synth) return Promise.reject(new SpeechUnavailableError());
    if (signal.aborted || !text.trim()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = rate;
      const voices = synth.getVoices();
      const exact = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
      const prefix = language.split('-')[0]!.toLowerCase();
      const voice = exact ?? voices.find(v => v.lang.toLowerCase().startsWith(prefix));
      if (voice) utterance.voice = voice;
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', cancel);
        clearTimeout(watchdog);
        utterance.onend = null;
        utterance.onerror = null;
        if (this.activeCancel === cancel) this.activeCancel = null;
        if (error) reject(error); else resolve();
      };
      const cancel = () => { synth.cancel(); finish(); };
      this.activeCancel = cancel;
      signal.addEventListener('abort', cancel, { once: true });
      utterance.onend = () => finish();
      utterance.onerror = event => {
        if (event.error === 'canceled' || event.error === 'interrupted' || signal.aborted) finish();
        else finish(new Error(`음성 재생 오류: ${event.error}`));
      };
      // 일부 브라우저는 종료 이벤트를 누락할 수 있습니다. 영구 정지 대신 실패로 반환합니다.
      const maxMs = Math.min(60000, Math.max(12000, text.length * 1100));
      watchdog = setTimeout(() => {
        synth.cancel();
        finish(new Error('음성 엔진의 응답 시간이 초과됐습니다.'));
      }, maxMs);
      try {
        synth.cancel(); // 이전에 단독으로 재생한 음성을 정리
        synth.speak(utterance);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('음성을 시작하지 못했습니다.'));
      }
    });
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}
