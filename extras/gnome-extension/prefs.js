import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class YourTuneMiniPlayerPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    const page = new Adw.PreferencesPage();
    window.add(page);

    const server = new Adw.PreferencesGroup({
      title: 'API Server',
      description: 'Where YourTune\'s API Server plugin listens. Match the plugin\'s Hostname and Port menu items.',
    });
    page.add(server);

    const host = new Adw.EntryRow({title: 'Host', text: settings.get_string('host'), show_apply_button: true});
    host.connect('apply', () => settings.set_string('host', host.text.trim() || '127.0.0.1'));
    server.add(host);

    const port = Adw.SpinRow.new_with_range(1, 65535, 1);
    port.title = 'Port';
    settings.bind('port', port, 'value', Gio.SettingsBindFlags.DEFAULT);
    server.add(port);

    const access = new Adw.PreferencesGroup({title: 'Access'});
    page.add(access);
    const reset = new Adw.ActionRow({
      title: 'Forget access token',
      subtitle: 'The panel asks YourTune for access again on the next connect.',
    });
    const resetButton = new Gtk.Button({label: 'Forget', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
    const syncReset = () => {
      resetButton.sensitive = settings.get_string('token') !== '';
    };
    resetButton.connect('clicked', () => settings.set_string('token', ''));
    const tokenChangedId = settings.connect('changed::token', syncReset);
    window.connect('close-request', () => {
      settings.disconnect(tokenChangedId);
      return false;
    });
    syncReset();
    reset.add_suffix(resetButton);
    access.add(reset);
  }
}
