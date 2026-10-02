import { describe, expect, it } from 'vitest';
import { habit } from '../scoring/test-helpers';
import { normalizeColor, normalizeHabit, normalizeIcon } from './normalize';

describe('normalize', () => {
  it('maps old colour names onto the palette', () => {
    expect(normalizeColor('purple')).toBe('violet');
    expect(normalizeColor('red')).toBe('coral');
    expect(normalizeColor('teal')).toBe('green');
    expect(normalizeColor('amber')).toBe('amber');
    expect(normalizeColor('#ff0000')).toBe('blue');
  });

  it('maps emoji onto icon keys, unknown to a check square', () => {
    expect(normalizeIcon('🏋️')).toBe('dumbbell');
    expect(normalizeIcon('🎧')).toBe('listen');
    expect(normalizeIcon('🦵')).toBe('walk');
    expect(normalizeIcon('book')).toBe('book');
    expect(normalizeIcon('🦄')).toBe('check-square');
    expect(normalizeIcon('')).toBe('check-square');
  });

  it('returns the same habit when nothing changes', () => {
    const h = habit({ color: 'green', icon: 'dumbbell' });
    expect(normalizeHabit(h)).toBe(h);
    expect(normalizeHabit({ ...h, color: 'teal' as never, icon: '📖' })).toMatchObject({
      color: 'green',
      icon: 'book',
    });
  });
});
