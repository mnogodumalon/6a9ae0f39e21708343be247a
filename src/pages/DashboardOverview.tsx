import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isBefore, isAfter, startOfDay, endOfDay, addDays, startOfMonth, endOfMonth, isWithinInterval } from 'date-fns';
import { dateFnsLocale } from '@/i18n';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { APP_IDS, lookupOption } from '@/types/app';
import { createRecordUrl, extractRecordId, LivingAppsService } from '@/services/livingAppsService';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { tx, appLabel } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import {
  ResourceTimeline,
  type ResourceEvent,
  type ResourceGroup,
} from '@/components/widgets/ResourceTimeline';
import {
  IconBed,
  IconAlertTriangle,
  IconDoorEnter,
  IconDoorExit,
  IconReceipt,
  IconCalendarCheck,
  IconPlus,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    gaesteMap, zimmerMap, buchungenMap, zusatzleistungenMap,
    fetchAll,
  } = data;

  const clock = useClock();
  const today = format(clock, 'yyyy-MM-dd');

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const statusKey = lookupKey(b.fields.status);
        if (statusKey === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => void confirmBuchung(b),
          };
        }
        if (statusKey === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void checkinBuchung(b),
          };
        }
        if (statusKey === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void checkoutBuchung(b),
          };
        }
      }
      if (top.type === 'rechnungen') {
        const r = top.record;
        const zs = lookupKey(r.fields.zahlungsstatus);
        if (zs === 'offen' || zs === 'teilweise_bezahlt') {
          return {
            label: tx('Als bezahlt markieren'),
            onClick: () => void markBezahlt(r),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // --- Advance helpers ---
  async function confirmBuchung(b: typeof buchungen[0]) {
    const prev = b.fields.status;
    data.setBuchungen(prev2 => prev2.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'bestaetigt') } }
        : x
    ));
    undoToast(tx`${b.record_id} — ${tx('bestätigt')}`, async () => {
      data.setBuchungen(prev2 => prev2.map(x =>
        x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: prev } } : x
      ));
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: lookupKey(prev) });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'bestaetigt' });
    } catch {
      await fetchAll();
    }
  }

  async function checkinBuchung(b: typeof buchungen[0]) {
    const prev = b.fields.status;
    data.setBuchungen(prev2 => prev2.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'eingecheckt') } }
        : x
    ));
    const gastName = gaesteMap.get(extractRecordId(b.fields.gast) ?? '')?.fields;
    const name = gastName ? `${gastName.vorname ?? ''} ${gastName.nachname ?? ''}`.trim() : tx('Gast');
    undoToast(tx`${name} — ${tx('eingecheckt')}`, async () => {
      data.setBuchungen(prev2 => prev2.map(x =>
        x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: prev } } : x
      ));
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: lookupKey(prev) });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'eingecheckt' });
    } catch {
      await fetchAll();
    }
  }

  async function checkoutBuchung(b: typeof buchungen[0]) {
    const prev = b.fields.status;
    data.setBuchungen(prev2 => prev2.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'ausgecheckt') } }
        : x
    ));
    const gastName = gaesteMap.get(extractRecordId(b.fields.gast) ?? '')?.fields;
    const name = gastName ? `${gastName.vorname ?? ''} ${gastName.nachname ?? ''}`.trim() : tx('Gast');
    undoToast(tx`${name} — ${tx('ausgecheckt')}`, async () => {
      data.setBuchungen(prev2 => prev2.map(x =>
        x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: prev } } : x
      ));
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: lookupKey(prev) });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'ausgecheckt' });
    } catch {
      await fetchAll();
    }
  }

  async function markBezahlt(r: typeof rechnungen[0]) {
    const prev = r.fields.zahlungsstatus;
    const jetzt = format(clock, "yyyy-MM-dd'T'HH:mm");
    data.setRechnungen(prev2 => prev2.map(x =>
      x.record_id === r.record_id
        ? { ...x, fields: { ...x.fields, zahlungsstatus: lookupOption('rechnungen', 'zahlungsstatus', 'bezahlt'), zahlungseingang: jetzt } }
        : x
    ));
    undoToast(tx`${tx('Rechnung')} — ${tx('als bezahlt markiert')}`, async () => {
      data.setRechnungen(prev2 => prev2.map(x =>
        x.record_id === r.record_id ? { ...x, fields: { ...x.fields, zahlungsstatus: prev, zahlungseingang: undefined } } : x
      ));
      await LivingAppsService.updateRechnungenEntry(r.record_id, { zahlungsstatus: lookupKey(prev), zahlungseingang: undefined });
    });
    try {
      await LivingAppsService.updateRechnungenEntry(r.record_id, { zahlungsstatus: 'bezahlt', zahlungseingang: jetzt });
    } catch {
      await fetchAll();
    }
  }

  // --- KPI derivations ---
  const ankunftHeute = useMemo(() =>
    buchungen.filter(b => b.fields.anreise === today && (lookupKey(b.fields.status) === 'bestaetigt' || lookupKey(b.fields.status) === 'angefragt')),
    [buchungen, today]
  );

  const abreiseHeute = useMemo(() =>
    buchungen.filter(b => b.fields.abreise === today && lookupKey(b.fields.status) === 'eingecheckt'),
    [buchungen, today]
  );

  const aktuelleGaeste = useMemo(() =>
    buchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'),
    [buchungen]
  );

  const offeneAnfragen = useMemo(() =>
    buchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [buchungen]
  );

  const offeneRechnungen = useMemo(() =>
    rechnungen.filter(r => {
      const zs = lookupKey(r.fields.zahlungsstatus);
      return zs === 'offen' || zs === 'teilweise_bezahlt';
    }),
    [rechnungen]
  );

  const ueberfaelligeRechnungen = useMemo(() =>
    offeneRechnungen.filter(r => r.fields.faellig_am && r.fields.faellig_am < today),
    [offeneRechnungen, today]
  );

  // Occupancy this month
  const occupancyByRoom = useMemo(() => {
    const start = startOfMonth(clock);
    const end = endOfMonth(clock);
    const daysInMonth = end.getDate();
    const counts = new Map<string, number>();
    for (const b of buchungen) {
      if (lookupKey(b.fields.status) === 'storniert') continue;
      const roomId = extractRecordId(b.fields.zimmer);
      if (!roomId || !b.fields.anreise) continue;
      const from = parseISO(b.fields.anreise);
      const to = b.fields.abreise ? parseISO(b.fields.abreise) : from;
      let occupied = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (isWithinInterval(d, { start: from, end: to })) occupied++;
      }
      counts.set(roomId, (counts.get(roomId) ?? 0) + occupied);
    }
    const pct = new Map<string, number>();
    for (const [roomId, occupied] of counts) {
      pct.set(roomId, Math.min(100, Math.round((occupied / daysInMonth) * 100)));
    }
    return pct;
  }, [buchungen, clock]);

  // --- Timeline ---
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer
      .slice()
      .sort((a, b) => (a.fields.bezeichnung ?? '').localeCompare(b.fields.bezeichnung ?? ''))
      .map(z => ({
        key: z.record_id,
        label: z.fields.bezeichnung ?? z.record_id,
      })),
    [zimmer]
  );

  const events = useMemo<ResourceEvent[]>(
    () =>
      buchungen
        .filter(b => !!b.fields.anreise && lookupKey(b.fields.status) !== 'storniert')
        .map(b => {
          const statusKey = lookupKey(b.fields.status);
          const tone =
            statusKey === 'eingecheckt' ? 'success' :
            statusKey === 'angefragt' ? 'warning' :
            statusKey === 'ausgecheckt' ? 'default' : 'primary';
          const gastInfo = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
          const guestName = gastInfo
            ? `${gastInfo.fields.vorname ?? ''} ${gastInfo.fields.nachname ?? ''}`.trim()
            : tx('Gast');
          return {
            id: `buchung:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title: guestName,
            subtitle: b.fields.abreise ? `${formatDate(b.fields.anreise)} – ${formatDate(b.fields.abreise)}` : formatDate(b.fields.anreise),
            tone: tone as ResourceEvent['tone'],
            group: extractRecordId(b.fields.zimmer) ?? '',
          };
        }),
    [buchungen, gaesteMap]
  );

  // Drag & drop: reschedule
  async function reschedule(id: string, newStart: string, newEnd?: string, newGroup?: string) {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const b = buchungen.find(x => x.record_id === rid);
    if (!b) return;

    // Double-booking check
    if (newGroup) {
      const conflict = buchungen.find(x =>
        x.record_id !== rid &&
        extractRecordId(x.fields.zimmer) === newGroup &&
        lookupKey(x.fields.status) !== 'storniert' &&
        x.fields.anreise && x.fields.abreise &&
        newStart < (x.fields.abreise ?? '') && (newEnd ?? newStart) > x.fields.anreise
      );
      if (conflict) return tx('Dieses Zimmer ist in diesem Zeitraum bereits belegt.');
    }

    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    const prevFields = { ...b.fields };
    data.setBuchungen(prev => prev.map(x =>
      x.record_id === rid
        ? { ...x, fields: { ...x.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
        : x
    ));
    const gastInfo = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
    const name = gastInfo ? `${gastInfo.fields.vorname ?? ''} ${gastInfo.fields.nachname ?? ''}`.trim() : tx('Buchung');
    undoToast(tx`${name} — ${tx('verschoben')}`, async () => {
      data.setBuchungen(prev => prev.map(x =>
        x.record_id === rid ? { ...x, fields: prevFields } : x
      ));
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: prevFields.anreise,
        ...(prevFields.abreise ? { abreise: prevFields.abreise } : {}),
        ...(prevFields.zimmer ? { zimmer: prevFields.zimmer } : {}),
      });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: newStart,
        ...(newEnd ? { abreise: newEnd } : {}),
        ...zimmerPatch,
      });
    } catch {
      await fetchAll();
    }
  }

  async function resizeBuchung(id: string, newStart: string, newEnd: string) {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const b = buchungen.find(x => x.record_id === rid);
    if (!b) return;
    const prevFields = { ...b.fields };
    data.setBuchungen(prev => prev.map(x =>
      x.record_id === rid
        ? { ...x, fields: { ...x.fields, anreise: newStart, abreise: newEnd } }
        : x
    ));
    undoToast(tx`${tx('Zeitraum angepasst')}`, async () => {
      data.setBuchungen(prev => prev.map(x =>
        x.record_id === rid ? { ...x, fields: prevFields } : x
      ));
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: prevFields.anreise, abreise: prevFields.abreise });
    });
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
    } catch {
      await fetchAll();
    }
  }

  // --- Context line ---
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (abreiseHeute.length > 0) {
      const names = abreiseHeute.map(b => {
        const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
        return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : '';
      }).filter(Boolean);
      parts.push(tx`${namen(names)} ${tx('reist heute ab')}`);
    }
    if (ankunftHeute.length > 0) {
      const names = ankunftHeute.map(b => {
        const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
        return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : '';
      }).filter(Boolean);
      parts.push(tx`${namen(names)} ${tx('kommt heute an')}`);
    }
    if (parts.length === 0 && aktuelleGaeste.length === 0) {
      return tx('Keine Gäste im Haus — perfekte Zeit zum Aufräumen!');
    }
    if (parts.length === 0) {
      return tx`${aktuelleGaeste.length} ${tx('Gäste aktuell im Haus')}`;
    }
    return parts.join(' · ');
  }, [abreiseHeute, ankunftHeute, aktuelleGaeste, gaesteMap]);

  // --- Filter state ---
  const [buchungFilter, setBuchungFilter] = useState<'all' | 'angefragt' | 'eingecheckt' | 'bestaetigt'>('all');

  const filteredEvents = useMemo(() => {
    if (buchungFilter === 'all') return events;
    return events.filter(ev => {
      const rid = ev.id.split(':')[1] ?? '';
      const b = buchungen.find(x => x.record_id === rid);
      return b && lookupKey(b.fields.status) === buchungFilter;
    });
  }, [events, buchungFilter, buchungen]);

  // --- Hero: überfällige Rechnungen ---
  const heroRechnung = ueberfaelligeRechnungen[0];

  // --- Aside: heute ---
  const checkinsHeute = ankunftHeute;
  const checkoutsHeute = abreiseHeute;

  const zimmerFrei = useMemo(() => {
    const belegte = new Set(
      buchungen
        .filter(b => lookupKey(b.fields.status) === 'eingecheckt' || lookupKey(b.fields.status) === 'bestaetigt')
        .map(b => extractRecordId(b.fields.zimmer))
        .filter(Boolean)
    );
    return zimmer.filter(z => !belegte.has(z.record_id));
  }, [buchungen, zimmer]);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">{contextLine}</p>
        </div>
        <Button
          onClick={() => crud.buchungen.openCreate({ status: 'bestaetigt' })}
          className="mt-3 shrink-0 sm:mt-0"
        >
          <IconPlus size={16} className="mr-1.5 shrink-0" />
          {tx('Neue Buchung')}
        </Button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          ueberfaelligeRechnungen.length > 0 && heroRechnung ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: tx('Als bezahlt markieren'),
                onClick: () => void markBezahlt(heroRechnung),
              }}
            >
              {ueberfaelligeRechnungen.length === 1
                ? tx`Eine Rechnung ist überfällig — fällig war ${formatDate(heroRechnung.fields.faellig_am)}.`
                : tx`${ueberfaelligeRechnungen.length} Rechnungen sind überfällig.`}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Anreise heute')}
              value={ankunftHeute.length}
              icon={<IconDoorEnter size={16} className="shrink-0" />}
              tone={ankunftHeute.length > 0 ? 'primary' : 'default'}
              onClick={() => setBuchungFilter(f => f === 'bestaetigt' ? 'all' : 'bestaetigt')}
              active={buchungFilter === 'bestaetigt'}
            />
            <StatStripItem
              title={tx('Abreise heute')}
              value={abreiseHeute.length}
              icon={<IconDoorExit size={16} className="shrink-0" />}
              tone={abreiseHeute.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Im Haus')}
              value={aktuelleGaeste.length}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={aktuelleGaeste.length > 0 ? 'success' : 'default'}
              onClick={() => setBuchungFilter(f => f === 'eingecheckt' ? 'all' : 'eingecheckt')}
              active={buchungFilter === 'eingecheckt'}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={offeneAnfragen.length}
              icon={<IconCalendarCheck size={16} className="shrink-0" />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => setBuchungFilter(f => f === 'angefragt' ? 'all' : 'angefragt')}
              active={buchungFilter === 'angefragt'}
            />
            <StatStripItem
              title={tx('Offen. Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconReceipt size={16} className="shrink-0" />}
              tone={ueberfaelligeRechnungen.length > 0 ? 'destructive' : offeneRechnungen.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Freie Zimmer')}
              value={zimmerFrei.length}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={zimmerFrei.length === 0 ? 'warning' : 'success'}
            />
          </StatStrip>
        }
        primary={
          <ResourceTimeline
            events={filteredEvents}
            groups={groups}
            axis="day"
            defaultRange="week"
            defaultDate={clock}
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const rid = ev.id.split(':')[1] ?? '';
              const b = buchungen.find(x => x.record_id === rid);
              if (b) crud.buchungen.openDetail(b);
            }}
            onEventDrop={reschedule}
            onEventResize={resizeBuchung}
            onRangeCreate={(start, end, group) => {
              crud.buchungen.openCreate({
                anreise: format(start, 'yyyy-MM-dd'),
                abreise: format(end, 'yyyy-MM-dd'),
                ...(group ? { zimmer: group } : {}),
              });
            }}
            onEmptyClick={(date, group) => {
              crud.buchungen.openCreate({
                anreise: format(date, 'yyyy-MM-dd'),
                ...(group ? { zimmer: group } : {}),
              });
            }}
            renderEvent={(ev, meta) => {
              const statusKey = (() => {
                const rid = ev.id.split(':')[1] ?? '';
                const b = buchungen.find(x => x.record_id === rid);
                return b ? lookupKey(b.fields.status) : '';
              })();
              return (
                <div className="flex items-center gap-1 truncate text-xs">
                  <IconBed className="h-3 w-3 shrink-0" />
                  {meta.isStart && <span className="truncate">{ev.title}</span>}
                  {meta.isStart && statusKey === 'angefragt' && (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-700">?</span>
                  )}
                </div>
              );
            }}
            renderGroupHeader={group => {
              const z = zimmer.find(x => x.record_id === group.key);
              const pct = occupancyByRoom.get(group.key) ?? 0;
              return (
                <div className="flex w-full items-center justify-between gap-1 cursor-pointer"
                  onClick={() => z && crud.zimmer.openDetail(z)}>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-foreground">{group.label}</div>
                    {z?.fields.kategorie && (
                      <div className="truncate text-[10px] text-muted-foreground">{z.fields.kategorie.label}</div>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-primary tabular-nums">
                    {pct}%
                  </span>
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute: Check-in & Check-out')}
              items={[
                ...checkinsHeute.map(b => {
                  const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
                  const guestName = g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : tx('Gast');
                  const zimmerRec = zimmerMap.get(extractRecordId(b.fields.zimmer) ?? '');
                  const statusKey = lookupKey(b.fields.status);
                  return {
                    id: `in:${b.record_id}`,
                    title: guestName,
                    secondLine: (
                      <>
                        <IconDoorEnter size={12} className="shrink-0 text-primary" />
                        <span className="font-medium text-primary">{tx('Anreise')}</span>
                        {zimmerRec && <span className="text-muted-foreground"> · {zimmerRec.fields.bezeichnung}</span>}
                      </>
                    ),
                    action: statusKey === 'bestaetigt' || statusKey === 'angefragt'
                      ? { label: tx('Einchecken'), onClick: () => void checkinBuchung(b) }
                      : undefined,
                  };
                }),
                ...checkoutsHeute.map(b => {
                  const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
                  const guestName = g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : tx('Gast');
                  const zimmerRec = zimmerMap.get(extractRecordId(b.fields.zimmer) ?? '');
                  return {
                    id: `out:${b.record_id}`,
                    title: guestName,
                    secondLine: (
                      <>
                        <IconDoorExit size={12} className="shrink-0 text-amber-600" />
                        <span className="font-medium text-amber-600">{tx('Abreise')}</span>
                        {zimmerRec && <span className="text-muted-foreground"> · {zimmerRec.fields.bezeichnung}</span>}
                      </>
                    ),
                    action: { label: tx('Auschecken'), onClick: () => void checkoutBuchung(b) },
                  };
                }),
              ]}
              onItemClick={id => {
                const rid = id.replace(/^(in|out):/, '');
                const b = buchungen.find(x => x.record_id === rid);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: tx('Keine An- oder Abreisen heute'),
                action: { label: tx('Buchung anlegen'), onClick: () => crud.buchungen.openCreate({ status: 'bestaetigt' }) },
              }}
            />
            <WorkList
              title={tx('Offene Anfragen')}
              items={offeneAnfragen.slice(0, 8).map(b => {
                const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
                const guestName = g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : tx('Gast');
                const zimmerRec = zimmerMap.get(extractRecordId(b.fields.zimmer) ?? '');
                return {
                  id: b.record_id,
                  title: guestName,
                  secondLine: (
                    <>
                      <span className="font-medium text-amber-600">{tx('Angefragt')}</span>
                      {b.fields.anreise && (
                        <span className="text-muted-foreground">
                          {' '}· {formatDate(b.fields.anreise)}
                          {b.fields.abreise ? ` – ${formatDate(b.fields.abreise)}` : ''}
                        </span>
                      )}
                      {zimmerRec && <span className="text-muted-foreground"> · {zimmerRec.fields.bezeichnung}</span>}
                    </>
                  ),
                  action: { label: tx('Bestätigen'), onClick: () => void confirmBuchung(b) },
                };
              })}
              onItemClick={id => {
                const b = buchungen.find(x => x.record_id === id);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: tx('Keine offenen Anfragen'),
              }}
            />
          </>
        }
      />
      {crud.surfaces}
    </div>
  );
}
