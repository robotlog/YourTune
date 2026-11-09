import { createRoute, z } from '@hono/zod-openapi';
import { app as electronApp } from 'electron';
import { verify } from 'hono/jwt';

import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { offerRestartForMiniPlayer } from '@/tray';
import { LoggerPrefix } from '@/utils';

import { AuthStrategy, type APIServerConfig } from '../../config';
import { API_VERSION } from '../api-version';
import { JWTPayloadSchema } from '../scheme';

import type { HonoApp } from '../types';
import type { BackendContext } from '@/types/contexts';
import type {
  LikeType,
  RepeatMode,
  VolumeState,
} from '@/types/datahost-get-state';
import type { WebSocketLike, upgradeWebSocket } from '@hono/node-server';
import type { Context, Next } from 'hono';
import type { WSContext } from 'hono/ws';

// Clients that are a panel icon of their own, so the tray icon would be a second one.
const TRAY_REPLACING_CLIENTS = ['yourtune-gnome-miniplayer'];

enum DataTypes {
  PlayerInfo = 'PLAYER_INFO',
  VideoChanged = 'VIDEO_CHANGED',
  PlayerStateChanged = 'PLAYER_STATE_CHANGED',
  PositionChanged = 'POSITION_CHANGED',
  VolumeChanged = 'VOLUME_CHANGED',
  RepeatChanged = 'REPEAT_CHANGED',
  ShuffleChanged = 'SHUFFLE_CHANGED',
  LikeChanged = 'LIKE_CHANGED',
}

type PlayerState = {
  song?: SongInfo;
  isPlaying: boolean;
  muted: boolean;
  position: number;
  volume: number;
  repeat: RepeatMode;
  shuffle: boolean;
  likeStatus?: LikeType;
};

// The routes register again whenever the server restarts (the plugin is turned
// off and on, or its address changes), while the backend keeps the player
// state it has seen, so new connections read their snapshot from there.
export type PlayerStateGetters = {
  songInfo: () => SongInfo | undefined;
  volumeState: () => VolumeState | undefined;
  repeatMode: () => RepeatMode | undefined;
  shuffle: () => boolean | undefined;
};

export const register = (
  app: HonoApp,
  { getConfig, ipc }: BackendContext<APIServerConfig>,
  uws: typeof upgradeWebSocket,
  state: PlayerStateGetters,
) => {
  const sockets = new Set<WSContext<WebSocketLike>>();

  const send = (type: DataTypes, playerState: Partial<PlayerState>) => {
    sockets.forEach((socket) =>
      socket.send(JSON.stringify({ type, ...playerState })),
    );
  };

  const createPlayerState = ({
    songInfo,
    volumeState,
    repeat,
    shuffle,
  }: {
    songInfo?: SongInfo;
    volumeState?: VolumeState;
    repeat: RepeatMode;
    shuffle: boolean;
  }): PlayerState => ({
    song: songInfo,
    isPlaying: songInfo ? !songInfo.isPaused : false,
    muted: volumeState?.isMuted ?? false,
    position: songInfo?.elapsedSeconds ?? 0,
    volume: volumeState?.state ?? 100,
    repeat,
    shuffle,
  });

  electronApp.once('before-quit', () => {
    send(DataTypes.PlayerStateChanged, {
      isPlaying: false,
      position: state.songInfo()?.elapsedSeconds ?? 0,
    });
  });

  registerCallback((songInfo, event) => {
    if (event === SongInfoEvent.VideoSrcChanged) {
      send(DataTypes.VideoChanged, { song: songInfo, position: 0 });
    }

    if (event === SongInfoEvent.PlayOrPaused) {
      send(DataTypes.PlayerStateChanged, {
        isPlaying: !(songInfo?.isPaused ?? true),
        position: songInfo.elapsedSeconds,
      });
    }

    if (event === SongInfoEvent.TimeChanged) {
      send(DataTypes.PositionChanged, { position: songInfo.elapsedSeconds });
    }
  });

  ipc.on('peard:volume-changed', (volumeState: VolumeState) => {
    send(DataTypes.VolumeChanged, {
      volume: volumeState.state,
      muted: volumeState.isMuted,
    });
  });

  ipc.on('peard:repeat-changed', (repeat: RepeatMode) => {
    send(DataTypes.RepeatChanged, { repeat });
  });

  ipc.on('peard:seeked', (t: number) => {
    send(DataTypes.PositionChanged, { position: t });
  });

  ipc.on('peard:shuffle-changed', (shuffle: boolean) => {
    send(DataTypes.ShuffleChanged, { shuffle });
  });

  ipc.on('peard:like-changed', (likeStatus: LikeType) => {
    send(DataTypes.LikeChanged, { likeStatus });
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: `/api/${API_VERSION}/ws`,
      summary: 'websocket endpoint',
      description: 'WebSocket endpoint for real-time updates',
      request: {
        query: z.object({
          token: z
            .string()
            .openapi({
              description:
                'Authentication token. Required when the API server authStrategy is not NONE; optional otherwise.',
            })
            .optional(),
        }),
      },
      responses: {
        101: {
          description: 'Switching Protocols',
        },
      },
    }),
    uws((ctx) => ({
      async onOpen(_, ws) {
        const config = await getConfig();
        const token = ctx.req.query('token');

        // Read even without auth: the client id decides whether to offer the restart.
        let clientId: string | undefined;
        if (token) {
          try {
            const payload = await verify(token, config.secret, 'HS256');
            const parsedPayload =
              await JWTPayloadSchema.safeParseAsync(payload);
            if (parsedPayload.success) clientId = parsedPayload.data.id;
          } catch (err) {
            console.error(
              LoggerPrefix,
              'WebSocket authentication failed:',
              err,
            );
          }
        }

        if (
          config.authStrategy !== AuthStrategy.NONE &&
          (!clientId || !config.authorizedClients.includes(clientId))
        ) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        sockets.add(ws);
        if (clientId && TRAY_REPLACING_CLIENTS.includes(clientId)) {
          offerRestartForMiniPlayer().catch((err: unknown) => {
            console.error(LoggerPrefix, 'Could not offer the restart:', err);
          });
        }

        ws.send(
          JSON.stringify({
            type: DataTypes.PlayerInfo,
            ...createPlayerState({
              songInfo: state.songInfo(),
              volumeState: state.volumeState(),
              repeat: state.repeatMode() ?? 'NONE',
              shuffle: state.shuffle() ?? false,
            }),
          }),
        );
      },

      onClose(_, ws) {
        sockets.delete(ws);
      },
    })) as (ctx: Context, next: Next) => Promise<Response>,
  );
};
