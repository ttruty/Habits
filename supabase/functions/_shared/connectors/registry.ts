import { deckfit } from './deckfit.ts';
import { minddrive } from './minddrive.ts';
import { strava } from './strava.ts';
import type { ServerConnector } from './types.ts';
import { withings } from './withings.ts';
import { yarnbeard } from './yarnbeard.ts';

/** Every server-side connector. One file + one line here per source. */
export const serverConnectors: readonly ServerConnector[] = [
  deckfit,
  minddrive,
  yarnbeard,
  strava,
  withings,
];

export function serverConnectorFor(kind: string): ServerConnector | undefined {
  return serverConnectors.find((c) => c.kind === kind);
}
