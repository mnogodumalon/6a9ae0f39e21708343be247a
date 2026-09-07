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
import { FIELD_RULES, displayNameOf, type EntityKey, type StringFieldKey } from './rules';
import { SERVER_SEARCH_FROM, SEARCH_PAGE_SIZE } from './selectMode';
import { recordIdOf, rememberRecordLabel } from './recordLabels';
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

/** What `toItem` may ask about the record beyond its own fields. */
export interface RefContext {
  /** Display name(s) of the record(s) an applookup/multipleapplookup field points at
   *  (`displayNameOf` of the target entity), joined with ', '; undefined until loaded or when empty. */
  ref(key: string): string | undefined;
}

export interface RecordSearchOptions<T extends SelectItemLike, E extends EntityKey = EntityKey> {
  /** The entity's text fields the search runs over — TYPED from the generated
   *  rules: a field of another entity or a non-text field is a compile error
   *  (a link table with no text of its own accepts only `[]`). */
  searchFields: StringFieldKey<E>[];
  /** The card for a record. OPTIONAL: without it the card is the record's display
   *  name (`displayNameOf` — first + last name, else the title-like text field), so
   *  most pick steps need no mapper at all. Give one to add a subtitle, stats or a status.
   *  The agent's semantic mapping record → card (title from the `^` fields, subtitle, stats).
   *  `ctx.ref('gast')` is the display name of the record an applookup points
   *  at — the hook loads the referenced entity once and knows it. A
   *  JourneyRecord carries NO `<key>Name` fields (those exist only on the
   *  dashboard's enriched records); `fieldText(b, 'gastName')` is always ''. */
  toItem?: (record: JourneyRecord, ctx: RefContext) => T;
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
  /** `ctx.ref(key)` for a record outside `toItem` (a fact line, a summary item). */
  refLabel(record: JourneyRecord, key: string): string | undefined;
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
  // Display names of referenced records (id → name) and what has been asked
  // for: a whole target entity ('*') or single ids (large targets).
  const refNames = useRef(new Map<string, string>());
  const refAsked = useRef(new Set<string>());
  const rowsRef = useRef<JourneyRecord[]>([]);
  const refLabel = useCallback((record: JourneyRecord, key: string): string | undefined => {
    const rawValue = record.fields[key];
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    const names = values.map(v => recordIdOf(v)).map(id => (id ? refNames.current.get(id) : undefined)).filter((n): n is string => Boolean(n));
    return names.length > 0 ? names.join(', ') : undefined;
  }, []);
  // Safety net: should the server reject the standing `filter`, the hook loads
  // the entity unfiltered and lets `where` (the TypeScript twin) restrict it —
  // slower, but a correct list instead of an empty picker. Reported once.
  const filterBroken = useRef(false);
  // Never re-fetch because an inline mapper/predicate closure changed identity.
  const defaultItem = (r: JourneyRecord): T => ({ id: r.id, title: displayNameOf(entity, r.fields) || t('v_record_unnamed') } as unknown as T);
  const toItemRef = useRef(toItem ?? defaultItem);
  toItemRef.current = toItem ?? defaultItem;
  const whereRef = useRef(where);
  whereRef.current = where;
  const keep = (rows: JourneyRecord[]) => (whereRef.current ? rows.filter(whereRef.current) : rows);
  const fieldsKey = searchFields.join('|');
  const orderKey = (orderby ?? []).join('|');

  const remember = useCallback((rows: JourneyRecord[]) => {
    for (const r of rows) records.current.set(r.id, r);
    const mapped = rows.map(r => toItemRef.current(r, { ref: key => refLabel(r, key) }));
    for (const m of mapped) {
      seen.current.set(m.id, m.title);
      rememberRecordLabel(m.id, m.title);
    }
    return mapped;
  }, [refLabel]);

