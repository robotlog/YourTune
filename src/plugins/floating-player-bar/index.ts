import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

export default createPlugin({
  name: () => t('plugins.floating-player-bar.name'),
  description: () => t('plugins.floating-player-bar.description'),
  restartNeeded: false,
  config: {
    enabled: true,
  },
  stylesheets: [style],
  // only plugins with a renderer part are loaded in the renderer, where the stylesheet applies
  renderer: {},
});
