### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

The history from before YourTune is in [pear-desktop's changelog](https://github.com/pear-devs/pear-desktop/blob/master/changelog.md).

#### Unreleased

Pull requests from pear-desktop, thanks to their authors.

Fixes:
- happy-dom 21, for a code injection fix in its ESM compiler ([pear-desktop#4794](https://github.com/pear-devs/pear-desktop/pull/4794) by renovate)

In YourTune:

- Discord Rich Presence is back. It runs under pear-desktop's Discord application, so Discord shows "YouTube Music".
- MPRIS and the other now-playing outputs say Paused for a track that loaded but never started, or was paused in its first half second.

#### v1.2.0

> 28 October 2026

Pull requests from pear-desktop, thanks to their authors.

New plugins:

- Skip AI Music, skips songs by AI artists from a community list and from your own artists, songs and keywords ([pear-desktop#4646](https://github.com/pear-devs/pear-desktop/pull/4646) by stranzero)

Fixes:

- Synced lyrics apply the LRC `[offset:]` tag to every line and word, so line lengths stay right ([pear-desktop#4789](https://github.com/pear-devs/pear-desktop/pull/4789) by PhotoDotPi)

In YourTune:

- Turkish translations for Skip AI Music.

#### v1.1.0

> 27 October 2026

Pull requests from pear-desktop, thanks to their authors.

New plugins:

- Mini Player, a small always-on-top window with playback controls and synced lyrics ([pear-desktop#4711](https://github.com/pear-devs/pear-desktop/pull/4711) by pumpkinfadly)
- Blocklist, skips the songs of artists you block ([pear-desktop#4567](https://github.com/pear-devs/pear-desktop/pull/4567) by h0tp-ftw)
- Seek Shortcuts, seeks 5 seconds with the arrow keys ([pear-desktop#4663](https://github.com/pear-devs/pear-desktop/pull/4663) by bonkedbythonk)
- Always Show Volume Slider ([pear-desktop#4716](https://github.com/pear-devs/pear-desktop/pull/4716) by aashish254)
- Dismiss Multidevice Popup, closes the "Listen on this device" popup ([pear-desktop#4718](https://github.com/pear-devs/pear-desktop/pull/4718) by aashish254)
- Toast Auto-Close, closes YouTube Music's toasts after three seconds ([pear-desktop#4642](https://github.com/pear-devs/pear-desktop/pull/4642) by kvn1351)
- Fullscreen Auto-hide, hides the controls and the cursor while idle in fullscreen ([pear-desktop#4664](https://github.com/pear-devs/pear-desktop/pull/4664) by bonkedbythonk)
- Resume Shuffle, brings the queue back shuffled when the last song is resumed ([pear-desktop#4616](https://github.com/pear-devs/pear-desktop/pull/4616) by danielchalmers)

Changes:

- Synced lyrics can be saved as an .lrc file ([pear-desktop#4655](https://github.com/pear-devs/pear-desktop/pull/4655) by fsalamic)
- Playback speed changes no longer crackle, and pitch can follow the speed ([pear-desktop#4759](https://github.com/pear-devs/pear-desktop/pull/4759) by gothmiku)
- Crossfade gets a playable stream again and no longer needs howler ([pear-desktop#4774](https://github.com/pear-devs/pear-desktop/pull/4774) by junxiangzhan)
- Only the active language is loaded at startup ([pear-desktop#4674](https://github.com/pear-devs/pear-desktop/pull/4674) by nixoletas)
- The window shows without waiting for the page to paint ([pear-desktop#4673](https://github.com/pear-devs/pear-desktop/pull/4673) by nixoletas)
- cpu-tamer's frame clock runs on requestAnimationFrame ([pear-desktop#4772](https://github.com/pear-devs/pear-desktop/pull/4772) by junxiangzhan)
- Ambient mode skips a redundant canvas read and write ([pear-desktop#4665](https://github.com/pear-devs/pear-desktop/pull/4665) by bonkedbythonk)
- Shortcuts are on by default, so Linux gets MPRIS out of the box ([pear-desktop#4571](https://github.com/pear-devs/pear-desktop/pull/4571) by Chaganti-Reddy)
- The Windows taskbar thumbnail buttons are on by default ([pear-desktop#4675](https://github.com/pear-devs/pear-desktop/pull/4675) by nixoletas)
- Like and dislike shortcuts ([pear-desktop#4578](https://github.com/pear-devs/pear-desktop/pull/4578) by Chaganti-Reddy)
- Synced lyrics can show romanized lines bigger than the original ([pear-desktop#4580](https://github.com/pear-devs/pear-desktop/pull/4580) by AARP41298)
- Scrobbler has a Log in to Last.fm entry, and the Last.fm token never goes over plain http ([pear-desktop#4717](https://github.com/pear-devs/pear-desktop/pull/4717) by aashish254)

Fixes:

- Podcast and RSS episodes are no longer silent ([pear-desktop#4592](https://github.com/pear-devs/pear-desktop/pull/4592) by JonUleis)
- "Override media keys" works on Windows and macOS ([pear-desktop#4572](https://github.com/pear-devs/pear-desktop/pull/4572) by h0tp-ftw)
- SponsorBlock also skips segments of the first song ([pear-desktop#4637](https://github.com/pear-devs/pear-desktop/pull/4637) by zoro-of-coding)
- Repeat mode stays on when the track changes ([pear-desktop#4357](https://github.com/pear-devs/pear-desktop/pull/4357) by bharatvansh)
- Precise Volume works with the new player UI ([pear-desktop#4746](https://github.com/pear-devs/pear-desktop/pull/4746) by WoWfff)
- Volume set through the API reads back the same ([pear-desktop#4672](https://github.com/pear-devs/pear-desktop/pull/4672) by nixoletas)
- MPRIS reports the position to the sub-second ([pear-desktop#4768](https://github.com/pear-devs/pear-desktop/pull/4768) by bbedward)
- Skip Disliked Songs no longer skips two songs ([pear-desktop#4618](https://github.com/pear-devs/pear-desktop/pull/4618) by jirafey)
- Album Color Theme also colors the home page ([pear-desktop#4579](https://github.com/pear-devs/pear-desktop/pull/4579) by Chaganti-Reddy)
- The about panel shows the real app info ([pear-desktop#4573](https://github.com/pear-devs/pear-desktop/pull/4573) by Chaganti-Reddy)
- Song info uses the title shown in the queue ([pear-desktop#4780](https://github.com/pear-devs/pear-desktop/pull/4780) by junxiangzhan)
- In-app menu keeps submenus on screen in narrow windows ([pear-desktop#4779](https://github.com/pear-devs/pear-desktop/pull/4779) by junxiangzhan)
- In-app menu keeps the sidebar below the title bar ([pear-desktop#4778](https://github.com/pear-devs/pear-desktop/pull/4778) by junxiangzhan)
- Custom Output Device lists current devices ([pear-desktop#4566](https://github.com/pear-devs/pear-desktop/pull/4566) by Benjas333)
- Korean romanization works again ([pear-desktop#4528](https://github.com/pear-devs/pear-desktop/pull/4528) by AARP41298)
- Amuse sends the full query so songs are recognized ([pear-desktop#4721](https://github.com/pear-devs/pear-desktop/pull/4721) by aashish254)
- Do Not Track lets non-objects through ([pear-desktop#4781](https://github.com/pear-devs/pear-desktop/pull/4781) by junxiangzhan)
- A failed download no longer focuses the window ([pear-desktop#4752](https://github.com/pear-devs/pear-desktop/pull/4752) by Pranjalstart679)
- One plugin's error no longer stops the others from starting ([pear-desktop#4661](https://github.com/pear-devs/pear-desktop/pull/4661) by bonkedbythonk)
- Navigation clears its buttons when disabled ([pear-desktop#4650](https://github.com/pear-devs/pear-desktop/pull/4650) by Angry3vilbot)
- The Windows portable build keeps its data next to the executable ([pear-desktop#4559](https://github.com/pear-devs/pear-desktop/pull/4559) by mouaad-here)

In YourTune:

- The player no longer stays on an old song while the queue moves on, when YouTube Music sends a song without the timing of its video version.
- Turkish translations for the new plugins.
- Security updates for dependencies.
- Windows gets a full installer (`YourTune-Setup-1.1.0.exe`) instead of the web installer, and releases come with `SHA256SUMS.txt`.

#### v1.0.0

> 26 October 2026

First release of YourTune, continuing pear-desktop 3.12.0.

- Renamed to YourTune, with its own app id, data folder and `yourtune://` url scheme. Settings from pear-desktop are copied over on the first start.
- New app icon and tray icons.
- New plugin: Player Waves, colored waves above the player bar that follow the cover's colors and the music.
- New plugin: Floating Player Bar, lifts the player bar off the window edges.
- Synced lyrics: the zero MusixMatch token is no longer used, LRCLib requests are retried on 503.
- Playback controls work with the new player UI, and like-state requests in the API server time out (from pear-desktop #4750 by Adriel Lopez).
- The Discord plugin is removed for now.
