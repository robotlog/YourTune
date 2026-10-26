### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

The history from before YourTune is in [pear-desktop's changelog](https://github.com/pear-devs/pear-desktop/blob/master/changelog.md).

#### Unreleased

Pull requests from pear-desktop, thanks to their authors.

Changes:

- cpu-tamer's frame clock runs on requestAnimationFrame ([pear-desktop#4772](https://github.com/pear-devs/pear-desktop/pull/4772) by junxiangzhan)
- Ambient mode skips a redundant canvas read and write ([pear-desktop#4665](https://github.com/pear-devs/pear-desktop/pull/4665) by bonkedbythonk)

Fixes:

- Precise Volume works with the new player UI ([pear-desktop#4746](https://github.com/pear-devs/pear-desktop/pull/4746) by WoWfff)
- Skip Disliked Songs no longer skips two songs ([pear-desktop#4618](https://github.com/pear-devs/pear-desktop/pull/4618) by jirafey)
- Album Color Theme also colors the home page ([pear-desktop#4579](https://github.com/pear-devs/pear-desktop/pull/4579) by Chaganti-Reddy)
- In-app menu keeps submenus on screen in narrow windows ([pear-desktop#4779](https://github.com/pear-devs/pear-desktop/pull/4779) by junxiangzhan)
- In-app menu keeps the sidebar below the title bar ([pear-desktop#4778](https://github.com/pear-devs/pear-desktop/pull/4778) by junxiangzhan)
- Amuse sends the full query so songs are recognized ([pear-desktop#4721](https://github.com/pear-devs/pear-desktop/pull/4721) by aashish254)
- Do Not Track lets non-objects through ([pear-desktop#4781](https://github.com/pear-devs/pear-desktop/pull/4781) by junxiangzhan)
- A failed download no longer focuses the window ([pear-desktop#4752](https://github.com/pear-devs/pear-desktop/pull/4752) by Pranjalstart679)
- One plugin's error no longer stops the others from starting ([pear-desktop#4661](https://github.com/pear-devs/pear-desktop/pull/4661) by bonkedbythonk)
- Navigation clears its buttons when disabled ([pear-desktop#4650](https://github.com/pear-devs/pear-desktop/pull/4650) by Angry3vilbot)

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
