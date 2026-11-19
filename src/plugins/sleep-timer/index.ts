import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  createSleepTimer,
  createSleepTimerBackend,
  pauseIfPlaying,
} from './timer';

export type SleepTimerPluginConfig = {
  enabled: boolean;
  /** Epoch ms at which playback pauses, or null when no timer runs. */
  deadline: number | null;
};

const PRESET_MINUTES = [15, 30, 60];
const PAUSE_EVENT = 'peard:sleep-timer-pause';

const sleepBackend = createSleepTimerBackend();
// Native menu labels are fixed once built: rebuild once at expiry so the
// menu drops the end time and disables Cancel.
let refreshMenu: () => unknown = () => undefined;
const menuExpiry = createSleepTimer(() => {
  Promise.resolve().then(refreshMenu).catch(console.error);
});

export default createPlugin<unknown, unknown, unknown, SleepTimerPluginConfig>({
  name: () => t('plugins.sleep-timer.name'),
  description: () => t('plugins.sleep-timer.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    deadline: null,
  },
  menu: async ({ getConfig, setConfig, refresh }) => {
    const { deadline } = await getConfig();
    const active = deadline !== null && deadline > Date.now();
    refreshMenu = refresh;
    menuExpiry.set(deadline);

    const setDeadline = async (durationMs: number | null) => {
      await setConfig({
        deadline: durationMs === null ? null : Date.now() + durationMs,
      });
      await refresh();
    };

    return [
      {
        label: active
          ? t('plugins.sleep-timer.menu.stops-at', {
              time: new Date(deadline).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            })
          : t('plugins.sleep-timer.menu.inactive'),
        enabled: false,
      },
      ...PRESET_MINUTES.map((minutes) => ({
        label: t('plugins.sleep-timer.menu.minutes', { minutes }),
        click: () => setDeadline(minutes * 60_000),
      })),
      {
        label: t('plugins.sleep-timer.menu.cancel'),
        enabled: active,
        click: () => setDeadline(null),
      },
    ];
  },
  backend: {
    start: ({ getConfig, setConfig, ipc }) =>
      sleepBackend.start({
        getConfig,
        setConfig,
        pause: () => ipc.send(PAUSE_EVENT),
      }),
    stop: ({ setConfig }) => {
      menuExpiry.cancel();
      return sleepBackend.stop({ setConfig });
    },
    onConfigChange: (config) => sleepBackend.onConfigChange(config.deadline),
  },
  renderer: {
    start({ ipc }) {
      ipc.on(PAUSE_EVENT, () =>
        pauseIfPlaying(document.querySelector<HTMLVideoElement>('video')),
      );
    },
    stop({ ipc }) {
      ipc.removeAllListeners(PAUSE_EVENT);
    },
  },
});
