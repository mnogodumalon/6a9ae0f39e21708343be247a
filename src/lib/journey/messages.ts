/**
 * Required-field messages — WRITTEN BY THE BUILD AGENT, never by a heuristic.
 *
 * The layer knows two things about an empty required field: that it is
 * required and what its label is. Out of that it can only say „„Anreise" ist
 * ein Pflichtfeld". What the person should do instead („Bitte einen Gast
 * auswählen.") is meaning, and meaning is the agent's: the Phase-2 orchestrator
 * writes one short instruction per required field — what is needed, not why — to
 * `.intents-staging/messages.json`, the integration step validates it against
 * the app metadata and renders it into the block below. Scaffold updates keep
 * the block. Do not edit outside the markers.
 *
 * Every door reads this and nothing else: `useStepForm` (flows and public
 * pages), the generated {Entity}Dialog and the public form's server-error line.
 * A field without a sentence falls back to the label sentence — never to a
 * bare „Dieses Feld ist erforderlich".
 *
 * Required fields per entity (from the base view):
 *   - gaeste: vorname (Vorname), nachname (Nachname)
 *   - zimmer: bezeichnung (Bezeichnung), kategorie (Kategorie)
 *   - zusatzleistungen: name (Name)
 *   - buchungen: gast (Gast), zimmer (Zimmer), anreise (Anreise), abreise (Abreise), status (Status)
 *   - rechnungen: buchung (Buchung), betrag (Betrag (€))
 */
import { t, tx } from '@/i18n';
import { labelOf, type EntityKey } from './rules';

/** The writable fields of each entity — the keys a message may address (generated). */
export interface MessageFields {
  "gaeste": "vorname" | "nachname" | "email" | "telefon" | "website" | "plz" | "ort" | "newsletter" | "anmerkungen";
  "zimmer": "bezeichnung" | "kategorie" | "preis_pro_nacht" | "etage" | "balkon";
  "zusatzleistungen": "name" | "preis" | "aktiv";
  "buchungen": "gast" | "zimmer" | "anreise" | "abreise" | "status" | "personen" | "begleitperson" | "zusatzleistungen_buchung" | "bemerkung";
  "rechnungen": "buchung" | "betrag" | "rechnungsdatum" | "faellig_am" | "zahlungsstatus" | "zahlungseingang";
}
export type MessageFieldKey<E extends EntityKey> = E extends keyof MessageFields ? MessageFields[E] : never;

export const REQUIRED_MESSAGES: { [E in EntityKey]?: Partial<Record<MessageFieldKey<E>, string>> } = {
  // <custom:messages>
  buchungen: { gast: "Bitte einen Gast auswählen.", zimmer: "Bitte ein freies Zimmer wählen.", anreise: "Bitte das Anreisedatum eingeben.", abreise: "Bitte das Abreisedatum eingeben.", status: "Bitte einen Status wählen." },
  gaeste: { vorname: "Bitte den Vornamen eingeben.", nachname: "Bitte den Nachnamen eingeben." },
  zimmer: { bezeichnung: "Bitte eine Zimmerbezeichnung eingeben.", kategorie: "Bitte eine Zimmerkategorie wählen." },
  rechnungen: { buchung: "Bitte die zugehörige Buchung auswählen.", betrag: "Bitte den Rechnungsbetrag eingeben." },
  // </custom:messages>
};

/** The sentence shown when `key` of `entity` is required and empty — the
 *  agent's own text (translated at runtime like every page string), else the
 *  label sentence. Call it while rendering, not at module scope. */
export function requiredMessage(entity: EntityKey, key: string): string {
  const own = (REQUIRED_MESSAGES as Record<string, Record<string, string | undefined> | undefined>)[entity]?.[key];
  if (own && own.trim()) return tx(own);
  return t('v_required', { label: labelOf(entity, key) });
}

/** True when the agent wrote a sentence for the field. */
export function hasOwnMessage(entity: EntityKey, key: string): boolean {
  const own = (REQUIRED_MESSAGES as Record<string, Record<string, string | undefined> | undefined>)[entity]?.[key];
  return Boolean(own && own.trim());
}
