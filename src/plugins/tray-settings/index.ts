import { Menu } from 'electron';

import { t } from '@/i18n';
import { setTrayExtraItems } from '@/tray';
import { createPlugin } from '@/utils';

export default createPlugin({
  name: () => t('plugins.tray-settings.name'),
  description: () => t('plugins.tray-settings.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  backend: {
    start({ window }) {
      setTrayExtraItems([
        {
          label: t('plugins.tray-settings.menu.open'),
          click() {
            window.show();
            // The app menu holds every setting, and it exists even with In-App Menu off
            Menu.getApplicationMenu()?.popup({ window });
          },
        },
      ]);
    },
    stop() {
      setTrayExtraItems([]);
    },
  },
});
