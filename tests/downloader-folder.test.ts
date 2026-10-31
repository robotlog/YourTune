import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { resolveDownloadFolder } from '../src/plugins/downloader/main/folder';

const fallback = join(tmpdir(), 'downloads');

test('uses an absolute folder on this OS, otherwise Downloads (#66)', () => {
  const native =
    process.platform === 'win32'
      ? 'C:\\Users\\me\\Downloads'
      : '/home/me/Downloads';

  expect(resolveDownloadFolder(native, fallback)).toBe(native);
  for (const invalid of [undefined, '', 'Downloads', '~/Downloads']) {
    expect(resolveDownloadFolder(invalid, fallback)).toBe(fallback);
  }
  if (process.platform !== 'win32') {
    expect(resolveDownloadFolder('C:\\Users\\me\\Downloads', fallback)).toBe(
      fallback,
    );
  } else {
    expect(resolveDownloadFolder('/home/me/Downloads', fallback)).toBe(
      fallback,
    );
  }
});
