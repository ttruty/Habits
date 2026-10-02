import { expect, it } from 'vitest';
import tokens from '../../design/tokens.css?inline';
import { scopeTokens } from './tokens';

it('scopes the design tokens to <habit-scorecard own-tokens>, theme by attribute', () => {
  const css = scopeTokens(tokens);
  expect(css).not.toMatch(/:root|html\s*\{|body\s*\{|@import|data-theme/);
  expect(css).toContain(':host([own-tokens]) {');
  expect(css).toContain(':host([own-tokens][theme="dark"])');
  expect(css).toContain(':host([own-tokens]:not([theme="light"]):not([theme="dark"]))');
  // Every selector is a single :host(…) group: anything after it would be invalid CSS and dropped.
  const selectors = css.split('\n').filter((l) => l.trim().startsWith(':host'));
  expect(selectors.length).toBeGreaterThan(3);
  for (const line of selectors) expect(line.trim()).toMatch(/^:host\(.*\) \{/);
  // Every colour token survives.
  for (const t of [
    '--color-bg',
    '--color-ink-3',
    '--habit-amber-on',
    '--radius-lg',
    '--text-body',
  ]) {
    expect(css).toContain(t);
  }
});

it('handles the minified form the production build produces', () => {
  const minified =
    ':root,:root[data-theme=light]{--color-bg:#fff}:root[data-theme=dark]{--color-bg:#000}' +
    '@media (prefers-color-scheme:dark){:root:not([data-theme]){--color-bg:#000}}html{background:red}';
  expect(scopeTokens(minified)).toBe(
    ':host([own-tokens]){--color-bg:#fff}:host([own-tokens][theme="dark"]){--color-bg:#000}' +
      '@media (prefers-color-scheme:dark){:host([own-tokens]:not([theme="light"]):not([theme="dark"])){--color-bg:#000}}',
  );
});
