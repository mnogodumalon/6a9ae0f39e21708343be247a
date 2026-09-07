import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: ['bezeichnung', 'kategorie', 'preis_pro_nacht', 'etage', 'balkon'],
  defaults: {
    'kategorie': { kind: 'lookup', key: 'einzelzimmer', label: 'Einzelzimmer' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
