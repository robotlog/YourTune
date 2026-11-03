// Reads GET /api/v1/queue responses. Plain JavaScript with no GNOME imports, so the tests can run
// it under Node.

function videoRenderer(item) {
  return item?.playlistPanelVideoRenderer ??
    item?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ??
    null;
}

// A song with a music video is one queue entry with both versions; YouTube Music plays the one
// that matches its audio/video switch.
function entryVideoIds(item) {
  const ids = [videoRenderer(item)?.videoId];
  for (const counterpart of item?.playlistPanelVideoWrapperRenderer?.counterpart ?? [])
    ids.push(counterpart.counterpartRenderer?.playlistPanelVideoRenderer?.videoId);
  return ids.filter(Boolean);
}

function runsText(text) {
  return (text?.runs ?? []).map(run => run.text ?? '').join('');
}

function parseDuration(text) {
  const parts = text.split(':').map(Number);
  if (!text || parts.some(part => !Number.isFinite(part)))
    return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function largestThumbnail(renderer) {
  const thumbnails = renderer?.thumbnail?.thumbnails ?? [];
  return [...thumbnails].sort((left, right) => (right.width ?? 0) - (left.width ?? 0))[0]?.url ?? null;
}

// What the panel needs to show an entry before YourTune reports it as playing.
function entryTrack(item) {
  const renderer = videoRenderer(item);
  if (!renderer?.videoId)
    return null;
  return {
    videoId: renderer.videoId,
    title: runsText(renderer.title),
    artist: runsText(renderer.shortBylineText),
    songDuration: parseDuration(runsText(renderer.lengthText)),
    imageSrc: largestThumbnail(renderer),
  };
}

// Returns the video ids and track details of each entry, and the index of the playing one (-1 when
// none is).
export function parseQueue(payload) {
  const items = payload?.items ?? [];
  return {
    entries: items.map(entryVideoIds),
    tracks: items.map(entryTrack),
    current: items.findIndex(item => videoRenderer(item)?.selected),
  };
}

export function entryHas(queue, index, videoId) {
  return queue.entries[index]?.includes(videoId) ?? false;
}

// Where POST /queue with INSERT_AFTER_CURRENT_VIDEO puts an item: YourTune inserts at
// `selected + 1 || length`, so right after the playing entry, or at the end when none is playing.
// Returns that index if it holds videoId, -1 otherwise.
export function insertedIndex(queue, videoId) {
  const index = queue.current >= 0 ? queue.current + 1 : queue.entries.length - 1;
  return entryHas(queue, index, videoId) ? index : -1;
}
