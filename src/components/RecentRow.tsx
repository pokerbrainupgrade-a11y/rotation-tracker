import { SessionChip } from './SessionChip';
import type { ScheduledSession } from '../types';

interface RecentRowProps {
  session: ScheduledSession;
  name: string;
}

export function RecentRow({ session, name }: RecentRowProps) {
  return (
    <div class="recent-row">
      <span class="recent-row__date num">{session.localDate.slice(5)}</span>
      <SessionChip position={session.position} />
      <span class="recent-row__name">{name}</span>
      {session.compressionLevel < 100 && (
        <span class="badge badge--compression num">{session.compressionLevel}%</span>
      )}
      {session.substituted && <span class="badge badge--sub">SUB</span>}
    </div>
  );
}
