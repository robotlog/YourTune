import { expect, test } from '@playwright/test';

import { showToast } from '../src/plugins/utils/renderer/toast';

const action = (message: string) => ({
  addToToastAction: {
    item: {
      notificationTextRenderer: {
        successResponseText: { simpleText: message },
      },
    },
  },
});

test('uses new handleAddToToastAction with exact text payload, bound to app', () => {
  const calls: unknown[] = [];
  const app = {
    id: 'app',
    handleAddToToastAction(this: { id: string }, a: unknown) {
      calls.push([this.id, a]);
    },
  };
  showToast(app, 'hello');
  expect(calls).toEqual([['app', action('hello')]]);
});

test('falls back to legacy toastService.show, bound to service', () => {
  const calls: unknown[] = [];
  const toastService = {
    id: 'svc',
    show(this: { id: string }, m: string) {
      calls.push([this.id, m]);
    },
  };
  showToast({ toastService }, 'hi');
  expect(calls).toEqual([['svc', 'hi']]);
});

test('prefers new API and never calls legacy when both exist', () => {
  const calls: string[] = [];
  showToast(
    {
      handleAddToToastAction: () => {
        calls.push('new');
      },
      toastService: {
        show: () => {
          calls.push('old');
        },
      },
    },
    'x',
  );
  expect(calls).toEqual(['new']);
});

test('does not crash when neither API exists', () => {
  expect(() => showToast({}, 'x')).not.toThrow();
  expect(() => showToast(null, 'x')).not.toThrow();
  expect(() => showToast({ toastService: {} }, 'x')).not.toThrow();
});
