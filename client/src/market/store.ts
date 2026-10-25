import { create } from 'zustand';
import { useMemo } from 'react';
import { useStore } from '../store.ts';
import { cleanPurchases, MARKET_PRODUCTS } from '../../../shared/market.ts';

const key = (user: string) => `tonarium.market.v1.${user}`;
const usePurchases = create<{ byUser: Record<string, string[]> }>(() => ({ byUser: {} }));
function read(user: string) {
  try { return cleanPurchases(JSON.parse(localStorage.getItem(key(user)) ?? '[]')); } catch { return []; }
}
export function useOwnedContent() {
  const user = useStore((s) => s.selfId);
  const saved = useMemo(() => user ? read(user) : [], [user]);
  return usePurchases((s) => s.byUser[user] ?? saved);
}
export function purchaseProduct(id: string): 'purchased' | 'owned' | 'invalid' {
  const user = useStore.getState().selfId;
  if (!user || !MARKET_PRODUCTS.some((p) => p.id === id)) return 'invalid';
  const owned = usePurchases.getState().byUser[user] ?? read(user);
  if (owned.includes(id)) return 'owned';
  const next = [...owned, id];
  try { localStorage.setItem(key(user), JSON.stringify(next)); } catch { /* Available for this visit even without browser storage. */ }
  usePurchases.setState((s) => ({ byUser: { ...s.byUser, [user]: next } }));
  return 'purchased';
}
