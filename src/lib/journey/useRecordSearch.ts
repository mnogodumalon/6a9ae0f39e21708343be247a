/**
 * useRecordSearch — the one hook a "pick a record" step uses.
 *
 * It answers the question the page cannot answer for itself: is this entity
 * small enough to hand over as an array, or does it have to be searched on the
 * server? It asks the door for a COUNT first (aggregate_records — no records
 * travel), then either loads everything as before or loads one page and hands
 * EntitySelectStep an `onSearch` that queries the server while the user types.
 *
 *   const gaeste = useRecordSearch(servicePort, 'gaeste', {
 *     searchFields: ['vorname', 'nachname', 'email'],
 *     toItem: g => ({ id: g.id, title: `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() }),
 *   });
 *   <EntitySelectStep {...gaeste.select} selectedId={f.get('gast') as string}
 *     onSelect={id => f.set('gast', id, gaeste.labelOf(id))} />
 *
 * The public door cannot count or filter (grants allow field/limit/offset), so
 * `count` returns null there, the hook loads what the grant hands out (≤500)
 * and EntitySelectStep searches it client-side. The step's FORM adapts either
 * way — that is resolveSelectMode's job, not this hook's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JourneyPort, JourneyRecord } from './port';
import type { EntityKey, StringFieldKey } from './rules';
import { SERVER_SEARCH_FROM, SEARCH_PAGE_SIZE } from './selectMode';
import { t } from '@/i18n';
import { Sentry } from '@/lib/sentry';

/** A 400 the server raised for the vSQL `filter` itself — not a network error,
 *  not an auth problem. The service has already reported it to the errorbus. */
function isFilterRejection(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const err = e as { status?: unknown; message?: unknown; type?: unknown };
  return err.status === 400 && /vsql/i.test(`${String(err.message ?? '')} ${String(err.type ?? '')}`);
}

export interface SelectItemLike { id: string; title: string; }

export interface RecordSearchOptions<T extends SelectItemLike, E extends EntityKey = EntityKey> {
  /** The entity's text fields the search runs over — TYPED from the generated
   *  rules: a field of another entity or a non-text field is a compile error
   *  (a link table with no text of its own accepts only `[]`). */
  searchFields: StringFieldKey<E>[];
  /** The agent's semantic mapping record → card (title from the `^` fields, subtitle, stats). */
  toItem: (record: JourneyRecord) => T;
  /** vSQL order, e.g. ['r.v_nachname asc'] (internal door only). */
  orderby?: string[];
  /** The step's standing restriction as vSQL — "r.v_status == 'verfuegbar'",
   *  "r.v_rueckgabedatum is None". Applied server-side to the count, the
   *  first page and every search; never filter the items array yourself (the
   *  count and the search would disagree). Internal door only — the public
   *  door cannot filter; use `where` there. */
  filter?: string;
  /** A client-side restriction over the records the door handed out — the
   *  door-agnostic fallback for what vSQL cannot say, and the only option on
   *  the public door. Prefer `filter` for the internal door: `where` runs
   *  after paging, so a page can come back shorter than pageSize. */
  where?: (record: JourneyRecord) => boolean;
  /** Below this count everything is loaded once and searched client-side (default SERVER_SEARCH_FROM). */
  loadAllUpTo?: number;
  pageSize?: number;
}

export interface RecordSearch<T extends SelectItemLike> {
  /** Spread into <EntitySelectStep {...search.select} onSelect={…} />.
   *  Besides the list it hands the step what it needs to offer "Neu anlegen"
   *  on its own — the entity, the door and `adopt` — and whether a standing
   *  restriction (`filter`/`where`) is in play, so an empty list can say why. */
  select: {
    items: T[];
    totalCount: number | null;
    onSearch?: (query: string, signal: AbortSignal) => Promise<T[]>;
    loading: boolean;
    error: string | null;
    entity: EntityKey;
    port: JourneyPort;
    filtered: boolean;
    adopt: (record: JourneyRecord) => void;
  };
  /** Display name of any record seen so far (first page or a search hit) — for f.set(key, id, label). */
  labelOf(id: string): string | undefined;
  /** The record behind an id the user could pick — already loaded, no request.
   *  For "what does the picked Einsatz link to": `fieldRef(x.recordOf(id), 'kunde')`.
   *  A live page re-fetched the pick with a hand-written filter (`r.record_id == …`, a 400). */
  recordOf(id: string): JourneyRecord | undefined;
  /** Take a record the page just created into the list and the label map —
   *  no request, the record is known. EntitySelectStep calls this itself
   *  after its inline create; a page that creates elsewhere calls it too. */
  adopt(record: JourneyRecord): void;
  /** Re-run the initial load (after a write elsewhere). */
  reload(): Promise<void>;
}

/** The whole decision, as a pure function so it can be tested without React.
 *  An unknown count (`null`, the public door) loads everything — the door caps
 *  it anyway, and guessing "large" would break a public picker. The threshold
 *  is INCLUSIVE: exactly `loadAllUpTo` records still load in one go. */
