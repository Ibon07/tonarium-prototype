import { create } from 'zustand';
import { CHANGELOG } from '../../../shared/changelog.ts';

const SEEN_KEY = 'tonarium.changelog.seen';

export function loadChangelogSeen(): string {
  try { return localStorage.getItem(SEEN_KEY) ?? ''; } catch { return ''; }
}

export const useChangelog = create(() => ({ seen: loadChangelogSeen() }));

export function markChangelogSeen() {
  const latest = CHANGELOG[0]?.date;
  if (!latest) return;
  try { localStorage.setItem(SEEN_KEY, latest); } catch { /* 保存できない環境では今回だけ既読にする */ }
  useChangelog.setState({ seen: latest });
}
