import type { DateKey, DateRange, Habit, HabitEvent, Source } from '../model';
import { addDays, eachDay, inRange, localDateKey } from '../scoring/dates';
import { ReadOnlyError, type DataProvider, type IngestToken, type NewEvent } from './provider';
import { newIngestToken } from './tokens';

// Fake data for the UI, the embed and tests: eight weeks up to today for five example habits.
// Each day's events come from a seed made of the date, so a given day looks the same on every
// load and the data never goes stale.
//
// Writes (habits, sources, check-ins) go to `storage` when one is given, so the demo app keeps
// your changes in this browser. Generated events can't be deleted.

const DAYS = 56;
const CREATED = '2026-01-01T00:00:00.000Z';

const sources: Source[] = [
  { id: 'demo-deckfit', kind: 'deckfit', label: 'DeckFit (phone)', config: {}, createdAt: CREATED },
  { id: 'demo-minddrive', kind: 'minddrive', label: 'MindDrive', config: {}, createdAt: CREATED },
  { id: 'demo-yarnbeard', kind: 'yarnbeard', label: 'Yarnbeard', config: {}, createdAt: CREATED },
  { id: 'demo-strava', kind: 'strava', label: 'Strava', config: {}, createdAt: CREATED },
  {
    id: 'demo-moon',
    kind: 'webhook',
    label: 'Moon+ Reader (MacroDroid)',
    config: {},
    createdAt: CREATED,
  },
];

function habits(today: DateKey): Habit[] {
  return [
    {
      id: 'demo-workout',
      name: 'Workout',
      icon: '🏋️',
      color: 'green',
      match: { sourceIds: ['demo-deckfit'], types: ['workout.completed'] },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 4 },
      sort: 0,
    },
    {
      id: 'demo-meditate',
      name: 'Meditate',
      icon: '🧘',
      color: 'purple',
      match: { sourceIds: ['demo-minddrive'], types: ['meditation.completed'] },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 7 },
      sort: 1,
    },
    {
      id: 'demo-listen',
      name: 'Listen 20m',
      icon: '🎧',
      color: 'blue',
      match: { sourceIds: ['demo-yarnbeard'], types: ['listening.day'] },
      rule: { aggregate: 'sum', atLeast: 1200 },
      target: { perWeek: 7 },
      sort: 2,
    },
    {
      id: 'demo-run',
      name: 'Run',
      icon: '🏃',
      color: 'orange',
      match: {
        sourceIds: ['demo-strava'],
        types: ['activity.created'],
        where: { sport_type: ['Run', 'TrailRun'] },
      },
      rule: { aggregate: 'count', atLeast: 1 },
      target: { perWeek: 3 },
      sort: 3,
    },
    {
      id: 'demo-read',
      name: 'Read',
      icon: '📖',
      color: 'teal',
      match: { sourceIds: ['demo-moon'], types: ['reading.session'] },
      rule: { aggregate: 'sum', atLeast: 600 },
      target: { perWeek: 7 },
      // Set up mid-week a few weeks ago, to show the habit-start handling.
      startDate: addDays(today, -17),
      sort: 4,
    },
  ];
}

/** mulberry32, seeded from a string. */
function random(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a, 31) + seed.charCodeAt(i)) | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Draft = Pick<HabitEvent, 'sourceId' | 'type' | 'value' | 'unit' | 'meta'> & { hour: number };

function draftsFor(day: DateKey): Draft[] {
  const out: Draft[] = [];
  const r = random(day);
  const hour = () => 6 + Math.floor(r() * 16);

  if (r() < 0.6)
    out.push({
      sourceId: 'demo-deckfit',
      type: 'workout.completed',
      value: 1,
      unit: 'count',
      hour: hour(),
    });
  if (r() < 0.75)
    out.push({
      sourceId: 'demo-minddrive',
      type: 'meditation.completed',
      value: 1,
      unit: 'count',
      hour: hour(),
    });
  if (r() < 0.85) {
    const seconds = 300 + Math.floor(r() * 3300);
    out.push({
      sourceId: 'demo-yarnbeard',
      type: 'listening.day',
      value: seconds,
      unit: 'seconds',
      hour: 21,
    });
  }
  if (r() < 0.4) {
    const sport = r() < 0.75 ? 'Run' : 'TrailRun';
    out.push({
      sourceId: 'demo-strava',
      type: 'activity.created',
      value: 4000 + Math.floor(r() * 6000),
      unit: 'meters',
      meta: { sport_type: sport },
      hour: hour(),
    });
  } else if (r() < 0.2) {
    // Rides don't count towards "Run".
    out.push({
      sourceId: 'demo-strava',
      type: 'activity.created',
      value: 20000,
      unit: 'meters',
      meta: { sport_type: 'Ride' },
      hour: hour(),
    });
  }
  for (let s = 0; s < 2; s++) {
    if (r() < 0.55) {
      out.push({
        sourceId: 'demo-moon',
        type: 'reading.session',
        value: 180 + Math.floor(r() * 1500),
        unit: 'seconds',
        hour: hour(),
      });
    }
  }
  return out;
}

