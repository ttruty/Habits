import type { ConnectorKind } from '../model';
import { deckfit } from './deckfit';
import { manual } from './manual';
import { minddrive } from './minddrive';
import { strava } from './strava';
import type { Connector } from './types';
import { webhook } from './webhook';
import { withings } from './withings';
import { yarnbeard } from './yarnbeard';

/** Every client-side connector. Adding a source = one connector file + one line here. */
export const connectors: readonly Connector[] = [
  manual,
  deckfit,
  minddrive,
  yarnbeard,
  strava,
  withings,
  webhook,
];

export function connectorFor(kind: ConnectorKind): Connector | undefined {
  return connectors.find((c) => c.kind === kind);
}
