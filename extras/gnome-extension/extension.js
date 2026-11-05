import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {YourTuneClient} from './client.js';
import {MiniPlayerIndicator} from './panel.js';

// YourTune owns this name while it runs (from its Shortcuts plugin), so the panel follows YourTune
// without polling the API Server.
const YOURTUNE_BUS_NAME = 'org.mpris.MediaPlayer2.YourTune';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export default class YourTuneMiniPlayerExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._client = new YourTuneClient(this._settings);
    this._indicator = new MiniPlayerIndicator({path: this.path, client: this._client, settings: this._settings});
    Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');

    this._busNameOwned = false;
    this._busWatchId = Gio.bus_watch_name(Gio.BusType.SESSION, YOURTUNE_BUS_NAME, Gio.BusNameWatcherFlags.NONE,
      () => {
        this._busNameOwned = true;
        this._syncRunning();
      },
      () => {
        this._busNameOwned = false;
        this._syncRunning();
      });
    this._hostChangedId = this._settings.connect('changed::host', () => this._syncRunning());
  }

  // The bus name only tells about a YourTune on this machine; one on another host is assumed to run.
  _syncRunning() {
    const local = LOCAL_HOSTS.has(this._settings.get_string('host'));
    this._indicator.setYourTuneRunning(this._busNameOwned || !local);
  }

  disable() {
    if (this._busWatchId) {
      Gio.bus_unwatch_name(this._busWatchId);
      this._busWatchId = 0;
    }
    if (this._hostChangedId) {
      this._settings.disconnect(this._hostChangedId);
      this._hostChangedId = 0;
    }
    this._settings = null;
    this._indicator?.destroy();
    this._indicator = null;
    this._client?.destroy();
    this._client = null;
  }
}
