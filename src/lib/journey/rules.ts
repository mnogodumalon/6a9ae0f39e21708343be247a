/**
 * Field rules — GENERATED from the app metadata. Do not edit.
 *
 * The mechanical truth about every field: what kind it is, whether the
 * platform's base view marks it required, which lookup keys exist, where an
 * applookup points, what the label is. `useStepForm` validates against these
 * rules and phrases its messages with the real labels; `toWirePayload` uses
 * them to shape the create payload; `SHAPES` tells a page which input FORM
 * fits the data (a date pair wants a calendar, not two fields) — it is a
 * signal, not a gate.
 */
import { appLabel, fieldLabel, lookupLabel } from '@/i18n';
import { LOOKUP_OPTIONS } from '@/types/app';

export type EntityKey = 'gaeste' | 'zimmer' | 'zusatzleistungen' | 'buchungen' | 'rechnungen';

/** The text fields of each entity — what a search may run over (generated;
 *  `never` for an entity without text of its own, e.g. a link table). */
export interface StringFields {
  "gaeste": "vorname" | "nachname" | "email" | "telefon" | "website" | "plz" | "ort" | "anmerkungen";
  "zimmer": "bezeichnung";
  "zusatzleistungen": "name";
  "buchungen": "bemerkung";
  "rechnungen": never;
}
export type StringFieldKey<E extends EntityKey> = E extends keyof StringFields ? StringFields[E] : never;

/** The applookup fields of each entity (generated). A pick stored through
 *  `form.set` on one of these must carry its display name — at compile time
 *  (`StepForm.set`), because the review would otherwise show the id. */
export interface RecordFields {
  "gaeste": never;
  "zimmer": never;
  "zusatzleistungen": never;
  "buchungen": "gast" | "zimmer" | "begleitperson" | "zusatzleistungen_buchung";
  "rechnungen": "buchung";
}
export type RecordFieldKey<E extends EntityKey> = E extends keyof RecordFields ? RecordFields[E] : never;

export type FieldKind =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'url'
  | 'number'
  | 'bool'
  | 'date'
  | 'datetime'
  | 'lookup'
  | 'multilookup'
  | 'record'
  | 'multirecord'
  | 'file'
  | 'geo';

export interface FieldRule {
  key: string;
  fulltype: string;
  kind: FieldKind;
  /** From the app's base view. A public page may override this per field. */
  required: boolean;
  /** Build-time label — `labelOf()` prefers the runtime i18n bundle. */
  label: string;
  /** Whether a journey may write it (`file` is upload-only, never via a journey). */
  writable: boolean;
  maxLength?: number;
  /** lookup / multilookup: the ONLY valid write values. */
  options?: string[];
  /** record / multirecord: the target app (always) and its entity key (when inside this appgroup). */
  targetAppId?: string;
  targetEntity?: EntityKey;
  format?: 'currency';
  /** HTML autocomplete token derived from the field name (given-name, email, tel, …). */
  autoComplete?: string;
}

export interface EntityInfo {
  key: EntityKey;
  appId: string;
  label: string;
  /** PascalCase plural — `get<pascal>()` on the service. */
  pascal: string;
  /** The single-record suffix — `create<single>()` on the service. */
  single: string;
}

/** Input-form signals per entity: which data shape each field (pair) has.
 *  `range`  — two date fields that form a stay/period → AvailabilityRangePicker
 *  `choice` — a lookup with few options → ChoiceGroup pills instead of a select
 *  `record` — an applookup → EntitySelectStep with search, never a raw id field
 *  `stock`  — a quantity that has a stock/capacity counterpart → show it, warn on overshoot */
export type Shape =
  | { kind: 'range'; from: string; to: string }
  | { kind: 'choice'; field: string; count: number }
  | { kind: 'record'; field: string; targetEntity?: EntityKey }
  | { kind: 'stock'; field: string };

