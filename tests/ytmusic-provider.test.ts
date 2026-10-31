import { expect, test } from '@playwright/test';

import { YTMusic } from '../src/plugins/synced-lyrics/providers/YTMusic';

test('localized no-lyrics messages are not lyrics; real lyrics remain (#53)', async () => {
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  let contents: unknown;

  const next = {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  endpoint: {
                    browseEndpoint: {
                      browseId: 'lyrics',
                      browseEndpointContextSupportedConfigs: {
                        browseEndpointContextMusicConfig: {
                          pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS',
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };

  globalThis.document = {
    querySelector: () => ({ networkManager: { fetch: async () => next } }),
  } as unknown as Document;
  globalThis.fetch = async () =>
    ({ json: async () => ({ contents }) }) as Response;

  try {
    const provider = new YTMusic();
    const search = () =>
      provider.search({
        videoId: 'id',
        title: 'title',
        artist: 'artist',
        songDuration: 180,
      });

    contents = {
      messageRenderer: { text: { runs: [{ text: 'No lyrics provided.' }] } },
    };
    expect(await search()).toBeNull();

    contents = {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: { musicMessageModel: { text: 'Không có lời bài hát' } },
            },
          },
        },
      },
    };
    expect(await search()).toBeNull();

    contents = {
      sectionListRenderer: {
        contents: [
          {
            musicDescriptionShelfRenderer: {
              description: { runs: [{ text: 'real words' }] },
            },
          },
        ],
      },
    };
    expect((await search())?.lyrics).toBe('real words');

    contents = {
      elementRenderer: {
        newElement: {
          type: {
            componentType: {
              model: {
                timedLyricsModel: {
                  lyricsData: {
                    timedLyricsData: [
                      {
                        lyricLine: 'timed words',
                        cueRange: {
                          startTimeMilliseconds: '100',
                          endTimeMilliseconds: '800',
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    };
    expect((await search())?.lines?.map((line) => line.text)).toContain(
      'timed words',
    );
  } finally {
    if (previousDocument === undefined)
      delete (globalThis as { document?: Document }).document;
    else globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
  }
});
