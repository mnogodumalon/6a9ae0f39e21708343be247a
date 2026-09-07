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
    status: { kind: 'lookup', key: 'angefragt', label: 'Angefragt' },
    personen: { kind: 'literal', value: 1 },
    abreise: { kind: 'todayOffset', days: 3, withTime: false },
  },
  computed: {
    '_buchung_dauer_nächte': { kind: 'dateDiff', from: 'anreise', to: 'abreise', unit: 'days' },
    '_zimmer_kosten': { op: 'mul', left: { kind: 'applookup', ownKey: 'zimmer', lookupKey: 'preis_pro_nacht' }, right: { kind: 'dateDiff', from: 'anreise', to: 'abreise', unit: 'days' } },
    '_zusatzleistungen_gesamt': (_fields, ctx) => ctx.sumOver('zusatzleistungen_buchung', it => Number(it.fields.preis ?? 0)),
    '_gesamtbetrag': { op: 'add', left: { kind: 'field', key: '_zimmer_kosten' }, right: { kind: 'field', key: '_zusatzleistungen_gesamt' } },
  },
};

export const computedDeps: Record<string, string[]> = {
  '_zusatzleistungen_gesamt': ['zusatzleistungen_buchung'],
};
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {};
