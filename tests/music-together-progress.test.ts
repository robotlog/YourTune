import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { isSeekProgress } from '../src/plugins/music-together/progress';

test('syncs seeking without treating a volume drag as a seek (#23)', () => {
  const { document } = new Window();
  document.body.innerHTML = `
    <tp-yt-paper-progress id="standalone"></tp-yt-paper-progress>
    <tp-yt-paper-slider id="progress-bar"><tp-yt-paper-progress id="seek"></tp-yt-paper-progress></tp-yt-paper-slider>
    <tp-yt-paper-slider id="volume-slider"><tp-yt-paper-progress id="volume"></tp-yt-paper-progress></tp-yt-paper-slider>`;

  const progress = [
    ...(document as unknown as Document).querySelectorAll(
      'tp-yt-paper-progress',
    ),
  ];
  expect(progress.filter(isSeekProgress).map((el) => el.id)).toEqual([
    'standalone',
    'seek',
  ]);
});
