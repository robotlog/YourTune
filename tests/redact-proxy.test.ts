import { expect, test } from '@playwright/test';

import { redactProxyUrl } from '../src/utils/redact-proxy';

test('hides the credentials of a proxy url with a scheme', () => {
  expect(redactProxyUrl('http://user:pass@proxy.example:8080')).toBe(
    'http://***@proxy.example:8080',
  );
  expect(redactProxyUrl('socks5://user:pass@127.0.0.1:1080')).toBe(
    'socks5://***@127.0.0.1:1080',
  );
});

test('hides the credentials of a proxy without a scheme', () => {
  expect(redactProxyUrl('user:pass@proxy.example:8080')).toBe(
    '***@proxy.example:8080',
  );
});

test('hides passwords that contain @ or :', () => {
  expect(redactProxyUrl('http://user:p@ss:w@rd@proxy.example:8080')).toBe(
    'http://***@proxy.example:8080',
  );
  expect(redactProxyUrl('user:a:b@c@proxy.example:8080')).toBe(
    '***@proxy.example:8080',
  );
});

test('hides schemeless passwords that contain ://', () => {
  expect(redactProxyUrl('user:a://b@host:1080')).toBe('***@host:1080');
  expect(redactProxyUrl('://user:pass@host:1080')).toBe('***@host:1080');
  expect(redactProxyUrl('1http://user:pass@host:1080')).toBe('***@host:1080');
  expect(redactProxyUrl('http://user:a://b@host:1080')).toBe(
    'http://***@host:1080',
  );
});

test('leaves proxies without credentials unchanged', () => {
  for (const proxy of [
    '',
    'http://proxy.example:8080',
    'socks5://127.0.0.1:4545',
    'proxy.example:8080',
  ]) {
    expect(redactProxyUrl(proxy)).toBe(proxy);
  }
});

test('hides credentials of malformed values without throwing', () => {
  expect(redactProxyUrl('http//user:pass@host')).toBe('***@host');
  expect(redactProxyUrl('://user:pass@')).toBe('***@');
  expect(redactProxyUrl('user:pass@')).toBe('***@');
  expect(redactProxyUrl('not a url @ all')).toBe('***@ all');
});