export function decideStrategy(
  count: number | null,
  loadAllUpTo: number = SERVER_SEARCH_FROM,
  pageSize: number = SEARCH_PAGE_SIZE,
): { serverSearch: boolean; limit?: number } {
  if (count === null || count <= loadAllUpTo) return { serverSearch: false };
  return { serverSearch: true, limit: pageSize };
}

export function useRecordSearch<E extends EntityKey, T extends SelectItemLike>(
  port: JourneyPort,
  entity: E,
  options: RecordSearchOptions<T, E>,
): RecordSearch<T> {
  const { searchFields, toItem, orderby, filter, where, loadAllUpTo = SERVER_SEARCH_FROM, pageSize = SEARCH_PAGE_SIZE } = options;
  const [items, setItems] = useState<T[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [serverSearch, setServerSearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Map<string, string>());
  const records = useRef(new Map<string, JourneyRecord>());
  // Safety net: should the server reject the standing `filter`, the hook loads
  // the entity unfiltered and lets `where` (the TypeScript twin) restrict it —
  // slower, but a correct list instead of an empty picker. Reported once.
  const filterBroken = useRef(false);
  // Never re-fetch because an inline mapper/predicate closure changed identity.
  const toItemRef = useRef(toItem);
  toItemRef.current = toItem;
  const whereRef = useRef(where);
  whereRef.current = where;
  const keep = (rows: JourneyRecord[]) => (whereRef.current ? rows.filter(whereRef.current) : rows);
  const fieldsKey = searchFields.join('|');
  const orderKey = (orderby ?? []).join('|');

  const remember = useCallback((rows: JourneyRecord[]) => {
    for (const r of rows) records.current.set(r.id, r);
    const mapped = rows.map(r => toItemRef.current(r));
    for (const m of mapped) seen.current.set(m.id, m.title);
    return mapped;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeFilter = filterBroken.current ? undefined : filter;
      const count = await port.count(entity, { filter: activeFilter });
      setTotalCount(count);
      // No text to search by (a link entity: applookups and dates only) →
      // there is nothing a server search could match; load the whole
      // (filtered) set and let the block search the cards client-side.
      // Degraded (filter rejected): everything is loaded and `where` applies,
      // so a server search over the unfiltered set would be wrong.
      const strategy = searchFields.length > 0 && !filterBroken.current
        ? decideStrategy(count, loadAllUpTo, pageSize)
        : { serverSearch: false as const };
      setServerSearch(strategy.serverSearch);
      const rows = keep(await port.list(entity, strategy.serverSearch ? { limit: strategy.limit, orderby, filter: activeFilter } : { orderby, filter: activeFilter }));
      const mapped = remember(rows);
      setItems(mapped);
      // A door that cannot count still knows how much it handed over.
      if (count === null || filterBroken.current) setTotalCount(mapped.length);
    } catch (e) {
      if (filter && !filterBroken.current && isFilterRejection(e)) {
        filterBroken.current = true;
        const reason = e instanceof Error ? e.message : String(e);
        console.warn(`useRecordSearch: the server rejected filter "${filter}" on '${entity}' — loading unfiltered, restricting with where(). ${reason}`);
        Sentry.captureException(new Error(`useRecordSearch filter rejected on '${entity}': ${filter} — ${reason}`), {
          tags: { feature: 'journey-filter-fallback', entity },
        });
        setLoading(false);
        return load();
      }
      setError(e instanceof Error ? e.message : t('sel_search_failed'));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the arrays
  }, [port, entity, loadAllUpTo, pageSize, orderKey, filter, remember]);

  useEffect(() => { void load(); }, [load]);

  const onSearch = useMemo(() => serverSearch
    ? async (query: string, signal: AbortSignal) => {
        const rows = keep(await port.list(entity, { search: { query, fields: searchFields }, limit: pageSize, orderby, filter, signal }));
        return remember(rows);
      }
    : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the arrays
  [serverSearch, port, entity, fieldsKey, orderKey, filter, pageSize, remember]);

  // A record the page created a moment ago: remembered (labelOf/recordOf
  // answer at once), put first in the list, counted. Whether it passes the
  // step's `where` is not asked — the user just made it, hiding it would
  // look like the create failed.
  const adopt = useCallback((record: JourneyRecord) => {
    const [item] = remember([record]);
    setItems(prev => [item, ...prev.filter(i => i.id !== item.id)]);
    setTotalCount(prev => (prev === null ? prev : prev + 1));
  }, [remember]);

  const filtered = Boolean(filter) || typeof where === 'function';

  return {
    select: { items, totalCount, onSearch, loading, error, entity, port, filtered, adopt },
    labelOf: id => seen.current.get(id),
    recordOf: id => records.current.get(id),
    adopt,
    reload: load,
  };
}
