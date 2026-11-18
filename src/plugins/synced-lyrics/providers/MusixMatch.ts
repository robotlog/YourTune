import * as z from 'zod';

import {
  cooldownUntil,
  isUnavailableToken,
  MusixMatchTokenRejected,
  retryRejectedToken,
  shouldRefreshToken,
} from './musixmatch-token';

import { LRC } from '../parsers/lrc';
import { netFetch } from '../renderer';

import type { LyricProvider, LyricResult, SearchSongInfo } from '../types';

class AnonymousAccessUnavailable extends Error {}
class MusixMatchRequestError extends Error {}

export class MusixMatch implements LyricProvider {
  name = 'MusixMatch';
  baseUrl = 'https://www.musixmatch.com/';

  private api: Promise<MusixMatchAPI | null> | undefined;
  private retryAt = 0;

  private fail(error: unknown) {
    if (Date.now() < this.retryAt) return;
    const unavailable = error instanceof AnonymousAccessUnavailable;
    this.retryAt = cooldownUntil(Date.now(), unavailable);
    this.api = undefined;
    console.warn('MusixMatch request failed; retrying after cooldown');
  }

  async search(info: SearchSongInfo): Promise<LyricResult | null> {
    if (Date.now() < this.retryAt) return null;

    // Late-init after IPC is available and share the result across songs.
    this.api ??= MusixMatchAPI.new().catch((error: unknown) => {
      this.fail(error);
      return null;
    });
    const api = await this.api;
    if (!api) return null;
    const data = await (async () => {
      await api.reinit();
      return retryRejectedToken(
        () =>
          api.query(Endpoint.getMacroSubtitles, {
            q_track: info.alternativeTitle || info.title,
            q_artist: info.artist,
            q_duration: info.songDuration.toString(),
            ...(info.album ? { q_album: info.album } : {}),
            namespace: 'lyrics_richsynched',
            subtitle_format: 'lrc',
          }),
        (token) => api.refresh(token),
      );
    })().catch((error: unknown) => {
      if (
        !(error instanceof MusixMatchRequestError) &&
        !(error instanceof MusixMatchTokenRejected) &&
        !(error instanceof AnonymousAccessUnavailable)
      )
        throw error;
      this.fail(error);
      return null;
    });

    if (!data) return null;
    const { macro_calls: macroCalls } = data.body;

    // prettier-ignore
    const getter = <T extends keyof typeof macroCalls>(key: T): typeof macroCalls[T]['message']['body'] => macroCalls[key].message.body;

    const track = getter('matcher.track.get')?.track;
    const lyrics = getter('track.lyrics.get')?.lyrics?.lyrics_body;
    const subtitle = getter('track.subtitles.get')?.subtitle_list?.[0];

    // either no track found, or musixmatch's algorithm returned "Coldplay - Paradise" for no reason whatsoever
    if (!track || track.track_id === 115264642) return null;

    return {
      title: track.track_name,
      artists: [track.artist_name],
      lines: subtitle
        ? LRC.parse(subtitle.subtitle.subtitle_body).lines.map((l) => ({
            ...l,
            status: 'upcoming' as const,
          }))
        : undefined,
      lyrics: lyrics,
    };
  }
}

// API Implementation, based on https://github.com/Strvm/musicxmatch-api/blob/main/src/musicxmatch_api/main.py

const zBoolean = z.union([z.literal(0), z.literal(1)]);
const Track = z.object({
  track_id: z.number(),
  track_name: z.string(),
  artist_name: z.string(),
});

const Lyrics = z.object({
  instrumental: zBoolean,
  lyrics_body: z.string(),
  lyrics_language: z.string(),
  lyrics_language_description: z.string(),
});

const Subtitle = z.object({
  subtitle_body: z.string(),
  subtitle_length: z.number(),
  subtitle_language: z.string(),
});

enum Endpoint {
  getMacroSubtitles = 'macro.subtitles.get',
  searchTrack = 'track.search',
}

type Query = {
  q?: string;
  q_track?: string;
  q_artist?: string;
  q_album?: string;
  q_duration?: string;
};

type Params = {
  [Endpoint.getMacroSubtitles]: Query & {
    namespace: 'lyrics_richsynched';
    subtitle_format: 'lrc';
  };
  [Endpoint.searchTrack]: {
    q: string;
    f_has_lyrics: 'true' | 'false';
    page_size: string;
    page: string;
  };
};

const ResponseSchema = {
  [Endpoint.searchTrack]: z.object({
    track_list: z.array(z.object({ track: Track })),
  }),
  [Endpoint.getMacroSubtitles]: z.object({
    macro_calls: z.object({
      'track.lyrics.get': z.object({
        message: z.object({
          body: z
            .object({ lyrics: Lyrics })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )
            .optional(),
        }),
      }),
      'track.subtitles.get': z.object({
        message: z.object({
          body: z
            .object({
              subtitle_list: z.array(z.object({ subtitle: Subtitle })),
            })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )

            .optional(),
        }),
      }),
      'matcher.track.get': z.object({
        message: z.object({
          body: z
            .object({ track: Track })
            .or(
              z
                .instanceof(Array)
                .describe('default response for 404 status')
                .transform(() => undefined)
                .or(z.string().transform(() => undefined)),
            )
            .optional(),
        }),
      }),
    }),
  }),
} as const;

class MusixMatchAPI {
  private initPromise: Promise<void>;
  private cookie = 'x-mxm-user-id=';
  private token: string | null = null;
  private expires = 0;
  private refreshPromise: Promise<void> | undefined;

