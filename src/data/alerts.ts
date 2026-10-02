import { connectorFor } from '../connectors/registry';
import type { Source } from '../model';
import type { IngestToken } from './provider';

/** A source quiet for longer than this gets a warning. */
export const STALE_DAYS = 7;

export interface SourceAlert {
  sourceId: string;
  kind: 'stale' | 'reconnect';
  message: string;
}

const DAY_MS = 86_400_000;

/**
 * What's wrong with the sources, in plain words: an app that has stopped reporting, or an OAuth
 * source whose access was revoked or expired. Disconnected apps aren't alerts: that was a choice.
 */
export function sourceAlerts(
  sources: readonly Source[],
  tokens: readonly IngestToken[],
  now: Date,
): SourceAlert[] {
  const out: SourceAlert[] = [];
  for (const s of sources) {
    const mode = connectorFor(s.kind)?.mode;
    if (mode === 'oauth' && (s.config as { problem?: string }).problem === 'reconnect') {
      out.push({ sourceId: s.id, kind: 'reconnect', message: `${s.label} needs reconnecting.` });
      continue;
    }
    if (mode !== 'push') continue;
    const mine = tokens.filter((t) => t.sourceId === s.id);
    const live = mine.find((t) => !t.revokedAt);
    if (!live) continue;
    const last = mine
      .map((t) => t.lastUsedAt)
      .filter((t): t is string => !!t)
      .sort()
      .at(-1);
    const since = Date.parse(last ?? live.createdAt);
    const days = Math.floor((now.getTime() - since) / DAY_MS);
    if (days < STALE_DAYS) continue;
    out.push({
      sourceId: s.id,
      kind: 'stale',
      message: last
        ? `${s.label} last reported ${days} days ago.`
        : `${s.label} hasn't reported since it was connected ${days} days ago.`,
    });
  }
  return out;
}
