import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {logErrorUnlessCancelled} from 'resource:///org/gnome/shell/misc/errorUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {isMissingEndpoint} from './client.js';
import {parseQueue} from './queue.js';
import {SearchView} from './searchView.js';

const ART_SIZE = 128;
const YOURTUNE_APP_ID = 'com.robotlog.yourtune';
const MARQUEE_SPEED_PX_PER_SECOND = 24;
const VERTICAL = Clutter.Orientation.VERTICAL;
const TICK_MS = 250;
const SEEK_SETTLE_MS = 2000;
const VOLUME_SEND_INTERVAL_MS = 100;
// GET /like-state can report the previous song for about a second after a track change. Read it
// early and often, but until LIKE_SETTLE_MS has passed only trust a value that differs from the
// previous song's, since a stale read always repeats it.
const LIKE_REFRESH_DELAYS_MS = [300, 700, 1200, 2000, 4000];
const LIKE_SETTLE_MS = 1000;
const LIKE_OVERRIDE_MS = 2000;

// Album art is written here so the card can use it as a CSS background.
function coverCacheDir() {
  return GLib.build_filenamev([GLib.get_user_cache_dir(), 'yourtune-miniplayer']);
}

// Removes covers a crash left behind; the panel deletes each one when the next replaces it.
function clearCoverCache() {
  try {
    const dir = Gio.File.new_for_path(coverCacheDir());
    const children = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = children.next_file(null)))
      dir.get_child(info.get_name()).delete(null);
    children.close(null);
  } catch {}
}

function formatTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, '0')}`;
}

const STATUS_VIEWS = {
  'connecting': {message: 'Connecting to YourTune…'},
  'offline': {
    message: 'YourTune is not reachable. Start YourTune and turn on the API Server plugin.',
    action: 'Retry',
  },
  'needs-auth': {message: 'Allow this panel to control YourTune.', action: 'Connect'},
  'authorizing': {message: 'Approve the request in YourTune.'},
  'denied': {message: 'The request was declined in YourTune.', action: 'Try again'},
};

const EMPTY_STATE = {
  song: null,
  isPlaying: false,
  position: 0,
  volume: 100,
  muted: false,
  repeat: 'NONE',
  shuffle: false,
  likeStatus: 'INDIFFERENT',
};

export const MiniPlayerIndicator = GObject.registerClass(
class MiniPlayerIndicator extends PanelMenu.Button {
  _init({path, client, settings}) {
    super._init(0.0, 'YourTune Mini Player');
    this._extensionPath = path;
    clearCoverCache();
    this._client = client;
    this._settings = settings;

    this._state = {...EMPTY_STATE};
    this._localProgress = 0;
    this._dragging = false;
    this._seekTarget = null;
    this._seekDeadline = 0;
    this._volumeDragging = false;
    this._lastVolumeSentAt = 0;
    this._likeOverride = null;
    this._likeOverrideTimer = 0;
    this._likeRefreshTimer = 0;
    this._previousLikeStatus = null;
    this._queue = null;
    this._queueSerial = 0;
    this._videoChangedAt = 0;
    this._artUrl = null;
    this._artPath = null;
    this._artLoadId = 0;
    this._menuIsOpen = false;
    this._destroyed = false;
    this._marquees = [];
    this._stSettings = St.Settings.get();
    this._animationsChangedId = this._stSettings.connect('notify::enable-animations', () => this._restartMarquees());

    this.add_style_class_name('yourtune-panel-button');
    this._panelIcon = new St.Icon({
      gicon: this._fileIcon('yourtune-panel.png'),
      style_class: 'yourtune-panel-icon',
      icon_size: 16,
    });
    this.add_child(this._panelIcon);

    this._buildMenu();

    this._client.connectObject(
      'status-changed', () => this._onStatusChanged(),
      'message', (_client, message) => this._onMessage(message),
      this);
    this._menuOpenId = this.menu.connect('open-state-changed', (_menu, open) => {
      this._menuIsOpen = open;
      if (open) {
        this._restartMarquees();
        this._refreshLikeStatus();
        this._refreshQueue();
      } else
        this._stopMarquees();
    });
    this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
      if (this._state.isPlaying && this._state.song && !this._dragging) {
        this._localProgress = Math.min(this._localProgress + TICK_MS / 1000, this._duration() || Number.POSITIVE_INFINITY);
        this._updateProgress();
      }
      return GLib.SOURCE_CONTINUE;
    });

    this._onStatusChanged();
  }

  _buildMenu() {
    this.menu.box.add_style_class_name('yourtune-menu');

    this._searchView = new SearchView({
      client: this._client,
      settings: this._settings,
      fileIcon: name => this._fileIcon(name),
      onQueueChanged: () => this._refreshQueue(),
    });
    this.menu.box.add_child(this._searchView);

    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this.menu.addMenuItem(item);
    const root = new St.BoxLayout({orientation: VERTICAL, style_class: 'yourtune-popup'});
    item.add_child(root);

    const playerStack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true});
    this._playerContent = new St.BoxLayout({orientation: VERTICAL, x_expand: true});
    playerStack.add_child(this._playerContent);
    root.add_child(playerStack);
    const playerRow = new St.BoxLayout({style_class: 'yourtune-player-row'});
    this._playerContent.add_child(playerRow);

    this._art = new St.Widget({
      style_class: 'yourtune-art',
      layout_manager: new Clutter.BinLayout(),
      width: ART_SIZE,
      height: ART_SIZE,
      x_expand: false,
      y_expand: false,
      y_align: Clutter.ActorAlign.START,
    });
    this._art.set_clip_to_allocation(true);
    this._artPlaceholder = new St.Icon({
      icon_name: 'audio-x-generic-symbolic',
      icon_size: Math.floor(ART_SIZE / 3),
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._art.add_child(this._artPlaceholder);

    // Hovering the artwork offers to bring up YourTune's window, as YouTube Music's own
    // miniplayer does.
    const artButton = new St.Button({
      style_class: 'yourtune-art-button',
      accessible_name: 'Show YourTune',
      can_focus: true,
      reactive: true,
      track_hover: true,
      y_align: Clutter.ActorAlign.START,
    });
    const artStack = new St.Widget({layout_manager: new Clutter.BinLayout()});
    const artOverlay = new St.Widget({
      style_class: 'yourtune-art-overlay',
      layout_manager: new Clutter.BinLayout(),
      width: ART_SIZE,
      height: ART_SIZE,
      opacity: 0,
    });
    artOverlay.add_child(new St.Icon({
      gicon: this._fileIcon('open-in-new-symbolic.svg'),
      icon_size: 24,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    }));
    artStack.add_child(this._art);
    artStack.add_child(artOverlay);
    artButton.set_child(artStack);
    const updateOverlay = () => {
      const visible = (artButton.hover || artButton.has_key_focus()) && Boolean(this._findYourTune());
      artOverlay.ease({opacity: visible ? 255 : 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    };
    artButton.connect('notify::hover', updateOverlay);
    artButton.connect('key-focus-in', updateOverlay);
    artButton.connect('key-focus-out', updateOverlay);
    artButton.connect('clicked', () => this._showYourTune());
    playerRow.add_child(artButton);

    const details = new St.BoxLayout({orientation: VERTICAL, x_expand: true, style_class: 'yourtune-details'});
    playerRow.add_child(details);

    this._titleMarquee = this._createMarquee('Nothing playing', 'yourtune-title');
    this._artistMarquee = this._createMarquee('Play something in YourTune', 'yourtune-artist');
    details.add_child(this._titleMarquee.clip);
    details.add_child(this._artistMarquee.clip);

    const seekBox = new St.BoxLayout({orientation: VERTICAL, style_class: 'yourtune-seek-box', x_expand: true});
    this._slider = new Slider.Slider(0);
    this._slider.x_expand = true;
    this._slider.style_class = 'slider yourtune-slider';
    this._slider.connect('drag-begin', () => {
      this._dragging = true;
    });
    this._slider.connect('drag-end', () => {
      this._dragging = false;
      const duration = this._duration();
      if (duration <= 0)
        return;
      const target = this._slider.value * duration;
      this._localProgress = target;
      this._seekTarget = target;
      this._seekDeadline = Date.now() + SEEK_SETTLE_MS;
      this._command('POST', '/seek-to', {seconds: Math.round(target)});
    });
    seekBox.add_child(this._slider);
    const times = new St.BoxLayout({style_class: 'yourtune-times'});
    this._currentTime = new St.Label({text: '0:00'});
    this._totalTime = new St.Label({text: '0:00', x_expand: true, x_align: Clutter.ActorAlign.END});
    times.add_child(this._currentTime);
    times.add_child(this._totalTime);
    seekBox.add_child(times);
    details.add_child(seekBox);

    const controls = new St.BoxLayout({style_class: 'yourtune-controls', x_align: Clutter.ActorAlign.CENTER});
    this._previousButton = this._iconButton('previous-symbolic.svg', 'Previous', () => this._command('POST', '/previous'));
    // POST /toggle-play only starts a track that is paused, not one that is loaded but never
    // started (a queue restored on launch), so send play or pause explicitly.
    this._playButton = this._iconButton('play-symbolic.svg', 'Play',
      () => this._command('POST', this._state.isPlaying ? '/pause' : '/play'), 'yourtune-play-button');
    this._nextButton = this._iconButton('next-symbolic.svg', 'Next', () => this._command('POST', '/next'));
    this._likeButton = this._iconButton('thumb-up-symbolic.svg', 'Like', () => this._rate('LIKE'));
    this._dislikeButton = this._iconButton('thumb-down-symbolic.svg', 'Dislike', () => this._rate('DISLIKE'));
    this._repeatButton = this._iconButton('repeat-symbolic.svg', 'Repeat', () => this._command('POST', '/switch-repeat', {iteration: 1}));
    this._shuffleButton = this._iconButton('shuffle-symbolic.svg', 'Shuffle', () => this._command('POST', '/shuffle'));
    this._mixButton = this._iconButton('mix-symbolic.svg', 'Start mix', () => this._startMix());
    for (const button of [this._previousButton, this._playButton, this._nextButton, this._likeButton,
      this._dislikeButton, this._mixButton, this._repeatButton, this._shuffleButton])
      controls.add_child(button);
    details.add_child(controls);

    this._volumeRow = new St.BoxLayout({style_class: 'yourtune-volume-row', x_expand: true});
    this._muteButton = this._iconButton('volume-high-symbolic.svg', 'Mute', () => this._command('POST', '/toggle-mute'), 'yourtune-volume-icon');
    this._volumeSlider = new Slider.Slider(0);
    this._volumeSlider.x_expand = true;
    this._volumeSlider.style_class = 'slider yourtune-volume-slider';
    this._volumeSlider.connect('drag-begin', () => {
      this._volumeDragging = true;
    });
    this._volumeSlider.connect('notify::value', () => {
      if (!this._volumeDragging || Date.now() - this._lastVolumeSentAt < VOLUME_SEND_INTERVAL_MS)
        return;
      this._sendVolume();
    });
    this._volumeSlider.connect('drag-end', () => {
      this._volumeDragging = false;
      this._sendVolume();
    });
    this._volumeRow.add_child(this._muteButton);
    this._volumeRow.add_child(this._volumeSlider);
    this._playerContent.add_child(this._volumeRow);

    this._statusOverlay = new St.BoxLayout({
      orientation: VERTICAL,
      style_class: 'yourtune-status-overlay',
      reactive: true,
      x_expand: true,
      y_expand: true,
    });
    const status = new St.BoxLayout({
      orientation: VERTICAL,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
      x_expand: true,
      y_expand: true,
    });
    this._statusLabel = new St.Label({style_class: 'yourtune-status-message', x_align: Clutter.ActorAlign.CENTER});
    this._statusLabel.clutter_text.line_wrap = true;
    this._statusLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    status.add_child(this._statusLabel);
    this._statusButton = new St.Button({
      style_class: 'yourtune-text-button',
      can_focus: true,
      reactive: true,
      track_hover: true,
      x_align: Clutter.ActorAlign.CENTER,
    });
    this._statusButton.connect('clicked', () => this._onStatusAction());
    status.add_child(this._statusButton);
    this._statusOverlay.add_child(status);
    playerStack.add_child(this._statusOverlay);
  }

  _onStatusChanged() {
    const status = this._client.status;
    const view = STATUS_VIEWS[status];
    this._statusOverlay.visible = Boolean(view);
    this._searchView.setEnabled(!view);
    if (view) {
      this._statusLabel.text = view.message;
      this._statusButton.visible = Boolean(view.action);
      this._statusButton.label = view.action ?? '';
    }
    if (status !== 'connected') {
      // The next connection may be to an upgraded YourTune.
      this._mixButton.visible = true;
      this._state = {...EMPTY_STATE};
      this._localProgress = 0;
      this._seekTarget = null;
      this._clearLikeOverride();
      this._clearLikeRefresh();
      this._queue = null;
      this._updateUi();
    }
  }

  _onStatusAction() {
    if (this._client.status === 'offline')
      this._client.reconnect();
    else
      this._client.authorize();
  }

  _onMessage(message) {
    const {type, ...data} = message;
    const wasPlaying = this._state.isPlaying;
    switch (type) {
    case 'PLAYER_INFO':
      this._state = {...EMPTY_STATE, ...data, song: data.song ?? null};
      this._syncProgress(this._state.position, true, false);
      this._scheduleLikeRefresh([0, ...LIKE_REFRESH_DELAYS_MS]);
      this._refreshQueue();
      if (!this._state.song)
        this._loadCurrentSong();
      break;
    case 'VIDEO_CHANGED':
      this._previousLikeStatus = this._state.likeStatus;
      this._videoChangedAt = Date.now();
      // YourTune reports a newly loaded track as playing and sends PLAYER_STATE_CHANGED only if it
      // turns out paused, so the track's own flag is the play state from here on.
      this._state = {
        ...this._state,
        ...data,
        isPlaying: data.song?.isPaused === undefined ? this._state.isPlaying : !data.song.isPaused,
        likeStatus: 'INDIFFERENT',
      };
      this._syncProgress(data.position, true, false);
      this._clearLikeOverride();
      this._scheduleLikeRefresh(LIKE_REFRESH_DELAYS_MS);
      this._refreshQueue();
      break;
    case 'PLAYER_STATE_CHANGED':
    case 'POSITION_CHANGED':
      this._state = {...this._state, ...data};
      this._syncProgress(data.position, false, wasPlaying && this._state.isPlaying);
      break;
    case 'VOLUME_CHANGED':
    case 'REPEAT_CHANGED':
    case 'SHUFFLE_CHANGED':
      this._state = {...this._state, ...data};
      break;
    case 'LIKE_CHANGED':
      // YourTune 1.4 reports likes as they change. On the new player UI it also sends the previous
      // track's state as the track changes and nothing for the new one, so that stale value is
      // dropped and the new track's state is still read after VIDEO_CHANGED.
      if (Date.now() - this._videoChangedAt < LIKE_SETTLE_MS && data.likeStatus === this._previousLikeStatus)
        return;
      this._state = {...this._state, likeStatus: data.likeStatus};
      if (this._likeOverride === data.likeStatus)
        this._clearLikeOverride();
      this._updateLikeButtons();
      return;
    default:
      return;
    }
    this._updateUi();
  }

  // YourTune reports the YouTube video's title and channel ("All In", "오케이션"), while the queue
  // has what YouTube Music itself shows ("All In (feat. B-Free)", "Ca$h Out"). Prefer the queue's
  // whenever the track is in it.
  _displayTrack(song) {
    if (!song)
      return song;
    const index = this._queue?.entries.findIndex(ids => ids.includes(song.videoId)) ?? -1;
    const track = index >= 0 ? this._queue.tracks[index] : null;
    return track?.title ? {...song, ...track} : song;
  }

  // After the API Server plugin is turned off and on, YourTune's first PLAYER_INFO has no song
  // until the track changes (robotlog/YourTune#5), so ask for it.
  async _loadCurrentSong() {
    try {
      const song = await this._client.request('GET', '/song');
      if (this._destroyed || !song || this._state.song)
        return;
      this._state = {...this._state, song, isPlaying: !song.isPaused};
      this._syncProgress(song.elapsedSeconds, true, false);
      this._scheduleLikeRefresh([0]);
      this._updateUi();
    } catch (error) {
      this._logFailure('song read', error);
    }
  }

  async _refreshQueue() {
    if (this._client?.status !== 'connected')
      return;
    const serial = ++this._queueSerial;
    try {
      const queue = parseQueue(await this._client.request('GET', '/queue'));
      if (serial !== this._queueSerial || this._destroyed)
        return;
      this._queue = queue;
      this._updateUi();
    } catch (error) {
      this._logFailure('queue read', error);
    }
  }

  _syncProgress(position, trackChanged, playing) {
    if (this._dragging || !Number.isFinite(position))
      return;
    if (trackChanged) {
      this._seekTarget = null;
      this._localProgress = position;
    } else if (this._seekTarget !== null && Date.now() < this._seekDeadline) {
      if (Math.abs(position - this._seekTarget) <= 1.5) {
        this._seekTarget = null;
        this._localProgress = position;
      }
    } else if (playing) {
      // Positions arrive in whole seconds while the local clock ticks in quarters, so only
      // follow the server when it is clearly ahead or behind.
      const delta = position - this._localProgress;
      if (delta > 0.35 || delta < -1.25)
        this._localProgress = position;
    } else {
      this._seekTarget = null;
      this._localProgress = position;
    }
  }

  _updateUi() {
    const song = this._state.song;
    const playing = this._state.isPlaying;
    const shown = this._displayTrack(song);
    this._setMarqueeText(this._titleMarquee, shown?.title || 'Nothing playing');
    this._setMarqueeText(this._artistMarquee, shown?.artist || 'Play something in YourTune');
    this._setArtwork(shown?.imageSrc ?? null);

    this._setButtonIcon(this._playButton, playing ? 'pause-symbolic.svg' : 'play-symbolic.svg');
    // Same rule as YourTune's own tray icon: the pause glyph only while a track is paused.
    const panelIcon = song && !playing ? 'yourtune-panel-paused.png' : 'yourtune-panel.png';
    if (this._panelIconName !== panelIcon) {
      this._panelIconName = panelIcon;
      this._panelIcon.gicon = this._fileIcon(panelIcon);
    }
    this._playButton.accessible_name = playing ? 'Pause' : 'Play';
    const connected = this._client.status === 'connected';
    const active = connected && Boolean(song);
    for (const button of [this._previousButton, this._playButton, this._nextButton, this._likeButton,
      this._dislikeButton, this._mixButton])
      this._setButtonEnabled(button, active);
    for (const button of [this._repeatButton, this._shuffleButton, this._muteButton])
      button.reactive = button.can_focus = connected;
    this._slider.reactive = active && this._duration() > 0;
    this._volumeSlider.reactive = connected;
    this._volumeRow.opacity = connected ? 255 : 90;

    this._updateLikeButtons();
    this._updateRepeatButton();
    this._shuffleButton.opacity = this._state.shuffle ? 255 : 120;
    this._shuffleButton.accessible_name = this._state.shuffle ? 'Shuffle: on' : 'Shuffle: off';
    this._updateVolume();
    this._updateProgress();
  }

  _duration() {
    return this._state.song?.songDuration ?? 0;
  }

  _updateProgress() {
    const duration = this._duration();
    const progress = Math.min(this._localProgress, duration || this._localProgress);
    this._currentTime.text = formatTime(progress);
    this._totalTime.text = formatTime(duration);
    if (!this._dragging)
      this._slider.value = duration > 0 ? Math.min(1, progress / duration) : 0;
  }

  _updateRepeatButton() {
    const mode = this._state.repeat || 'NONE';
    this._setButtonIcon(this._repeatButton, mode === 'ONE' ? 'repeat-one-symbolic.svg' : 'repeat-symbolic.svg');
    this._repeatButton.opacity = mode === 'NONE' ? 120 : 255;
    this._repeatButton.accessible_name = `Repeat: ${mode.toLowerCase()}`;
  }

  _updateVolume() {
    if (this._volumeDragging)
      return;
    const {muted, volume} = this._state;
    const iconName = muted || volume === 0
      ? 'volume-muted-symbolic.svg'
      : volume < 40
        ? 'volume-low-symbolic.svg'
        : 'volume-high-symbolic.svg';
    this._setButtonIcon(this._muteButton, iconName);
    this._muteButton.accessible_name = muted ? 'Unmute' : 'Mute';
    this._volumeSlider.value = muted ? 0 : Math.max(0, Math.min(1, volume / 100));
  }

  _sendVolume() {
    this._lastVolumeSentAt = Date.now();
    this._command('POST', '/volume', {volume: Math.round(this._volumeSlider.value * 100)});
  }

  _currentLikeStatus() {
    return this._likeOverride ?? this._state.likeStatus ?? 'INDIFFERENT';
  }

  // POST /like and /dislike toggle; disliking also makes YouTube Music skip the song.
  _rate(status) {
    if (!this._state.song)
      return;
    this._setLikeOverride(this._currentLikeStatus() === status ? 'INDIFFERENT' : status);
    this._command('POST', status === 'LIKE' ? '/like' : '/dislike');
    this._scheduleLikeRefresh(LIKE_REFRESH_DELAYS_MS);
  }

  _updateLikeButtons() {
    const status = this._currentLikeStatus();
    const liked = status === 'LIKE';
    const disliked = status === 'DISLIKE';
    this._setButtonIcon(this._likeButton, liked ? 'thumb-up-filled-symbolic.svg' : 'thumb-up-symbolic.svg');
    this._setButtonIcon(this._dislikeButton, disliked ? 'thumb-down-filled-symbolic.svg' : 'thumb-down-symbolic.svg');
    this._likeButton.accessible_name = liked ? 'Unlike' : 'Like';
    this._dislikeButton.accessible_name = disliked ? 'Remove dislike' : 'Dislike';
    this._likeButton[liked ? 'add_style_class_name' : 'remove_style_class_name']('yourtune-like-on');
    this._dislikeButton[disliked ? 'add_style_class_name' : 'remove_style_class_name']('yourtune-dislike-on');
  }

  _setLikeOverride(status) {
    this._clearLikeOverride();
    this._likeOverride = status;
    this._likeOverrideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LIKE_OVERRIDE_MS, () => {
      this._likeOverrideTimer = 0;
      this._likeOverride = null;
      this._updateLikeButtons();
      return GLib.SOURCE_REMOVE;
    });
    this._updateLikeButtons();
  }

  _clearLikeOverride() {
    this._likeOverride = null;
    if (this._likeOverrideTimer) {
      GLib.source_remove(this._likeOverrideTimer);
      this._likeOverrideTimer = 0;
    }
  }

  // The WebSocket carries no like state, so it is read after anything that may change it, at each
  // of the given delays from now.
  _scheduleLikeRefresh(delaysMs) {
    this._clearLikeRefresh();
    const [first, ...rest] = delaysMs;
    if (first === undefined)
      return;
    this._likeRefreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, first, () => {
      this._likeRefreshTimer = 0;
      this._refreshLikeStatus();
      this._scheduleLikeRefresh(rest.map(delay => delay - first));
      return GLib.SOURCE_REMOVE;
    });
  }

  _clearLikeRefresh() {
    if (this._likeRefreshTimer) {
      GLib.source_remove(this._likeRefreshTimer);
      this._likeRefreshTimer = 0;
    }
  }

  async _refreshLikeStatus() {
    if (this._client?.status !== 'connected' || !this._state.song)
      return;
    const videoId = this._state.song.videoId;
    try {
      const result = await this._client.request('GET', '/like-state');
      if (this._destroyed || this._state.song?.videoId !== videoId)
        return;
      const likeStatus = result?.state ?? 'INDIFFERENT';
      if (Date.now() - this._videoChangedAt < LIKE_SETTLE_MS && likeStatus === this._previousLikeStatus)
        return;
      this._state = {...this._state, likeStatus};
      if (this._likeOverride === this._state.likeStatus)
        this._clearLikeOverride();
      this._updateLikeButtons();
    } catch (error) {
      this._logFailure('like state', error);
    }
  }

  // YourTune uses this as its Wayland app id and X11 window class, and names its desktop file
  // after it.
  _findYourTune() {
    const window = global.get_window_actors()
      .map(actor => actor.meta_window)
      .find(metaWindow => metaWindow.get_wm_class() === YOURTUNE_APP_ID);
    if (window)
      return {window};
    const app = Shell.AppSystem.get_default().lookup_app(`${YOURTUNE_APP_ID}.desktop`);
    return app ? {app} : null;
  }

  // With no window to raise, launching the app again makes YourTune show its main window, even
  // when it is hidden in the tray.
  _showYourTune() {
    const target = this._findYourTune();
    if (!target)
      return;
    this.menu.close();
    if (target.window)
      Main.activateWindow(target.window);
    else
      target.app.activate();
  }

  _command(method, path, body = null) {
    this._client.request(method, path, body).catch(error => {
      this._logFailure(`${method} ${path}`, error);
    });
  }

  // YourTune before 1.4 has no POST /start-radio, so the button goes away instead of doing nothing.
  _startMix() {
    this._client.request('POST', '/start-radio', {}).catch(error => {
      if (isMissingEndpoint(error))
        this._mixButton.visible = false;
      else
        this._logFailure('POST /start-radio', error);
    });
  }

  _logFailure(what, error) {
    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
      console.error(`YourTune ${what} failed: ${error.message}`);
  }

  _fileIcon(fileName) {
    return new Gio.FileIcon({file: Gio.File.new_for_path(`${this._extensionPath}/icons/${fileName}`)});
  }

  _setButtonIcon(button, iconName) {
    if (button._yourtuneIconName === iconName && button.get_child())
      return;
    button._yourtuneIconName = iconName;
    button.set_child(new St.Icon({gicon: this._fileIcon(iconName), icon_size: 22}));
  }

  _iconButton(iconName, accessibleName, callback, styleClass = '') {
    const button = new St.Button({
      style_class: `yourtune-icon-button ${styleClass}`,
      accessible_name: accessibleName,
      can_focus: true,
      reactive: true,
      track_hover: true,
    });
    this._setButtonIcon(button, iconName);
    button.connect('clicked', callback);
    return button;
  }

  _setButtonEnabled(button, enabled) {
    button.reactive = enabled;
    button.can_focus = enabled;
    button.opacity = enabled ? 255 : 90;
  }

  _createMarquee(text, styleClass) {
    const clip = new St.Widget({
      style_class: 'yourtune-marquee-clip',
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
    });
    clip.set_clip_to_allocation(true);
    const label = new St.Label({
      text,
      style_class: styleClass,
      x_align: Clutter.ActorAlign.START,
      y_align: Clutter.ActorAlign.CENTER,
    });
    label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    label.clutter_text.single_line_mode = true;
    clip.add_child(label);

    const marquee = {
      clip,
      label,
      generation: 0,
      pendingId: 0,
      lastClipWidth: -1,
      allocationId: 0,
      mappedId: 0,
    };
    marquee.allocationId = clip.connect('notify::allocation', () => {
      const width = Math.round(clip.width);
      if (width === marquee.lastClipWidth)
        return;
      marquee.lastClipWidth = width;
      this._restartMarquee(marquee);
    });
    marquee.mappedId = label.connect('notify::mapped', () => this._restartMarquee(marquee));
    this._marquees.push(marquee);
    return marquee;
  }

  _setMarqueeText(marquee, text) {
    if (marquee.label.text === text)
      return;
    marquee.label.text = text;
    this._restartMarquee(marquee);
  }

  _canRunMarquee(marquee) {
    return !this._destroyed &&
      this._menuIsOpen &&
      this._stSettings.enable_animations &&
      marquee.label.mapped &&
      marquee.clip.width > 0;
  }

  _cancelMarquee(marquee) {
    marquee.generation += 1;
    if (marquee.pendingId) {
      GLib.source_remove(marquee.pendingId);
      marquee.pendingId = 0;
    }
    marquee.label.remove_transition('translation-x');
    marquee.label.translation_x = 0;
  }

  _restartMarquee(marquee) {
    this._cancelMarquee(marquee);
    if (!this._canRunMarquee(marquee))
      return;
    marquee.pendingId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      marquee.pendingId = 0;
      void this._runMarquee(marquee);
      return GLib.SOURCE_REMOVE;
    });
  }

  _restartMarquees() {
    for (const marquee of this._marquees)
      this._restartMarquee(marquee);
  }

  _stopMarquees() {
    for (const marquee of this._marquees)
      this._cancelMarquee(marquee);
  }

  async _runMarquee(marquee) {
    if (!this._canRunMarquee(marquee))
      return;
    const [, naturalWidth] = marquee.label.get_preferred_width(-1);
    const overflow = Math.max(0, Math.ceil(naturalWidth - marquee.clip.width));
    if (overflow <= 1)
      return;

    const generation = marquee.generation;
    const duration = Math.max(1, Math.round(overflow / MARQUEE_SPEED_PX_PER_SECOND * 1000));
    let firstPass = true;
    try {
      while (generation === marquee.generation && this._canRunMarquee(marquee)) {
        await marquee.label.easeAsync({
          translation_x: -overflow,
          delay: firstPass ? 1500 : 1800,
          duration,
          mode: Clutter.AnimationMode.LINEAR,
        });
        if (generation !== marquee.generation || !this._canRunMarquee(marquee))
          return;
        await marquee.label.easeAsync({
          translation_x: 0,
          delay: 1200,
          duration,
          mode: Clutter.AnimationMode.LINEAR,
        });
        firstPass = false;
      }
    } catch (error) {
      if (generation === marquee.generation && this._canRunMarquee(marquee))
        logErrorUnlessCancelled(error);
    }
  }

  _artFallback() {
    this._art.set_style('');
    this._artPlaceholder.visible = true;
    this._deleteArtFile();
  }

  _applyArtPixbuf(pixbuf) {
    const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor || 1;
    const px = Math.max(1, Math.round(ART_SIZE * scale));
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const side = Math.max(1, Math.min(width, height));
    const square = pixbuf.new_subpixbuf(Math.floor((width - side) / 2), Math.floor((height - side) / 2), side, side);
    const scaled = square.scale_simple(px, px, GdkPixbuf.InterpType.BILINEAR);
    const dir = coverCacheDir();
    try {
      Gio.File.new_for_path(dir).make_directory_with_parents(null);
    } catch {}
    const path = GLib.build_filenamev([dir, `cover-${this._artLoadId}.png`]);
    scaled.savev(path, 'png', [], []);
    this._deleteArtFile();
    this._artPath = path;
    this._artPlaceholder.visible = false;
    const uri = GLib.filename_to_uri(path, null);
    this._art.set_style(`background-image: url("${uri}"); background-size: cover; background-position: center; background-repeat: no-repeat;`);
  }

  _deleteArtFile() {
    if (!this._artPath)
      return;
    try {
      Gio.File.new_for_path(this._artPath).delete(null);
    } catch {}
    this._artPath = null;
  }

  async _setArtwork(url) {
    if (url === this._artUrl)
      return;

    this._artUrl = url;
    const loadId = ++this._artLoadId;
    if (!url) {
      this._artFallback();
      return;
    }

    try {
      const bytes = await this._client.fetchBytes(url);
      if (loadId !== this._artLoadId)
        return;
      const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
      this._applyArtPixbuf(GdkPixbuf.Pixbuf.new_from_stream(stream, null));
    } catch (error) {
      if (loadId !== this._artLoadId || error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        return;
      this._logFailure('artwork', error);
      this._artFallback();
    }
  }

  // Runs on the destroy signal, so it also cleans up when GNOME Shell disposes the panel itself.
  _onDestroy() {
    this._destroyed = true;
    this._artLoadId++;
    GLib.source_remove(this._tickId);
    this._clearLikeOverride();
    this._clearLikeRefresh();
    this._stopMarquees();
    for (const marquee of this._marquees) {
      marquee.clip.disconnect(marquee.allocationId);
      marquee.label.disconnect(marquee.mappedId);
    }
    this._marquees = [];
    this._stSettings.disconnect(this._animationsChangedId);
    this._stSettings = null;
    this.menu.disconnect(this._menuOpenId);
    this._client.disconnectObject(this);
    this._client = null;
    this._deleteArtFile();
    super._onDestroy();
  }
});