  // The referenced records' names, loaded once per target entity: the whole
  // target when it is small (or the door cannot count), else only the ids the
  // rows point at (batched `r.id == …` filters). Cards are re-mapped when a
  // name arrives, so `ctx.ref` in `toItem` fills in without any page code.
  const loadRefs = useCallback(async (rows: JourneyRecord[]) => {
    const targets = new Map<EntityKey, string[]>();
    for (const [k, rule] of Object.entries(FIELD_RULES[entity] ?? {})) {
      if ((rule.kind === 'record' || rule.kind === 'multirecord') && rule.targetEntity) {
        targets.set(rule.targetEntity, [...(targets.get(rule.targetEntity) ?? []), k]);
      }
    }
    if (targets.size === 0) return;
    let changed = false;
    const learn = (target: EntityKey, recs: JourneyRecord[]) => {
      for (const rec of recs) {
        const name = displayNameOf(target, rec.fields);
        if (!name) continue;
        refNames.current.set(rec.id, name);
        rememberRecordLabel(rec.id, name);
        changed = true;
      }
    };
    await Promise.all([...targets].map(async ([target, keys]) => {
      const ids = new Set<string>();
      for (const r of rows) for (const k of keys) {
        const v = r.fields[k];
        for (const one of Array.isArray(v) ? v : [v]) { const id = recordIdOf(one); if (id && !refNames.current.has(id)) ids.add(id); }
      }
      if (ids.size === 0 || refAsked.current.has(`${target}:*`)) return;
      try {
        if (!refAsked.current.has(`${target}:count`)) {
          refAsked.current.add(`${target}:count`);
          const count = await port.count(target, {});
          if (count === null || count <= loadAllUpTo) {
            refAsked.current.add(`${target}:*`);
            learn(target, await port.list(target));
            return;
          }
        }
        const missing = [...ids].filter(id => !refAsked.current.has(`${target}:${id}`));
        for (const id of missing) refAsked.current.add(`${target}:${id}`);
        for (let i = 0; i < missing.length; i += 25) {
          const chunk = missing.slice(i, i + 25);
          learn(target, await port.list(target, { filter: chunk.map(id => `r.id == '${id}'`).join(' or '), limit: chunk.length }));
        }
      } catch (e) {
        console.warn(`useRecordSearch: could not load '${target}' for reference names on '${entity}':`, e);
      }
    }));
    if (changed) setItems(remember(rowsRef.current));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters are stable
  }, [port, entity, loadAllUpTo, remember]);

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
      rowsRef.current = rows;
      const mapped = remember(rows);
      setItems(mapped);
      void loadRefs(rows);
      // The total the step shows: when everything was loaded, it is what is
      // on screen — the server's count does not know `where` (a client-side
      // restriction after paging), so 3 counted minus 1 kept out read as
      // "2 von 3 angezeigt – Suche verfeinern" without any search (live).
      // Only a server-searched page is legitimately a sample of more.
      if (count === null || filterBroken.current || !strategy.serverSearch) setTotalCount(mapped.length);
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
  }, [port, entity, loadAllUpTo, pageSize, orderKey, filter, remember, loadRefs]);

  useEffect(() => { void load(); }, [load]);

  const onSearch = useMemo(() => serverSearch
    ? async (query: string, signal: AbortSignal) => {
        const rows = keep(await port.list(entity, { search: { query, fields: searchFields }, limit: pageSize, orderby, filter, signal }));
        void loadRefs(rows);
        return remember(rows);
      }
    : undefined,
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keys stand in for the arrays
  [serverSearch, port, entity, fieldsKey, orderKey, filter, pageSize, remember, loadRefs]);

  // A record the page created a moment ago: remembered (labelOf/recordOf
  // answer at once), put first in the list, counted. Whether it passes the
  // step's `where` is not asked — the user just made it, hiding it would
  // look like the create failed.
  const adopt = useCallback((record: JourneyRecord) => {
    const [item] = remember([record]);
    rowsRef.current = [record, ...rowsRef.current.filter(r => r.id !== record.id)];
    setItems(prev => [item, ...prev.filter(i => i.id !== item.id)]);
    setTotalCount(prev => (prev === null ? prev : prev + 1));
  }, [remember]);

  const filtered = Boolean(filter) || typeof where === 'function';

  return {
    select: { items, totalCount, onSearch, loading, error, entity, port, filtered, adopt },
    labelOf: id => seen.current.get(id),
    refLabel,
    recordOf: id => records.current.get(id),
    adopt,
    reload: load,
  };
}
