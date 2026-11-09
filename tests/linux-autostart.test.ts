import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createAutostartEntry,
  updateLinuxAutostart,
} from '../src/providers/linux-autostart';

test.skip(process.platform !== 'linux', 'linux autostart only');

const execLine = (path: string) =>
  createAutostartEntry(path)
    .split('\n')
    .find((line) => line.startsWith('Exec='));

test('writes a desktop entry for the binary', () => {
  expect(createAutostartEntry('/opt/YourTune/yourtune')).toBe(
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=YourTune',
      'Exec="/opt/YourTune/yourtune"',
      'Icon=yourtune',
      'Terminal=false',
      '',
    ].join('\n'),
  );
});

test('escapes the binary path for the Exec key', () => {
  expect(execLine('/home/me/My Apps/your tune')).toBe(
    'Exec="/home/me/My Apps/your tune"',
  );
  expect(execLine('/opt/100%/yourtune')).toBe('Exec="/opt/100%%/yourtune"');
  expect(execLine('/opt/$a`b"c/yourtune')).toBe(
    'Exec="/opt/\\\\$a\\\\`b\\\\"c/yourtune"',
  );
  expect(execLine('/opt/a\\b/yourtune')).toBe(
    'Exec="/opt/a\\\\\\\\b/yourtune"',
  );
});

test.describe('updateLinuxAutostart', () => {
  let configDir: string;
  let entry: string;
  const fakeApp = (isPackaged: boolean) =>
    ({ isPackaged, getPath: () => configDir }) as unknown as Electron.App;

  test.beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'yourtune-autostart-'));
    entry = join(configDir, 'autostart', 'com.robotlog.yourtune.desktop');
  });

  test.afterEach(() => {
    delete process.env.APPIMAGE;
    rmSync(configDir, { recursive: true, force: true });
  });

  test('adds the entry and removes it again', () => {
    updateLinuxAutostart(fakeApp(true), true);
    expect(readFileSync(entry, 'utf8')).toContain(`Exec="${process.execPath}"`);

    updateLinuxAutostart(fakeApp(true), false);
    expect(existsSync(entry)).toBe(false);
  });

  test('starts the AppImage rather than its mounted binary', () => {
    process.env.APPIMAGE = '/home/me/YourTune.AppImage';
    updateLinuxAutostart(fakeApp(true), true);
    expect(readFileSync(entry, 'utf8')).toContain(
      'Exec="/home/me/YourTune.AppImage"',
    );
  });

  test('does nothing when it runs from source', () => {
    updateLinuxAutostart(fakeApp(false), true);
    expect(existsSync(entry)).toBe(false);
  });
});
