import type { Group } from '../../../shared/protocol.ts';

export function GroupAvatar({ group: g, size = '', className = '' }: { group: Group; size?: 'big' | 'tiny' | ''; className?: string }) {
  return (
    <span className={`gmark ${size} ${className}`} style={{ background: g.color }}>
      {g.imageVersion ? <img src={`/group-image/${encodeURIComponent(g.id)}?v=${g.imageVersion}`} alt="" /> : g.name.slice(0, 1)}
    </span>
  );
}
