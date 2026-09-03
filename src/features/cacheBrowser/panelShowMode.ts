/** Whether opening the cache browser should steal editor focus. */
export type CacheBrowserShowMode = 'open' | 'reload';

export function shouldRevealCacheBrowserPanel(mode: CacheBrowserShowMode): boolean {
  return mode === 'open';
}
