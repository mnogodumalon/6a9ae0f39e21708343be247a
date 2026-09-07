import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: ['gast', 'zimmer', { row: ['anreise', 'abreise'] }, 'status', 'personen', 'begleitperson', 'zusatzleistungen_buchung', 'bemerkung'],
  defaults: {
    'anreise': { kind: 'today' },
    'abreise': { kind: 'todayOffset', days: 3 },
    'status': { kind: 'lookup', key: 'angefragt', label: 'Angefragt' },
    'personen': { kind: 'literal', value: 1 },
  },
  computed: {
    '_buchung_anzahl_naechte': { kind: 'dateDiff', from: 'anreise', to: 'abreise', unit: 'days' },
    'gesamtkosten': (_fields, ctx) => {
      const zimmerpreis = ctx.applookup('zimmer', 'preis_pro_nacht') ?? 0;
      const naechte = ctx.dateDiff('anreise', 'abreise') ?? 0;
      const basis = zimmerpreis * naechte;
      const zusatz = ctx.sumOver('zusatzleistungen_buchung', it => Number(it.fields.preis ?? 0));
      return basis + zusatz;
    },
  },
};

export const computedDeps: Record<string, string[]> = {
  'gesamtkosten': ['zimmer', 'zusatzleistungen_buchung', 'anreise', 'abreise'],
};

export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {
  'zimmer': [{ lookupKey: 'preis_pro_nacht' }],
};
