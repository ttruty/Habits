import { describe, expect, it } from 'vitest';
import type { Source } from '../model';
import { sourceAlerts } from './alerts';
import type { IngestToken } from './provider';

const now = new Date('2026-10-02T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const src = (id: string, kind: Source['kind'], config: Record<string, unknown> = {}): Source => ({
  id,
  kind,
  label: id,
  config,
  createdAt: daysAgo(30),
});
const token = (sourceId: string, over: Partial<IngestToken> = {}): IngestToken => ({
  id: `t-${sourceId}`,
  sourceId,
  createdAt: daysAgo(30),
  ...over,
});

describe('sourceAlerts', () => {
  it('warns about apps quiet for a week or more', () => {
    expect(
      sourceAlerts(
        [src('DeckFit', 'deckfit'), src('MindDrive', 'minddrive')],
        [
          token('DeckFit', { lastUsedAt: daysAgo(9) }),
          token('MindDrive', { lastUsedAt: daysAgo(6) }),
        ],
        now,
      ),
    ).toEqual([
      { sourceId: 'DeckFit', kind: 'stale', message: 'DeckFit last reported 9 days ago.' },
    ]);
  });

  it('warns about an app that never reported, counting from its token', () => {
    expect(sourceAlerts([src('Yarnbeard', 'yarnbeard')], [token('Yarnbeard')], now)).toEqual([
      {
        sourceId: 'Yarnbeard',
        kind: 'stale',
        message: "Yarnbeard hasn't reported since it was connected 30 days ago.",
      },
    ]);
    expect(
      sourceAlerts([src('Y', 'yarnbeard')], [token('Y', { createdAt: daysAgo(1) })], now),
    ).toEqual([]);
  });

  it('uses the latest report across old and new tokens', () => {
    const tokens = [
      token('D', { id: 'old', revokedAt: daysAgo(3), lastUsedAt: daysAgo(2) }),
      token('D', { id: 'new', createdAt: daysAgo(3) }),
    ];
    expect(sourceAlerts([src('D', 'deckfit')], tokens, now)).toEqual([]);
  });

  it('says nothing about disconnected apps, hand ticking, or healthy OAuth sources', () => {
    expect(
      sourceAlerts(
        [src('D', 'deckfit'), src('M', 'manual'), src('S', 'strava', { connected: true })],
        [token('D', { revokedAt: daysAgo(20) })],
        now,
      ),
    ).toEqual([]);
  });

  it('flags an OAuth source that needs reconnecting', () => {
    expect(
      sourceAlerts([src('Strava', 'strava', { connected: false, problem: 'reconnect' })], [], now),
    ).toEqual([{ sourceId: 'Strava', kind: 'reconnect', message: 'Strava needs reconnecting.' }]);
  });
});
