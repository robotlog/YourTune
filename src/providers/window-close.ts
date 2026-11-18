import type { App, BrowserWindow } from 'electron';

export const setupCloseToHide = (
  app: App,
  win: BrowserWindow,
  platform: NodeJS.Platform = process.platform,
) => {
  let forceQuit = false;
  let leavingFullscreen = false;

  const onBeforeQuit = () => {
    forceQuit = true;
  };
  const hideAfterFullscreen = () => {
    leavingFullscreen = false;
    if (!forceQuit && !win.isDestroyed()) {
      win.hide();
    }
  };

  app.on('before-quit', onBeforeQuit);
  win.once('closed', () => {
    app.removeListener('before-quit', onBeforeQuit);
    win.removeListener('leave-full-screen', hideAfterFullscreen);
  });

  win.on('close', (event) => {
    if (forceQuit) return;

    event.preventDefault();
    if (leavingFullscreen) return;

    if (platform === 'darwin' && win.isFullScreen()) {
      leavingFullscreen = true;
      win.once('leave-full-screen', hideAfterFullscreen);
      win.setFullScreen(false);
    } else {
      win.hide();
    }
  });
};
