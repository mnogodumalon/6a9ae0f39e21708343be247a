import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'vorname',
    'nachname',
    'email',
    'telefon',
    'website',
    { row: ['plz', 'ort'], cols: '1fr 2fr' },
    'newsletter',
    'anmerkungen',
  ],
  defaults: {
    newsletter: { kind: 'literal', value: true },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
