# YourTune Mini Player for GNOME Shell

A panel mini player for GNOME Shell 50. It talks only to YourTune's API Server plugin, so nothing
extra runs in the app: playback controls, likes, shuffle, repeat, volume, starting a mix, and song
or video search that can play a result now or next. Starting a mix needs YourTune 1.4 or newer;
older versions play results through the queue instead.

## Install

Turn on the API Server plugin in YourTune (Plugins → API Server). It listens on `0.0.0.0` by
default, which accepts connections from other devices; `127.0.0.1` is enough for the extension.
The extension speaks plain HTTP, so leave the plugin's HTTPS option off.

Each [release](https://github.com/robotlog/YourTune/releases) has the extension as
`yourtune-gnome-extension-<version>.zip`:

```sh
gnome-extensions install --force yourtune-gnome-extension-<version>.zip
```

Or build it from the repository root:

```sh
gnome-extensions pack extras/gnome-extension --force \
  --extra-source=client.js --extra-source=panel.js --extra-source=searchView.js \
  --extra-source=search.js --extra-source=queue.js --extra-source=icons
gnome-extensions install --force yourtune-miniplayer@robotlog.github.io.shell-extension.zip
```

Log out and back in, then run `gnome-extensions enable yourtune-miniplayer@robotlog.github.io`.

Open the panel menu and click **Connect**, then allow `yourtune-gnome-miniplayer` in YourTune. The
extension's preferences, in the Extensions app, set the host and port and can forget the token.

## Development

Run a nested shell (`mutter-dev-bin` on Ubuntu) to load changes without logging out:

```sh
dbus-run-session gnome-shell --devkit --wayland
```

The search and queue parsers are tested with `node --test 'extras/gnome-extension/tests/*.test.js'`.
After changing the list in `tools/generate-icons.mjs`, regenerate the icons with
`node extras/gnome-extension/tools/generate-icons.mjs`.

## Credits

The icons are [Material Icons](https://github.com/google/material-design-icons) by Google
(Apache 2.0), from the `@mdui/icons` package. The panel icons are YourTune's tray icons. The
notice and license text in `icons/` ship in the extension zip.
