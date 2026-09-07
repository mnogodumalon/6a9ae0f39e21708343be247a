import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'bezeichnung',
    'kategorie',
    'preis_pro_nacht',
    'etage',
    'balkon',
  ],
  defaults: {},
  computed: {},
  numberFields: {},
};

export const computedDeps: Record<string, string[]> = {};
export const computedApplookupRefs: Record<string, { lookupKey: string }[]> = {};
