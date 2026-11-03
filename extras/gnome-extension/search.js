// Parses YouTube Music search responses from POST /api/v1/search. Plain JavaScript with no
// GNOME imports, so the tests can run it under Node.

// Captured from YouTube Music's Songs and Videos filter chips.
export const SEARCH_PARAMS = {
  songs: 'EgWKAQIIAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D',
  videos: 'EgWKAQIQAWoQEAUQCRADEAQQChAVEBAQDg%3D%3D',
};

const SONG_VIDEO_TYPES = new Set(['MUSIC_VIDEO_TYPE_ATV', 'MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK']);
const VIDEO_VIDEO_TYPES = new Set(['MUSIC_VIDEO_TYPE_OMV', 'MUSIC_VIDEO_TYPE_UGC']);
const DURATION = /^\d+:\d{2}(?::\d{2})?$/;
const MAX_DEPTH = 24;

function runsText(runs) {
  return (runs ?? []).map(run => run.text ?? '').join('');
}

function flexRuns(renderer, column) {
  return renderer.flexColumns?.[column]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? [];
}

function pickArtworkUrl(thumbnails) {
  if (!thumbnails?.length)
    return null;
  const sorted = [...thumbnails].sort((left, right) => (left.width ?? 0) - (right.width ?? 0));
  return (sorted.find(thumbnail => (thumbnail.width ?? 0) >= 60) ?? sorted[sorted.length - 1]).url ?? null;
}

function watchEndpointFrom(renderer) {
  return renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint ??
    renderer.navigationEndpoint?.watchEndpoint ??
    flexRuns(renderer, 0).map(run => run.navigationEndpoint?.watchEndpoint).find(Boolean) ??
    null;
}

function videoTypeFrom(renderer, watchEndpoint) {
  return watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType ??
    renderer.playlistItemData?.musicVideoType ??
    renderer.musicVideoType ??
    null;
}

function runPageType(run) {
  return run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs
    ?.browseEndpointContextMusicConfig?.pageType;
}

// A mixed search subtitle leads with a type label ("Song", "Video", ...) and a separator run.
// Skip it structurally instead of by its localized text, and keep YouTube Music's own separators.
function subtitleFromRuns(runs) {
  const texts = runs.map(run => run.text ?? '');
  const hasTypeLabel = texts.length >= 2 && texts[1].trim() === '•' && !runs[0].navigationEndpoint;
  return texts
    .slice(hasTypeLabel ? 2 : 0)
    .filter(text => !DURATION.test(text))
    .join('')
    .replace(/^(\s*•\s*)+|(\s*•\s*)+$/g, '')
    .trim();
}

export function parseItem(renderer) {
  const watchEndpoint = watchEndpointFrom(renderer);
  const videoId = renderer.playlistItemData?.videoId ?? watchEndpoint?.videoId;
  const title = runsText(flexRuns(renderer, 0)).trim();
  if (!videoId || !title)
    return null;

  const subtitleRuns = flexRuns(renderer, 1);
  const artists = subtitleRuns.filter(run => runPageType(run) === 'MUSIC_PAGE_TYPE_ARTIST' && run.text).map(run => run.text);
  const album = subtitleRuns.find(run => runPageType(run) === 'MUSIC_PAGE_TYPE_ALBUM')?.text ?? null;
  const duration = subtitleRuns.map(run => run.text ?? '').find(text => DURATION.test(text)) ??
    renderer.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text ??
    null;
  const videoType = videoTypeFrom(renderer, watchEndpoint);

  return {
    videoId,
    title,
    artist: artists.join(', ') || subtitleFromRuns(subtitleRuns),
    album,
    duration,
    artworkUrl: pickArtworkUrl(renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
    kind: SONG_VIDEO_TYPES.has(videoType) ? 'song' : VIDEO_VIDEO_TYPES.has(videoType) ? 'video' : 'other',
  };
}

function findAll(node, key, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH)
    return out;
  if (!Array.isArray(node) && node[key])
    out.push(node[key]);
  for (const child of Array.isArray(node) ? node : Object.values(node))
    findAll(child, key, out, depth + 1);
  return out;
}

function findFirst(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH)
    return null;
  if (!Array.isArray(node) && node[key])
    return node[key];
  for (const child of Array.isArray(node) ? node : Object.values(node)) {
    const found = findFirst(child, key, depth + 1);
    if (found)
      return found;
  }
  return null;
}

function continuationFrom(payload) {
  const endpoint = findFirst(payload, 'continuationItemRenderer')?.continuationEndpoint;
  const token = endpoint?.continuationCommand?.token ??
    findFirst(payload, 'nextContinuationData')?.continuation ??
    null;
  return typeof token === 'string' && token ? token : null;
}

// Returns the page's songs or videos, with podcast episodes and anything else left out, and the
// token for the next page.
export function parseSearchPage(payload, kind) {
  const items = [];
  const seen = new Set();
  for (const renderer of findAll(payload, 'musicResponsiveListItemRenderer')) {
    const item = parseItem(renderer);
    if (item?.kind === kind && !seen.has(item.videoId)) {
      seen.add(item.videoId);
      items.push(item);
    }
  }
  return {items, continuation: continuationFrom(payload)};
}

export function normalized(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Exact title matches first, then items that contain every query word, then any word. Ties keep
// YouTube Music's order, which already reflects the query (an album name, say).
export function rankResults(items, query) {
  const q = normalized(query);
  const tokens = q.split(/\s+/).filter(Boolean);
  const rank = item => {
    const title = normalized(item.title);
    // The album counts too, so a query naming one doesn't rank covers that put it in their title
    // above the album's own tracks.
    const all = normalized(`${item.title} ${item.artist} ${item.album ?? ''}`);
    if (title === q)
      return 0;
    if (tokens.length && tokens.every(token => all.includes(token)))
      return 1;
    if (tokens.some(token => all.includes(token)))
      return 2;
    return 3;
  };
  return items
    .map((item, index) => ({item, index, rank: rank(item)}))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.item);
}