export const ENTITIES: Record<EntityKey, EntityInfo> = {
  "gaeste": {
    "key": "gaeste",
    "appId": "6a9ae0d06909bb394e9727fd",
    "label": "Gäste",
    "pascal": "Gaeste",
    "single": "GaesteEntry"
  },
  "zimmer": {
    "key": "zimmer",
    "appId": "6a9ae0d5ba8308eabd8da879",
    "label": "Zimmer",
    "pascal": "Zimmer",
    "single": "ZimmerEntry"
  },
  "zusatzleistungen": {
    "key": "zusatzleistungen",
    "appId": "6a9ae0d579cbef571a2028f7",
    "label": "Zusatzleistungen",
    "pascal": "Zusatzleistungen",
    "single": "ZusatzleistungenEntry"
  },
  "buchungen": {
    "key": "buchungen",
    "appId": "6a9ae0d693daa9eb8f498b3a",
    "label": "Buchungen",
    "pascal": "Buchungen",
    "single": "BuchungenEntry"
  },
  "rechnungen": {
    "key": "rechnungen",
    "appId": "6a9ae0d64e3af8665e78b82e",
    "label": "Rechnungen",
    "pascal": "Rechnungen",
    "single": "RechnungenEntry"
  }
};

export const FIELD_RULES: Record<EntityKey, Record<string, FieldRule>> = {
  "gaeste": {
    "vorname": {
      "key": "vorname",
      "fulltype": "string/text",
      "kind": "text",
      "required": true,
      "label": "Vorname",
      "writable": true,
      "maxLength": 4000,
      "autoComplete": "given-name"
    },
    "nachname": {
      "key": "nachname",
      "fulltype": "string/text",
      "kind": "text",
      "required": true,
      "label": "Nachname",
      "writable": true,
      "maxLength": 4000,
      "autoComplete": "family-name"
    },
    "email": {
      "key": "email",
      "fulltype": "string/email",
      "kind": "email",
      "required": false,
      "label": "E-Mail",
      "writable": true,
      "autoComplete": "email"
    },
    "telefon": {
      "key": "telefon",
      "fulltype": "string/tel",
      "kind": "tel",
      "required": false,
      "label": "Telefon",
      "writable": true,
      "autoComplete": "tel"
    },
    "website": {
      "key": "website",
      "fulltype": "string/url",
      "kind": "url",
      "required": false,
      "label": "Website",
      "writable": true,
      "autoComplete": "url"
    },
    "plz": {
      "key": "plz",
      "fulltype": "string/text",
      "kind": "text",
      "required": false,
      "label": "PLZ",
      "writable": true,
      "maxLength": 4000,
      "autoComplete": "postal-code"
    },
    "ort": {
      "key": "ort",
      "fulltype": "string/text",
      "kind": "text",
      "required": false,
      "label": "Ort",
      "writable": true,
      "maxLength": 4000,
      "autoComplete": "address-level2"
    },
    "newsletter": {
      "key": "newsletter",
      "fulltype": "bool",
      "kind": "bool",
      "required": false,
      "label": "Newsletter",
      "writable": true
    },
    "anmerkungen": {
      "key": "anmerkungen",
      "fulltype": "string/textarea",
      "kind": "textarea",
      "required": false,
      "label": "Anmerkungen",
      "writable": true
    }
  },
  "zimmer": {
    "bezeichnung": {
      "key": "bezeichnung",
      "fulltype": "string/text",
      "kind": "text",
      "required": true,
      "label": "Bezeichnung",
      "writable": true,
      "maxLength": 4000
    },
    "kategorie": {
      "key": "kategorie",
      "fulltype": "lookup/radio",
      "kind": "lookup",
      "required": true,
      "label": "Kategorie",
      "writable": true,
      "options": [
        "einzelzimmer",
        "doppelzimmer",
        "suite"
      ]
    },
    "preis_pro_nacht": {
      "key": "preis_pro_nacht",
      "fulltype": "number",
      "kind": "number",
      "required": false,
      "label": "Preis pro Nacht (€)",
      "writable": true,
      "format": "currency"
    },
    "etage": {
      "key": "etage",
      "fulltype": "number",
      "kind": "number",
      "required": false,
      "label": "Etage",
      "writable": true
    },
    "balkon": {
      "key": "balkon",
      "fulltype": "bool",
      "kind": "bool",
      "required": false,
      "label": "Balkon",
      "writable": true
    },
    "foto": {
      "key": "foto",
      "fulltype": "file",
      "kind": "file",
      "required": false,
      "label": "Foto",
      "writable": false
    }
  },
  "zusatzleistungen": {
    "name": {
      "key": "name",
      "fulltype": "string/text",
      "kind": "text",
      "required": true,
      "label": "Name",
      "writable": true,
      "maxLength": 4000,
      "autoComplete": "name"
    },
    "preis": {
      "key": "preis",
      "fulltype": "number",
      "kind": "number",
      "required": false,
      "label": "Preis (€)",
      "writable": true,
      "format": "currency"
    },
    "aktiv": {
      "key": "aktiv",
      "fulltype": "bool",
      "kind": "bool",
      "required": false,
      "label": "Aktiv",
      "writable": true
    }
  },
  "buchungen": {
    "gast": {
      "key": "gast",
      "fulltype": "applookup/select",
      "kind": "record",
      "required": true,
      "label": "Gast",
      "writable": true,
      "targetAppId": "6a9ae0d06909bb394e9727fd",
      "targetEntity": "gaeste"
    },
    "zimmer": {
      "key": "zimmer",
      "fulltype": "applookup/select",
      "kind": "record",
      "required": true,
      "label": "Zimmer",
      "writable": true,
      "targetAppId": "6a9ae0d5ba8308eabd8da879",
      "targetEntity": "zimmer"
    },
    "anreise": {
      "key": "anreise",
      "fulltype": "date/date",
      "kind": "date",
      "required": true,
      "label": "Anreise",
      "writable": true
    },
    "abreise": {
      "key": "abreise",
      "fulltype": "date/date",
      "kind": "date",
      "required": true,
      "label": "Abreise",
      "writable": true
    },
    "status": {
      "key": "status",
      "fulltype": "lookup/select",
      "kind": "lookup",
      "required": true,
      "label": "Status",
      "writable": true,
      "options": [
        "storniert",
        "bestaetigt",
        "angefragt",
        "eingecheckt",
        "ausgecheckt"
      ]
    },
    "personen": {
      "key": "personen",
      "fulltype": "number",
      "kind": "number",
      "required": false,
      "label": "Personen",
      "writable": true
    },
    "begleitperson": {
      "key": "begleitperson",
      "fulltype": "applookup/select",
      "kind": "record",
      "required": false,
      "label": "Begleitperson",
      "writable": true,
      "targetAppId": "6a9ae0d06909bb394e9727fd",
      "targetEntity": "gaeste"
    },
    "zusatzleistungen_buchung": {
      "key": "zusatzleistungen_buchung",
      "fulltype": "multipleapplookup/select",
      "kind": "multirecord",
      "required": false,
      "label": "Zusatzleistungen",
      "writable": true,
      "targetAppId": "6a9ae0d579cbef571a2028f7",
      "targetEntity": "zusatzleistungen"
    },
    "bemerkung": {
      "key": "bemerkung",
      "fulltype": "string/textarea",
      "kind": "textarea",
      "required": false,
      "label": "Bemerkung",
      "writable": true
    },
    "beleg": {
      "key": "beleg",
      "fulltype": "file",
      "kind": "file",
      "required": false,
      "label": "Beleg",
      "writable": false
    }
  },
  "rechnungen": {
    "buchung": {
      "key": "buchung",
      "fulltype": "applookup/select",
      "kind": "record",
      "required": true,
      "label": "Buchung",
      "writable": true,
      "targetAppId": "6a9ae0d693daa9eb8f498b3a",
      "targetEntity": "buchungen"
    },
    "betrag": {
      "key": "betrag",
      "fulltype": "number",
      "kind": "number",
      "required": true,
      "label": "Betrag (€)",
      "writable": true,
      "format": "currency"
    },
    "rechnungsdatum": {
      "key": "rechnungsdatum",
      "fulltype": "date/date",
      "kind": "date",
      "required": false,
      "label": "Rechnungsdatum",
      "writable": true
    },
    "faellig_am": {
      "key": "faellig_am",
      "fulltype": "date/date",
      "kind": "date",
      "required": false,
      "label": "Fällig am",
      "writable": true
    },
    "zahlungsstatus": {
      "key": "zahlungsstatus",
      "fulltype": "lookup/select",
      "kind": "lookup",
      "required": false,
      "label": "Zahlungsstatus",
      "writable": true,
      "options": [
        "offen",
        "teilweise_bezahlt",
        "bezahlt"
      ]
    },
    "zahlungseingang": {
      "key": "zahlungseingang",
      "fulltype": "date/datetimeminute",
      "kind": "datetime",
      "required": false,
      "label": "Zahlungseingang",
      "writable": true
    }
  }
};

