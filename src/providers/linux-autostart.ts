import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ENTRY_FILE = 'com.robotlog.yourtune.desktop';

// Quoted for the Exec key, then escaped like any other desktop entry value.
const quoteExec = (path: string) =>
  `"${path.replace(/["`$\\]/g, '\\$&')}"`
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '%%');

export const createAutostartEntry = (exec: string) =>
  [
    '[Desktop Entry]',
    'Type=Application',
    'Name=YourTune',
    `Exec=${quoteExec(exec)}`,
    'Icon=yourtune',
    'Terminal=false',
    '',
  ].join('\n');

// Electron's login items don't exist on Linux, where desktops start what's in
// the autostart folder instead.
export const updateLinuxAutostart = (app: Electron.App, enabled: boolean) => {
  // In development the binary is Electron itself, which wouldn't start YourTune.
  if (!app.isPackaged) return;

  const file = join(app.getPath('appData'), 'autostart', ENTRY_FILE);
  try {
    if (enabled) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(
        file,
        createAutostartEntry(process.env.APPIMAGE ?? process.execPath),
      );
    } else {
      rmSync(file, { force: true });
    }
  } catch (error) {
    console.error('Could not update the autostart entry:', error);
  }
};
