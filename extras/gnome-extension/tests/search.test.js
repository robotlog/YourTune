// Run with: node --test 'extras/gnome-extension/tests/*.test.js'
// The fixtures are trimmed responses from POST /api/v1/search for "IU Blueming".
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

import {normalized, parseSearchPage, rankResults} from '../search.js';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url)));

test('parses the songs filter page', () => {
  const {items, continuation} = parseSearchPage(fixture('search-songs.json'), 'song');
  assert.equal(items.length, 4);
  assert.deepEqual(items[0], {
    videoId: 'I0_ZXHzKysc',
    title: 'Blueming',
    artist: 'IU',
    duration: '3:38',
    artworkUrl: items[0].artworkUrl,
    kind: 'song',
  });
  assert.match(items[0].artworkUrl, /^https:\/\//);
  assert.ok(continuation);
});

test('parses the videos filter page', () => {
  const {items, continuation} = parseSearchPage(fixture('search-videos.json'), 'video');
  assert.equal(items.length, 4);
  assert.equal(items[0].videoId, 'D1PvIWdJ8xo');
  assert.equal(items[0].kind, 'video');
  assert.equal(items[0].duration, '3:42');
  assert.ok(continuation);
});

test('keeps only the requested kind', () => {
  assert.equal(parseSearchPage(fixture('search-songs.json'), 'video').items.length, 0);
  assert.equal(parseSearchPage(fixture('search-videos.json'), 'song').items.length, 0);
});

test('parses a continuation page', () => {
  const {items, continuation} = parseSearchPage(fixture('search-songs-continuation.json'), 'song');
  assert.equal(items.length, 3);
  assert.equal(items[0].title, 'Wait (기다려)');
  assert.equal(items[0].artist, 'IU');
  assert.ok(continuation);
});

test('normalizes width, case and punctuation', () => {
  assert.equal(normalized('ＢＬＵＥＭＩＮＧ!  (Live)'), 'blueming live');
});

test('ranks exact titles, then all words, then any word, keeping YouTube Music order within each', () => {
  const item = (title, artist) => ({title, artist});
  const ranked = rankResults([
    item('Other', 'Someone'),
    item('Blueming (Live)', 'IU'),
    item('Blueming cover', 'Fan'),
    item('Blueming', 'IU'),
    item('Celebrity', 'IU'),
  ], 'IU Blueming');
  assert.deepEqual(ranked.map(entry => entry.title), ['Blueming (Live)', 'Blueming', 'Blueming cover', 'Celebrity', 'Other']);
  assert.deepEqual(rankResults([item('Blueming (Live)', 'IU'), item('Blueming', 'IU')], 'blueming').map(entry => entry.title),
    ['Blueming', 'Blueming (Live)']);
});