export const SHAPES: Record<EntityKey, Shape[]> = {
  "gaeste": [],
  "zimmer": [
    {
      "kind": "choice",
      "field": "kategorie",
      "count": 3
    }
  ],
  "zusatzleistungen": [],
  "buchungen": [
    {
      "kind": "range",
      "from": "anreise",
      "to": "abreise"
    },
    {
      "kind": "choice",
      "field": "status",
      "count": 5
    },
    {
      "kind": "record",
      "field": "gast",
      "targetEntity": "gaeste"
    },
    {
      "kind": "record",
      "field": "zimmer",
      "targetEntity": "zimmer"
    },
    {
      "kind": "record",
      "field": "begleitperson",
      "targetEntity": "gaeste"
    },
    {
      "kind": "record",
      "field": "zusatzleistungen_buchung",
      "targetEntity": "zusatzleistungen"
    }
  ],
  "rechnungen": [
    {
      "kind": "choice",
      "field": "zahlungsstatus",
      "count": 3
    },
    {
      "kind": "record",
      "field": "buchung",
      "targetEntity": "buchungen"
    }
  ]
};

/** The fields a record of this entity is recognised by (a person: first and
 *  last name; else its title-like text field) — the same choice the dashboard's
 *  enrichment makes for `<key>Name`. `useRecordSearch` resolves an applookup to
 *  this name (`ctx.ref('gast')` in `toItem`). */
