import { expect, test } from '@playwright/test';
import { Window } from 'happy-dom';

import { showToast } from '../src/plugins/utils/renderer/toast';
import {
  BUTTON_ID,
  createQuickAdd,
} from '../src/plugins/quick-add-to-playlist/quick-add';

// Fixture-based: the popup structure, the attribution field and the item data
// shape imitate what the app code expects, they were not checked against the
// real YouTube Music DOM.

type Hooks = {
  hasSaveItem?: boolean;
  // Runs when the menu trigger is clicked, before the popup is built.
  onTrigger?: (f: Fixture) => void;
  // Builds the popup for the trigger; defaults to a correct attributed one.
  attributed?: boolean;
};
type Fixture = ReturnType<typeof setup>;

const setup = (ui: 'legacy' | 'new' = 'legacy', hooks: Hooks = {}) => {
  const window = new Window();
  const document = window.document as unknown as Document;
  const state = {
    videoId: 'song-1',
    saved: [] as string[],
    toasts: [] as string[],
    triggers: 0,
  };
  document.body.innerHTML =
    ui === 'legacy'
      ? `<div id="movie_player"></div>
         <ytmusic-player-bar><div class="right-controls-buttons"></div>
           <ytmusic-menu-renderer id="owner"><button id="trigger"></button></ytmusic-menu-renderer>
         </ytmusic-player-bar>`
      : `<div id="movie_player"></div>
         <ytmusic-miniplayer>
           <segmented-like-dislike-button-view-model></segmented-like-dislike-button-view-model>
           <ytmusic-menu-renderer id="owner"><button id="trigger"></button></ytmusic-menu-renderer>
         </ytmusic-miniplayer>`;
  Object.assign(document.querySelector('#movie_player')!, {
    getVideoData: () => ({ video_id: state.videoId }),
  });

  const fixture = { window, document, state };
  const addPopup = (
    videoId: string,
    sink: Element | null,
    parent: Element = document.body,
  ) => {
    const popup = document.createElement('ytmusic-menu-popup-renderer');
    if (sink) {
      Object.assign(popup, {
        ytEventForwardingBehavior: { forwarder_: { eventSink: sink } },
      });
    }
    const box = document.createElement('tp-yt-paper-listbox');
    // Shape read by the repo's check.ts.
    const item = document.createElement('a');
    item.id = 'navigation-endpoint';
    Object.assign(item, { data: { addToPlaylistEndpoint: { videoId } } });
    item.addEventListener('click', () => state.saved.push(videoId));
    box.append(item);
    popup.append(box);
    parent.append(popup);
    return { popup, box, item };
  };
  document.querySelector('#trigger')!.addEventListener('click', () => {
    state.triggers++;
    hooks.onTrigger?.(fixture);
    if (hooks.hasSaveItem === false) return;
    addPopup(
      state.videoId,
      hooks.attributed === false ? null : document.querySelector('#owner'),
    );
  });
  return { ...fixture, addPopup };
};

const open: Fixture[] = [];
test.afterEach(() => {
  for (const f of open.splice(0)) f.window.happyDOM.close();
});

const make = (f: Fixture) => {
  open.push(f);
  const qa = createQuickAdd(f.document, {
    label: 'Save',
    unavailable: 'nope',
    notify: (m) => f.state.toasts.push(m),
    findTimeoutMs: 200,
  });
  qa.mount();
  return qa;
};

const press = (f: Fixture) =>
  f.document
    .getElementById(BUTTON_ID)!
    .dispatchEvent(new f.window.Event('click') as unknown as Event);
const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));
const click = async (f: Fixture) => {
  press(f);
  await settle();
};

for (const ui of ['legacy', 'new'] as const) {
  test(`${ui}: one accessible button opens the picker for the current song`, async () => {
    const f = setup(ui);
    const qa = make(f);
    const button = f.document.getElementById(BUTTON_ID)!;
    expect(button.getAttribute('aria-label')).toBe('Save');
    expect(f.state.saved).toEqual([]); // nothing automatic
    await click(f);
    expect(f.state.saved).toEqual(['song-1']);
    expect(f.state.toasts).toEqual([]);
    qa.unmount();
  });
}

test('rapid track change never opens the picker for the wrong song', async () => {
  const f = setup('legacy', {
    onTrigger: (x) => {
      x.state.videoId = 'song-2';
    },
  });
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
});

test('track change while waiting for the menu cancels the click', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  make(f);
  press(f);
  await settle(80);
  f.state.videoId = 'song-2';
  f.addPopup('song-1', f.document.querySelector('#owner'));
  await settle();
  expect(f.state.saved).toEqual([]);
});

test('signed out / missing save item: message, no save, menu left alone', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  make(f);
  const backdrop = f.document.createElement('tp-yt-iron-overlay-backdrop');
  let backdropClicks = 0;
  backdrop.addEventListener('click', () => backdropClicks++);
  f.document.body.append(backdrop);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
  expect(backdropClicks).toBe(0);
});

test('stale same-song queue menu is never used', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  // A visible queue-row menu for the same song already exists, attributed to
  // some other menu renderer.
  const other = f.document.createElement('ytmusic-menu-renderer');
  f.document.body.append(other);
  const stale = f.addPopup('song-1', other);
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
  expect(stale.item.isConnected).toBe(true);
});

test('unrelated overlay appearing after the click is not used', async () => {
  const f = setup('legacy', {
    hasSaveItem: false,
    onTrigger: (x) => {
      const other = x.document.createElement('ytmusic-menu-renderer');
      x.document.body.append(other);
      x.addPopup('song-1', other); // matches the song, wrong owner
    },
  });
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
});

