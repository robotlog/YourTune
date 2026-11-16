/** The player's double-click handler, as a method of its Polymer controller. */
interface PlayerController {
  onDoubleClick?: (() => void) | undefined;
}

export interface PlayerElement extends HTMLElement {
  polymerController?: object;
  /** Older YTM builds kept the handler on the player element itself. */
  onDoubleClick_?: (() => void) | undefined;
}

/**
 * Stops the player's double-click from leaving full screen. On the new layout
 * the handler is the Polymer controller prototype's method (replacing the
 * element's own `onDoubleClick`, a proxy wrapper, does nothing); older builds
 * had it on the element as `onDoubleClick_`. Returns the undo.
 */
export function takeDoubleClick(player: PlayerElement | null | undefined) {
  if (!player) return;
  const prototype = player.polymerController
    ? (Object.getPrototypeOf(player.polymerController) as
        | (PlayerController & object)
        | null)
    : undefined;
  const onController = typeof prototype?.onDoubleClick === 'function';
  const target = (onController ? prototype : player) as PlayerElement &
    PlayerController;
  const key = onController ? 'onDoubleClick' : 'onDoubleClick_';
  const handler = target[key];
  if (typeof handler !== 'function') return;
  target[key] = () => {};
  return () => {
    target[key] = handler;
  };
}
