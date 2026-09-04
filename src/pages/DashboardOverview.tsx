import { useMemo, useState, useCallback } from 'react';
import { format, parseISO, isToday, isPast, isFuture, differenceInDays, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { ResourceTimeline, type ResourceEvent, type ResourceGroup } from '@/components/widgets/ResourceTimeline';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { APP_IDS, lookupOption } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import {
  IconBed,
  IconAlertTriangle,
  IconArrowRight,
  IconCash,
  IconUserCheck,
  IconUsers,
  IconCalendarCheck,
} from '@tabler/icons-react';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    zimmerMap, gaesteMap, buchungenMap,
    setBuchungen, fetchAll,
  } = data;

  const clock = useClock();

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const st = lookupKey(b.fields.status);
        if (st === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void advanceBuchung(b.record_id, 'bestaetigt', 'eingecheckt'),
          };
        }
        if (st === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void advanceBuchung(b.record_id, 'eingecheckt', 'ausgecheckt'),
          };
        }
        if (st === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => void advanceBuchung(b.record_id, 'angefragt', 'bestaetigt'),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;

  // --- Advance booking status (shared helper) ---
  const advanceBuchung = useCallback(async (id: string, fromStatus: string, toStatus: string) => {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    const newStatus = lookupOption('buchungen', 'status', toStatus);
    setBuchungen(bs => bs.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, status: newStatus } } : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: toStatus });
      undoToast(
        toStatus === 'eingecheckt'
          ? tx`${prev.record_id} — eingecheckt`
          : toStatus === 'ausgecheckt'
          ? tx`${prev.record_id} — ausgecheckt`
          : tx`${prev.record_id} — bestätigt`,
        async () => {
          setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
          await LivingAppsService.updateBuchungenEntry(id, { status: fromStatus });
        },
      );
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  // --- Derived data ---
  const todayKey = format(clock, 'yyyy-MM-dd');

  const anreisenHeute = useMemo(() =>
    enrichedBuchungen.filter(b => b.fields.anreise === todayKey && lookupKey(b.fields.status) !== 'storniert'),
    [enrichedBuchungen, todayKey]
  );

  const abreisenHeute = useMemo(() =>
    enrichedBuchungen.filter(b => b.fields.abreise === todayKey && lookupKey(b.fields.status) !== 'storniert'),
    [enrichedBuchungen, todayKey]
  );

  const aktiveGaeste = useMemo(() =>
    enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'),
    [enrichedBuchungen]
  );

  const angefragte = useMemo(() =>
    enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [enrichedBuchungen]
  );

  const offeneRechnungen = useMemo(() =>
    rechnungen.filter(r => lookupKey(r.fields.zahlungsstatus) === 'offen'),
    [rechnungen]
  );

  const ueberfaelligeRechnungen = useMemo(() =>
    offeneRechnungen.filter(r => r.fields.faellig_am && isPast(parseISO(r.fields.faellig_am)) && !isToday(parseISO(r.fields.faellig_am))),
    [offeneRechnungen]
  );

  // Check-in due today but not yet done
  const pendingCheckins = useMemo(() =>
    anreisenHeute.filter(b => lookupKey(b.fields.status) === 'bestaetigt'),
    [anreisenHeute]
  );

  // Belegung this month
  const belegungMonat = useMemo(() => {
    const start = startOfMonth(clock);
    const end = endOfMonth(clock);
    const daysInMonth = end.getDate();
    if (zimmer.length === 0 || daysInMonth === 0) return 0;
    const kapazitaet = zimmer.length * daysInMonth;
    let belegteNaechte = 0;
    for (const b of buchungen) {
      const st = lookupKey(b.fields.status);
      if (st === 'storniert' || !b.fields.anreise) continue;
      const from = parseISO(b.fields.anreise);
      const to = b.fields.abreise ? parseISO(b.fields.abreise) : from;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (isWithinInterval(d, { start: from, end: to })) belegteNaechte++;
      }
    }
    return Math.round((belegteNaechte / kapazitaet) * 100);
  }, [buchungen, zimmer, clock]);

  // --- ResourceTimeline groups (Zimmer as rows) ---
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer
      .sort((a, b) => {
        const katOrder: Record<string, number> = { einzelzimmer: 0, doppelzimmer: 1, suite: 2 };
        const ka = katOrder[lookupKey(a.fields.kategorie) ?? ''] ?? 9;
        const kb = katOrder[lookupKey(b.fields.kategorie) ?? ''] ?? 9;
        if (ka !== kb) return ka - kb;
        return (a.fields.etage ?? 0) - (b.fields.etage ?? 0);
      })
      .map(z => ({
        key: z.record_id,
        label: z.fields.bezeichnung ?? z.record_id,
        tone: 'default' as const,
      })),
    [zimmer]
  );

  // --- ResourceTimeline events ---
  const events = useMemo<ResourceEvent[]>(
    () =>
      enrichedBuchungen
        .filter(b => !!b.fields.anreise && lookupKey(b.fields.status) !== 'storniert')
        .map(b => {
          const st = lookupKey(b.fields.status);
          const tone =
            st === 'eingecheckt' ? 'success' as const
            : st === 'angefragt' ? 'warning' as const
            : 'primary' as const;
          return {
            id: `buchung:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title: b.gastName || tx('Gast'),
            subtitle: b.zimmerName,
            tone,
            group: extractRecordId(b.fields.zimmer) ?? '',
          };
        }),
    [enrichedBuchungen]
  );

  // --- Doppelbelegungsprüfung ---
  const checkDoubleBooking = useCallback((
    id: string,
    newStart: string,
    newEnd?: string,
    newGroup?: string
  ): string | undefined => {
    const bid = id.split(':')[1] ?? '';
    const targetRoom = newGroup ?? extractRecordId(buchungen.find(b => b.record_id === bid)?.fields.zimmer ?? '');
    if (!targetRoom) return undefined;
    const startDate = parseISO(newStart);
    const endDate = newEnd ? parseISO(newEnd) : startDate;
    for (const b of buchungen) {
      if (b.record_id === bid) continue;
      const bRoom = extractRecordId(b.fields.zimmer);
      if (bRoom !== targetRoom) continue;
      const st = lookupKey(b.fields.status);
      if (st === 'storniert') continue;
      if (!b.fields.anreise) continue;
      const bStart = parseISO(b.fields.anreise);
      const bEnd = b.fields.abreise ? parseISO(b.fields.abreise) : bStart;
      if (startDate <= bEnd && endDate >= bStart) {
        const gName = enrichedBuchungen.find(e => e.record_id === b.record_id)?.gastName || tx('anderer Gast');
        return tx`Zimmer bereits belegt (${gName})`;
      }
    }
    return undefined;
  }, [buchungen, enrichedBuchungen]);

  // --- onEventDrop ---
  const handleEventDrop = useCallback(async (
    id: string,
    newStart: string,
    newEnd?: string,
    newGroup?: string
  ): Promise<void | string> => {
    const conflict = checkDoubleBooking(id, newStart, newEnd, newGroup);
    if (conflict) return conflict;
    const bid = id.split(':')[1] ?? '';
    const prev = buchungen.find(b => b.record_id === bid);
    if (!prev) return;
    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    setBuchungen(bs => bs.map(b =>
      b.record_id === bid
        ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(bid, {
        anreise: newStart,
        ...(newEnd ? { abreise: newEnd } : {}),
        ...zimmerPatch,
      });
      undoToast(tx('Buchung verschoben'), async () => {
        setBuchungen(bs => bs.map(b => b.record_id === bid ? prev : b));
        await LivingAppsService.updateBuchungenEntry(bid, {
          anreise: prev.fields.anreise,
          abreise: prev.fields.abreise,
          zimmer: prev.fields.zimmer,
        });
      });
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll, checkDoubleBooking]);

  // --- onEventResize ---
  const handleEventResize = useCallback(async (
    id: string,
    newStart: string,
    newEnd: string
  ): Promise<void | string> => {
    const conflict = checkDoubleBooking(id, newStart, newEnd);
    if (conflict) return conflict;
    const bid = id.split(':')[1] ?? '';
    const prev = buchungen.find(b => b.record_id === bid);
    if (!prev) return;
    setBuchungen(bs => bs.map(b =>
      b.record_id === bid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(bid, { anreise: newStart, abreise: newEnd });
      undoToast(tx('Buchung angepasst'), async () => {
        setBuchungen(bs => bs.map(b => b.record_id === bid ? prev : b));
        await LivingAppsService.updateBuchungenEntry(bid, {
          anreise: prev.fields.anreise,
          abreise: prev.fields.abreise,
        });
      });
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll, checkDoubleBooking]);

  // --- Context line ---
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (anreisenHeute.length > 0) {
      const names = namen(anreisenHeute.map(b => b.gastName));
      parts.push(`${names} ${anreisenHeute.length === 1 ? tx('reist an') : tx('reisen an')}`);
    }
    if (abreisenHeute.length > 0) {
      const names = namen(abreisenHeute.map(b => b.gastName));
      parts.push(`${names} ${abreisenHeute.length === 1 ? tx('reist ab') : tx('reisen ab')}`);
    }
    if (aktiveGaeste.length > 0) {
      parts.push(tx`${aktiveGaeste.length} Gäste eingecheckt`);
    }
    if (parts.length === 0) return tx('Heute keine Bewegungen — ruhiger Tag.');
    return parts.join(' · ');
  }, [anreisenHeute, abreisenHeute, aktiveGaeste]);

  // --- Hero: offene Anfragen oder überfällige Rechnungen ---
  const urgentAnfrage = angefragte[0];
  const urgentRechnung = ueberfaelligeRechnungen[0];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          onClick={() => crud.buchungen.openCreate({ status: 'angefragt' })}
          className="mt-3 sm:mt-0 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 shrink-0"
        >
          <IconBed size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          urgentAnfrage ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: tx('Bestätigen'),
                onClick: () => void advanceBuchung(urgentAnfrage.record_id, 'angefragt', 'bestaetigt'),
              }}
            >
              {angefragte.length === 1
                ? tx`Anfrage von ${urgentAnfrage.gastName || '—'} wartet auf Bestätigung — Zimmer ${urgentAnfrage.zimmerName || '—'}, Anreise ${formatDate(urgentAnfrage.fields.anreise)}`
                : tx`${angefragte.length} Anfragen warten auf Bestätigung — zuerst ${urgentAnfrage.gastName || '—'}`
              }
            </HeroBanner>
          ) : urgentRechnung ? (
            <HeroBanner
              icon={<IconCash size={18} />}
              action={{
                label: tx('Rechnung öffnen'),
                onClick: () => crud.rechnungen.openDetail(urgentRechnung),
              }}
            >
              {ueberfaelligeRechnungen.length === 1
                ? tx`Rechnung ${formatCurrency(urgentRechnung.fields.betrag)} überfällig seit ${formatDate(urgentRechnung.fields.faellig_am)}`
                : tx`${ueberfaelligeRechnungen.length} Rechnungen überfällig — älteste seit ${formatDate(urgentRechnung.fields.faellig_am)}`
              }
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Eingecheckt')}
              value={aktiveGaeste.length}
              icon={<IconUserCheck size={16} className="shrink-0" />}
              tone={aktiveGaeste.length > 0 ? 'success' : 'default'}
              onClick={() => crud.buchungen.openCreate({ status: 'eingecheckt' })}
            />
            <StatStripItem
              title={tx('Anreisen heute')}
              value={anreisenHeute.length}
              icon={<IconUsers size={16} className="shrink-0" />}
              tone={pendingCheckins.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Abreisen heute')}
              value={abreisenHeute.length}
              icon={<IconCalendarCheck size={16} className="shrink-0" />}
              tone="default"
            />
            <StatStripItem
              title={tx('Auslastung Monat')}
              value={`${belegungMonat}%`}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={belegungMonat > 80 ? 'success' : belegungMonat > 40 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconCash size={16} className="shrink-0" />}
              tone={ueberfaelligeRechnungen.length > 0 ? 'destructive' : offeneRechnungen.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <ResourceTimeline
            events={events}
            groups={groups}
            axis="day"
            defaultRange="week"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const bid = ev.id.split(':')[1] ?? '';
              const rec = buchungen.find(b => b.record_id === bid);
              if (rec) crud.buchungen.openDetail(rec);
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onRangeCreate={(start, end, group) => {
              crud.buchungen.openCreate({
                anreise: format(start, 'yyyy-MM-dd'),
                abreise: format(end, 'yyyy-MM-dd'),
                zimmer: group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined,
                status: 'angefragt',
              });
            }}
            onEmptyClick={(date, group) => {
              crud.buchungen.openCreate({
                anreise: format(date, 'yyyy-MM-dd'),
                zimmer: group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined,
                status: 'angefragt',
              });
            }}
            renderGroupHeader={group => {
              const z = zimmer.find(z => z.record_id === group.key);
              const kat = z?.fields.kategorie?.label ?? '';
              const etage = z?.fields.etage != null ? tx`${z.fields.etage}. Etage` : '';
              return (
                <div className="flex w-full flex-col min-w-0">
                  <span className="truncate text-sm font-semibold text-foreground">{group.label}</span>
                  <span className="truncate text-xs text-muted-foreground">{[kat, etage].filter(Boolean).join(' · ')}</span>
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute — Anreisen & Auschecken')}
              items={[
                ...anreisenHeute.map(b => ({
                  id: `an:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <span className="flex items-center gap-1 flex-wrap">
                      <span className="font-medium text-primary text-xs">{tx('Anreise')}</span>
                      <span className="text-muted-foreground text-xs"> · {b.zimmerName || tx('Zimmer unbekannt')}</span>
                      {lookupKey(b.fields.status) === 'bestaetigt' && (
                        <span className="ml-1 text-xs font-semibold text-amber-600">{tx('ausstehend')}</span>
                      )}
                      {lookupKey(b.fields.status) === 'eingecheckt' && (
                        <span className="ml-1 text-xs font-semibold text-emerald-600">{tx('eingecheckt')}</span>
                      )}
                    </span>
                  ),
                  action: lookupKey(b.fields.status) === 'bestaetigt'
                    ? { label: tx('Einchecken'), onClick: () => void advanceBuchung(b.record_id, 'bestaetigt', 'eingecheckt') }
                    : undefined,
                })),
                ...abreisenHeute.map(b => ({
                  id: `ab:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <span className="flex items-center gap-1 flex-wrap">
                      <span className="font-medium text-muted-foreground text-xs">{tx('Abreise')}</span>
                      <span className="text-muted-foreground text-xs"> · {b.zimmerName || tx('Zimmer unbekannt')}</span>
                      {lookupKey(b.fields.status) === 'eingecheckt' && (
                        <span className="ml-1 text-xs font-semibold text-amber-600">{tx('ausstehend')}</span>
                      )}
                    </span>
                  ),
                  action: lookupKey(b.fields.status) === 'eingecheckt'
                    ? { label: tx('Auschecken'), onClick: () => void advanceBuchung(b.record_id, 'eingecheckt', 'ausgecheckt') }
                    : undefined,
                })),
              ]}
              onItemClick={id => {
                const bid = id.replace(/^(an|ab):/, '');
                const rec = buchungen.find(b => b.record_id === bid);
                if (rec) crud.buchungen.openDetail(rec);
              }}
              empty={{
                text: tx('Heute keine Anreisen oder Abreisen'),
                action: { label: tx('Neue Buchung'), onClick: () => crud.buchungen.openCreate({ status: 'angefragt' }) },
              }}
              max={8}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={offeneRechnungen.slice(0, 6).map(r => {
                const buchung = buchungenMap.get(extractRecordId(r.fields.buchung) ?? '');
                const gast = buchung ? gaesteMap.get(extractRecordId(buchung.fields.gast) ?? '') : undefined;
                const gastName = gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : tx('Gast unbekannt');
                const isUeberfaellig = r.fields.faellig_am && isPast(parseISO(r.fields.faellig_am)) && !isToday(parseISO(r.fields.faellig_am));
                return {
                  id: r.record_id,
                  title: gastName,
                  secondLine: (
                    <span className="flex items-center gap-1 flex-wrap">
                      <span className={`font-semibold text-xs ${isUeberfaellig ? 'text-destructive' : 'text-amber-600'}`}>
                        {formatCurrency(r.fields.betrag)}
                      </span>
                      {r.fields.faellig_am && (
                        <span className="text-muted-foreground text-xs">
                          {' · '}
                          {isUeberfaellig
                            ? tx`${differenceInDays(clock, parseISO(r.fields.faellig_am))} Tage überfällig`
                            : tx`fällig ${formatDate(r.fields.faellig_am)}`
                          }
                        </span>
                      )}
                    </span>
                  ),
                  action: {
                    label: tx('Öffnen'),
                    onClick: () => crud.rechnungen.openDetail(r),
                  },
                };
              })}
              onItemClick={id => {
                const r = rechnungen.find(r => r.record_id === id);
                if (r) crud.rechnungen.openDetail(r);
              }}
              empty={{
                text: tx('Alle Rechnungen beglichen — keine offenen Posten'),
                action: { label: tx('Rechnung erstellen'), onClick: () => crud.rechnungen.openCreate({}) },
              }}
            />
          </>
        }
      />

      {crud.surfaces}
    </div>
  );
}
