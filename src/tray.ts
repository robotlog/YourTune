import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import PausedTrayIconWhite from '@assets/tray-paused-white.png?asset&asarUnpack';
import PausedTrayIcon from '@assets/tray-paused.png?asset&asarUnpack';
import TrayIconWhite from '@assets/tray-white.png?asset&asarUnpack';
import TrayIcon from '@assets/tray.png?asset&asarUnpack';
import { Menu, nativeImage, screen, Tray } from 'electron';
import is from 'electron-is';

import { APPLICATION_NAME, t } from '@/i18n';

import * as config from './config';
import { askToRestart, restart } from './providers/app-controls';
import { getSongControls } from './providers/song-controls';
import { registerCallback, SongInfoEvent } from './providers/song-info';

import type { MenuTemplate } from './menu';

const execFileAsync = promisify(execFile);

const GNOME_MINI_PLAYER_UUID = 'yourtune-miniplayer@robotlog.github.io';
const GNOME_MINI_PLAYER_NAME = 'YourTune Mini Player';
const GNOME_SHELL_QUERY_TIMEOUT_MS = 1000;

// Prevent tray being garbage collected
let tray: Electron.Tray | undefined;
let restartOffered = false;
// Items a plugin adds above Restart; the menu is rebuilt when they change.
let extraItems: MenuTemplate = [];
let rebuildMenu: (() => void) | undefined;

export const setTrayExtraItems = (items: MenuTemplate) => {
  extraItems = items;
  rebuildMenu?.();
};

type TrayEvent = (
  event: Electron.KeyboardEvent,
  bounds: Electron.Rectangle,
) => void;

export const setTrayOnClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('click');
  tray.on('click', fn);
};

// Won't do anything on macOS since its disabled
export const setTrayOnDoubleClick = (fn: TrayEvent) => {
  if (!tray) {
    return;
  }

  tray.removeAllListeners('double-click');
  tray.on('double-click', fn);
};

// The GNOME mini player is a panel icon of its own (#30). The tray can't make way
// for it once it exists: after Tray.destroy(), Ubuntu's AppIndicator extension
// keeps an empty icon for as long as the app runs. So it isn't created at all
// when the mini player will show up. That only takes the extension and the bus
// name from the Shortcuts plugin: without a connection the mini player still
// shows, and asks to be allowed or for the API Server to be turned on.
const miniPlayerReplacesTray = async () => {
  if (!is.linux() || !(await config.plugins.isEnabled('shortcuts'))) {
    return false;
  }

  try {
    const { stdout } = await execFileAsync(
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.gnome.Shell',
        '--object-path',
        '/org/gnome/Shell',
        '--method',
        'org.gnome.Shell.Extensions.GetExtensionInfo',
        GNOME_MINI_PLAYER_UUID,
      ],
      { timeout: GNOME_SHELL_QUERY_TIMEOUT_MS },
    );
    return /'state': <1(\.0)?>/.test(stdout);
  } catch {
    // Not GNOME Shell, or gdbus isn't there
    return false;
  }
};

// The extension can also be turned on while YourTune runs. The tray is already
// there then and only a restart can take it away, so ask, once per run.
export const offerRestartForMiniPlayer = async () => {
  if (!tray || restartOffered) return;
  restartOffered = true;

  if (await miniPlayerReplacesTray()) {
    await askToRestart(GNOME_MINI_PLAYER_NAME);
  }
};

export const setUpTray = async (
  app: Electron.App,
  win: Electron.BrowserWindow,
) => {
  if (!config.get('options.tray') || (await miniPlayerReplacesTray())) {
    tray = undefined;
    return;
  }

  const { playPause, next, previous } = getSongControls(win);

  const pixelRatio = is.windows()
    ? screen.getPrimaryDisplay().scaleFactor || 1
    : 1;

  const defaultTrayIcon = nativeImage
    .createFromPath(is.macOS() ? TrayIconWhite : TrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });
  const pausedTrayIcon = nativeImage
    .createFromPath(is.macOS() ? PausedTrayIconWhite : PausedTrayIcon)
    .resize({
      width: 16 * pixelRatio,
      height: 16 * pixelRatio,
    });

  tray = new Tray(defaultTrayIcon);

  tray.setToolTip(
    t('main.tray.tooltip.default', {
      applicationName: APPLICATION_NAME,
    }),
  );

  // MacOS only
  tray.setIgnoreDoubleClickEvents(true);

  tray.on('click', () => {
    if (config.get('options.trayClickPlayPause')) {
      playPause();
    } else if (win.isVisible()) {
      win.hide();
      app.dock?.hide();
    } else {
      win.show();
      app.dock?.show();
    }
  });

  const template: MenuTemplate = [
    {
      label: t('main.tray.play-pause'),
      click() {
        playPause();
      },
    },
    {
      label: t('main.tray.next'),
      click() {
        next();
      },
    },
    {
      label: t('main.tray.previous'),
      click() {
        previous();
      },
    },
    {
      label: t('main.tray.show'),
      click() {
        win.show();
        app.dock?.show();
      },
    },
  ];
  const tail: MenuTemplate = [
    { type: 'separator' },
    {
      label: t('main.tray.restart'),
      click: restart,
    },
    { type: 'separator' },
    {
      label: t('main.tray.quit'),
      role: 'quit',
    },
  ];

  rebuildMenu = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([...template, ...extraItems, ...tail]),
    );
  rebuildMenu();

  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.TimeChanged) return;

    if (tray) {
      if (typeof songInfo.isPaused === 'undefined') {
        tray.setImage(defaultTrayIcon);
        return;
      }

      tray.setToolTip(
        t('main.tray.tooltip.with-song-info', {
          artist: songInfo.artist,
          title: songInfo.title,
          applicationName: APPLICATION_NAME,
        }),
      );

      tray.setImage(songInfo.isPaused ? pausedTrayIcon : defaultTrayIcon);
    }
  });
};
