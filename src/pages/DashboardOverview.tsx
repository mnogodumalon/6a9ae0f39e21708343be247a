import { useMemo, useCallback } from 'react';
import { format, parseISO, isToday, isBefore, differenceInDays, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { WorkList } from '@/components/WorkList';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { ResourceTimeline, type ResourceEvent, type ResourceGroup } from '@/components/widgets/ResourceTimeline';
import { tx, appLabel } from '@/i18n';
import { dateFnsLocale } from '@/i18n';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { extractRecordId, createRecordUrl, LivingAppsService } from '@/services/livingAppsService';
import { lookupOption, APP_IDS } from '@/types/app';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { IconBed, IconAlertCircle, IconUsers, IconReceipt, IconCalendar, IconCheck } from '@tabler/icons-react';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    setBuchungen, fetchAll,
  } = data;

  const clock = useClock();

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const status = lookupKey(b.fields.status);
        if (status === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => void confirmBuchung(b.record_id),
          };
        }
        if (status === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void checkinBuchung(b.record_id),
          };
        }
        if (status === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void checkoutBuchung(b.record_id),
          };
        }
      }
      return undefined;
    },
  });
  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // --- Derived data ---
  const todayKey = format(clock, 'yyyy-MM-dd');

  const confirmBuchung = useCallback(async (id: string) => {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'bestaetigt') } }
      : b
    ));
    undoToast(tx`Buchung bestätigt`, async () => {
      setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
      await LivingAppsService.updateBuchungenEntry(id, { status: 'angefragt' });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'bestaetigt' });
    } catch {
      fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  const checkinBuchung = useCallback(async (id: string) => {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'eingecheckt') } }
      : b
    ));
    undoToast(tx`Eingecheckt`, async () => {
      setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
      await LivingAppsService.updateBuchungenEntry(id, { status: 'bestaetigt' });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'eingecheckt' });
    } catch {
      fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  const checkoutBuchung = useCallback(async (id: string) => {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'ausgecheckt') } }
      : b
    ));
    undoToast(tx`Ausgecheckt`, async () => {
      setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
      await LivingAppsService.updateBuchungenEntry(id, { status: 'eingecheckt' });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'ausgecheckt' });
    } catch {
      fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  // ResourceTimeline groups (rooms as rows)
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({ key: z.record_id, label: z.fields.bezeichnung ?? z.record_id })),
    [zimmer],
  );

  // Map bookings to timeline events (only confirmed/checked-in/requested)
  const events = useMemo<ResourceEvent[]>(() => {
    return enrichedBuchungen
      .filter(b => {
        const s = lookupKey(b.fields.status);
        return !!b.fields.anreise && s !== 'storniert' && s !== 'ausgecheckt';
      })
      .map(b => {
        const s = lookupKey(b.fields.status);
        const tone = s === 'angefragt' ? 'warning'
          : s === 'eingecheckt' ? 'success'
          : 'primary';
        const roomId = extractRecordId(b.fields.zimmer) ?? '';
        return {
          id: `buchung:${b.record_id}`,
          start: b.fields.anreise!,
          end: b.fields.abreise,
          allDay: true,
          title: b.gastName || b.zimmerName || tx('Buchung'),
          subtitle: b.fields.status?.label,
          tone,
          group: roomId,
        };
      });
  }, [enrichedBuchungen]);

  // Occupancy stats
  const occupancyByRoom = useMemo(() => {
    const monthStart = startOfMonth(clock);
    const monthEnd = endOfMonth(clock);
    const daysInMonth = monthEnd.getDate();
    const counts = new Map<string, number>();
    for (const b of buchungen) {
      const roomId = extractRecordId(b.fields.zimmer);
      if (!roomId || !b.fields.anreise) continue;
      const s = lookupKey(b.fields.status);
      if (s === 'storniert') continue;
      const from = parseISO(b.fields.anreise);
      const to = b.fields.abreise ? parseISO(b.fields.abreise) : from;
      let occupied = 0;
      for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 1)) {
        if (isWithinInterval(d, { start: from, end: to })) occupied++;
      }
      counts.set(roomId, (counts.get(roomId) ?? 0) + occupied);
    }
    const pct = new Map<string, number>();
    for (const [roomId, occ] of counts) {
      pct.set(roomId, Math.round((occ / daysInMonth) * 100));
    }
    return pct;
  }, [buchungen, clock]);

  // Anfragen (unconfirmed)
  const anfragen = useMemo(
    () => enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [enrichedBuchungen],
  );

  // Today arrivals (confirmed, not yet checked in)
  const heuteAnreise = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.anreise === todayKey && lookupKey(b.fields.status) === 'bestaetigt'
    ),
    [enrichedBuchungen, todayKey],
  );

  // Currently checked in
  const eingecheckt = useMemo(
    () => enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'),
    [enrichedBuchungen],
  );

  // Today checkouts
  const heuteAbreise = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.abreise === todayKey && lookupKey(b.fields.status) === 'eingecheckt'
    ),
    [enrichedBuchungen, todayKey],
  );

  // Open invoices
  const offeneRechnungen = useMemo(
    () => enrichedRechnungen.filter(r => {
      const s = lookupKey(r.fields.zahlungsstatus);
      return s === 'offen' || s === 'teilweise_bezahlt';
    }),
    [enrichedRechnungen],
  );

  // Overdue invoices
  const ueberfaelligeRechnungen = useMemo(
    () => offeneRechnungen.filter(r =>
      r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), clock)
    ),
    [offeneRechnungen, clock],
  );

  // Context line: name people arriving/departing today
  const contextLine = useMemo(() => {
    const anreisende = heuteAnreise.map(b => b.gastName).filter(Boolean);
    const abreisende = heuteAbreise.map(b => b.gastName).filter(Boolean);
    if (anreisende.length === 0 && abreisende.length === 0) {
      if (eingecheckt.length > 0) {
        return tx`${eingecheckt.length} Gäste sind aktuell eingecheckt.`;
      }
      return tx('Heute keine Ankünfte oder Abreisen.');
    }
    const parts: string[] = [];
    if (anreisende.length > 0) parts.push(tx`Heute kommen ${namen(anreisende)}.`);
    if (abreisende.length > 0) parts.push(tx`Abreise: ${namen(abreisende)}.`);
    return parts.join(' ');
  }, [heuteAnreise, heuteAbreise, eingecheckt]);

  // Drag reschedule
  const reschedule = useCallback(async (id: string, newStart: string, newEnd?: string, newGroup?: string) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    // Overlap check: would this create a double booking?
    if (newGroup) {
      const conflicting = buchungen.filter(b => {
        if (b.record_id === rid) return false;
        const s = lookupKey(b.fields.status);
        if (s === 'storniert' || s === 'ausgecheckt') return false;
        const bRoom = extractRecordId(b.fields.zimmer);
        if (bRoom !== newGroup) return false;
        if (!b.fields.anreise) return false;
        const bStart = b.fields.anreise;
        const bEnd = b.fields.abreise ?? bStart;
        const movEnd = newEnd ?? newStart;
        return !(movEnd < bStart || newStart > bEnd);
      });
      if (conflicting.length > 0) {
        return tx('Zimmer bereits belegt in diesem Zeitraum.');
      }
    }
    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;
    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    setBuchungen(bs => bs.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
        : b
    ));
    undoToast(tx`Buchung verschoben`, async () => {
      setBuchungen(bs => bs.map(b => b.record_id === rid ? prev : b));
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: prev.fields.anreise,
        abreise: prev.fields.abreise,
        zimmer: prev.fields.zimmer ?? undefined,
      });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: newStart,
        ...(newEnd ? { abreise: newEnd } : {}),
        ...zimmerPatch,
      });
    } catch {
      fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  const resize = useCallback(async (id: string, newStart: string, newEnd: string) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;
    setBuchungen(bs => bs.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b
    ));
    undoToast(tx`Aufenthalt angepasst`, async () => {
      setBuchungen(bs => bs.map(b => b.record_id === rid ? prev : b));
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: prev.fields.anreise,
        abreise: prev.fields.abreise,
      });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
    } catch {
      fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  // Hero: offene Anfragen need confirmation
  const heroAnfrage = anfragen[0];

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground truncate">
            {gruss(clock)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <button
          className="shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
          onClick={() => crud.buchungen.openCreate({ status: 'bestaetigt' })}
        >
          <IconBed size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroAnfrage && anfragen.length > 0 ? (
            <HeroBanner
              icon={<IconAlertCircle size={18} />}
              action={{
                label: tx('Bestätigen'),
                onClick: () => void confirmBuchung(heroAnfrage.record_id),
              }}
            >
              <b>{namen(anfragen.map(b => b.gastName).filter(Boolean))}</b>
              {anfragen.length === 1
                ? tx` — Anfrage wartet auf Bestätigung.`
                : tx` — ${anfragen.length} Anfragen warten auf Bestätigung.`
              }
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Heute Anreise')}
              value={heuteAnreise.length}
              icon={<IconCalendar size={16} />}
              tone={heuteAnreise.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Eingecheckt')}
              value={eingecheckt.length}
              icon={<IconUsers size={16} />}
              tone={eingecheckt.length > 0 ? 'success' : 'default'}
            />
            <StatStripItem
              title={tx('Heute Abreise')}
              value={heuteAbreise.length}
              icon={<IconBed size={16} />}
              tone={heuteAbreise.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconReceipt size={16} />}
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
              const rid = ev.id.split(':')[1] ?? '';
              const rec = buchungen.find(b => b.record_id === rid);
              if (rec) crud.buchungen.openDetail(rec);
            }}
            onEventDrop={reschedule}
            onEventResize={resize}
            onRangeCreate={(start, end, group) => {
              crud.buchungen.openCreate({
                anreise: format(start, 'yyyy-MM-dd'),
                abreise: format(end, 'yyyy-MM-dd'),
                zimmer: group,
              });
            }}
            onEmptyClick={(date, group) => {
              crud.buchungen.openCreate({
                anreise: format(date, 'yyyy-MM-dd'),
                zimmer: group,
              });
            }}
            renderEvent={(ev, meta) => (
              <div className="flex items-center gap-1 truncate text-xs">
                <IconBed className="h-3 w-3 shrink-0 opacity-70" />
                {meta.isStart && <span className="truncate font-medium">{ev.title}</span>}
              </div>
            )}
            renderGroupHeader={group => {
              const z = zimmer.find(z => z.record_id === group.key);
              const pct = occupancyByRoom.get(group.key) ?? 0;
              return (
                <div className="flex w-full items-center justify-between gap-1 min-w-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{group.label}</div>
                    {z?.fields.kategorie && (
                      <div className="truncate text-[11px] text-muted-foreground">{z.fields.kategorie.label}</div>
                    )}
                  </div>
                  {pct > 0 && (
                    <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                      {pct}%
                    </span>
                  )}
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute & bald')}
              items={[
                ...heuteAnreise.map(b => ({
                  id: `anreise:${b.record_id}`,
                  title: b.gastName || tx('Unbekannter Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-primary">{tx('Anreise heute')}</span>
                      {b.zimmerName && <span className="text-muted-foreground"> · {b.zimmerName}</span>}
                    </>
                  ),
                  action: {
                    label: tx('Einchecken'),
                    onClick: () => void checkinBuchung(b.record_id),
                  },
                })),
                ...heuteAbreise.map(b => ({
                  id: `abreise:${b.record_id}`,
                  title: b.gastName || tx('Unbekannter Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-amber-600">{tx('Abreise heute')}</span>
                      {b.zimmerName && <span className="text-muted-foreground"> · {b.zimmerName}</span>}
                    </>
                  ),
                  action: {
                    label: tx('Auschecken'),
                    onClick: () => void checkoutBuchung(b.record_id),
                  },
                })),
              ]}
              onItemClick={id => {
                const rid = id.split(':')[1] ?? '';
                const rec = buchungen.find(b => b.record_id === rid);
                if (rec) crud.buchungen.openDetail(rec);
              }}
              empty={{
                text: tx('Keine Ankünfte oder Abreisen heute.'),
                action: { label: tx('Buchung anlegen'), onClick: () => crud.buchungen.openCreate({ status: 'bestaetigt' }) },
              }}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={offeneRechnungen.slice(0, 8).map(r => {
                const isOverdue = r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), clock);
                const buchung = buchungen.find(b => b.record_id === extractRecordId(r.fields.buchung));
                const gast = buchung ? enrichedBuchungen.find(eb => eb.record_id === buchung.record_id) : undefined;
                return {
                  id: r.record_id,
                  title: gast?.gastName || r.buchungName || tx('Rechnung'),
                  secondLine: (
                    <>
                      <span className={isOverdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                        {isOverdue ? tx('Überfällig') : r.fields.zahlungsstatus?.label}
                      </span>
                      {r.fields.betrag != null && (
                        <span className="text-muted-foreground"> · {formatCurrency(r.fields.betrag)}</span>
                      )}
                      {r.fields.faellig_am && (
                        <span className="text-muted-foreground"> · {formatDate(r.fields.faellig_am)}</span>
                      )}
                    </>
                  ),
                  action: {
                    label: tx('Als bezahlt markieren'),
                    onClick: () => {
                      const prevR = rechnungen.find(x => x.record_id === r.record_id);
                      if (!prevR) return;
                      // Optimistic update not available for rechnungen directly, trigger detail
                      crud.rechnungen.openDetail(r);
                    },
                  },
                };
              })}
              onItemClick={id => {
                const rec = rechnungen.find(r => r.record_id === id);
                if (rec) crud.rechnungen.openDetail(rec);
              }}
              empty={{
                text: tx('Alle Rechnungen bezahlt.'),
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
