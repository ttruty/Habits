import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoProvider } from '../data/demo-provider';
import { linkErrorFromUrl, type Auth } from '../data/auth';
import './habits-app';
import type { HabitsApp } from './habits-app';

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
  Object.assign(app, props);
  document.body.append(app);
  await settle(app);
  return app;
}

async function settle(app: HabitsApp) {
  for (let i = 0; i < 3; i++) {
    await app.updateComplete;
    await new Promise((r) => setTimeout(r));
  }
}

const $ = (app: HabitsApp, sel: string) => app.shadowRoot!.querySelector(sel);
const navButton = (app: HabitsApp, name: string) =>
  [...app.shadowRoot!.querySelectorAll('nav button')].find(
    (b) => b.textContent?.trim() === name,
  ) as HTMLButtonElement;

describe('<habits-app>', () => {
  afterEach(() => document.body.replaceChildren());

  it('runs on demo data with no sign-in', async () => {
    const app = await mount({ provider: createDemoProvider() });
    expect($(app, '.demo')?.textContent).toContain('Demo data');
    expect($(app, 'habit-scorecard')).not.toBeNull();
    expect(navButton(app, 'Sign out')).toBeUndefined();
  });

  it('switches pages', async () => {
    const app = await mount({ provider: createDemoProvider() });
    expect(navButton(app, 'Scorecard').getAttribute('aria-current')).toBe('page');
    navButton(app, 'Habits').click();
    await settle(app);
    expect($(app, 'habit-editor')).not.toBeNull();
    expect(navButton(app, 'Habits').getAttribute('aria-current')).toBe('page');
  });

  it('asks a signed-out owner to sign in, with any link error', async () => {
    const app = await mount({
      provider: createDemoProvider(),
      auth: fakeAuth(null),
      linkError: 'That link has expired or was already used. Send a new one.',
    });
    const form = $(app, 'sign-in-form')!;
    expect(form).not.toBeNull();
    expect($(app, 'nav')).toBeNull();
    expect($(app, '.demo')).toBeNull();
    expect(form.shadowRoot!.querySelector('[role=alert]')?.textContent).toContain('expired');
  });

  it('shows the scorecard once signed in, and signs out', async () => {
    const auth = fakeAuth(null);
    const app = await mount({ provider: createDemoProvider(), auth });
    auth.set('me@example.com');
    await settle(app);
    expect($(app, 'habit-scorecard')).not.toBeNull();
    navButton(app, 'Sign out').click();
    await settle(app);
    expect(auth.signOut).toHaveBeenCalled();
    expect($(app, 'sign-in-form')).not.toBeNull();
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

describe('returning from Strava', () => {
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
    await settle(app);
    await list.updateComplete;
    expect(list.shadowRoot!.querySelector('.message')?.textContent).toBe(
      "Strava wasn't connected.",
    );

    navButton(app, 'Scorecard').click();
    await settle(app);
    navButton(app, 'Sources').click();
    await settle(app);
    const again = $(app, 'source-list') as HTMLElement & { updateComplete: Promise<void> };
    await again.updateComplete;
    await settle(app);
    expect(again.shadowRoot!.querySelector('.message')?.textContent).toBe('');
  });
});
