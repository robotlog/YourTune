export type TimerClock = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

const realClock: TimerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

// setTimeout caps at ~24.8 days and drifts while the machine sleeps,
// so wake up in short slices and compare against the wall-clock deadline.
const MAX_SLICE_MS = 30_000;

export const createSleepTimer = (
  onExpire: (deadline: number) => void,
  clock = realClock,
) => {
  let handle: unknown;
  let generation = 0;

  const cancel = () => {
    generation += 1;
    if (handle !== undefined) clock.clearTimeout(handle);
    handle = undefined;
  };

  const schedule = (deadline: number, id: number) => {
    const left = deadline - clock.now();
    handle = clock.setTimeout(
      () => {
        if (id !== generation) return;
        if (clock.now() >= deadline) {
          handle = undefined;
          onExpire(deadline);
        } else {
          schedule(deadline, id);
        }
      },
      Math.max(0, Math.min(left, MAX_SLICE_MS)),
    );
  };

  return {
    /** Replaces any running timer. A null or past deadline just cancels. */
    set(deadline: number | null) {
      cancel();
      if (deadline === null || deadline <= clock.now()) return;
      schedule(deadline, generation);
    },
    cancel,
  };
};

type DeadlineStore = {
  getConfig: () =>
    | Promise<{ deadline: number | null }>
    | { deadline: number | null };
  setConfig: (config: { deadline: number | null }) => Promise<void> | void;
};

const logError = (err: unknown) => console.error(err);

export const createSleepTimerBackend = (clock = realClock) => {
  let timer: ReturnType<typeof createSleepTimer> | undefined;
  // Bumped by every lifecycle event, so a start whose config read is
  // overtaken by stop, a newer start or a config change never arms.
  let version = 0;

  return {
    async start({
      getConfig,
      setConfig,
      pause,
    }: DeadlineStore & {
      pause: () => void;
    }) {
      timer?.cancel();
      const own = (version += 1);
      const current = createSleepTimer((deadline) => {
        try {
          pause();
        } catch (err) {
          // The window can be gone while the app lives on (macOS).
          logError(err);
        }
        // Clear only the deadline that fired; a newer one stays.
        const firedAt = version;
        Promise.resolve(getConfig())
          .then((config) =>
            firedAt === version && config.deadline === deadline
              ? setConfig({ deadline: null })
              : undefined,
          )
          .catch(logError);
      }, clock);
      timer = current;
      const { deadline } = await getConfig();
      if (own === version) current.set(deadline);
    },
    async stop({ setConfig }: Pick<DeadlineStore, 'setConfig'>) {
      version += 1;
      timer?.cancel();
      timer = undefined;
      // stop only runs on disable: re-enabling must not resume this deadline.
      await Promise.resolve(setConfig({ deadline: null })).catch(logError);
    },
    onConfigChange(deadline: number | null) {
      version += 1;
      timer?.set(deadline);
    },
  };
};

/** Pause only, never toggle: a player that is already paused stays paused. */
export const pauseIfPlaying = (
  video: { paused: boolean; pause(): void } | null,
) => {
  if (video && !video.paused) video.pause();
};
