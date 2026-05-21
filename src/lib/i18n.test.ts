import { describe, expect, it } from 'vitest';
import { translations } from './i18n';

describe('translations', () => {
  it('keeps every language pack complete', () => {
    const baseKeys = Object.keys(translations.ceb);

    for (const [language, dictionary] of Object.entries(translations)) {
      expect(Object.keys(dictionary).sort(), language).toEqual([...baseKeys].sort());
    }
  });
});
