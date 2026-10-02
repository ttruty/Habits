import { unsafeCSS } from 'lit';
import tokens from '../../design/tokens.css?inline';

/**
 * design/tokens.css is the source of truth. The app loads it globally (main.ts), so components
 * inherit the tokens through their shadow roots. On someone else's page, <habit-scorecard> has
 * no tokens around it: it then sets `own-tokens` on itself, and this scoped copy applies, with
 * its `theme` attribute in place of <html data-theme>.
 */
export function scopeTokens(css: string): string {
  // Every condition goes inside :host(…): `:host(x)[y]` or `:host(x):not(…)` isn't valid CSS.
  const own = ':host([own-tokens])';
  // Quotes are optional: the production build minifies `[data-theme="dark"]` to `[data-theme=dark]`.
  const q = `["']?`;
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // comments (incl. the optional Ionic bridge)
    .replace(/@import[^;]+;/g, '')
    .replace(/(?<=^|\})\s*(html|body)\s*\{[^}]*\}/g, '') // page base rules
    .replace(
      /:root:not\(\[data-theme\]\)/g,
      ':host([own-tokens]:not([theme="light"]):not([theme="dark"]))',
    )
    .replace(
      new RegExp(`:root\\[data-theme=${q}dark${q}\\]`, 'g'),
      ':host([own-tokens][theme="dark"])',
    )
    .replace(new RegExp(`:root,\\s*:root\\[data-theme=${q}light${q}\\]`, 'g'), own)
    .replace(new RegExp(`:root\\[data-theme=${q}light${q}\\]`, 'g'), own)
    .replace(/:root/g, own);
}

export const ownTokens = unsafeCSS(scopeTokens(tokens));
