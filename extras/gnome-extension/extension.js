import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {YourTuneClient} from './client.js';
import {MiniPlayerIndicator} from './panel.js';

export default class YourTuneMiniPlayerExtension extends Extension {
  enable() {
    const settings = this.getSettings();
    this._client = new YourTuneClient(settings);
    this._indicator = new MiniPlayerIndicator({path: this.path, client: this._client});
    Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');
    this._client.start();
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    this._client?.destroy();
    this._client = null;
  }
}
