import { t } from '@/i18n';
import { showToast } from '@/plugins/utils/renderer';
import { createPlugin } from '@/utils';

import { createQuickAdd } from './quick-add';

import type { AppElement } from '@/types/queue';

let quickAdd: ReturnType<typeof createQuickAdd> | undefined;

export default createPlugin({
  name: () => t('plugins.quick-add-to-playlist.name'),
  description: () => t('plugins.quick-add-to-playlist.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  renderer: {
    onPlayerApiReady() {
      quickAdd?.unmount();
      quickAdd = createQuickAdd(document, {
        label: t('plugins.quick-add-to-playlist.button'),
        unavailable: t('plugins.quick-add-to-playlist.unavailable'),
        notify: (message) =>
          showToast(document.querySelector<AppElement>('ytmusic-app'), message),
      });
      quickAdd.mount();
    },
    stop() {
      quickAdd?.unmount();
      quickAdd = undefined;
    },
  },
});
