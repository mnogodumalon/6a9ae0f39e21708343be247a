import { lookupLabel } from '@/i18n';

// AUTOMATICALLY GENERATED TYPES - DO NOT EDIT

export type LookupValue = { key: string; label: string };
/** A raw record URL (applookup reference). NEVER render this directly
 *  in JSX — it is a URL, not a display value. Show the enriched `*Name`
 *  field or resolve it via the entity map instead. Assignable to/from
 *  string everywhere; the `& {}` keeps the alias NAME visible in tsc
 *  error messages (a plain primitive alias gets normalized away). */
export type RecordUrl = string & {};
export type GeoLocation = { lat: number; long: number; info?: string };

export type AttachmentType = 'file' | 'note' | 'url' | 'json';
export interface Attachment {
  id: string;
  type: AttachmentType;
  label: string | null;
  value: string | null;
  active: boolean;
  createdat?: string | null;
  updatedat?: string | null;
}

export interface AttachmentInput {
  type: AttachmentType;
  label?: string;
  value: string;
  active?: boolean;
}

export interface Gaeste {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    vorname?: string;
    nachname?: string;
    email?: string;
    telefon?: string;
    website?: string;
    plz?: string;
    ort?: string;
    newsletter?: boolean;
    anmerkungen?: string;
  };
}

export interface Zimmer {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    bezeichnung?: string;
    kategorie?: LookupValue;
    preis_pro_nacht?: number;
    etage?: number;
    balkon?: boolean;
    foto?: string;
  };
}

export interface Zusatzleistungen {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    name?: string;
    preis?: number;
    aktiv?: boolean;
  };
}

export interface Buchungen {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    gast?: RecordUrl; // applookup -> URL zu 'Gaeste' Record
    zimmer?: RecordUrl; // applookup -> URL zu 'Zimmer' Record
    anreise?: string; // Format: YYYY-MM-DD oder ISO String
    abreise?: string; // Format: YYYY-MM-DD oder ISO String
    status?: LookupValue;
    personen?: number;
    begleitperson?: RecordUrl; // applookup -> URL zu 'Gaeste' Record
    zusatzleistungen_buchung?: RecordUrl[];
    bemerkung?: string;
    beleg?: string;
  };
}

export interface Rechnungen {
  record_id: string;
  /** The API field. */
  created_at: string;
  updated_at: string | null;
  /** Alias of created_at, filled by the read helpers. The API sends
   *  snake_case only — reading `createdat` off a raw record yields
   *  undefined, which type-checks and then crashes at runtime. */
  createdat: string;
  updatedat: string | null;
  fields: {
    buchung?: RecordUrl; // applookup -> URL zu 'Buchungen' Record
    betrag?: number;
    rechnungsdatum?: string; // Format: YYYY-MM-DD oder ISO String
    faellig_am?: string; // Format: YYYY-MM-DD oder ISO String
    zahlungsstatus?: LookupValue;
    zahlungseingang?: string; // Format: YYYY-MM-DD oder ISO String
  };
}

export const APP_IDS = {
  GAESTE: '6a9ae0d06909bb394e9727fd',
  ZIMMER: '6a9ae0d5ba8308eabd8da879',
  ZUSATZLEISTUNGEN: '6a9ae0d579cbef571a2028f7',
  BUCHUNGEN: '6a9ae0d693daa9eb8f498b3a',
  RECHNUNGEN: '6a9ae0d64e3af8665e78b82e',
} as const;


