import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isBefore, startOfDay, endOfDay, isWithinInterval, startOfMonth, endOfMonth } from 'date-fns';
import { IconBed, IconUserCheck, IconFileInvoice, IconAlertTriangle, IconPlus, IconCheck } from '@tabler/icons-react';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, lookupOption } from '@/types/app';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { DashboardGrid } from '@/components/DashboardGrid';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import {
  ResourceTimeline,
  type ResourceEvent,
  type ResourceGroup,
  type ResourceTone,
} from '@/components/widgets/ResourceTimeline';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, setBuchungen, rechnungen,
    gaesteMap, zimmerMap, buchungenMap,
    fetchAll,
  } = data;

  const clock = useClock();

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const statusKey = b.fields.status?.key;
        if (statusKey === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => void confirmBuchung(b.record_id),
          };
        }
        if (statusKey === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void checkinBuchung(b.record_id),
          };
        }
        if (statusKey === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void checkoutBuchung(b.record_id),
          };
        }
      }
      if (top.type === 'rechnungen') {
        const r = top.record;
        if (r.fields.zahlungsstatus?.key === 'offen') {
          return {
            label: tx('Als bezahlt markieren'),
            onClick: () => void markRechnungBezahlt(r.record_id),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // ── Status helpers ────────────────────────────────────────────────
  async function confirmBuchung(id: string) {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'bestaetigt') } }
      : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'bestaetigt' });
      undoToast(tx`Buchung bestätigt`, async () => {
        setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
        await LivingAppsService.updateBuchungenEntry(id, { status: 'angefragt' });
      });
    } catch {
      await fetchAll();
    }
  }

  async function checkinBuchung(id: string) {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'eingecheckt') } }
      : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'eingecheckt' });
      undoToast(tx`Gast eingecheckt`, async () => {
        setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
        await LivingAppsService.updateBuchungenEntry(id, { status: 'bestaetigt' });
      });
    } catch {
      await fetchAll();
    }
  }

  async function checkoutBuchung(id: string) {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    setBuchungen(bs => bs.map(b => b.record_id === id
      ? { ...b, fields: { ...b.fields, status: lookupOption('buchungen', 'status', 'ausgecheckt') } }
      : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'ausgecheckt' });
      undoToast(tx`Gast ausgecheckt`, async () => {
        setBuchungen(bs => bs.map(b => b.record_id === id ? prev : b));
        await LivingAppsService.updateBuchungenEntry(id, { status: 'eingecheckt' });
      });
    } catch {
      await fetchAll();
    }
  }

  async function markRechnungBezahlt(id: string) {
    const r = rechnungen.find(x => x.record_id === id);
    if (!r) return;
    const now = format(clock, "yyyy-MM-dd'T'HH:mm");
    const { setRechnungen } = data;
    setRechnungen(rs => rs.map(x => x.record_id === id
      ? { ...x, fields: { ...x.fields, zahlungsstatus: lookupOption('rechnungen', 'zahlungsstatus', 'bezahlt'), zahlungseingang: now } }
      : x));
    try {
      await LivingAppsService.updateRechnungenEntry(id, { zahlungsstatus: 'bezahlt', zahlungseingang: now });
      undoToast(tx`Rechnung als bezahlt markiert`, async () => {
        setRechnungen(rs => rs.map(x => x.record_id === id ? r : x));
        await LivingAppsService.updateRechnungenEntry(id, { zahlungsstatus: 'offen', zahlungseingang: undefined });
      });
    } catch {
      await fetchAll();
    }
  }

  // ── Derived data ─────────────────────────────────────────────────
  const todayKey = format(clock, 'yyyy-MM-dd');

  const aktiveStatus = new Set(['angefragt', 'bestaetigt', 'eingecheckt']);
  const aktiveBuchungen = useMemo(
    () => buchungen.filter(b => aktiveStatus.has(b.fields.status?.key ?? '')),
    [buchungen],
  );

  const offeneAnfragen = useMemo(
    () => enrichedBuchungen.filter(b => b.fields.status?.key === 'angefragt'),
    [enrichedBuchungen],
  );

  const heuteAnkuenfte = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.status?.key === 'bestaetigt' && b.fields.anreise === todayKey,
    ),
    [enrichedBuchungen, todayKey],
  );

  const heuteAbreisen = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.status?.key === 'eingecheckt' && b.fields.abreise === todayKey,
    ),
    [enrichedBuchungen, todayKey],
  );

  const offeneRechnungen = useMemo(
    () => enrichedRechnungen.filter(r => r.fields.zahlungsstatus?.key === 'offen'),
    [enrichedRechnungen],
  );

  const ueberfaelligeRechnungen = useMemo(
    () => offeneRechnungen.filter(r => r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), startOfDay(clock))),
    [offeneRechnungen, clock],
  );

  // Auslastung heute: Zimmer mit aktiver Buchung
  const belegteZimmerHeute = useMemo(() => {
    const zimmerIds = new Set<string>();
    buchungen.forEach(b => {
      const s = b.fields.status?.key;
      if (s !== 'eingecheckt' && s !== 'bestaetigt') return;
      if (!b.fields.anreise || !b.fields.abreise) return;
      const von = parseISO(b.fields.anreise);
      const bis = parseISO(b.fields.abreise);
      if (isWithinInterval(startOfDay(clock), { start: von, end: bis })) {
        const zId = extractRecordId(b.fields.zimmer);
        if (zId) zimmerIds.add(zId);
      }
    });
    return zimmerIds.size;
  }, [buchungen, clock]);

  const zimmerGesamt = zimmer.length;

  // ── ResourceTimeline groups + events ─────────────────────────────
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
      tone: undefined as ResourceTone | undefined,
    })),
    [zimmer],
  );

  const events = useMemo<ResourceEvent[]>(
    () =>
      aktiveBuchungen
        .filter(b => !!b.fields.anreise)
        .map(b => {
          const statusKey = b.fields.status?.key ?? '';
          const tone: ResourceTone =
            statusKey === 'eingecheckt' ? 'success' :
            statusKey === 'angefragt' ? 'warning' : 'primary';
          const gastId = extractRecordId(b.fields.gast);
          const gast = gastId ? gaesteMap.get(gastId) : undefined;
          const title = gast
            ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() || tx('Buchung')
            : tx('Buchung');
          return {
            id: `buchung:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title,
            subtitle: b.fields.status?.label,
            tone,
            group: extractRecordId(b.fields.zimmer) ?? '',
          };
        }),
    [aktiveBuchungen, gaesteMap],
  );

  // Occupancy % pro Zimmer (aktueller Monat) für renderGroupHeader
  const occupancyByRoom = useMemo(() => {
    const start = startOfMonth(clock);
    const end = endOfMonth(clock);
    const daysInMonth = end.getDate();
    const counts = new Map<string, number>();
    for (const b of buchungen) {
      const zId = extractRecordId(b.fields.zimmer);
      if (!zId || !b.fields.anreise) continue;
      const von = parseISO(b.fields.anreise);
      const bis = b.fields.abreise ? parseISO(b.fields.abreise) : von;
      let occupied = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (isWithinInterval(d, { start: von, end: bis })) occupied++;
      }
      counts.set(zId, (counts.get(zId) ?? 0) + occupied);
    }
    const pct = new Map<string, number>();
    for (const [zId, occ] of counts) {
      pct.set(zId, Math.round((occ / daysInMonth) * 100));
    }
    return pct;
  }, [buchungen, clock]);

  // ── Drag: reschedule (drop) ────────────────────────────────────────
  async function onEventDrop(
    id: string,
    newStart: string,
    newEnd?: string,
    newGroup?: string,
  ): Promise<void | string> {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;

    // Double-booking check
    if (newGroup) {
      const conflict = buchungen.some(b => {
        if (b.record_id === rid) return false;
        const bZimmer = extractRecordId(b.fields.zimmer);
        if (bZimmer !== newGroup) return false;
        const s = b.fields.status?.key;
        if (!aktiveStatus.has(s ?? '')) return false;
        if (!b.fields.anreise) return false;
        const bVon = parseISO(b.fields.anreise);
        const bBis = b.fields.abreise ? parseISO(b.fields.abreise) : bVon;
        const nVon = parseISO(newStart);
        const nBis = newEnd ? parseISO(newEnd) : nVon;
        return !(nBis < bVon || nVon > bBis);
      });
      if (conflict) return tx('Zimmer ist in diesem Zeitraum bereits belegt');
    }

    const prev = buchungen.find(b => b.record_id === rid);
    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    setBuchungen(bs =>
      bs.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
          : b,
      ),
    );
    try {
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: newStart,
        ...(newEnd ? { abreise: newEnd } : {}),
        ...zimmerPatch,
      });
      undoToast(tx`Buchung verschoben`, async () => {
        if (prev) {
          setBuchungen(bs => bs.map(b => b.record_id === rid ? prev : b));
          await LivingAppsService.updateBuchungenEntry(rid, {
            anreise: prev.fields.anreise,
            abreise: prev.fields.abreise,
            ...(newGroup ? { zimmer: prev.fields.zimmer } : {}),
          });
        }
      });
    } catch {
      await fetchAll();
    }
  }

  // ── Drag: resize ─────────────────────────────────────────────────
  async function onEventResize(id: string, newStart: string, newEnd: string): Promise<void | string> {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = buchungen.find(b => b.record_id === rid);
    setBuchungen(bs =>
      bs.map(b => b.record_id === rid ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } } : b),
    );
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      undoToast(tx`Zeitraum angepasst`, async () => {
        if (prev) {
          setBuchungen(bs => bs.map(b => b.record_id === rid ? prev : b));
          await LivingAppsService.updateBuchungenEntry(rid, { anreise: prev.fields.anreise, abreise: prev.fields.abreise });
        }
      });
    } catch {
      await fetchAll();
    }
  }

  // ── Context line ──────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (heuteAnkuenfte.length > 0) {
      const namen_ = namen(heuteAnkuenfte.map(b => b.gastName));
      parts.push(tx`${namen_} reist heute an`);
    }
    if (heuteAbreisen.length > 0) {
      const namen_ = namen(heuteAbreisen.map(b => b.gastName));
      parts.push(tx`${namen_} reist heute ab`);
    }
    if (parts.length === 0) {
      if (zimmer.length === 0) return tx('Richte deine Pension ein — füge zuerst die Zimmer hinzu.');
      return tx`${belegteZimmerHeute} von ${zimmerGesamt} Zimmern belegt`;
    }
    return parts.join(' · ');
  }, [heuteAnkuenfte, heuteAbreisen, belegteZimmerHeute, zimmerGesamt, zimmer.length]);

  // ── Empty app state ───────────────────────────────────────────────
  if (zimmer.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <IconBed size={48} className="text-muted-foreground" stroke={1.5} />
          <div>
            <h2 className="text-xl font-semibold mb-2">{tx('Willkommen in der Pension Seeblick!')}</h2>
            <p className="text-muted-foreground max-w-sm">{tx('Lege zuerst deine Zimmer an, damit du Buchungen verwalten kannst.')}</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            onClick={() => crud.zimmer.openCreate({})}
          >
            <IconPlus size={16} className="shrink-0" />
            {tx('Erstes Zimmer anlegen')}
          </button>
        </div>
        {crud.surfaces}
      </div>
    );
  }

  // ── Hero ──────────────────────────────────────────────────────────
  const hero = offeneAnfragen.length > 0 ? (
    <HeroBanner
      icon={<IconAlertTriangle size={18} />}
      action={{
        label: tx('Bestätigen'),
        onClick: () => void confirmBuchung(offeneAnfragen[0].record_id),
      }}
    >
      <b>{namen(offeneAnfragen.map(b => b.gastName))}</b>{' '}
      {offeneAnfragen.length === 1
        ? tx`hat eine Buchungsanfrage gestellt — Anreise ${formatDate(offeneAnfragen[0].fields.anreise)}`
        : tx`haben offene Buchungsanfragen`}
    </HeroBanner>
  ) : undefined;

  // ── KPIs ──────────────────────────────────────────────────────────
  const kpis = (
    <StatStrip>
      <StatStripItem
        title={tx('Belegt heute')}
        value={`${belegteZimmerHeute}/${zimmerGesamt}`}
        icon={<IconBed size={16} />}
        tone={belegteZimmerHeute === zimmerGesamt ? 'warning' : 'default'}
      />
      <StatStripItem
        title={tx('Ankünfte heute')}
        value={heuteAnkuenfte.length}
        icon={<IconUserCheck size={16} />}
        tone={heuteAnkuenfte.length > 0 ? 'primary' : 'default'}
      />
      <StatStripItem
        title={tx('Abreisen heute')}
        value={heuteAbreisen.length}
        icon={<IconUserCheck size={16} />}
        tone={heuteAbreisen.length > 0 ? 'primary' : 'default'}
      />
      <StatStripItem
        title={tx('Offene Rechnungen')}
        value={offeneRechnungen.length}
        icon={<IconFileInvoice size={16} />}
        tone={ueberfaelligeRechnungen.length > 0 ? 'destructive' : offeneRechnungen.length > 0 ? 'warning' : 'default'}
      />
    </StatStrip>
  );

  // ── Aside ──────────────────────────────────────────────────────────
  const aside = (
    <>
      <WorkList
        title={tx('Heute einchecken')}
        items={heuteAnkuenfte.map(b => ({
          id: b.record_id,
          title: b.gastName || tx('Gast'),
          secondLine: (
            <>
              <span className="font-medium text-primary">{b.zimmerName}</span>
              {b.fields.personen ? (
                <span className="text-muted-foreground"> · {b.fields.personen} {tx('Personen')}</span>
              ) : null}
            </>
          ),
          action: {
            label: tx('Einchecken'),
            onClick: () => void checkinBuchung(b.record_id),
          },
        }))}
        onItemClick={id => {
          const b = enrichedBuchungen.find(x => x.record_id === id);
          if (b) crud.buchungen.openDetail(b);
        }}
        empty={{
          text: heuteAbreisen.length > 0
            ? tx`${heuteAbreisen.length} Abreise(n) heute`
            : tx('Keine Ankünfte heute'),
        }}
      />
      <WorkList
        title={tx('Offene Rechnungen')}
        items={[...ueberfaelligeRechnungen, ...offeneRechnungen.filter(r => !ueberfaelligeRechnungen.includes(r))]
          .slice(0, 8)
          .map(r => {
            const isUeberfaellig = ueberfaelligeRechnungen.includes(r);
            return {
              id: r.record_id,
              title: r.buchungName || (
                (() => {
                  const bId = extractRecordId(r.fields.buchung);
                  const b = bId ? buchungenMap.get(bId) : undefined;
                  const gId = b ? extractRecordId(b.fields.gast) : null;
                  const g = gId ? gaesteMap.get(gId) : undefined;
                  return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : tx('Buchung');
                })()
              ),
              secondLine: (
                <>
                  {isUeberfaellig
                    ? <span className="font-medium text-destructive">{tx('Überfällig')}</span>
                    : <span className="text-muted-foreground">{tx('Offen')}</span>}
                  {r.fields.betrag != null && (
                    <span className="text-muted-foreground"> · {formatCurrency(r.fields.betrag)}</span>
                  )}
                  {r.fields.faellig_am && (
                    <span className="text-muted-foreground"> {tx('· fällig')} {formatDate(r.fields.faellig_am)}</span>
                  )}
                </>
              ),
              action: {
                label: tx('Bezahlt'),
                onClick: () => void markRechnungBezahlt(r.record_id),
              },
            };
          })}
        onItemClick={id => {
          const r = enrichedRechnungen.find(x => x.record_id === id);
          if (r) crud.rechnungen.openDetail(r);
        }}
        empty={{
          text: tx('Alle Rechnungen beglichen'),
          action: {
            label: tx('Neue Rechnung'),
            onClick: () => crud.rechnungen.openCreate({}),
          },
        }}
      />
    </>
  );

  // ── Primary: ResourceTimeline ─────────────────────────────────────
  const primary = (
    <ResourceTimeline
      events={events}
      groups={groups}
      axis="day"
      defaultRange="week"
      defaultDate={clock}
      locale={dateFnsLocale()}
      onEventClick={ev => {
        const rid = ev.id.split(':')[1] ?? '';
        const b = enrichedBuchungen.find(x => x.record_id === rid);
        if (b) crud.buchungen.openDetail(b);
      }}
      onEventDrop={onEventDrop}
      onEventResize={onEventResize}
      onRangeCreate={(start, end, group) => {
        const zimmerUrl = group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined;
        crud.buchungen.openCreate({
          anreise: format(start, 'yyyy-MM-dd'),
          abreise: format(end, 'yyyy-MM-dd'),
          ...(zimmerUrl ? { zimmer: zimmerUrl } : {}),
          status: 'bestaetigt',
        });
      }}
      onEmptyClick={(date, group) => {
        const zimmerUrl = group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined;
        crud.buchungen.openCreate({
          anreise: format(date, 'yyyy-MM-dd'),
          ...(zimmerUrl ? { zimmer: zimmerUrl } : {}),
          status: 'bestaetigt',
        });
      }}
      renderGroupHeader={group => {
        const z = zimmerMap.get(group.key);
        const pct = occupancyByRoom.get(group.key) ?? 0;
        return (
          <div className="flex w-full items-center justify-between gap-2 min-w-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{group.label}</p>
              {z?.fields.kategorie?.label && (
                <p className="truncate text-xs text-muted-foreground">{z.fields.kategorie.label}</p>
              )}
            </div>
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[11px] font-semibold text-primary tabular-nums">
              {pct}%
            </span>
          </div>
        );
      }}
      renderEvent={(ev, meta) => (
        <div className="flex items-center gap-1 truncate text-xs">
          <IconBed className="h-3 w-3 shrink-0" />
          {meta.isStart && <span className="truncate">{ev.title}</span>}
        </div>
      )}
    />
  );

  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
            onClick={() => crud.buchungen.openCreate({ status: 'bestaetigt' })}
          >
            <IconPlus size={16} className="shrink-0" />
            {tx('Neue Buchung')}
          </button>
        </div>
      </div>

      <DashboardGrid
        variant="wide"
        hero={hero}
        kpis={kpis}
        primary={primary}
        aside={aside}
      />

      {crud.surfaces}
    </div>
  );
}
