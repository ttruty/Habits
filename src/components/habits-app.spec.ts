import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import { linkErrorFromUrl, type Auth } from '../data/auth';
import './habits-app';
import type { HabitsApp } from './habits-app';

const today = '2026-10-01';

function fakeAuth(initial: string | null): Auth & { set(email: string | null): void } {
  let listener: (email: string | null) => void = () => {};
  return {
    onChange(l) {
      listener = l;
      l(initial);
      return () => {};
    },
    sendLink: vi.fn(async () => {}),
    signOut: vi.fn(async () => listener(null)),
    set: (email) => listener(email),
  };
}

async function mount(props: Partial<HabitsApp>) {
  const app = document.createElement('habits-app');
  Object.assign(app, { today, ...props });
  document.body.append(app);
  await settle(app);
  return app;
}

async function settle(app: HabitsApp) {
  for (let i = 0; i < 5; i++) {
    await app.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = (app: HabitsApp, sel: string) => app.shadowRoot!.querySelector(sel);
const tab = (app: HabitsApp, name: string) =>
  [...app.shadowRoot!.querySelectorAll('.tab-bar button')].find(
    (b) => b.getAttribute('aria-label') === name,
  ) as HTMLButtonElement;

describe('<habits-app>', () => {
  afterEach(() => document.body.replaceChildren());

  it('opens on Today with the floating tab bar', async () => {
    const app = await mount({ provider: createDemoProvider() });
    expect($(app, 'today-page')).not.toBeNull();
    const labels = [...app.shadowRoot!.querySelectorAll('.tab-bar button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Today', 'Progress', 'New habit', 'Sources', 'More']);
    expect(tab(app, 'Today').getAttribute('aria-current')).toBe('page');
    expect(document.title).toBe('Habits');
  });

  it('goes between tabs, naming each page', async () => {
    const app = await mount({ provider: createDemoProvider() });
    for (const [name, tag] of [
      ['Progress', 'progress-page'],
      ['Sources', 'source-list'],
      ['More', 'more-page'],
    ]) {
      tab(app, name).click();
      await settle(app);
      expect($(app, tag), name).not.toBeNull();
      expect(tab(app, name).getAttribute('aria-current')).toBe('page');
      expect(document.title).toBe(`${name} · Habits`);
    }
  });

  it('opens the form from + and hides the tab bar there', async () => {
    const app = await mount({ provider: createDemoProvider() });
    tab(app, 'New habit').click();
    await settle(app);
    expect($(app, 'habit-form')).not.toBeNull();
    expect($(app, '.tab-bar')).toBeNull();
  });

  it('follows navigation from pages, and reloads after changes', async () => {
    const p = createDemoProvider();
    const listHabits = vi.spyOn(p, 'listHabits');
    const app = await mount({ provider: p });
    const page = $(app, 'today-page')!;
    page.dispatchEvent(
      new CustomEvent('navigate', { detail: { name: 'grid' }, bubbles: true, composed: true }),
    );
    await settle(app);
    expect($(app, 'habit-scorecard')).not.toBeNull();
    expect(tab(app, 'Today').getAttribute('aria-current')).toBe('page');
    const before = listHabits.mock.calls.length;
    $(app, 'habit-scorecard')!.dispatchEvent(
      new Event('changed', { bubbles: true, composed: true }),
    );
    await settle(app);
    expect(listHabits.mock.calls.length).toBe(before + 1);
  });

  it('shows a toast with Undo, which runs and reloads', async () => {
    const app = await mount({ provider: createDemoProvider() });
    const undo = vi.fn(async () => {});
    $(app, 'today-page')!.dispatchEvent(
      new CustomEvent('toast', {
        detail: { message: 'Read: done', undo },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(app);
    const toast = $(app, '.toast')!;
    expect(toast.textContent).toContain('Read: done');
    (toast.querySelector('button') as HTMLButtonElement).click();
    await settle(app);
    expect(undo).toHaveBeenCalled();
    expect($(app, '.toast')).toBeNull();
  });

  it('asks a signed-out owner to sign in, with any link error', async () => {
    const app = await mount({
      provider: createDemoProvider(),
      auth: fakeAuth(null),
      linkError: 'That link has expired or was already used. Send a new one.',
    });
    const form = $(app, 'sign-in-form')!;
    expect(form).not.toBeNull();
    expect($(app, '.tab-bar')).toBeNull();
    expect(form.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain('expired');
  });

  it('shows the app once signed in', async () => {
    const auth = fakeAuth(null);
    const app = await mount({ provider: createDemoProvider(), auth });
    auth.set('me@example.com');
    await settle(app);
    expect($(app, 'today-page')).not.toBeNull();
  });

  it('waits for the session before showing anything', async () => {
    const auth: Auth = {
      onChange: () => () => {},
      sendLink: async () => {},
      signOut: async () => {},
    };
    const app = await mount({ provider: createDemoProvider(), auth });
    expect($(app, '[role=status]')?.textContent).toBe('Loading…');
  });

  it('says when loading fails', async () => {
    const p = createDemoProvider();
    p.listHabits = async () => {
      throw new Error('offline');
    };
    const app = await mount({ provider: p });
    expect($(app, '[role=alert]')?.textContent).toBe("Couldn't load your habits.");
  });

  it('passes source alerts to Today', async () => {
    const p = createDemoProvider();
    const list = p.listSources;
    p.listSources = async () => [
      ...(await list()),
      {
        id: 'st',
        kind: 'strava',
        label: 'Strava',
        config: { problem: 'reconnect' },
        createdAt: 'T',
      },
    ];
    const app = await mount({ provider: p });
    const today = $(app, 'today-page') as HTMLElement & { alerts: { message: string }[] };
    expect(today.alerts.map((a) => a.message)).toEqual(['Strava needs reconnecting.']);
  });
});

describe('returning from an OAuth provider', () => {
  afterEach(() => {
    document.body.replaceChildren();
    history.replaceState(null, '', '/');
  });

  it('opens Sources with the outcome, once, and tidies the address bar', async () => {
    history.replaceState(null, '', '/?keep=1&oauth=strava:denied#x');
    const app = await mount({ provider: createDemoProvider() });
    expect(location.search).toBe('?keep=1');
    expect(location.hash).toBe('#x');
    const list = $(app, 'source-list') as HTMLElement & { updateComplete: Promise<void> };
    await list.updateComplete;
    await settle(app);
    expect(list.shadowRoot!.querySelector('.message')?.textContent).toBe(
      "Strava wasn't connected.",
    );

    tab(app, 'Today').click();
    await settle(app);
    tab(app, 'Sources').click();
    await settle(app);
    const again = $(app, 'source-list') as HTMLElement & { updateComplete: Promise<void> };
    await again.updateComplete;
    await settle(app);
    expect(again.shadowRoot!.querySelector('.message')?.textContent).toBe('');
  });
});

describe('<sign-in-form>', () => {
  afterEach(() => document.body.replaceChildren());

  async function form(auth: Auth) {
    const app = await mount({ provider: createDemoProvider(), auth });
    const el = $(app, 'sign-in-form')!;
    const root = el.shadowRoot!;
    (root.querySelector('#email') as HTMLInputElement).value = 'me@example.com';
    (root.querySelector('form') as HTMLFormElement).requestSubmit();
    await settle(app);
    await (el as unknown as { updateComplete: Promise<void> }).updateComplete;
    return root;
  }

  it('sends a link and says to check email', async () => {
    const auth = fakeAuth(null);
    const root = await form(auth);
    expect(auth.sendLink).toHaveBeenCalledWith('me@example.com');
    expect(root.querySelector('[role=status]')?.textContent).toBe(
      'Check your email for a sign-in link.',
    );
  });

  it('says when the link could not be sent', async () => {
    const auth = fakeAuth(null);
    auth.sendLink = async () => {
      throw new Error('Signups not allowed for otp');
    };
    const root = await form(auth);
    expect(root.querySelector('#failed')?.textContent).toContain("Couldn't send a link");
    expect(root.querySelector('#email')?.getAttribute('aria-invalid')).toBe('true');
  });
});
describe('linkErrorFromUrl', () => {
  it('turns redirect errors into plain words', () => {
    expect(linkErrorFromUrl('')).toBe('');
    expect(linkErrorFromUrl('#access_token=x')).toBe('');
    expect(linkErrorFromUrl('#error=access_denied&error_code=otp_expired')).toContain('expired');
    expect(linkErrorFromUrl('#error=server_error')).toBe("That link didn't work. Send a new one.");
  });
});
