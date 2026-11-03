# YourTune Plasma widget

A KDE Plasma 6 panel widget with play/pause, previous, next, like, dislike, shuffle and repeat.
Plasma's own Media Player widget already covers playback through MPRIS; this one adds the
YouTube Music controls MPRIS doesn't have.

## Install

1. In YourTune, turn on **Plugins > API Server**. Setting its hostname to `127.0.0.1` keeps the
   API off your local network; the widget only talks to `127.0.0.1`.
2. Install the widget:

   ```sh
   kpackagetool6 -t Plasma/Applet -i extras/plasma-widget
   ```

   Use `-u` instead of `-i` to update it later, and `-r io.github.robotlog.yourtune` to remove it.
3. Add **YourTune** to a panel. The first time it connects, YourTune asks whether to allow it.

The widget uses port 26538, the API Server's default. If you changed the port, add
`port=<your port>` to this widget's `[Configuration][General]` group in
`~/.config/plasma-org.kde.plasma.desktop-appletsrc` and restart Plasma.
