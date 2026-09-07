import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: [
    'gast',
    'zimmer',
    { row: ['anreise', 'abreise'] },
    'status',
    'personen',
    'begleitperson',
    'zusatzleistungen_buchung',
    'bemerkung',
  ],
  defaults: {
    'anreise': { kind: 'today', withTime: false },
    'abreise': { kind: 'todayOffset', days: 3, withTime: false },
    'personen': { kind: 'literal', value: 1 },
    'status': { kind: 'lookup', key: 'angefragt', label: 'Angefragt' },
  },
  computed: {
    '_buchung_dauer_nächte': { kind: 'dateDiff', from: 'anreise', to: 'abreise', unit: 'days' },
    '_buchung_gesamtkosten': (_fields, ctx) => {
      const tagespreis = ctx.applookup('zimmer', 'preis_pro_nacht') ?? 0;
      const nächte = ctx.dateDiff('anreise', 'abreise') ?? 0;
      const basispreis = tagespreis * nächte;
      const zusatzkosten = ctx.sumOver('zusatzleistungen_buchung', (item) => {
        return Number(item.fields.preis ?? 0);
      });
      return basispreis + zusatzkosten;
    },
  },
  numberFields: {},
};

export const computedDeps: Record<string, string[]> = {
  '_buchung_gesamtkosten': ['zimmer', 'zusatzleistungen_buchung', 'anreise', 'abreise'],
};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {
  'zimmer': [{ lookupKey: 'preis_pro_nacht' }],
};
