import { useMemo, useCallback } from 'react';
import { format, parseISO, isToday, isBefore, isAfter, startOfDay } from 'date-fns';
import { tx, appLabel } from '@/i18n';
import { dateFnsLocale } from '@/i18n';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { ResourceTimeline, type ResourceEvent, type ResourceGroup } from '@/components/widgets/ResourceTimeline';
import {
  IconBed,
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconFileInvoice,
  IconCalendarOff,
} from '@tabler/icons-react';
import { APP_IDS, lookupOption } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste,
    zimmer,
    buchungen,
    rechnungen,
    setBuchungen,
    fetchAll,
  } = data;

  const clock = useClock();
  const todayKey = format(clock, 'yyyy-MM-dd');

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const status = b.fields.status?.key;
        if (status === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => void advanceStatus(b.record_id, 'bestaetigt', b.fields.status?.key ?? ''),
          };
        }
        if (status === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void advanceStatus(b.record_id, 'eingecheckt', b.fields.status?.key ?? ''),
          };
        }
        if (status === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void advanceStatus(b.record_id, 'ausgecheckt', b.fields.status?.key ?? ''),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // ── Status-advance helper (shared across hero, worklist, overlay footer) ──
  const advanceStatus = useCallback(
    async (recordId: string, newStatus: string, oldStatus: string) => {
      const prev = buchungen.map(b => ({ ...b }));
      const newStatusVal = lookupOption('buchungen', 'status', newStatus);
      const oldStatusVal = lookupOption('buchungen', 'status', oldStatus);
      setBuchungen(bList =>
        bList.map(b =>
          b.record_id === recordId ? { ...b, fields: { ...b.fields, status: newStatusVal } } : b,
        ),
      );
      try {
        await LivingAppsService.updateBuchungenEntry(recordId, { status: newStatus });
        undoToast(tx`Status auf ${newStatusVal.label} gesetzt`, async () => {
          setBuchungen(prev);
          await LivingAppsService.updateBuchungenEntry(recordId, { status: oldStatus });
        });
      } catch {
        setBuchungen(prev);
        await fetchAll();
      }
    },
    [buchungen, setBuchungen, fetchAll],
  );

  // ── Drag-reschedule with double-booking guard ──
  const handleEventDrop = useCallback(
    async (id: string, newStart: string, newEnd?: string, newGroup?: string) => {
      const rid = id.split(':')[1] ?? '';
      if (!rid) return;

      // Double-booking check: reject if another booking already occupies newGroup in [newStart, newEnd]
      if (newGroup) {
        const conflict = buchungen.find(b => {
          if (b.record_id === rid) return false;
          const roomId = extractRecordId(b.fields.zimmer);
          if (roomId !== newGroup) return false;
          const bStart = b.fields.anreise ?? '';
          const bEnd = b.fields.abreise ?? bStart;
          const dragEnd = newEnd ?? newStart;
          return bStart <= dragEnd && bEnd >= newStart;
        });
        if (conflict) {
          const guestName = enrichedBuchungen.find(b => b.record_id === conflict.record_id)?.gastName ?? '';
          return guestName
            ? tx`Zimmer bereits belegt (${guestName})`
            : tx('Zimmer in diesem Zeitraum bereits belegt');
        }
      }

      const zimmerPatch = newGroup
        ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) }
        : {};

      const prev = buchungen.map(b => ({ ...b }));
      setBuchungen(bList =>
        bList.map(b =>
          b.record_id === rid
            ? {
                ...b,
                fields: {
                  ...b.fields,
                  anreise: newStart,
                  ...(newEnd ? { abreise: newEnd } : {}),
                  ...zimmerPatch,
                },
              }
            : b,
        ),
      );
      try {
        await LivingAppsService.updateBuchungenEntry(rid, {
          anreise: newStart,
          ...(newEnd ? { abreise: newEnd } : {}),
          ...zimmerPatch,
        });
        undoToast(tx('Buchung verschoben'), async () => {
          setBuchungen(prev);
          const origBook = prev.find(b => b.record_id === rid);
          if (origBook) {
            await LivingAppsService.updateBuchungenEntry(rid, {
              anreise: origBook.fields.anreise,
              abreise: origBook.fields.abreise,
              zimmer: origBook.fields.zimmer ?? undefined,
            });
          }
        });
      } catch {
        setBuchungen(prev);
        await fetchAll();
      }
    },
    [buchungen, enrichedBuchungen, setBuchungen, fetchAll],
  );

  const handleEventResize = useCallback(
    async (id: string, newStart: string, newEnd: string) => {
      const rid = id.split(':')[1] ?? '';
      if (!rid) return;
      const prev = buchungen.map(b => ({ ...b }));
      setBuchungen(bList =>
        bList.map(b =>
          b.record_id === rid
            ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
            : b,
        ),
      );
      try {
        await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
        undoToast(tx('Aufenthalt angepasst'), async () => {
          setBuchungen(prev);
          const origBook = prev.find(b => b.record_id === rid);
          if (origBook) {
            await LivingAppsService.updateBuchungenEntry(rid, {
              anreise: origBook.fields.anreise,
              abreise: origBook.fields.abreise,
            });
          }
        });
      } catch {
        setBuchungen(prev);
        await fetchAll();
      }
    },
    [buchungen, setBuchungen, fetchAll],
  );

  // ── Widget data ──
  const groups = useMemo<ResourceGroup[]>(
    () =>
      zimmer.map(z => ({
        key: z.record_id,
        label: z.fields.bezeichnung ?? z.record_id,
        tone: undefined as undefined,
      })),
    [zimmer],
  );

  const events = useMemo<ResourceEvent[]>(() => {
    const LOOKUP_OPTIONS_STATUS: Record<string, string> = {
      angefragt: 'warning',
      bestaetigt: 'primary',
      eingecheckt: 'success',
      ausgecheckt: 'default',
      storniert: 'destructive',
    };
    return buchungen
      .filter(b => !!b.fields.anreise)
      .map(b => {
        const eRec = enrichedBuchungen.find(e => e.record_id === b.record_id);
        return {
          id: `buchung:${b.record_id}`,
          start: b.fields.anreise!,
          end: b.fields.abreise,
          allDay: true,
          title: eRec?.gastName || tx('Unbekannter Gast'),
          subtitle: b.fields.status?.label,
          tone: (LOOKUP_OPTIONS_STATUS[b.fields.status?.key ?? ''] ?? 'default') as ResourceEvent['tone'],
          group: extractRecordId(b.fields.zimmer) ?? '',
        };
      });
  }, [buchungen, enrichedBuchungen]);

  // ── KPI derivations ──
  const aktiveBuchungen = useMemo(
    () =>
      buchungen.filter(
        b =>
          b.fields.status?.key !== 'storniert' &&
          b.fields.status?.key !== 'ausgecheckt',
      ),
    [buchungen],
  );

  const heuteEingecheckt = useMemo(
    () =>
      buchungen.filter(
        b =>
          b.fields.status?.key === 'eingecheckt' &&
          b.fields.anreise === todayKey,
      ),
    [buchungen, todayKey],
  );

  const heuteAuschecken = useMemo(
    () =>
      buchungen.filter(
        b =>
          b.fields.status?.key === 'eingecheckt' &&
          b.fields.abreise === todayKey,
      ),
    [buchungen, todayKey],
  );

  const heuteAnreisen = useMemo(
    () =>
      enrichedBuchungen.filter(
        b =>
          b.fields.anreise === todayKey &&
          (b.fields.status?.key === 'bestaetigt' || b.fields.status?.key === 'eingecheckt'),
      ),
    [enrichedBuchungen, todayKey],
  );

  const offeneAnfragen = useMemo(
    () => enrichedBuchungen.filter(b => b.fields.status?.key === 'angefragt'),
    [enrichedBuchungen],
  );

  const offeneRechnungen = useMemo(
    () =>
      enrichedRechnungen.filter(
        b => b.fields.zahlungsstatus?.key === 'offen' || b.fields.zahlungsstatus?.key === 'teilweise_bezahlt',
      ),
    [enrichedRechnungen],
  );

  const ueberfaelligeRechnungen = useMemo(
    () =>
      offeneRechnungen.filter(
        r =>
          r.fields.faellig_am &&
          isBefore(parseISO(r.fields.faellig_am), startOfDay(clock)),
      ),
    [offeneRechnungen, clock],
  );

  // Zimmer frei heute (nicht belegt mit eingecheckt oder bestaetigt mit anreise heute)
  const belegteZimmerIds = useMemo(
    () =>
      new Set(
        buchungen
          .filter(
            b =>
              b.fields.zimmer &&
              (b.fields.status?.key === 'eingecheckt' ||
                (b.fields.status?.key === 'bestaetigt' &&
                  b.fields.anreise === todayKey)),
          )
          .map(b => extractRecordId(b.fields.zimmer))
          .filter(Boolean),
      ),
    [buchungen, todayKey],
  );

  const zimmerFreiHeute = zimmer.length - belegteZimmerIds.size;

  // ── Context line ──
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (heuteAnreisen.length > 0) {
      const names = namen(heuteAnreisen.map(b => b.gastName));
      parts.push(tx`${names} reist heute an.`);
    }
    if (heuteAuschecken.length > 0) {
      const names = namen(heuteAuschecken.map(b => {
        const e = enrichedBuchungen.find(x => x.record_id === b.record_id);
        return e?.gastName ?? '';
      }).filter(Boolean));
      parts.push(tx`${names} checkt heute aus.`);
    }
    if (parts.length === 0 && zimmerFreiHeute > 0) {
      return tx`${String(zimmerFreiHeute)} Zimmer heute frei.`;
    }
    if (parts.length === 0) {
      return tx('Alle Zimmer belegt.');
    }
    return parts.join(' ');
  }, [heuteAnreisen, heuteAuschecken, enrichedBuchungen, zimmerFreiHeute]);

  // ── Hero: überfällige Rechnungen sind die kritischste Situation ──
  const heroRechnung = ueberfaelligeRechnungen[0];

  // ── Aside: Heute ein-/auschecken ──
  const heuteAktionen = useMemo(() => {
    const ankommend = enrichedBuchungen.filter(
      b =>
        b.fields.anreise === todayKey &&
        b.fields.status?.key === 'bestaetigt',
    );
    const abreisend = enrichedBuchungen.filter(
      b =>
        b.fields.abreise === todayKey &&
        b.fields.status?.key === 'eingecheckt',
    );
    return [...ankommend, ...abreisend];
  }, [enrichedBuchungen, todayKey]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contextLine}</p>
        </div>
        <button
          onClick={() => crud.buchungen.openCreate({ status: 'bestaetigt' })}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors self-start sm:self-auto"
        >
          <IconBed size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          heroRechnung
            ? (
              <HeroBanner
                icon={<IconAlertTriangle size={18} />}
                action={{
                  label: tx('Rechnung öffnen'),
                  onClick: () => crud.rechnungen.openDetail(rechnungen.find(r => r.record_id === heroRechnung.record_id)!),
                }}
              >
                <b>{tx`${ueberfaelligeRechnungen.length === 1 ? tx('Eine Rechnung') : tx`${String(ueberfaelligeRechnungen.length)} Rechnungen`} überfällig`}</b>
                {' — '}
                {tx`Fällig seit ${formatDate(heroRechnung.fields.faellig_am)}, Betrag ${formatCurrency(heroRechnung.fields.betrag)}.`}
              </HeroBanner>
            )
            : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Zimmer frei heute')}
              value={zimmerFreiHeute}
              icon={<IconCalendarOff size={16} />}
              tone={zimmerFreiHeute > 0 ? 'success' : 'default'}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconClock size={16} />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Eingecheckt')}
              value={buchungen.filter(b => b.fields.status?.key === 'eingecheckt').length}
              icon={<IconBed size={16} />}
              tone="primary"
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconFileInvoice size={16} />}
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
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
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
            renderGroupHeader={group => {
              const zim = zimmer.find(z => z.record_id === group.key);
              const isBelegt = belegteZimmerIds.has(group.key);
              return (
                <div className="flex w-full items-center justify-between gap-1 min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">
                    {zim?.fields.bezeichnung ?? group.label}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      isBelegt
                        ? 'bg-primary/10 text-primary'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}
                  >
                    {isBelegt ? tx('Belegt') : tx('Frei')}
                  </span>
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute aktiv')}
              items={heuteAktionen.map(b => {
                const isAnreise = b.fields.anreise === todayKey && b.fields.status?.key === 'bestaetigt';
                return {
                  id: b.record_id,
                  title: b.gastName || tx('Unbekannt'),
                  secondLine: (
                    <>
                      <span
                        className={
                          isAnreise
                            ? 'font-medium text-primary'
                            : 'font-medium text-amber-600'
                        }
                      >
                        {isAnreise ? tx('Anreise') : tx('Abreise')}
                      </span>
                      <span className="text-muted-foreground">
                        {' · '}{b.zimmerName}
                      </span>
                    </>
                  ),
                  action: isAnreise
                    ? {
                        label: tx('Einchecken'),
                        onClick: () =>
                          void advanceStatus(b.record_id, 'eingecheckt', b.fields.status?.key ?? ''),
                      }
                    : {
                        label: tx('Auschecken'),
                        onClick: () =>
                          void advanceStatus(b.record_id, 'ausgecheckt', b.fields.status?.key ?? ''),
                      },
                };
              })}
              onItemClick={id => {
                const rec = buchungen.find(b => b.record_id === id);
                if (rec) crud.buchungen.openDetail(rec);
              }}
              empty={{
                text: tx('Keine An- oder Abreisen heute.'),
                action: { label: tx('Neue Buchung'), onClick: () => crud.buchungen.openCreate({ status: 'bestaetigt' }) },
              }}
            />
            <WorkList
              title={tx('Offene Anfragen')}
              items={offeneAnfragen.map(b => ({
                id: b.record_id,
                title: b.gastName || tx('Unbekannter Gast'),
                secondLine: (
                  <>
                    <span className="font-medium text-amber-600">{tx('Angefragt')}</span>
                    <span className="text-muted-foreground">
                      {' · '}{b.zimmerName}
                      {b.fields.anreise ? ` · ${formatDate(b.fields.anreise)}` : ''}
                    </span>
                  </>
                ),
                action: {
                  label: tx('Bestätigen'),
                  onClick: () =>
                    void advanceStatus(b.record_id, 'bestaetigt', b.fields.status?.key ?? ''),
                },
              }))}
              onItemClick={id => {
                const rec = buchungen.find(b => b.record_id === id);
                if (rec) crud.buchungen.openDetail(rec);
              }}
              empty={{
                text: tx('Keine offenen Anfragen.'),
                action: {
                  label: tx('Buchung anlegen'),
                  onClick: () => crud.buchungen.openCreate({ status: 'angefragt' }),
                },
              }}
            />
          </>
        }
      />
      {crud.surfaces}
    </div>
  );
}