function eventsFor(day: DateKey, now: Date): HabitEvent[] {
  const [y, m, d] = day.split('-').map(Number);
  return draftsFor(day).flatMap(({ hour, ...draft }, i) => {
    const at = new Date(y, m - 1, d, hour);
    if (at > now) return []; // later today: hasn't happened yet
    const externalId = `${day}:${i}`;
    return [
      {
        ...draft,
        id: `${draft.sourceId}:${externalId}`,
        externalId,
        occurredAt: at.toISOString(),
        localDate: day,
      },
    ];
  });
}

export const DEMO_STORAGE_KEY = 'habits.demo.v1';

interface Saved {
  habits: Habit[];
  sources: Source[];
  events: HabitEvent[];
  tokens?: IngestToken[];
}

export interface DemoOptions {
  now?: () => Date;
  /** Where writes persist. None = in memory only. */
  storage?: Storage | null;
  readOnly?: boolean;
}

export function createDemoProvider({
  now = () => new Date(),
  storage = null,
  readOnly = false,
}: DemoOptions = {}): DataProvider {
  const today = () => localDateKey(now());
  let saved: Saved | undefined;

  function state(): Saved {
    if (!saved) {
      try {
        const raw = storage?.getItem(DEMO_STORAGE_KEY);
        if (raw) saved = JSON.parse(raw) as Saved;
      } catch {
        // Unreadable or blocked storage: start fresh.
      }
      saved ??= { habits: habits(today()), sources: [], events: [] };
    }
    return saved;
  }

  function write(change: (s: Saved) => void) {
    if (readOnly) throw new ReadOnlyError();
    change(state());
    try {
      storage?.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Full or blocked storage: keep the change for this page only.
    }
  }

  const revoke = (s: Saved, sourceId: string) => {
    for (const t of (s.tokens ??= [])) {
      if (t.sourceId === sourceId && !t.revokedAt) t.revokedAt = now().toISOString();
    }
  };

  return {
    canEdit: !readOnly,
    // Demo tokens are never sent anywhere; this URL only fills the connect screen.
    ingestUrl: 'https://demo.invalid/functions/v1/ingest',
    listSources: async () => [...sources, ...state().sources],
    listHabits: async () => structuredClone(state().habits),
    async listEvents(range: DateRange) {
      const t = today();
      const from = range.from > addDays(t, -(DAYS - 1)) ? range.from : addDays(t, -(DAYS - 1));
      const to = range.to < t ? range.to : t;
      const at = now();
      const generated = eachDay({ from, to }).flatMap((day) => eventsFor(day, at));
      return [...generated, ...state().events.filter((e) => inRange(e.localDate, range))];
    },
    async addSource(source) {
      const added: Source = { ...source, id: crypto.randomUUID(), createdAt: now().toISOString() };
      write((s) => s.sources.push(added));
      return added;
    },
    async saveHabit(habit) {
      write((s) => {
        const i = s.habits.findIndex((h) => h.id === habit.id);
        if (i >= 0) s.habits[i] = structuredClone(habit);
        else s.habits.push(structuredClone(habit));
      });
    },
    async saveHabitOrder(ids) {
      write((s) => {
        for (const h of s.habits) if (ids.includes(h.id)) h.sort = ids.indexOf(h.id);
      });
    },
    async putEvent(event: NewEvent) {
      write((s) => {
        const i = s.events.findIndex(
          (e) => e.sourceId === event.sourceId && e.externalId === event.externalId,
        );
        if (i >= 0) s.events[i] = { ...event, id: s.events[i].id };
        else s.events.push({ ...event, id: crypto.randomUUID() });
      });
    },
    async deleteEvent(id) {
      write((s) => {
        s.events = s.events.filter((e) => e.id !== id);
      });
    },
    listIngestTokens: async () => structuredClone(state().tokens ?? []),
    async issueIngestToken(sourceId) {
      const token = newIngestToken();
      write((s) => {
        revoke(s, sourceId);
        s.tokens!.push({ id: crypto.randomUUID(), sourceId, createdAt: now().toISOString() });
      });
      return token;
    },
    async revokeIngestTokens(sourceId) {
      write((s) => revoke(s, sourceId));
    },
  };
}