  private constructor() {
    this.initPromise = this.init();
  }

  public static async new() {
    const api = new MusixMatchAPI();
    await api.initPromise;
    return api;
  }

  public async reinit() {
    const [{ status }] = await Promise.allSettled([this.initPromise]);
    if (status === 'rejected' || this.expires <= Date.now()) {
      this.refreshPromise ??= this.init().finally(() => {
        this.refreshPromise = undefined;
      });
      this.initPromise = this.refreshPromise;
      await this.refreshPromise;
    }
  }

  public async refresh(rejectedToken: string) {
    if (this.refreshPromise) {
      await this.refreshPromise;
      return;
    }
    if (!shouldRefreshToken(rejectedToken, this.token)) return;
    this.cookie = 'x-mxm-user-id=';
    localStorage.removeItem(this.key);
    this.refreshPromise = this.init().finally(() => {
      this.refreshPromise = undefined;
    });
    this.initPromise = this.refreshPromise;
    await this.refreshPromise;
  }

  // god I love typescript generics, they're so useful
  public async query<
    T extends Endpoint,
    R = {
      header: { status_code: number };
      body: T extends keyof typeof ResponseSchema
        ? z.infer<(typeof ResponseSchema)[T]>
        : unknown;
    },
  >(endpoint: T, params: Params[T]): Promise<R> {
    await this.initPromise;
    if (!this.token) throw new Error('Token not initialized');
    const token = this.token;

    const url = `${this.baseUrl}${endpoint}`;

    const clonedParams = new URLSearchParams(
      Object.assign(
        {
          app_id: this.app_id,
          format: 'json',
          usertoken: token,
        },
        <Record<string, string>>params,
      ),
    );

    const [status, json, headers] = await netFetch(`${url}?${clonedParams}`, {
      headers: { Cookie: this.cookie },
    }).catch((cause: unknown) => {
      throw new MusixMatchRequestError('MusixMatch request failed', { cause });
    });
    if (status === 401) throw new MusixMatchTokenRejected(token);
    if (status < 200 || status >= 300) {
      throw new MusixMatchRequestError(`MusixMatch HTTP ${status}`);
    }

    const setCookie = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'set-cookie',
    );
    if (setCookie) {
      this.cookie = setCookie[1];
    }

    const response = JSON.parse(json);
    // prettier-ignore
    if (
      response && typeof response === 'object' &&
      'message' in response && response.message && typeof response.message === 'object' &&
      'header' in response.message && response.message.header && typeof response.message.header === 'object' &&
      (('status_code' in response.message.header && response.message.header.status_code === 401) ||
       ('hint' in response.message.header && typeof response.message.header.hint === 'string' &&
        /renew/i.test(response.message.header.hint)))
    ) {
      throw new MusixMatchTokenRejected(token);
    }

    const parsed = z
      .object({
        message: z.object({ body: ResponseSchema[endpoint] }),
      })
      .safeParse(response);

    if (!parsed.success) {
      console.error('Malformed response', response, parsed.error);
      throw new Error('Failed to parse response from MusixMatch API');
    }

    return parsed.data.message as R;
  }

  private savedTokenSchema = z.union([
    z.object({
      token: z.literal(null),
      expires: z.number().optional(),
    }),
    z.object({
      token: z.string(),
      expires: z.number(),
    }),
  ]);

  private key = 'ytm:synced-lyrics:mxm:token';
  private async init() {
    const { token, expires } = this.savedTokenSchema.parse(
      JSON.parse(localStorage.getItem(this.key) ?? '{ "token": null }'),
    );
    if (token && !isUnavailableToken(token) && expires > Date.now()) {
      this.token = token;
      this.expires = expires;
      return;
    }

    localStorage.removeItem(this.key);

    this.token = await this.getToken().catch((error: unknown) => {
      if (error instanceof AnonymousAccessUnavailable) throw error;
      throw new MusixMatchRequestError('MusixMatch token request failed', {
        cause: error,
      });
    });
    if (!this.token) throw new MusixMatchRequestError('Failed to get token');

    this.expires = Date.now() + 60_000;
    localStorage.setItem(
      this.key,
      JSON.stringify({ token: this.token, expires: this.expires }),
    );
  }

  private tokenSchema = z.object({
    message: z.object({
      body: z
        .object({
          user_token: z.string(),
        })
        .optional(),
    }),
  });
  private async getToken() {
    const endpoint = 'token.get';
    const params = new URLSearchParams({ app_id: this.app_id });
    const [status, json, headers] = await netFetch(
      `${this.baseUrl}${endpoint}?${params}`,
      {
        headers: Object.assign({ Cookie: this.cookie }, this.headers),
      },
    );
    if (status < 200 || status >= 300) {
      throw new Error(`MusixMatch token request failed: HTTP ${status}`);
    }

    const setCookie = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === 'set-cookie',
    );
    if (setCookie) {
      this.cookie = setCookie[1];
    }

    const {
      message: { body },
    } = this.tokenSchema.parse(JSON.parse(json));
    const token = body?.user_token ?? '';
    // the anonymous desktop token is all zeroes now, and every lookup with it returns the same decoy lyrics
    if (isUnavailableToken(token)) throw new AnonymousAccessUnavailable();
    return token;
  }

  private readonly baseUrl = 'https://apic-desktop.musixmatch.com/ws/1.1/';
  private readonly app_id = 'web-desktop-app-v1.0';
  private readonly headers = {
    Authority: 'apic-desktop.musixmatch.com',
  };
}
