import assert from 'node:assert/strict';
import {test} from 'node:test';

import {entryHas, parseQueue} from '../queue.js';

const plain = (videoId, selected = false) => ({playlistPanelVideoRenderer: {videoId, ...(selected ? {selected} : {})}});
const wrapped = (videoId, counterpartId, selected = false) => ({
  playlistPanelVideoWrapperRenderer: {
    primaryRenderer: plain(videoId, selected),
    counterpart: [{counterpartRenderer: plain(counterpartId)}],
  },
});

test('finds the playing entry, including a wrapped one', () => {
  assert.equal(parseQueue({items: [plain('a'), wrapped('b', 'b2', true), plain('c')]}).current, 1);
  assert.equal(parseQueue({items: [plain('a', true)]}).current, 0);
});

test('reports no playing entry for an empty or missing queue', () => {
  assert.deepEqual(parseQueue(null), {entries: [], tracks: [], current: -1});
  assert.equal(parseQueue({items: [plain('a')]}).current, -1);
});

test('matches either version of a song with a music video', () => {
  const queue = parseQueue({items: [plain('a', true), wrapped('video', 'song')]});
  assert.ok(entryHas(queue, 1, 'video'));
  assert.ok(entryHas(queue, 1, 'song'));
  assert.ok(!entryHas(queue, 1, 'a'));
  assert.ok(!entryHas(queue, 2, 'a'));
});

test('reads the details of each entry', () => {
  const item = {
    playlistPanelVideoRenderer: {
      videoId: 'a',
      title: {runs: [{text: "Cashin' Out"}]},
      shortBylineText: {runs: [{text: 'Ca$h Out'}]},
      lengthText: {runs: [{text: '1:03:57'}]},
      thumbnail: {thumbnails: [{url: 'small', width: 60}, {url: 'large', width: 544}, {url: 'mid', width: 226}]},
    },
  };
  assert.deepEqual(parseQueue({items: [item]}).tracks[0], {
    videoId: 'a',
    title: "Cashin' Out",
    artist: 'Ca$h Out',
    songDuration: 3837,
    imageSrc: 'large',
  });
  assert.equal(parseQueue({items: [plain('b')]}).tracks[0].songDuration, 0);
});
