import { deckfit } from './deckfit.ts';
import { minddrive } from './minddrive.ts';
import type { ServerConnector } from './types.ts';
import { yarnbeard } from './yarnbeard.ts';

/** Every connector that can hold an ingest token. One file + one line here per source. */
export const serverConnectors: readonly ServerConnector[] = [deckfit, minddrive, yarnbeard];

export function serverConnectorFor(kind: string): ServerConnector | undefined {
  return serverConnectors.find((c) => c.kind === kind);
}
