const RELEASE_TAG_URL = 'https://github.com/robotlog/YourTune/releases/tag/';

// Strict semver (no build metadata, no leading zeros): keeps `/`, `?`, `#`, `%`
// and whitespace out of the tag path.
const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** Fixed-host release page for a validated version, or null when invalid. */
export const getReleaseNotesUrl = (version: unknown): string | null =>
  typeof version === 'string' && VERSION_PATTERN.test(version)
    ? `${RELEASE_TAG_URL}v${version}`
    : null;

export const UPDATE_BUTTON = {
  ok: 0,
  download: 1,
  disable: 2,
  releaseNotes: 3,
} as const;

export const handleUpdateResponse = (
  response: number,
  version: unknown,
  actions: {
    openExternal: (url: string) => unknown;
    disableUpdates: () => unknown;
    downloadLink: string;
  },
) => {
  switch (response) {
    case UPDATE_BUTTON.download:
      actions.openExternal(actions.downloadLink);
      break;
    case UPDATE_BUTTON.disable:
      actions.disableUpdates();
      break;
    case UPDATE_BUTTON.releaseNotes: {
      const url = getReleaseNotesUrl(version);
      if (url) actions.openExternal(url);
      break;
    }
  }
};