test('unattributable popup fails closed', async () => {
  const f = setup('legacy', { attributed: false });
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
});

test('hidden popup is ignored', async () => {
  const f = setup('legacy', {
    hasSaveItem: false,
    onTrigger: (x) => {
      x.addPopup(
        'song-1',
        x.document.querySelector('#owner'),
      ).popup.setAttribute('aria-hidden', 'true');
    },
  });
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
});

test('ambiguous trigger: no click at all', async () => {
  const f = setup();
  f.document
    .querySelector('ytmusic-menu-renderer')!
    .insertAdjacentHTML('beforeend', '<button id="second"></button>');
  make(f);
  await click(f);
  expect(f.state.triggers).toBe(0);
  expect(f.state.toasts).toEqual(['nope']);
});

test('disabled trigger: no click', async () => {
  const f = setup();
  f.document.querySelector('#trigger')!.setAttribute('aria-disabled', 'true');
  make(f);
  await click(f);
  expect(f.state.triggers).toBe(0);
});

test('opt-out (unmount) while pending cancels the operation', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  const qa = make(f);
  press(f);
  await settle(80);
  qa.unmount();
  f.addPopup('song-1', f.document.querySelector('#owner'));
  await settle();
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual([]);
});

test('remount while pending cancels the old operation', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  const qa = make(f);
  press(f);
  await settle(80);
  qa.mount();
  f.addPopup('song-1', f.document.querySelector('#owner'));
  await settle();
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual([]);
  expect(f.state.triggers).toBe(1);
  expect(f.document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
});

test('preexisting visible attributed popup is ignored', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  const before = f.addPopup('song-1', f.document.querySelector('#owner'));
  make(f);
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(f.state.toasts).toEqual(['nope']);
  expect(before.item.isConnected).toBe(true);
});

test('the plugin button is not a menu trigger candidate', async () => {
  const f = setup();
  // Layout where the button's host sits inside the menu renderer.
  f.document
    .querySelector('#owner')!
    .append(f.document.querySelector('.right-controls-buttons')!);
  make(f);
  await click(f);
  expect(f.state.triggers).toBe(1);
  expect(f.state.saved).toEqual(['song-1']);
});

test('layout replacement while pending cancels and relocates the button', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  make(f);
  press(f);
  await settle(80);
  const old = f.document.querySelector('.right-controls-buttons')!;
  const fresh = f.document.createElement('div');
  fresh.className = 'right-controls-buttons';
  old.replaceWith(fresh);
  await settle(20);
  expect(fresh.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
  f.addPopup('song-1', f.document.querySelector('#owner'));
  await settle();
  expect(f.state.saved).toEqual([]);
});

test('switching legacy to new layout moves the single button', async () => {
  const f = setup('legacy');
  make(f);
  f.document.querySelector('ytmusic-player-bar')!.remove();
  f.document.body.insertAdjacentHTML(
    'beforeend',
    '<ytmusic-miniplayer><segmented-like-dislike-button-view-model></segmented-like-dislike-button-view-model></ytmusic-miniplayer>',
  );
  await settle(20);
  const all = f.document.querySelectorAll(`#${BUTTON_ID}`);
  expect(all.length).toBe(1);
  expect(all[0]!.previousElementSibling?.localName).toBe(
    'segmented-like-dislike-button-view-model',
  );
});

test('focus is restored only when it was dropped', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  make(f);
  const button = f.document.getElementById(BUTTON_ID) as HTMLElement;
  button.focus();
  await click(f);
  expect(f.document.activeElement).toBe(button);

  const g = setup('legacy', { hasSaveItem: false });
  make(g);
  const dialogInput = g.document.createElement('input');
  g.document.body.append(dialogInput);
  dialogInput.focus();
  await click(g);
  expect(g.document.activeElement).toBe(dialogInput);
});

test('repeated clicks while pending open one picker', async () => {
  const f = setup();
  make(f);
  press(f);
  press(f);
  await settle();
  expect(f.state.triggers).toBe(1);
  expect(f.state.saved).toEqual(['song-1']);
});

test('duplicate mount and re-render keep exactly one button', async () => {
  const f = setup();
  const qa = make(f);
  qa.mount();
  expect(f.document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
  f.document.getElementById(BUTTON_ID)!.remove();
  await settle(50);
  expect(f.document.querySelectorAll(`#${BUTTON_ID}`).length).toBe(1);
  qa.unmount();
});

test('teardown removes the button and stops re-adding it', async () => {
  const f = setup();
  const qa = make(f);
  qa.unmount();
  expect(f.document.getElementById(BUTTON_ID)).toBeNull();
  f.document
    .querySelector('.right-controls-buttons')!
    .append(f.document.createElement('i'));
  await settle(50);
  expect(f.document.getElementById(BUTTON_ID)).toBeNull();
});

test('failure toast goes through showToast on a build without toastService', async () => {
  const f = setup('legacy', { hasSaveItem: false });
  open.push(f);
  const actions: unknown[] = [];
  const app = { handleAddToToastAction: (a: unknown) => actions.push(a) };
  const qa = createQuickAdd(f.document, {
    label: 'Save',
    unavailable: 'nope',
    notify: (m) => showToast(app, m),
    findTimeoutMs: 200,
  });
  qa.mount();
  await click(f);
  expect(f.state.saved).toEqual([]);
  expect(actions).toEqual([
    {
      addToToastAction: {
        item: {
          notificationTextRenderer: {
            successResponseText: { simpleText: 'nope' },
          },
        },
      },
    },
  ]);
  qa.unmount();
});
