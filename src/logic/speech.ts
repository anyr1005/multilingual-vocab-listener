
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
  private voicesReady: Promise<void> | null = null;
  private readonly voiceCache = new Map<string, SpeechSynthesisVoice | null>();

  constructor() {
    this.synthesis = typeof window !== 'undefined' && 'speechSynthesis' in window
      ? window.speechSynthesis : null;
    // 음성 목록은 비동기로 채워지며, 나중에 OS가 언어팩을 추가하면 다시 바뀝니다.
    this.synthesis?.addEventListener?.('voiceschanged', () => this.voiceCache.clear());
  }
  get isSupported(): boolean { return this.synthesis !== null; }

  /**
   * Chrome·Safari의 getVoices()는 첫 호출에서 빈 배열을 반환합니다.
   * 기다리지 않으면 세션의 첫 단어만 OS 기본 음성으로 읽혀 언어가 어긋납니다.
   */
  private waitForVoices(): Promise<void> {
    const synth = this.synthesis;
    if (!synth || synth.getVoices().length) return Promise.resolve();
    this.voicesReady ??= new Promise<void>(resolve => {
      const done = (): void => {
        clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', done);
        resolve();
      };
      // 음성이 하나도 설치되지 않은 환경에서 영원히 멈추지 않도록 제한을 둡니다.
      const timer = setTimeout(done, 2000);
      synth.addEventListener?.('voiceschanged', done, { once: true });
    });
    return this.voicesReady;
  }

  /** 정확히 일치하는 BCP47 음성을 우선하고, 없으면 같은 기본 언어의 음성을 씁니다. */
  private pickVoice(language: string): SpeechSynthesisVoice | null {
    const cached = this.voiceCache.get(language);
    if (cached !== undefined) return cached;
    const voices = this.synthesis?.getVoices() ?? [];
    const wanted = language.toLowerCase();
    const prefix = `${wanted.split('-')[0]!}-`;
    const voice = voices.find(v => v.lang.toLowerCase().replace('_', '-') === wanted)
      ?? voices.find(v => {
        const lang = v.lang.toLowerCase().replace('_', '-');
        return lang === wanted.split('-')[0] || lang.startsWith(prefix);
      })
      ?? null;
    this.voiceCache.set(language, voice);
    return voice;
  }

  cancel(): void {
    this.activeCancel?.();
    this.activeCancel = null;
    this.synthesis?.cancel();
  }

  async speak(text: string, language: string, rate: number, signal: AbortSignal): Promise<void> {
    const synth = this.synthesis;
    if (!synth) throw new SpeechUnavailableError();
    if (signal.aborted || !text.trim()) return;
    await this.waitForVoices();
    if (signal.aborted) return;
    return new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = rate;
      const voice = this.pickVoice(language);
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
        // iOS Safari는 cancel() 직후의 speak()를 자주 흘려버립니다.
        // 연속 재생은 직전 발화가 끝난 뒤에 넘어오므로 남은 것이 있을 때만 정리합니다.
        if (synth.speaking || synth.pending) synth.cancel();
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
