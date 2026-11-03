import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {insertedIndex, parseQueue} from './queue.js';
import {SEARCH_PARAMS, parseSearchPage, rankResults} from './search.js';

const VERTICAL = Clutter.Orientation.VERTICAL;
const SEARCH_DEBOUNCE_MS = 900;
const MAX_QUERY_LENGTH = 200;
const QUEUE_MESSAGE_MS = 3000;
const QUEUE_ERROR_MS = 6000;
const QUEUE_CONFIRM_MS = 6000;
const QUEUE_POLL_MS = 250;
const KINDS = {songs: 'song', videos: 'video'};

function cleanQuery(text) {
  return text.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY_LENGTH);
}

function isCancelled(error) {
  return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export const SearchView = GObject.registerClass(
class SearchView extends St.BoxLayout {
  _init({client, settings, fileIcon, onQueueChanged}) {
    super._init({orientation: VERTICAL, style_class: 'yourtune-search-wrap', x_expand: true});
    this._client = client;
    this._settings = settings;
    this._fileIcon = fileIcon;
    this._onQueueChanged = onQueueChanged;
    this._search = null;
    this._serial = 0;
    this._searchTimer = 0;
    this._queueMessageTimer = 0;
    this._scrollRestoreId = 0;
    this._pollWait = null;
    this._queuePending = false;
    this._destroyed = false;
    this.connect('destroy', () => this._onDestroy());

    // The popup menu treats arrow keys and letters as navigation; keep them in the entry.
    this.connect('key-press-event', (_actor, event) =>
      event.get_key_symbol() === Clutter.KEY_Escape ? Clutter.EVENT_PROPAGATE : Clutter.EVENT_STOP);

    this._entry = new St.Entry({
      style_class: 'yourtune-search-entry',
      hint_text: 'Search',
      can_focus: true,
      track_hover: true,
      x_expand: true,
    });
    this._entry.set_primary_icon(new St.Icon({gicon: fileIcon('search-symbolic.svg'), icon_size: 16}));
    const text = this._entry.get_clutter_text();
    text.connect('activate', () => {
      this._cancelSearchTimer();
      this._runSearch();
    });
    text.connect('text-changed', () => this._onTextChanged());
    this.add_child(this._entry);

    this._resultsBox = new St.BoxLayout({orientation: VERTICAL, style_class: 'yourtune-results-box', x_expand: true, visible: false});
    const header = new St.BoxLayout({style_class: 'yourtune-results-header', x_expand: true});
    header.add_child(new St.Label({text: 'Results', style_class: 'yourtune-results-label', x_expand: true}));
    const toggle = new St.BoxLayout({style_class: 'yourtune-kind-toggle'});
    this._kindButtons = new Map();
    for (const [kind, label] of [['songs', 'Songs'], ['videos', 'Videos']]) {
      const button = this._textButton(label, `Search ${label.toLowerCase()}`, () => this._setKind(kind), 'yourtune-kind-button');
      this._kindButtons.set(kind, button);
      toggle.add_child(button);
    }
    header.add_child(toggle);
    this._resultsBox.add_child(header);

    this._status = new St.Label({style_class: 'yourtune-results-status'});
    this._status.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    this._resultsBox.add_child(this._status);

    this._list = new St.BoxLayout({orientation: VERTICAL, style_class: 'yourtune-results', x_expand: true});
    this._scroll = new St.ScrollView({
      style_class: 'yourtune-results-scroll',
      overlay_scrollbars: true,
      x_expand: true,
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      child: this._list,
    });
    this._resultsBox.add_child(this._scroll);

    this._queueStatus = new St.Label({text: ' ', style_class: 'yourtune-results-status', x_expand: true, opacity: 0});
    this._queueStatus.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    this._resultsBox.add_child(this._queueStatus);
    this.add_child(this._resultsBox);

    this._render();
  }

  get _kind() {
    const kind = this._settings.get_string('search-kind');
    return kind in KINDS ? kind : 'songs';
  }

  setEnabled(enabled) {
    this.opacity = enabled ? 255 : 65;
    this._entry.get_clutter_text().set_editable(enabled);
    this._entry.can_focus = enabled;
    if (!enabled) {
      this._cancelSearchTimer();
      this._search = null;
      this._render();
    }
  }

  _setKind(kind) {
    if (kind === this._kind)
      return;
    this._settings.set_string('search-kind', kind);
    this._cancelSearchTimer();
    this._runSearch();
  }

  _isComposing() {
    return this._entry.get_clutter_text().has_preedit();
  }

  _onTextChanged() {
    this._cancelSearchTimer();
    if (!cleanQuery(this._entry.get_text())) {
      this._serial++;
      this._search = null;
      this._render();
      return;
    }
    // Input methods show a partial syllable as preedit text; committing it changes the text again.
    if (this._isComposing())
      return;
    this._searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
      this._searchTimer = 0;
      if (!this._isComposing())
        this._runSearch();
      return GLib.SOURCE_REMOVE;
    });
  }

  _cancelSearchTimer() {
    if (this._searchTimer) {
      GLib.source_remove(this._searchTimer);
      this._searchTimer = 0;
    }
  }

  async _runSearch() {
    const query = cleanQuery(this._entry.get_text());
    if (!query) {
      this._search = null;
      this._render();
      return;
    }
    const kind = this._kind;
    if (this._search?.query === query && this._search.kind === kind && this._search.status === 'loading')
      return;

    const serial = ++this._serial;
    this._search = {query, kind, status: 'loading', items: [], continuation: null, loadingMore: false};
    this._render();
    try {
      const payload = await this._client.request('POST', '/search', {query, params: SEARCH_PARAMS[kind]});
      if (serial !== this._serial || this._destroyed)
        return;
      const page = parseSearchPage(payload, KINDS[kind]);
      this._search = {...this._search, status: 'ready', items: rankResults(page.items, query), continuation: page.continuation};
    } catch (error) {
      if (serial !== this._serial || this._destroyed || isCancelled(error))
        return;
      console.error(`YourTune search failed: ${error.message}`);
      this._search = {...this._search, status: 'error'};
    }
    this._render();
  }

  async _loadMore() {
    const search = this._search;
    if (!search?.continuation || search.loadingMore)
      return;
    const serial = this._serial;
    search.loadingMore = true;
    this._renderKeepingScroll();
    try {
      const payload = await this._client.request('POST', '/search', {query: search.query, continuation: search.continuation});
      if (serial !== this._serial || this._destroyed)
        return;
      const page = parseSearchPage(payload, KINDS[search.kind]);
      const seen = new Set(search.items.map(item => item.videoId));
      search.items.push(...page.items.filter(item => !seen.has(item.videoId)));
      search.continuation = page.continuation;
    } catch (error) {
      if (serial !== this._serial || this._destroyed || isCancelled(error))
        return;
      console.error(`YourTune search page failed: ${error.message}`);
      this._showQueueMessage('Could not load more results', true);
    }
    search.loadingMore = false;
    this._renderKeepingScroll();
  }

  _renderKeepingScroll() {
    const adjustment = this._scroll.vadjustment;
    const value = adjustment.value;
    this._render();
    if (this._scrollRestoreId)
      GLib.source_remove(this._scrollRestoreId);
    this._scrollRestoreId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._scrollRestoreId = 0;
      adjustment.value = value;
      return GLib.SOURCE_REMOVE;
    });
  }

  _render() {
    for (const child of this._list.get_children())
      child.destroy();

    const search = this._search;
    this._resultsBox.visible = Boolean(search);
    if (!search)
      return;

    for (const [kind, button] of this._kindButtons)
      button[kind === search.kind ? 'add_style_class_name' : 'remove_style_class_name']('yourtune-kind-button-selected');

    const empty = search.status === 'ready' && !search.items.length;
    this._status.visible = search.status !== 'ready' || empty;
    this._status.text = search.status === 'loading'
      ? 'Searching…'
      : search.status === 'error'
        ? 'Search failed. Try again.'
        : `No ${search.kind} found`;
    this._scroll.visible = search.status === 'ready' && !empty;
    if (!this._scroll.visible)
      return;

    for (const item of search.items)
      this._list.add_child(this._createRow(item));
    if (search.continuation) {
      const more = this._textButton(search.loadingMore ? 'Loading…' : 'More results', 'Load more results',
        () => this._loadMore(), 'yourtune-more-button');
      more.reactive = !search.loadingMore;
      this._list.add_child(more);
    }
  }

  _createRow(item) {
    const row = new St.BoxLayout({style_class: 'yourtune-result-row', x_expand: true});

    // The thumbnail is the play control, like the artwork in YouTube Music's own lists.
    const artButton = new St.Button({
      style_class: 'yourtune-result-art-wrap',
      accessible_name: `Play ${item.title}`,
      can_focus: true,
      reactive: true,
      track_hover: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    const artStack = new St.Widget({layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
    const art = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 40, style_class: 'yourtune-result-art'});
    this._loadThumbnail(art, item.artworkUrl);
    const overlay = new St.Widget({
      style_class: 'yourtune-result-art-overlay',
      layout_manager: new Clutter.BinLayout(),
      x_expand: true,
      y_expand: true,
      opacity: 0,
    });
    overlay.add_child(new St.Icon({
      gicon: this._fileIcon('play-symbolic.svg'),
      icon_size: 18,
      x_align: Clutter.ActorAlign.CENTER,
      y_align: Clutter.ActorAlign.CENTER,
    }));
    artStack.add_child(art);
    artStack.add_child(overlay);
    artButton.set_child(artStack);
    artButton.set_clip_to_allocation(true);
    const updateOverlay = () => {
      const visible = artButton.hover || artButton.has_key_focus();
      overlay.ease({opacity: visible ? 255 : 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    };
    artButton.connect('notify::hover', updateOverlay);
    artButton.connect('key-focus-in', updateOverlay);
    artButton.connect('key-focus-out', updateOverlay);
    artButton.connect('clicked', () => this._playNow(item));
    row.add_child(artButton);

    const details = new St.BoxLayout({orientation: VERTICAL, x_expand: true, style_class: 'yourtune-result-details'});
    const title = new St.Label({text: item.title, style_class: 'yourtune-result-title', x_expand: true});
    title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    const subtitle = new St.Label({
      text: [item.artist, item.duration].filter(Boolean).join(' • '),
      style_class: 'yourtune-result-artist',
      x_expand: true,
    });
    subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    details.add_child(title);
    details.add_child(subtitle);
    row.add_child(details);

    const playNext = new St.Button({
      style_class: 'yourtune-icon-button',
      accessible_name: `Play next: ${item.title}`,
      can_focus: true,
      reactive: true,
      track_hover: true,
      y_align: Clutter.ActorAlign.CENTER,
      child: new St.Icon({gicon: this._fileIcon('play-next-symbolic.svg'), icon_size: 22}),
    });
    playNext.connect('clicked', () => this._playNext(item));
    row.add_child(playNext);
    return row;
  }

  async _loadThumbnail(icon, url) {
    if (!url)
      return;
    try {
      const bytes = await this._client.fetchBytes(url);
      if (!this._destroyed && icon.get_parent())
        icon.gicon = Gio.BytesIcon.new(bytes);
    } catch (error) {
      if (!isCancelled(error))
        console.error(`YourTune thumbnail failed: ${error.message}`);
    }
  }

  // There is no "play this now" endpoint yet: put the item right after the current one, then jump
  // to that entry.
  async _playNow(item) {
    await this._queue(item, async () => {
      const index = await this._putNext(item.videoId);
      await this._client.request('PATCH', '/queue', {index});
    }, `Playing “${item.title}”`);
  }

  async _playNext(item) {
    await this._queue(item, () => this._putNext(item.videoId), `“${item.title}” plays next`);
  }

  // POST /queue answers before YouTube Music has fetched and inserted the item, so read the queue
  // until the item is where it goes. Resolves to its index.
  async _putNext(videoId) {
    let index = insertedIndex(parseQueue(await this._client.request('GET', '/queue')), videoId);
    if (index >= 0)
      return index;
    await this._client.request('POST', '/queue', {videoId, insertPosition: 'INSERT_AFTER_CURRENT_VIDEO'});
    const deadline = Date.now() + QUEUE_CONFIRM_MS;
    while (Date.now() < deadline) {
      await this._pollDelay();
      index = insertedIndex(parseQueue(await this._client.request('GET', '/queue')), videoId);
      if (index >= 0)
        return index;
    }
    throw new Error(`${videoId} did not show up in the queue`);
  }

  // Resolves after QUEUE_POLL_MS, or rejects as cancelled when the view is destroyed first.
  _pollDelay() {
    return new Promise((resolve, reject) => {
      const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, QUEUE_POLL_MS, () => {
        this._pollWait = null;
        resolve();
        return GLib.SOURCE_REMOVE;
      });
      this._pollWait = {id, reject};
    });
  }

  async _queue(item, action, doneMessage) {
    if (this._queuePending)
      return;
    this._queuePending = true;
    try {
      await action();
      if (!this._destroyed) {
        this._onQueueChanged();
        this._showQueueMessage(doneMessage, false);
      }
    } catch (error) {
      if (this._destroyed || isCancelled(error))
        return;
      console.error(`YourTune queue failed: ${error.message}`);
      this._showQueueMessage(`Could not queue “${item.title}”`, true);
    } finally {
      this._queuePending = false;
    }
  }

  _showQueueMessage(text, isError) {
    if (this._queueMessageTimer)
      GLib.source_remove(this._queueMessageTimer);
    this._queueStatus.text = text;
    this._queueStatus.accessible_name = text;
    this._queueStatus.opacity = 255;
    this._queueMessageTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, isError ? QUEUE_ERROR_MS : QUEUE_MESSAGE_MS, () => {
      this._queueMessageTimer = 0;
      this._queueStatus.opacity = 0;
      return GLib.SOURCE_REMOVE;
    });
  }

  _textButton(label, accessibleName, callback, styleClass) {
    const button = new St.Button({
      label,
      style_class: styleClass,
      accessible_name: accessibleName,
      can_focus: true,
      reactive: true,
      track_hover: true,
    });
    button.connect('clicked', callback);
    return button;
  }

  _onDestroy() {
    this._destroyed = true;
    this._serial++;
    this._cancelSearchTimer();
    if (this._queueMessageTimer)
      GLib.source_remove(this._queueMessageTimer);
    if (this._scrollRestoreId)
      GLib.source_remove(this._scrollRestoreId);
    if (this._pollWait) {
      GLib.source_remove(this._pollWait.id);
      this._pollWait.reject(new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Search view destroyed'}));
      this._pollWait = null;
    }
  }
});
