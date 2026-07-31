import { describe, expect, it } from 'vitest';

import { LANGUAGES } from '../../../shared/src/index';
import { dict } from '../i18n/translations';

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

describe('translations', () => {
  it('keeps every language key and placeholder-compatible with English', () => {
    const englishKeys = Object.keys(dict.en).sort();
    const english = dict.en as Record<string, string>;
    for (const language of LANGUAGES) {
      const table = dict[language] as Record<string, string>;
      expect(Object.keys(table).sort(), `${language} keys`).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(placeholders(table[key]), `${language}.${key} placeholders`).toEqual(
          placeholders(english[key]),
        );
      }
    }
  });
});