export const DISPLAY_FIELDS: Record<EntityKey, string[]> = {
  "gaeste": [
    "vorname",
    "nachname"
  ],
  "zimmer": [
    "bezeichnung"
  ],
  "zusatzleistungen": [
    "name"
  ],
  "buchungen": [
    "bemerkung"
  ],
  "rechnungen": [
    "buchung"
  ]
};

/** The display name of a record: its display fields joined, else the first
 *  non-empty text value, else ''. */
export function displayNameOf(entity: EntityKey, fields: Record<string, unknown>): string {
  const parts = (DISPLAY_FIELDS[entity] ?? [])
    .map(k => fields[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(v => v.trim());
  if (parts.length > 0) return parts.join(' ');
  for (const [k, rule] of Object.entries(FIELD_RULES[entity] ?? {})) {
    if (rule.kind !== 'text' && rule.kind !== 'email') continue;
    const v = fields[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export function ruleOf(entity: EntityKey, key: string): FieldRule | undefined {
  return FIELD_RULES[entity]?.[key];
}

/** The field label as the user sees it — runtime bundle first, generated label second. */
export function labelOf(entity: EntityKey, key: string): string {
  const fromBundle = fieldLabel(entity, key);
  if (fromBundle !== key) return fromBundle;
  return ruleOf(entity, key)?.label ?? key;
}

export function entityLabel(entity: EntityKey): string {
  const fromBundle = appLabel(entity);
  if (fromBundle !== entity) return fromBundle;
  return ENTITIES[entity]?.label ?? entity;
}

/** Lookup options with runtime labels — the only legitimate source of `{key,label}` pairs. */
export function optionsOf(entity: EntityKey, key: string): Array<{ key: string; label: string }> {
  const generated = (LOOKUP_OPTIONS as Record<string, Record<string, Array<{ key: string; label: string }>>>)[entity]?.[key];
  if (generated && generated.length) return generated.map(o => ({ key: o.key, label: o.label }));
  const keys = ruleOf(entity, key)?.options ?? [];
  return keys.map(k => ({ key: k, label: lookupLabel(entity, key, k) ?? k }));
}

export function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object' && 'from' in (v as object) && 'to' in (v as object)) {
    const r = v as { from: unknown; to: unknown };
    return isEmptyValue(r.from) && isEmptyValue(r.to);
  }
  return false;
}
