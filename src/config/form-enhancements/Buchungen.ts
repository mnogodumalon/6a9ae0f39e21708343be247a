// Auto-generated. Per-entity form-enhancements config for "Buchungen".
// The sandbox sub-agent (Step 0) may overwrite this file with a richer config.
// Schema: see ./types.ts.

import type { FormEnhancements } from './types';

export const formEnhancements: FormEnhancements = {
  fieldOrder: ["gast", "zimmer", {"row": ["anreise", "abreise"]}, "personen", "begleitperson", "zusatzleistungen_buchung", "status", "bemerkung"],
  defaults: {
    'anreise': { kind: 'today' },
    'abreise': { kind: 'todayOffset', days: 3 },
    'personen': { kind: 'literal', value: 1 },
    'status': { kind: 'lookup', key: 'angefragt', label: 'Angefragt' },
  },
  computed: {
    '_aufenthalt_dauer_nächte': { kind: 'dateDiff', from: 'anreise', to: 'abreise', unit: 'days' },
    '_gesamtkosten': (_fields, ctx) => {
      const basis = (ctx.applookup('zimmer', 'preis_pro_nacht') ?? 0) * (ctx.dateDiff('anreise', 'abreise') ?? 0);
      const zusatz = ctx.sumOver('zusatzleistungen_buchung', it => Number(it.fields.preis ?? 0));
      return basis + zusatz;
    },
  },
};

// Build-time-populated field dependencies for MODUS-2 arrow functions in
// `computed`. The sub-agent leaves this empty; scripts/parse-formulas.mjs
// fills it after Step 0 by regex-extracting ctx.* calls from each function
// body. The dialog feeds these into classifyComputed so MODUS-2 entries get
// inline anchors instead of always landing in the aggregate section.
export const computedDeps: Record<string, string[]> = {
  '_gesamtkosten': ['zimmer', 'zusatzleistungen_buchung', 'anreise', 'abreise'],
};

// Build-time-populated applookup (ownKey → lookupKey) pairs found in MODUS-2
// arrow functions. Filled by scripts/parse-formulas.mjs from regex matches
// on `ctx.applookup('x','y')` and `ctx.applookupAny('x','y')`. The dialog
// merges this with MODUS-1 refs extracted at render time, so every numeric
// field the formula pulls from a selected lookup is surfaced as an inline
// hint next to the lookup combobox.
export const computedApplookupRefs: Record<string, {lookupKey: string}[]> = {
  'zimmer': [{ lookupKey: 'preis_pro_nacht' }],
};
