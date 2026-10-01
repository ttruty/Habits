import { afterEach, describe, expect, it } from 'vitest';
import './habit-scorecard';

describe('<habit-scorecard>', () => {
  afterEach(() => document.body.replaceChildren());

  it('registers and renders', async () => {
    const card = document.createElement('habit-scorecard');
    document.body.append(card);
    await card.updateComplete;
    expect(card.shadowRoot?.querySelector('h1')?.textContent).toBe('Habits');
  });

  it('defaults to the auto theme and reflects it', async () => {
    const card = document.createElement('habit-scorecard');
    document.body.append(card);
    await card.updateComplete;
    expect(card.getAttribute('theme')).toBe('auto');
  });
});
