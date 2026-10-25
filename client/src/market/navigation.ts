import { useEffect } from 'react';
import { get, set, useStore } from '../store.ts';
import { marketProductFromUrl, marketProductUrl } from '../../../shared/market-links.ts';

export function openMarketProduct(id: string | null, updateUrl = true) {
  if (updateUrl) {
    const url = new URL(location.href);
    url.hash = id ? `/market/${encodeURIComponent(id)}` : '';
    history.pushState(null, '', url);
  }
  set({ homePage: 'market', marketProductId: id, hubOpen: !!get().session });
}
export function openMarketLink(url: string) {
  const id = marketProductFromUrl(url, location.origin);
  if (!id) return false;
  openMarketProduct(id);
  return true;
}
export const shareProductUrl = (id: string) => marketProductUrl(id, location.origin);

export function useMarketNavigation() {
  const joined = useStore((s) => s.joined);
  useEffect(() => {
    const read = () => {
      const id = marketProductFromUrl(location.href, location.origin);
      if (id) openMarketProduct(id, false);
      else if (get().homePage === 'market') set({ marketProductId: null });
    };
    read();
    window.addEventListener('hashchange', read);
    window.addEventListener('popstate', read);
    return () => { window.removeEventListener('hashchange', read); window.removeEventListener('popstate', read); };
  }, [joined]);
}
