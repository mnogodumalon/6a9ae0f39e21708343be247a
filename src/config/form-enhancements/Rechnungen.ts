import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: ['buchung', 'betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus', 'zahlungseingang'],
  defaults: {
    'rechnungsdatum': { kind: 'today' },
    'faellig_am': { kind: 'todayOffset', days: 14 },
    'zahlungsstatus': { kind: 'lookup', key: 'offen', label: 'Offen' },
  },
  computed: {},
};

export const computedDeps: Record<string, string[]> = {};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
