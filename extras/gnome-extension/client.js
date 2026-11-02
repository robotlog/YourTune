import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');
Gio._promisify(Soup.Session.prototype, 'websocket_connect_async');

export const CLIENT_ID = 'yourtune-gnome-miniplayer';

const REQUEST_TIMEOUT_S = 10;
const RECONNECT_MIN_S = 2;
const RECONNECT_MAX_S = 30;
const WS_POLICY_VIOLATION = 1008;

// Status values the panel renders:
// 'connecting'  waiting for the WebSocket
// 'offline'     YourTune or its API Server plugin is not reachable; retries with backoff
// 'needs-auth'  no token, or the stored one was rejected; waits for the user
// 'authorizing' waiting for the user to answer the dialog in YourTune
// 'denied'      the user declined the dialog; waits for the user
// 'connected'   receiving player updates
export class YourTuneClient extends EventEmitter {
  constructor(settings) {
    super();
    this._settings = settings;
    this._session = new Soup.Session({timeout: REQUEST_TIMEOUT_S});
    // POST /auth blocks until the user answers the dialog, so it must not time out.
    this._authSession = new Soup.Session();
    this._cancellable = new Gio.Cancellable();
    this._connection = null;
    this._reconnectId = 0;
    this._backoff = RECONNECT_MIN_S;
    this._status = 'connecting';
    this._settingsChangedId = settings.connect('changed', (_settings, key) => {
      // The preferences window can forget the token while it is in use.
      const tokenForgotten = key === 'token' && !this._token && this._status !== 'needs-auth';
      if (key === 'host' || key === 'port' || tokenForgotten)
        this.reconnect();
    });
  }

  get status() {
    return this._status;
  }

  get _baseUrl() {
    return `http://${this._settings.get_string('host')}:${this._settings.get_int('port')}`;
  }

  get _token() {
    return this._settings.get_string('token');
  }

  start() {
    if (!this._token) {
      this._setStatus('needs-auth');
      return;
    }
    this._connect();
  }

  reconnect() {
    this._closeConnection();
    this._clearReconnect();
    this._backoff = RECONNECT_MIN_S;
    this.start();
  }

  async authorize() {
    if (this._status === 'authorizing')
      return;
    this._closeConnection();
    this._clearReconnect();
    this._setStatus('authorizing');

    const message = Soup.Message.new('POST', `${this._baseUrl}/auth/${CLIENT_ID}`);
    try {
      const bytes = await this._authSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable);
      if (message.status_code === Soup.Status.FORBIDDEN) {
        this._setStatus('denied');
        return;
      }
      if (message.status_code !== Soup.Status.OK)
        throw new Error(`HTTP ${message.status_code}`);
      const {accessToken} = JSON.parse(new TextDecoder().decode(bytes.get_data()));
      this._settings.set_string('token', accessToken);
      this._connect();
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        return;
      if (this._isUnreachable(error)) {
        this._setStatus('offline');
        return;
      }
      console.error(`YourTune authorization failed: ${error.message}`);
      this._setStatus('needs-auth');
    }
  }

  // Resolves to the parsed JSON body, or null for an empty one.
  async request(method, path, body = null) {
    const message = Soup.Message.new(method, `${this._baseUrl}/api/v1${path}`);
    message.request_headers.append('Authorization', `Bearer ${this._token}`);
    if (body !== null) {
      const data = new TextEncoder().encode(JSON.stringify(body));
      message.set_request_body_from_bytes('application/json', new GLib.Bytes(data));
    }

    const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable);
    if (message.status_code === Soup.Status.UNAUTHORIZED) {
      this._rejectToken();
      throw new Error('Unauthorized');
    }
    if (message.status_code < 200 || message.status_code >= 300)
      throw new Error(`${method} ${path}: HTTP ${message.status_code}`);
    const data = bytes.get_data();
    return data?.length ? JSON.parse(new TextDecoder().decode(data)) : null;
  }

  // Resolves to the raw bytes of an absolute URL, such as album art.
  async fetchBytes(url) {
    const message = Soup.Message.new('GET', url);
    const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable);
    if (message.status_code !== Soup.Status.OK)
      throw new Error(`GET ${url}: HTTP ${message.status_code}`);
    return bytes;
  }

  async _connect() {
    this._closeConnection();
    this._clearReconnect();
    this._setStatus('connecting');

    const url = `${this._baseUrl.replace(/^http/, 'ws')}/api/v1/ws?token=${encodeURIComponent(this._token)}`;
    const message = Soup.Message.new('GET', url);
    let connection;
    try {
      connection = await this._session.websocket_connect_async(message, null, [], GLib.PRIORITY_DEFAULT, this._cancellable);
    } catch (error) {
      if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        return;
      this._setStatus('offline');
      this._scheduleReconnect();
      return;
    }

    this._connection = connection;
    connection.connect('message', (_connection, type, bytes) => {
      if (type !== Soup.WebsocketDataType.TEXT)
        return;
      try {
        this.emit('message', JSON.parse(new TextDecoder().decode(bytes.get_data())));
      } catch (error) {
        console.error(`YourTune WebSocket message parse failed: ${error.message}`);
      }
    });
    connection.connect('closed', () => {
      if (this._connection !== connection)
        return;
      this._connection = null;
      if (connection.get_close_code() === WS_POLICY_VIOLATION) {
        this._rejectToken();
        return;
      }
      this._setStatus('offline');
      this._scheduleReconnect();
    });
    this._backoff = RECONNECT_MIN_S;
    this._setStatus('connected');
  }

  _rejectToken() {
    this._closeConnection();
    this._clearReconnect();
    this._settings.set_string('token', '');
    this._setStatus('needs-auth');
  }

  _isUnreachable(error) {
    return error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CONNECTION_REFUSED) ||
      error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.HOST_UNREACHABLE) ||
      error.matches?.(Gio.ResolverError, Gio.ResolverError.NOT_FOUND);
  }

  _scheduleReconnect() {
    this._clearReconnect();
    const delay = this._backoff;
    this._backoff = Math.min(this._backoff * 2, RECONNECT_MAX_S);
    this._reconnectId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
      this._reconnectId = 0;
      this._connect();
      return GLib.SOURCE_REMOVE;
    });
  }

  _clearReconnect() {
    if (this._reconnectId) {
      GLib.source_remove(this._reconnectId);
      this._reconnectId = 0;
    }
  }

  _closeConnection() {
    const connection = this._connection;
    this._connection = null;
    if (connection?.get_state() === Soup.WebsocketState.OPEN)
      connection.close(Soup.WebsocketCloseCode.NORMAL, null);
  }

  _setStatus(status) {
    if (this._status === status)
      return;
    this._status = status;
    this.emit('status-changed', status);
  }

  destroy() {
    this._cancellable.cancel();
    this._settings.disconnect(this._settingsChangedId);
    this._clearReconnect();
    this._closeConnection();
    this._session.abort();
    this._authSession.abort();
    this.disconnectAll();
  }
}
