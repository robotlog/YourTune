// Adds a player-bar button that opens YouTube Music's own "Save to playlist"
// picker for the current song. Nothing is added or selected automatically:
// the button only drives the native player menu item, so it needs no private
// endpoint, API or storage, and works the same on the legacy player bar and
// the new miniplayer.

export const BUTTON_ID = 'quick-add-to-playlist-button';

const MENU_TRIGGER =
  'ytmusic-player-bar ytmusic-menu-renderer button, ytmusic-miniplayer ytmusic-menu-renderer button';
const LISTBOX = 'tp-yt-paper-listbox';
// Shape read by src/plugins/utils/renderer/check.ts.
const MENU_ITEMS = '#navigation-endpoint';

const ICON_PATH =
  'M14 10H3v2h11v-2zm0-4H3v2h11V6zM3 16h7v-2H3v2zm11-2v2h3v3h2v-3h3v-2h-3v-3h-2v3h-3z';

type EndpointHolder = {
  data?: { addToPlaylistEndpoint?: { videoId?: string } };
};

export type QuickAddOptions = {
  label: string;
  unavailable: string;
  // Called with a user-facing message when the picker cannot be opened.
  notify?: (message: string) => void;
  findTimeoutMs?: number;
};

const getVideoId = (root: ParentNode) =>
  root
    .querySelector<
      HTMLElement & { getVideoData?: () => { video_id?: string } }
    >('#movie_player')
    ?.getVideoData?.()?.video_id;

const saveEndpointVideoId = (item: Element) =>
  (item as EndpointHolder).data?.addToPlaylistEndpoint?.videoId;

const isVisible = (el: Element) => {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const style = (
      n as HTMLElement
    ).ownerDocument.defaultView?.getComputedStyle(n);
    if (
      (n as HTMLElement).hidden ||
      n.getAttribute('aria-hidden') === 'true' ||
      style?.display === 'none' ||
      style?.visibility === 'hidden'
    ) {
      return false;
    }
  }
  return true;
};

const isUsable = (el: Element) =>
  isVisible(el) &&
  !(el as HTMLButtonElement).disabled &&
  el.getAttribute('aria-disabled') !== 'true';

// Same attribution the other player-menu plugins use: the popup remembers the
// menu renderer that opened it. Unknown means unattributable.
const popupOwner = (box: Element) =>
  (
    box.parentElement as
      | (HTMLElement & {
          ytEventForwardingBehavior?: {
            forwarder_?: { eventSink?: Element };
          };
        })
      | null
  )?.ytEventForwardingBehavior?.forwarder_?.eventSink;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const createQuickAdd = (doc: Document, options: QuickAddOptions) => {
  const timeout = options.findTimeoutMs ?? 1500;
  // Identifies the live operation; mount/unmount/new clicks invalidate it.
  let op = 0;
  let pending = false;
  let observer: MutationObserver | undefined;

  const openPicker = async (id: number, button: HTMLElement) => {
    const owns = () =>
      id === op &&
      button.isConnected &&
      doc.getElementById(BUTTON_ID) === button;
    const fail = () => {
      if (!owns()) return;
      options.notify?.(options.unavailable);
      // Give focus back only if it was dropped, never from another dialog.
      const active = doc.activeElement;
      if (!active || active === doc.body) button.focus();
    };

    // Resolved at click time; a later track switch must not retarget it.
    const videoId = getVideoId(doc);
    const triggers = [
      ...doc.querySelectorAll<HTMLElement>(MENU_TRIGGER),
    ].filter((el) => isUsable(el) && !el.closest(`#${BUTTON_ID}`));
    // Ambiguous controls: no speculative click.
    if (!videoId || triggers.length !== 1) return fail();
    const trigger = triggers[0];
    const owner = trigger.closest('ytmusic-menu-renderer');
    if (!owner) return fail();

    const open = new Set([...doc.querySelectorAll(LISTBOX)].filter(isVisible));
    trigger.click();

    // A menu is left open on failure: only the user may dismiss it.
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && owns()) {
      if (getVideoId(doc) !== videoId) return fail();
      const boxes = [...doc.querySelectorAll(LISTBOX)].filter(
        (box) => !open.has(box) && isVisible(box) && popupOwner(box) === owner,
      );
      if (boxes.length > 1) return fail();
      const box = boxes[0];
      if (box) {
        const items = [...box.querySelectorAll(MENU_ITEMS)].filter(
          (el) => saveEndpointVideoId(el) === videoId && isUsable(el),
        );
        if (items.length > 1) return fail();
        const item = items[0] as HTMLElement | undefined;
        if (item) {
          item.click();
          return;
        }
      }
      await sleep(50);
    }
    fail();
  };

  const createButton = () => {
    const button = doc.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.title = options.label;
    button.setAttribute('aria-label', options.label);
    button.style.cssText =
      'background:none;border:0;color:inherit;cursor:pointer;width:40px;height:40px;padding:8px;display:inline-flex;align-items:center;justify-content:center;';
    button.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true"><path d="${ICON_PATH}"/></svg>`;
    button.addEventListener('click', () => {
      if (pending) return;
      pending = true;
      const id = ++op;
      openPicker(id, button)
        .catch(() => id === op && options.notify?.(options.unavailable))
        .finally(() => {
          if (id === op) pending = false;
        });
    });
    return button;
  };

  // Idempotent: at most one button, placed beside the active bar. Moves it
  // when the layout changes and removes it when no bar is left.
  const ensure = () => {
    const buttons = doc.querySelectorAll(`#${BUTTON_ID}`);
    for (const extra of [...buttons].slice(1)) extra.remove();

    const legacy = doc.querySelector('.right-controls-buttons');
    const like = doc.querySelector(
      'ytmusic-miniplayer segmented-like-dislike-button-view-model',
    );
    if (!legacy && !like) {
      buttons[0]?.remove();
      return;
    }
    const button = buttons[0] ?? createButton();
    if (legacy) {
      if (button.parentElement !== legacy) legacy.append(button);
    } else if (button.previousElementSibling !== like) {
      like!.after(button);
    }
  };

  return {
    mount() {
      this.unmount();
      ensure();
      // The bar is re-rendered on SPA changes and UI switches.
      // shortcut: watches the whole body (ensure is two lookups), narrow it if profiling shows cost.
      const Observer = doc.defaultView?.MutationObserver;
      if (Observer && doc.body) {
        observer = new Observer(ensure);
        observer.observe(doc.body, { childList: true, subtree: true });
      }
    },
    unmount() {
      op++; // cancels any pending picker operation
      pending = false;
      observer?.disconnect();
      observer = undefined;
      doc.getElementById(BUTTON_ID)?.remove();
    },
  };
};