export const LOOKUP_OPTIONS: Record<string, Record<string, {key: string, label: string}[]>> = {
  'zimmer': {
    kategorie: [{ key: "einzelzimmer", get label() { return lookupLabel('zimmer', 'kategorie', "einzelzimmer") ?? "Einzelzimmer"; } }, { key: "doppelzimmer", get label() { return lookupLabel('zimmer', 'kategorie', "doppelzimmer") ?? "Doppelzimmer"; } }, { key: "suite", get label() { return lookupLabel('zimmer', 'kategorie', "suite") ?? "Suite"; } }],
  },
  'buchungen': {
    status: [{ key: "storniert", get label() { return lookupLabel('buchungen', 'status', "storniert") ?? "Storniert"; } }, { key: "bestaetigt", get label() { return lookupLabel('buchungen', 'status', "bestaetigt") ?? "Bestätigt"; } }, { key: "angefragt", get label() { return lookupLabel('buchungen', 'status', "angefragt") ?? "Angefragt"; } }, { key: "eingecheckt", get label() { return lookupLabel('buchungen', 'status', "eingecheckt") ?? "Eingecheckt"; } }, { key: "ausgecheckt", get label() { return lookupLabel('buchungen', 'status', "ausgecheckt") ?? "Ausgecheckt"; } }],
  },
  'rechnungen': {
    zahlungsstatus: [{ key: "offen", get label() { return lookupLabel('rechnungen', 'zahlungsstatus', "offen") ?? "Offen"; } }, { key: "teilweise_bezahlt", get label() { return lookupLabel('rechnungen', 'zahlungsstatus', "teilweise_bezahlt") ?? "Teilweise bezahlt"; } }, { key: "bezahlt", get label() { return lookupLabel('rechnungen', 'zahlungsstatus', "bezahlt") ?? "Bezahlt"; } }],
  },
};

// Optimistic LookupValue writes: never re-type a label — resolve the schema
// option instead (its label is a locale-aware getter; falls back to the key).
// WRONG: status: { key: 'offen', label: 'Offen' }   (frozen in one language)
// RIGHT: status: lookupOption('<appKey>', 'status', 'offen')
export function lookupOption(app: string, field: string, key: string): LookupValue {
  return LOOKUP_OPTIONS[app]?.[field]?.find(o => o.key === key) ?? { key, label: key };
}

export const FIELD_TYPES: Record<string, Record<string, string>> = {
  'gaeste': {
    'vorname': 'string/text',
    'nachname': 'string/text',
    'email': 'string/email',
    'telefon': 'string/tel',
    'website': 'string/url',
    'plz': 'string/text',
    'ort': 'string/text',
    'newsletter': 'bool',
    'anmerkungen': 'string/textarea',
  },
  'zimmer': {
    'bezeichnung': 'string/text',
    'kategorie': 'lookup/radio',
    'preis_pro_nacht': 'number',
    'etage': 'number',
    'balkon': 'bool',
    'foto': 'file',
  },
  'zusatzleistungen': {
    'name': 'string/text',
    'preis': 'number',
    'aktiv': 'bool',
  },
  'buchungen': {
    'gast': 'applookup/select',
    'zimmer': 'applookup/select',
    'anreise': 'date/date',
    'abreise': 'date/date',
    'status': 'lookup/select',
    'personen': 'number',
    'begleitperson': 'applookup/select',
    'zusatzleistungen_buchung': 'multipleapplookup/select',
    'bemerkung': 'string/textarea',
    'beleg': 'file',
  },
  'rechnungen': {
    'buchung': 'applookup/select',
    'betrag': 'number',
    'rechnungsdatum': 'date/date',
    'faellig_am': 'date/date',
    'zahlungsstatus': 'lookup/select',
    'zahlungseingang': 'date/datetimeminute',
  },
};

export const HUB_TOPOLOGY: Record<string, { field: string; entity: string }[]> = {
};

type StripLookup<T> = {
  [K in keyof T]: T[K] extends LookupValue | undefined ? string | LookupValue | undefined
    : T[K] extends LookupValue[] | undefined ? string[] | LookupValue[] | undefined
    : T[K];
};

// Helper Types for creating new records (lookup fields as plain strings for API)
export type CreateGaeste = StripLookup<Gaeste['fields']>;
export type CreateZimmer = StripLookup<Zimmer['fields']>;
export type CreateZusatzleistungen = StripLookup<Zusatzleistungen['fields']>;
export type CreateBuchungen = StripLookup<Buchungen['fields']>;
export type CreateRechnungen = StripLookup<Rechnungen['fields']>;