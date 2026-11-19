import { expect, test } from '@playwright/test';

import {
  getReleaseNotesUrl,
  handleUpdateResponse,
  UPDATE_BUTTON,
} from '../src/providers/update-dialog';

test('builds a canonical tag URL for valid versions', () => {
  expect(getReleaseNotesUrl('1.4.3')).toBe(
    'https://github.com/robotlog/YourTune/releases/tag/v1.4.3',
  );
  expect(getReleaseNotesUrl('2.0.0-beta.1')).toBe(
    'https://github.com/robotlog/YourTune/releases/tag/v2.0.0-beta.1',
  );
});

test('rejects malicious or malformed versions', () => {
  for (const bad of [
    undefined,
    null,
    42,
    '',
    'v1.4.3',
    '1.4',
    '01.4.3',
    '1.4.3/../../evil',
    '1.4.3?x=1',
    '1.4.3#frag',
    '1.4.3%2f..',
    '1.4.3 ',
    '1.4.3\n',
    '1.4.3+build',
    'https://evil.example/x',
    '../1.4.3',
    '1.4.3-',
  ]) {
    expect(getReleaseNotesUrl(bad)).toBeNull();
  }
});

const run = (response: number, version: unknown) => {
  const opened: string[] = [];
  let disabled = 0;
  handleUpdateResponse(response, version, {
    downloadLink: 'https://github.com/robotlog/YourTune/releases/latest',
    openExternal: (url) => opened.push(url),
    disableUpdates: () => disabled++,
  });
  return { opened, disabled };
};

test('routes existing actions unchanged', () => {
  expect(run(UPDATE_BUTTON.ok, '1.4.3')).toEqual({ opened: [], disabled: 0 });
  expect(run(UPDATE_BUTTON.download, '1.4.3')).toEqual({
    opened: ['https://github.com/robotlog/YourTune/releases/latest'],
    disabled: 0,
  });
  expect(run(UPDATE_BUTTON.disable, '1.4.3')).toEqual({
    opened: [],
    disabled: 1,
  });
});

test('release notes opens only the validated tag page', () => {
  expect(run(UPDATE_BUTTON.releaseNotes, '1.4.3').opened).toEqual([
    'https://github.com/robotlog/YourTune/releases/tag/v1.4.3',
  ]);
  expect(run(UPDATE_BUTTON.releaseNotes, '1.4.3/../x')).toEqual({
    opened: [],
    disabled: 0,
  });
  expect(run(99, '1.4.3')).toEqual({ opened: [], disabled: 0 });
});
