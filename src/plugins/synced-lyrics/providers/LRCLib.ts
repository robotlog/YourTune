import { jaroWinkler } from '@skyra/jaro-winkler';

import { LRC } from '../parsers/lrc';
import { config } from '../renderer/renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

// Identifies the app as the LRCLIB API guidelines ask. The header is CORS-allowed by lrclib.net.
const CLIENT_ID = 'YourTune (https://github.com/robotlog/YourTune)';
// Transient: rate limit and server-side overload. Anything else (400, 404...) won't change on retry.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
// Covers the request and reading its body, per attempt
const ATTEMPT_TIMEOUT_MS = 10_000;
// Longest single wait, jitter included. A Retry-After above this means "come back later":
// give up instead of retrying early or blocking the lyrics panel.
const MAX_DELAY_MS = 10_000;
// Total sleeping for one lookup, shared by all of its requests (fallback queries included)
const MAX_TOTAL_WAIT_MS = 15_000;

// Retry-After is either delta-seconds or an HTTP date. Zero, negative and past values give 0.
const parseRetryAfter = (value: string | null | undefined) => {
  const raw = value?.trim();
  if (!raw) return undefined;
  const ms = Number.isFinite(Number(raw))
    ? Number(raw) * 1000
    : Date.parse(raw) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
};

const discard = (response: Response) =>
  response.body?.cancel().catch(() => {}) ?? Promise.resolve();

class InvalidResponse extends Error {}

type WaitBudget = { waited: number };

// Retries transient failures (429/5xx, network errors, timeouts) within the attempt, delay and budget limits.
// Gives up with the last status error, or the last network error if there never was a response.
const fetchResults = async (url: string, budget: WaitBudget) => {
  for (let attempt = 1; ; attempt++) {
    let failure: unknown;
    let status: number | undefined;
    let retryAfter: number | undefined;
    try {
      const response = await fetch(url, {
        headers: { 'Lrclib-Client': CLIENT_ID },
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (response.ok) {
        const text = await response.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new InvalidResponse('Invalid JSON response');
        }
        if (!Array.isArray(data)) {
          throw new InvalidResponse(
            `Expected an array, instead got ${typeof data}`,
          );
        }
        return data as LRCLIBSearchResponse;
      }

      await discard(response);
      status = response.status;
      retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      if (!RETRYABLE_STATUSES.has(status)) {
        throw new Error(`bad HTTPStatus(${status})`);
      }
    } catch (error) {
      if (error instanceof InvalidResponse) throw error;
      if (status !== undefined && !RETRYABLE_STATUSES.has(status)) throw error;
      failure = error;
    }

    // A valid hint is a lower bound; zero, negative or past hints fall back to the backoff
    const factor = 2 ** (attempt - 1);
    const backoff = Math.min(factor * 1000, 8000);
    const base = Math.max(backoff, retryAfter ?? 0);
    const jitter = Math.random() * 0.3;
    const delay = Math.min(Math.round(base * (1 + jitter)), MAX_DELAY_MS);
    if (
      attempt >= MAX_ATTEMPTS ||
      base > MAX_DELAY_MS ||
      budget.waited + delay > MAX_TOTAL_WAIT_MS
    ) {
      // statusText is empty over HTTP/2, so report the numeric status
      if (status !== undefined) throw new Error(`bad HTTPStatus(${status})`);
      throw failure;
    }

    budget.waited += delay;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

export class LRCLib implements LyricProvider {
  name = 'LRCLib';
  baseUrl = 'https://lrclib.net';

  async search({
    title,
    alternativeTitle,
    artist,
    album,
    songDuration,
    tags,
  }: SearchSongInfo): Promise<LyricResult | null> {
    let query = new URLSearchParams({
      artist_name: artist,
      track_name: title,
    });

    query.set('album_name', album!);
    if (query.get('album_name') === 'undefined') {
      query.delete('album_name');
    }

    let url = `${this.baseUrl}/api/search?${query.toString()}`;
    // one lookup shares one sleeping budget across its fallback queries
    const budget: WaitBudget = { waited: 0 };
    let data = await fetchResults(url, budget);

    if (data.length === 0) {
      if (!config()?.showLyricsEvenIfInexact) {
        return null;
      }

      // Try to search with the alternative title (original language)
      const trackName = alternativeTitle || title;
      query = new URLSearchParams({ q: `${trackName}` });
      url = `${this.baseUrl}/api/search?${query.toString()}`;
      data = await fetchResults(url, budget);

      // If still no results, try with the original title as fallback
      if (data.length === 0 && alternativeTitle) {
        query = new URLSearchParams({ q: title });
        url = `${this.baseUrl}/api/search?${query.toString()}`;
        data = await fetchResults(url, budget);
      }
    }

    const filteredResults = [];
    for (const item of data) {
      const { artistName } = item;

      const artists = artist.split(/[&,]/g).map((i) => i.trim());
      const itemArtists = artistName.split(/[&,]/g).map((i) => i.trim());

      // Try to match using artist name first
      const permutations = [];
      for (const artistA of artists) {
        for (const artistB of itemArtists) {
          permutations.push([artistA.toLowerCase(), artistB.toLowerCase()]);
        }
      }

      for (const artistA of itemArtists) {
        for (const artistB of artists) {
          permutations.push([artistA.toLowerCase(), artistB.toLowerCase()]);
        }
      }

      let ratio = Math.max(...permutations.map(([x, y]) => jaroWinkler(x, y)));

      // If direct artist match is below threshold and we have tags, try matching with tags
      if (ratio <= 0.9 && tags && tags.length > 0) {
        // Filter out the artist from tags to avoid duplicate comparisons
        const filteredTags = tags.filter(
          (tag) => tag.toLowerCase() !== artist.toLowerCase(),
        );

        const tagPermutations = [];
        // Compare each tag with each item artist
        for (const tag of filteredTags) {
          for (const itemArtist of itemArtists) {
            tagPermutations.push([tag.toLowerCase(), itemArtist.toLowerCase()]);
          }
        }

        // Compare each item artist with each tag
        for (const itemArtist of itemArtists) {
          for (const tag of filteredTags) {
            tagPermutations.push([itemArtist.toLowerCase(), tag.toLowerCase()]);
          }
        }

        if (tagPermutations.length > 0) {
          const tagRatio = Math.max(
            ...tagPermutations.map(([x, y]) => jaroWinkler(x, y)),
          );

          // Use the best match ratio between direct artist match and tag match
          ratio = Math.max(ratio, tagRatio);
        }
      }

      if (ratio <= 0.9) continue;
      filteredResults.push(item);
    }

    filteredResults.sort(({ duration: durationA }, { duration: durationB }) => {
      const left = Math.abs(durationA - songDuration);
      const right = Math.abs(durationB - songDuration);

      return left - right;
    });

    const closestResult = filteredResults[0];
    if (!closestResult) {
      return null;
    }

    if (Math.abs(closestResult.duration - songDuration) > 15) {
      return null;
    }

    if (closestResult.instrumental) {
      return null;
    }

    const raw = closestResult.syncedLyrics;
    const plain = closestResult.plainLyrics;
    if (!raw && !plain) {
      return null;
    }

    return {
      title: closestResult.trackName,
      artists: closestResult.artistName.split(/[&,]/g),
      lines: raw
        ? LRC.parse(raw).lines.map((l) => ({
            ...l,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics: plain ?? undefined,
    };
  }
}

type LRCLIBSearchResponse = {
  id: number;
  name: string;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}[];
