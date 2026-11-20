export type ThrottlingTrigger = 'play' | 'timer' | 'closed';

// The slice of BrowserWindow this needs, so it can be tested without Electron.
export interface ThrottledWindow {
  isDestroyed(): boolean;
  once(event: 'closed', listener: () => void): unknown;
  webContents: {
    isDestroyed(): boolean;
    setBackgroundThrottling(allowed: boolean): void;
  };
}

export interface RestoreThrottlingOptions {
  win: ThrottledWindow;
  // Registers a listener that is called when playback starts and returns the
  // function that removes it.
  onPlay: (listener: () => void) => () => void;
  timeoutMs?: number;
  // Called once with whatever restored throttling
  onRestore?: (trigger: ThrottlingTrigger) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * A window is created with background throttling off so its first page load
 * finishes even when it is minimized right away. This turns throttling back on,
 * once, when playback starts, after a safety timeout, or when the window closes.
 */
export const restoreThrottlingOnFirstPlay = ({
  win,
  onPlay,
  timeoutMs = 60_000,
  onRestore,
  setTimeout: setTimer = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: clearTimer = (h) =>
    globalThis.clearTimeout(h as ReturnType<typeof globalThis.setTimeout>),
}: RestoreThrottlingOptions) => {
  let restored = false;
  let unsubscribe: (() => void) | undefined;

  const restore = (trigger: ThrottlingTrigger) => {
    if (restored) return;
    restored = true;
    clearTimer(timer);
    unsubscribe?.();
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.setBackgroundThrottling(true);
    }
    onRestore?.(trigger);
  };

  const timer = setTimer(() => restore('timer'), timeoutMs);
  unsubscribe = onPlay(() => restore('play'));
  win.once('closed', () => restore('closed'));
};
