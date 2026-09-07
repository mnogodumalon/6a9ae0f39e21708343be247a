import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns';
import { dateFnsLocale } from '@/i18n';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { APP_IDS, LOOKUP_OPTIONS, lookupOption } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { tx, appLabel } from '@/i18n';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { Button } from '@/components/ui/button';
import {
  ResourceTimeline,
  type ResourceEvent,
  type ResourceGroup,
  type ResourceTone,
} from '@/components/widgets/ResourceTimeline';
import { IconBed, IconCalendar, IconCheck, IconAlertTriangle, IconPlus, IconFileInvoice } from '@tabler/icons-react';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    gaesteMap, zimmerMap, buchungenMap,
    setBuchungen, fetchAll,
  } = data;

  const clock = useClock();
  const today = format(clock, 'yyyy-MM-dd');

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const status = lookupKey(b.fields.status);
        if (status === 'angefragt') {
          return {
            label: tx('Buchung bestätigen'),
            onClick: () => advanceBuchung(b, 'bestaetigt'),
          };
        }
        if (status === 'bestaetigt' && b.fields.anreise === today) {
          return {
            label: tx('Einchecken'),
            onClick: () => advanceBuchung(b, 'eingecheckt'),
          };
        }
        if (status === 'eingecheckt' && b.fields.abreise && b.fields.abreise <= today) {
          return {
            label: tx('Auschecken'),
            onClick: () => advanceBuchung(b, 'ausgecheckt'),
          };
        }
      }
      if (top.type === 'rechnungen') {
        const r = top.record;
        const zs = lookupKey(r.fields.zahlungsstatus);
        if (zs === 'offen') {
          return {
            label: tx('Als bezahlt markieren'),
            onClick: () => markRechnungBezahlt(r),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  const [filterStatus, setFilterStatus] = useState<string | null>(null);

  // ── Advance helper (shared: banner, list-row, overlay footer) ──────────────
  function advanceBuchung(b: typeof buchungen[0], newStatus: string) {
    const prev = b.fields.status;
    const optimistic = buchungen.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', newStatus) } }
        : x,
    );
    setBuchungen(optimistic);
    void LivingAppsService.updateBuchungenEntry(b.record_id, { status: newStatus })
      .catch(() => fetchAll());
    undoToast(tx`Status geändert`, () => {
      setBuchungen(buchungen.map(x =>
        x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: prev } } : x,
      ));
      void LivingAppsService.updateBuchungenEntry(b.record_id, { status: lookupKey(prev) ?? newStatus })
        .catch(() => fetchAll());
    });
  }

  function markRechnungBezahlt(r: typeof rechnungen[0]) {
    const prevStatus = r.fields.zahlungsstatus;
    const now = format(clock, "yyyy-MM-dd'T'HH:mm");
    undoToast(tx`Rechnung als bezahlt markiert`, () => {
      void LivingAppsService.updateRechnungenEntry(r.record_id, {
        zahlungsstatus: lookupKey(prevStatus) ?? 'offen',
        zahlungseingang: undefined,
      }).catch(() => fetchAll());
    });
    void LivingAppsService.updateRechnungenEntry(r.record_id, {
      zahlungsstatus: 'bezahlt',
      zahlungseingang: now,
    }).catch(() => fetchAll());
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const heute_anreise = useMemo(() =>
    enrichedBuchungen.filter(b =>
      b.fields.anreise === today && lookupKey(b.fields.status) === 'bestaetigt',
    ), [enrichedBuchungen, today]);

  const heute_abreise = useMemo(() =>
    enrichedBuchungen.filter(b =>
      b.fields.abreise === today && lookupKey(b.fields.status) === 'eingecheckt',
    ), [enrichedBuchungen, today]);

  const angefragt = useMemo(() =>
    enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [enrichedBuchungen]);

  const aktiv_eingecheckt = useMemo(() =>
    buchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'),
    [buchungen]);

  const offene_rechnungen = useMemo(() =>
    enrichedRechnungen.filter(r => lookupKey(r.fields.zahlungsstatus) === 'offen'),
    [enrichedRechnungen]);

  const ueberfaellige_rechnungen = useMemo(() =>
    offene_rechnungen.filter(r => r.fields.faellig_am && r.fields.faellig_am < today),
    [offene_rechnungen, today]);

  // ── Context greeting ───────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (heute_anreise.length > 0) {
      const names = namen(heute_anreise.map(b => b.gastName));
      parts.push(tx`${names} reist heute an.`);
    }
    if (heute_abreise.length > 0) {
      const names = namen(heute_abreise.map(b => b.gastName));
      parts.push(tx`${names} reist heute ab.`);
    }
    if (parts.length === 0) {
      if (aktiv_eingecheckt.length > 0) {
        return tx`${aktiv_eingecheckt.length} Gäste sind aktuell eingecheckt.`;
      }
      return tx('Keine An- oder Abreisen heute.');
    }
    return parts.join(' ');
  }, [heute_anreise, heute_abreise, aktiv_eingecheckt]);

  // ── ResourceTimeline data ──────────────────────────────────────────────────
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
    })),
    [zimmer],
  );

  function toneForBuchung(status: string | undefined): ResourceTone {
    if (status === 'eingecheckt') return 'success';
    if (status === 'angefragt') return 'warning';
    if (status === 'storniert') return 'destructive';
    return 'primary';
  }

  const events = useMemo<ResourceEvent[]>(() => {
    const filtered = filterStatus
      ? buchungen.filter(b => lookupKey(b.fields.status) === filterStatus)
      : buchungen;
    return filtered
      .filter(b => !!b.fields.anreise && !!b.fields.zimmer)
      .map(b => {
        const gastId = extractRecordId(b.fields.gast);
        const gast = gastId ? gaesteMap.get(gastId) : undefined;
        const gastName = gast
          ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
          : tx('Gast');
        return {
          id: `buchung:${b.record_id}`,
          start: b.fields.anreise!,
          end: b.fields.abreise,
          allDay: true,
          title: gastName,
          subtitle: b.fields.abreise ? `${formatDate(b.fields.anreise)} – ${formatDate(b.fields.abreise)}` : formatDate(b.fields.anreise),
          tone: toneForBuchung(lookupKey(b.fields.status)),
          group: extractRecordId(b.fields.zimmer) ?? '',
        };
      });
  }, [buchungen, gaesteMap, filterStatus]);

  // Drag: move booking to new room / reschedule
  const handleEventDrop = async (id: string, newStart: string, newEnd?: string, newGroup?: string): Promise<string | undefined> => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    // Double-booking check: does the target room already have a booking in that range?
    if (newGroup) {
      const clash = buchungen.find(b => {
        if (b.record_id === rid) return false;
        if (extractRecordId(b.fields.zimmer) !== newGroup) return false;
        if (lookupKey(b.fields.status) === 'storniert') return false;
        const bStart = b.fields.anreise ?? '';
        const bEnd = b.fields.abreise ?? bStart;
        return newStart <= bEnd && (newEnd ?? newStart) >= bStart;
      });
      if (clash) return tx('Zimmer ist in diesem Zeitraum bereits belegt.');
    }
    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;
    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    setBuchungen(buchungen.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
        : b,
    ));
    undoToast(tx`Buchung verschoben`, () => {
      setBuchungen(buchungen.map(b => b.record_id === rid ? prev : b));
      void LivingAppsService.updateBuchungenEntry(rid, {
        anreise: prev.fields.anreise,
        abreise: prev.fields.abreise,
        ...(newGroup && prev.fields.zimmer ? { zimmer: prev.fields.zimmer } : {}),
      }).catch(() => fetchAll());
    });
    void LivingAppsService.updateBuchungenEntry(rid, {
      anreise: newStart,
      ...(newEnd ? { abreise: newEnd } : {}),
      ...zimmerPatch,
    }).catch(() => fetchAll());
    return undefined;
  };

  const handleEventResize = async (id: string, newStart: string, newEnd: string): Promise<string | undefined> => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;
    // No-overlap check on resize
    const zimmerIdOfB = extractRecordId(prev.fields.zimmer) ?? '';
    const clash = buchungen.find(b => {
      if (b.record_id === rid) return false;
      if (extractRecordId(b.fields.zimmer) !== zimmerIdOfB) return false;
      if (lookupKey(b.fields.status) === 'storniert') return false;
      const bStart = b.fields.anreise ?? '';
      const bEnd = b.fields.abreise ?? bStart;
      return newStart <= bEnd && newEnd >= bStart;
    });
    if (clash) return tx('Zimmer ist in diesem Zeitraum bereits belegt.');
    setBuchungen(buchungen.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b,
    ));
    undoToast(tx`Aufenthalt angepasst`, () => {
      setBuchungen(buchungen.map(b => b.record_id === rid ? prev : b));
      void LivingAppsService.updateBuchungenEntry(rid, {
        anreise: prev.fields.anreise,
        abreise: prev.fields.abreise,
      }).catch(() => fetchAll());
    });
    void LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd })
      .catch(() => fetchAll());
    return undefined;
  };

  // ── Urgent signal: Gäste, die ausgecheckt werden müssen ───────────────────
  const dringend_abreise = heute_abreise.length > 0 ? heute_abreise : [];

  // ── Zimmer-Auslastung heute ────────────────────────────────────────────────
  const belegt_heute = buchungen.filter(b => {
    const s = lookupKey(b.fields.status);
    if (s === 'storniert') return false;
    const von = b.fields.anreise ?? '';
    const bis = b.fields.abreise ?? von;
    return von <= today && today <= bis;
  }).length;
  const total_zimmer = zimmer.length;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <Button onClick={() => crud.buchungen.openCreate({ status: 'bestaetigt' })} className="shrink-0">
          <IconPlus size={16} className="mr-1.5 shrink-0" />
          {tx('Neue Buchung')}
        </Button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          dringend_abreise.length > 0
            ? (
              <HeroBanner
                icon={<IconAlertTriangle size={18} />}
                action={{
                  label: tx('Auschecken'),
                  onClick: () => advanceBuchung(dringend_abreise[0], 'ausgecheckt'),
                }}
              >
                <b>{namen(dringend_abreise.map(b => b.gastName))}</b>
                {dringend_abreise.length === 1
                  ? tx` muss heute noch ausgecheckt werden.`
                  : tx` müssen heute noch ausgecheckt werden.`}
              </HeroBanner>
            )
            : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Belegt heute')}
              value={`${belegt_heute} / ${total_zimmer}`}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={belegt_heute === total_zimmer ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Anreisen heute')}
              value={heute_anreise.length}
              icon={<IconCalendar size={16} className="shrink-0" />}
              tone={heute_anreise.length > 0 ? 'primary' : 'default'}
              onClick={() => setFilterStatus(f => f === 'bestaetigt' ? null : 'bestaetigt')}
              active={filterStatus === 'bestaetigt'}
            />
            <StatStripItem
              title={tx('Eingecheckt')}
              value={aktiv_eingecheckt.length}
              icon={<IconCheck size={16} className="shrink-0" />}
              tone={aktiv_eingecheckt.length > 0 ? 'success' : 'default'}
              onClick={() => setFilterStatus(f => f === 'eingecheckt' ? null : 'eingecheckt')}
              active={filterStatus === 'eingecheckt'}
            />
            <StatStripItem
              title={tx('Anfragen')}
              value={angefragt.length}
              icon={<IconAlertTriangle size={16} className="shrink-0" />}
              tone={angefragt.length > 0 ? 'warning' : 'default'}
              onClick={() => setFilterStatus(f => f === 'angefragt' ? null : 'angefragt')}
              active={filterStatus === 'angefragt'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offene_rechnungen.length}
              icon={<IconFileInvoice size={16} className="shrink-0" />}
              tone={ueberfaellige_rechnungen.length > 0 ? 'destructive' : offene_rechnungen.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <ResourceTimeline
            events={events}
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
            renderEvent={(ev, meta) => (
              <div className="flex items-center gap-1 truncate text-xs">
                <IconBed className="h-3 w-3 shrink-0" />
                {meta.isStart && <span className="truncate font-medium">{ev.title}</span>}
              </div>
            )}
            renderGroupHeader={group => {
              const z = zimmer.find(x => x.record_id === group.key);
              const kategorie = z?.fields.kategorie?.label;
              return (
                <div className="flex w-full items-center justify-between gap-1 min-w-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{group.label}</div>
                    {kategorie && (
                      <div className="truncate text-[11px] text-muted-foreground">{kategorie}</div>
                    )}
                  </div>
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute — An- & Abreisen')}
              items={[
                ...heute_anreise.map(b => ({
                  id: `an:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-primary">{tx('Anreise')}</span>
                      <span className="text-muted-foreground"> · {b.zimmerName}</span>
                    </>
                  ),
                  action: {
                    label: tx('Einchecken'),
                    onClick: () => advanceBuchung(buchungen.find(x => x.record_id === b.record_id)!, 'eingecheckt'),
                  },
                })),
                ...heute_abreise.map(b => ({
                  id: `ab:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-amber-600">{tx('Abreise')}</span>
                      <span className="text-muted-foreground"> · {b.zimmerName}</span>
                    </>
                  ),
                  action: {
                    label: tx('Auschecken'),
                    onClick: () => advanceBuchung(buchungen.find(x => x.record_id === b.record_id)!, 'ausgecheckt'),
                  },
                })),
              ]}
              onItemClick={id => {
                const rid = id.split(':')[1] ?? '';
                const b = buchungen.find(x => x.record_id === rid);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: tx('Keine An- oder Abreisen heute — nächste Buchung im Belegungsplan'),
                action: {
                  label: tx('Neue Buchung'),
                  onClick: () => crud.buchungen.openCreate({ status: 'bestaetigt' }),
                },
              }}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={offene_rechnungen.slice(0, 8).map(r => {
                const buchung = r.fields.buchung ? buchungenMap.get(extractRecordId(r.fields.buchung) ?? '') : undefined;
                const gastId = buchung ? extractRecordId(buchung.fields.gast) : undefined;
                const gast = gastId ? gaesteMap.get(gastId) : undefined;
                const gastName = gast
                  ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
                  : tx('Gast');
                const istUeberfaellig = r.fields.faellig_am && r.fields.faellig_am < today;
                return {
                  id: r.record_id,
                  title: gastName,
                  secondLine: (
                    <>
                      <span className={istUeberfaellig ? 'font-medium text-destructive' : 'font-medium text-amber-600'}>
                        {formatCurrency(r.fields.betrag)}
                      </span>
                      {r.fields.faellig_am && (
                        <span className="text-muted-foreground"> · {tx('fällig')} {formatDate(r.fields.faellig_am)}</span>
                      )}
                    </>
                  ),
                  action: {
                    label: tx('Bezahlt'),
                    onClick: () => markRechnungBezahlt(rechnungen.find(x => x.record_id === r.record_id)!),
                  },
                };
              })}
              onItemClick={id => {
                const r = rechnungen.find(x => x.record_id === id);
                if (r) crud.rechnungen.openDetail(r);
              }}
              empty={{
                text: tx('Alle Rechnungen beglichen — sehr gut!'),
                action: {
                  label: tx('Neue Rechnung'),
                  onClick: () => crud.rechnungen.openCreate({}),
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
