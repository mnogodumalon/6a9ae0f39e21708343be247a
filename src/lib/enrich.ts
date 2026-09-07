import type { EnrichedBuchungen, EnrichedRechnungen } from '@/types/enriched';
import type { Buchungen, Gaeste, Rechnungen, Zimmer, Zusatzleistungen } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveDisplay(url: unknown, map: Map<string, any>, ...fields: string[]): string {
  if (!url) return '';
  const id = extractRecordId(url);
  if (!id) return '';
  const r = map.get(id);
  if (!r) return '';
  return fields.map(f => String(r.fields[f] ?? '')).join(' ').trim();
}

interface BuchungenMaps {
  gaesteMap: Map<string, Gaeste>;
  zimmerMap: Map<string, Zimmer>;
  zusatzleistungenMap: Map<string, Zusatzleistungen>;
}

export function enrichBuchungen(
  buchungen: Buchungen[],
  maps: BuchungenMaps
): EnrichedBuchungen[] {
  return buchungen.map(r => ({
    ...r,
    gastName: resolveDisplay(r.fields.gast, maps.gaesteMap, 'vorname', 'nachname'),
    zimmerName: resolveDisplay(r.fields.zimmer, maps.zimmerMap, 'bezeichnung'),
    begleitpersonName: resolveDisplay(r.fields.begleitperson, maps.gaesteMap, 'vorname', 'nachname'),
    zusatzleistungen_buchungName: resolveDisplay(r.fields.zusatzleistungen_buchung, maps.zusatzleistungenMap, 'name'),
  }));
}

interface RechnungenMaps {
  buchungenMap: Map<string, Buchungen>;
}

export function enrichRechnungen(
  rechnungen: Rechnungen[],
  maps: RechnungenMaps
): EnrichedRechnungen[] {
  return rechnungen.map(r => ({
    ...r,
    buchungName: resolveDisplay(r.fields.buchung, maps.buchungenMap, 'bemerkung'),
  }));
}
