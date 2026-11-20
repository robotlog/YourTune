/**
 * Hides the userinfo (username and password) of a proxy url so it can be logged.
 * `http://user:pass@host:8080` becomes `http://***@host:8080`.
 * Works on strings that are not valid urls too, and never throws.
 */
export const redactProxyUrl = (proxy: string): string => {
  const at = proxy.lastIndexOf('@');
  if (at === -1) return proxy;

  const schemeEnd = proxy.indexOf('://');
  const start = schemeEnd !== -1 && schemeEnd < at ? schemeEnd + 3 : 0;
  return `${proxy.slice(0, start)}***${proxy.slice(at)}`;
};
