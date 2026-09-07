import { useState, useEffect, useMemo, useCallback } from 'react';
import type { Gaeste, Zimmer, Zusatzleistungen, Buchungen, Rechnungen } from '@/types/app';
import { LivingAppsService } from '@/services/livingAppsService';
import { t } from '@/i18n';

/** Dashboard data + the OPTIMISTIC-WRITE API.
 *
 *  The per-entity setters (`set<Entity>`) are exported for exactly one job:
 *  optimistic updates on drag writes (onEventDrop / onEventResize /
 *  onCardMove). Call the setter FIRST — the bar/card lands instantly — then
 *  fire the PATCH in the background and call `fetchAll()` ONLY in the catch.
 *  Never await the PATCH before updating state (the UI freezes for the full
 *  round-trip on every drag) and never refetch after a successful write.
 *  There is no other mechanism (no `__optimistic`, no `mutate`).
 */
/** Entities this hook can load — the same keys the journey layer uses. */
export type DashboardEntity = 'gaeste' | 'zimmer' | 'zusatzleistungen' | 'buchungen' | 'rechnungen';

export interface DashboardDataOptions {
  /** Entities this page does NOT need (picked through useRecordSearch instead).
   *  Every flow page mounts this hook on its own route, so without `omit` a
   *  page that searches 3.000 guests server-side would still pull all 3.000
   *  through the side door. */
  omit?: DashboardEntity[];
}

export function useDashboardData(options: DashboardDataOptions = {}) {
  // A string key, not the array: an inline `omit={['gaeste']}` is a new array
  // on every render and would restart the fetch forever.
  const omitKey = (options.omit ?? []).slice().sort().join('|');
  const [gaeste, setGaeste] = useState<Gaeste[]>([]);
  const [zimmer, setZimmer] = useState<Zimmer[]>([]);
  const [zusatzleistungen, setZusatzleistungen] = useState<Zusatzleistungen[]>([]);
  const [buchungen, setBuchungen] = useState<Buchungen[]>([]);
  const [rechnungen, setRechnungen] = useState<Rechnungen[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAll = useCallback(async () => {
    setError(null);
    const omit = new Set(omitKey ? omitKey.split('|') : []);
    try {
      const [gaesteData, zimmerData, zusatzleistungenData, buchungenData, rechnungenData] = await Promise.all([
        omit.has('gaeste') ? Promise.resolve([] as Gaeste[]) : LivingAppsService.getGaeste(),
        omit.has('zimmer') ? Promise.resolve([] as Zimmer[]) : LivingAppsService.getZimmer(),
        omit.has('zusatzleistungen') ? Promise.resolve([] as Zusatzleistungen[]) : LivingAppsService.getZusatzleistungen(),
        omit.has('buchungen') ? Promise.resolve([] as Buchungen[]) : LivingAppsService.getBuchungen(),
        omit.has('rechnungen') ? Promise.resolve([] as Rechnungen[]) : LivingAppsService.getRechnungen(),
      ]);
      setGaeste(gaesteData);
      setZimmer(zimmerData);
      setZusatzleistungen(zusatzleistungenData);
      setBuchungen(buchungenData);
      setRechnungen(rechnungenData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(t('data_load_failed')));
    } finally {
      setLoading(false);
    }
  }, [omitKey]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Silent background refresh (no loading state change → no flicker)
  useEffect(() => {
    const omit = new Set(omitKey ? omitKey.split('|') : []);
    async function silentRefresh() {
      try {
        const [gaesteData, zimmerData, zusatzleistungenData, buchungenData, rechnungenData] = await Promise.all([
          omit.has('gaeste') ? Promise.resolve([] as Gaeste[]) : LivingAppsService.getGaeste(),
          omit.has('zimmer') ? Promise.resolve([] as Zimmer[]) : LivingAppsService.getZimmer(),
          omit.has('zusatzleistungen') ? Promise.resolve([] as Zusatzleistungen[]) : LivingAppsService.getZusatzleistungen(),
          omit.has('buchungen') ? Promise.resolve([] as Buchungen[]) : LivingAppsService.getBuchungen(),
          omit.has('rechnungen') ? Promise.resolve([] as Rechnungen[]) : LivingAppsService.getRechnungen(),
        ]);
        setGaeste(gaesteData);
        setZimmer(zimmerData);
        setZusatzleistungen(zusatzleistungenData);
        setBuchungen(buchungenData);
        setRechnungen(rechnungenData);
      } catch {
        // silently ignore — stale data is better than no data
      }
    }
    function handleRefresh() { void silentRefresh(); }
    // assistant:data-changed comes from the assistant (<la-klar-assistant>)
    // after every mutation. The element additionally fires the legacy
    // dashboard-refresh event for OLD deployed bundles — do NOT subscribe to
    // both here, or every mutation fetches twice.
    window.addEventListener('assistant:data-changed', handleRefresh);
    return () => window.removeEventListener('assistant:data-changed', handleRefresh);
  }, [omitKey]);

  const gaesteMap = useMemo(() => {
    const m = new Map<string, Gaeste>();
    gaeste.forEach(r => m.set(r.record_id, r));
    return m;
  }, [gaeste]);

  const zimmerMap = useMemo(() => {
    const m = new Map<string, Zimmer>();
    zimmer.forEach(r => m.set(r.record_id, r));
    return m;
  }, [zimmer]);

  const zusatzleistungenMap = useMemo(() => {
    const m = new Map<string, Zusatzleistungen>();
    zusatzleistungen.forEach(r => m.set(r.record_id, r));
    return m;
  }, [zusatzleistungen]);

  const buchungenMap = useMemo(() => {
    const m = new Map<string, Buchungen>();
    buchungen.forEach(r => m.set(r.record_id, r));
    return m;
  }, [buchungen]);

  return { gaeste, setGaeste, zimmer, setZimmer, zusatzleistungen, setZusatzleistungen, buchungen, setBuchungen, rechnungen, setRechnungen, loading, error, fetchAll, gaesteMap, zimmerMap, zusatzleistungenMap, buchungenMap };
}

/** The hook's return — the `data` prop of DashboardOverview in the Ready-Wrapper form. */
export type DashboardData = ReturnType<typeof useDashboardData>;