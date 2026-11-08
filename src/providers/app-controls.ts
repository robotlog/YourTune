import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import * as config from '@/config';
import { t } from '@/i18n';

export const restart = () => restartInternal();

export const askToRestart = async (
  name: string,
  parent?: BrowserWindow | null,
) => {
  const options: Electron.MessageBoxOptions = {
    type: 'info',
    buttons: [
      t('main.dialog.need-to-restart.buttons.restart-now'),
      t('main.dialog.need-to-restart.buttons.later'),
    ],
    title: t('main.dialog.need-to-restart.title'),
    message: t('main.dialog.need-to-restart.message', { pluginName: name }),
    detail: t('main.dialog.need-to-restart.detail', { pluginName: name }),
    defaultId: 0,
    cancelId: 1,
  };

  const { response } = await (parent
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options));
  if (response === 0) restart();
};

export const setupAppControls = () => {
  ipcMain.on('peard:restart', restart);
  ipcMain.handle('peard:get-downloads-folder', () => app.getPath('downloads'));
  ipcMain.on('peard:reload', () =>
    BrowserWindow.getFocusedWindow()?.webContents.loadURL(config.get('url')),
  );
  ipcMain.handle('peard:get-path', (_, ...args: string[]) =>
    path.join(...args),
  );
};

function restartInternal() {
  app.relaunch({ execPath: process.env.PORTABLE_EXECUTABLE_FILE });
  // ExecPath will be undefined if not running portable app, resulting in default behavior
  app.quit();
}

function sendToFrontInternal(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export const sendToFront =
  process.type === 'browser'
    ? sendToFrontInternal
    : () => {
        console.error('sendToFront called from renderer');
      };
