import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { tx, appLabel } from '@/i18n';
import { APP_IDS, LOOKUP_OPTIONS, lookupOption } from '@/types/app';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { dateFnsLocale } from '@/i18n';
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns';
import { useState, useMemo, useCallback } from 'react';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import { ResourceTimeline, type ResourceEvent, type ResourceGroup } from '@/components/widgets/ResourceTimeline';
import {
  IconBed,
  IconAlertTriangle,
  IconLogin,
  IconLogout,
  IconReceipt,
  IconCalendar,
  IconCheck,
} from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    gaesteMap, zimmerMap, buchungenMap,
    fetchAll, setBuchungen,
  } = data;

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record;
        const status = lookupKey(b.fields.status);
        if (status === 'angefragt') {
          return {
            label: tx('Buchung bestätigen'),
            onClick: () => confirmBuchung(b),
          };
        }
        if (status === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => checkinBuchung(b),
          };
        }
        if (status === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => checkoutBuchung(b),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  const clock = useClock();
  const today = format(clock, 'yyyy-MM-dd');

  // ── Status-Advance-Helpers (shared: banner + worklist + overlay footer) ──
  const confirmBuchung = useCallback(async (b: typeof buchungen[0]) => {
    const prev = buchungen;
    const newStatus = lookupOption('buchungen', 'status', 'bestaetigt');
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: newStatus } } : x
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'bestaetigt' });
      undoToast(
        tx`${b.record_id} — Buchung bestätigt`,
        async () => {
          setBuchungen(prev);
          await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'angefragt' });
        }
      );
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  const checkinBuchung = useCallback(async (b: typeof buchungen[0]) => {
    const prev = buchungen;
    const newStatus = lookupOption('buchungen', 'status', 'eingecheckt');
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: newStatus } } : x
    ));
    const gastRec = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
    const name = gastRec ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim() : '';
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'eingecheckt' });
      undoToast(
        name ? tx`${name} — eingecheckt` : tx('Gast eingecheckt'),
        async () => {
          setBuchungen(prev);
          await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'bestaetigt' });
        }
      );
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll, gaesteMap]);

  const checkoutBuchung = useCallback(async (b: typeof buchungen[0]) => {
    const prev = buchungen;
    const newStatus = lookupOption('buchungen', 'status', 'ausgecheckt');
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id ? { ...x, fields: { ...x.fields, status: newStatus } } : x
    ));
    const gastRec = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
    const name = gastRec ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim() : '';
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'ausgecheckt' });
      undoToast(
        name ? tx`${name} — ausgecheckt` : tx('Gast ausgecheckt'),
        async () => {
          setBuchungen(prev);
          await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'eingecheckt' });
        }
      );
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll, gaesteMap]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const aktiveBuchungen = useMemo(() =>
    buchungen.filter(b => {
      const s = lookupKey(b.fields.status);
      return s !== 'storniert' && s !== 'ausgecheckt';
    }), [buchungen]);

  const offeneAnfragen = useMemo(() =>
    buchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'), [buchungen]);

  const heuteAnreise = useMemo(() =>
    buchungen.filter(b =>
      b.fields.anreise === today &&
      lookupKey(b.fields.status) === 'bestaetigt'
    ), [buchungen, today]);

  const heuteAbreise = useMemo(() =>
    buchungen.filter(b =>
      b.fields.abreise === today &&
      lookupKey(b.fields.status) === 'eingecheckt'
    ), [buchungen, today]);

  const eingecheckt = useMemo(() =>
    buchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'), [buchungen]);

  // Offene Rechnungen (überfällig)
  const offeneRechnungen = useMemo(() =>
    rechnungen.filter(r => {
      const zs = lookupKey(r.fields.zahlungsstatus);
      return zs === 'offen' || zs === 'teilweise_bezahlt';
    }), [rechnungen]);

  const ueberfaelligeRechnungen = useMemo(() =>
    offeneRechnungen.filter(r =>
      r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), startOfDay(clock))
    ), [offeneRechnungen, clock]);

  // Zimmerbelegung heute
  const belegteZimmerHeute = useMemo(() => {
    const belegte = new Set<string>();
    buchungen.forEach(b => {
      const s = lookupKey(b.fields.status);
      if (s === 'eingecheckt' || s === 'bestaetigt') {
        const zid = extractRecordId(b.fields.zimmer);
        if (zid && b.fields.anreise && b.fields.abreise) {
          if (b.fields.anreise <= today && b.fields.abreise >= today) {
            belegte.add(zid);
          }
        }
      }
    });
    return belegte;
  }, [buchungen, today]);

  const freieZimmer = zimmer.length - belegteZimmerHeute.size;

  // ── ResourceTimeline ──────────────────────────────────────────────────────
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
    })),
    [zimmer]
  );

  const timelineEvents = useMemo<ResourceEvent[]>(
    () =>
      buchungen
        .filter(b => {
          const s = lookupKey(b.fields.status);
          return s !== 'storniert' && !!b.fields.anreise;
        })
        .flatMap(b => {
          const zimId = extractRecordId(b.fields.zimmer);
          if (!zimId) return [];
          const gastRec = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
          const gastName = gastRec
            ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim()
            : tx('Gast');
          const s = lookupKey(b.fields.status);
          const tone =
            s === 'eingecheckt' ? 'success' :
            s === 'angefragt' ? 'warning' :
            s === 'bestaetigt' ? 'primary' : 'default';
          return [{
            id: `buchung:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title: gastName,
            subtitle: b.fields.abreise ? tx`bis ${formatDate(b.fields.abreise)}` : undefined,
            tone,
            group: zimId,
          }];
        }),
    [buchungen, gaesteMap]
  );

  // ── Drag: Reschedule + cross-room move ────────────────────────────────────
  const handleEventDrop = useCallback(async (
    id: string,
    newStart: string,
    newEnd?: string,
    newGroup?: string
  ) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;

    // Double-booking check
    if (newGroup || newStart) {
      const targetRoom = newGroup ?? extractRecordId(buchungen.find(b => b.record_id === rid)?.fields.zimmer ?? '');
      const overlap = buchungen.some(b => {
        if (b.record_id === rid) return false;
        if (extractRecordId(b.fields.zimmer) !== targetRoom) return false;
        const s = lookupKey(b.fields.status);
        if (s === 'storniert' || s === 'ausgecheckt') return false;
        if (!b.fields.anreise) return false;
        const bStart = b.fields.anreise;
        const bEnd = b.fields.abreise ?? b.fields.anreise;
        const evEnd = newEnd ?? newStart;
        return !(evEnd < bStart || newStart > bEnd);
      });
      if (overlap) return tx('Zimmer ist in diesem Zeitraum bereits belegt');
    }

    const prev = [...buchungen];
    const zimmerPatch = newGroup ? { zimmer: createRecordUrl(APP_IDS.ZIMMER, newGroup) } : {};
    setBuchungen(prev => prev.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, ...(newEnd ? { abreise: newEnd } : {}), ...zimmerPatch } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(rid, {
        anreise: newStart,
        ...(newEnd ? { abreise: newEnd } : {}),
        ...zimmerPatch,
      });
      undoToast(tx('Buchung verschoben'), async () => {
        setBuchungen(prev);
        const origB = prev.find(b => b.record_id === rid);
        if (origB) {
          await LivingAppsService.updateBuchungenEntry(rid, {
            anreise: origB.fields.anreise,
            abreise: origB.fields.abreise,
            zimmer: origB.fields.zimmer as string,
          });
        }
      });
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  const handleEventResize = useCallback(async (id: string, newStart: string, newEnd: string) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = [...buchungen];
    setBuchungen(prev => prev.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      undoToast(tx('Aufenthaltsdauer geändert'), async () => {
        setBuchungen(prev);
        const origB = prev.find(b => b.record_id === rid);
        if (origB) {
          await LivingAppsService.updateBuchungenEntry(rid, {
            anreise: origB.fields.anreise,
            abreise: origB.fields.abreise,
          });
        }
      });
    } catch {
      await fetchAll();
    }
  }, [buchungen, setBuchungen, fetchAll]);

  // ── Context line ──────────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const parts: string[] = [];
    if (heuteAnreise.length > 0) {
      const names = heuteAnreise.flatMap(b => {
        const gr = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
        return gr ? [`${gr.fields.vorname ?? ''} ${gr.fields.nachname ?? ''}`.trim()] : [];
      });
      parts.push(namen(names));
    }
    if (heuteAbreise.length > 0) {
      const names = heuteAbreise.flatMap(b => {
        const gr = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
        return gr ? [`${gr.fields.vorname ?? ''} ${gr.fields.nachname ?? ''}`.trim()] : [];
      });
      if (parts.length > 0) parts.push('·');
      parts.push(`${namen(names)} ${heuteAbreise.length === 1 ? tx('reist ab') : tx('reisen ab')}`);
    }
    if (parts.length === 0 && eingecheckt.length > 0) {
      return tx`${eingecheckt.length} Gäste aktuell eingecheckt — ruhiger Tag.`;
    }
    if (parts.length === 0) {
      return freieZimmer > 0
        ? tx`${freieZimmer} Zimmer frei — keine Ankünfte heute.`
        : tx('Alle Zimmer belegt heute.');
    }
    return parts.join(' ');
  }, [heuteAnreise, heuteAbreise, eingecheckt, freieZimmer, gaesteMap]);

  // ── Hero: offene Anfragen als dringendster Hinweis ────────────────────────
  const erstAnfrage = offeneAnfragen[0];
  const heroGast = erstAnfrage
    ? gaesteMap.get(extractRecordId(erstAnfrage.fields.gast) ?? '')
    : undefined;

  // ── KPI filter state ──────────────────────────────────────────────────────
  const [kpiFilter, setKpiFilter] = useState<'anreise' | 'abreise' | 'anfragen' | null>(null);
  const toggleFilter = (f: 'anreise' | 'abreise' | 'anfragen') =>
    setKpiFilter(prev => prev === f ? null : f);

  // ── WorkList: Heute Anreise ───────────────────────────────────────────────
  const anreiseItems = useMemo(() => {
    const filtered = kpiFilter === 'anfragen'
      ? offeneAnfragen
      : kpiFilter === 'abreise'
      ? heuteAbreise
      : heuteAnreise.length > 0 || kpiFilter === 'anreise'
      ? heuteAnreise
      : heuteAnreise;

    return filtered.map(b => {
      const gastRec = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
      const gastName = gastRec ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim() : tx('Unbekannter Gast');
      const zimRec = extractRecordId(b.fields.zimmer) ? zimmerMap.get(extractRecordId(b.fields.zimmer)!) : undefined;
      const zimName = zimRec?.fields.bezeichnung ?? tx('Kein Zimmer');
      const s = lookupKey(b.fields.status);
      const statusColor =
        s === 'eingecheckt' ? 'text-emerald-600' :
        s === 'angefragt' ? 'text-amber-600' :
        s === 'bestaetigt' ? 'text-blue-600' : 'text-muted-foreground';
      const statusLabel =
        s === 'eingecheckt' ? tx('Eingecheckt') :
        s === 'angefragt' ? tx('Angefragt') :
        s === 'bestaetigt' ? tx('Bestätigt') :
        s === 'ausgecheckt' ? tx('Ausgecheckt') : tx('Unbekannt');

      const action =
        s === 'bestaetigt' && b.fields.anreise === today
          ? { label: tx('Einchecken'), onClick: () => checkinBuchung(b) }
          : s === 'angefragt'
          ? { label: tx('Bestätigen'), onClick: () => confirmBuchung(b) }
          : s === 'eingecheckt' && b.fields.abreise === today
          ? { label: tx('Auschecken'), onClick: () => checkoutBuchung(b) }
          : undefined;

      return {
        id: b.record_id,
        title: gastName,
        secondLine: (
          <>
            <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
            <span className="text-muted-foreground"> · {zimName}</span>
            {b.fields.anreise && (
              <span className="text-muted-foreground"> · {formatDate(b.fields.anreise)}–{b.fields.abreise ? formatDate(b.fields.abreise) : '?'}</span>
            )}
          </>
        ),
        action,
      };
    });
  }, [kpiFilter, offeneAnfragen, heuteAbreise, heuteAnreise, gaesteMap, zimmerMap, today, checkinBuchung, confirmBuchung, checkoutBuchung]);

  // ── WorkList: Offene Rechnungen ───────────────────────────────────────────
  const rechnungItems = useMemo(() =>
    offeneRechnungen.slice(0, 8).map(r => {
      const buchungRec = extractRecordId(r.fields.buchung) ? buchungenMap.get(extractRecordId(r.fields.buchung)!) : undefined;
      const gastRec = buchungRec
        ? gaesteMap.get(extractRecordId(buchungRec.fields.gast) ?? '')
        : undefined;
      const gastName = gastRec
        ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim()
        : tx('Unbekannt');
      const isUeberfaellig = r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), startOfDay(clock));
      const zs = lookupKey(r.fields.zahlungsstatus);

      return {
        id: r.record_id,
        title: gastName,
        secondLine: (
          <>
            <span className={`font-medium ${isUeberfaellig ? 'text-destructive' : 'text-amber-600'}`}>
              {isUeberfaellig ? tx('Überfällig') : tx('Offen')}
            </span>
            {r.fields.betrag != null && (
              <span className="text-muted-foreground"> · {formatCurrency(r.fields.betrag)}</span>
            )}
            {r.fields.faellig_am && (
              <span className="text-muted-foreground"> · {formatDate(r.fields.faellig_am)}</span>
            )}
          </>
        ),
      };
    }), [offeneRechnungen, buchungenMap, gaesteMap, clock]);

  // ── Title for aside WorkList ──────────────────────────────────────────────
  const worklistTitle = useMemo(() => {
    if (kpiFilter === 'anfragen') return tx('Offene Anfragen');
    if (kpiFilter === 'abreise') return tx('Heutige Abreisen');
    if (heuteAnreise.length > 0 || kpiFilter === 'anreise') return tx('Heutige Anreisen');
    if (heuteAbreise.length > 0) return tx('Heutige Abreisen');
    if (offeneAnfragen.length > 0) return tx('Offene Anfragen');
    return tx('Aktuelle Buchungen');
  }, [kpiFilter, heuteAnreise, heuteAbreise, offeneAnfragen]);

  // ── WorkList items for "primary" aside slot ───────────────────────────────
  const primaryWorkItems = useMemo(() => {
    const allActive = kpiFilter === 'anfragen'
      ? offeneAnfragen
      : kpiFilter === 'abreise'
      ? heuteAbreise
      : kpiFilter === 'anreise'
      ? heuteAnreise
      : heuteAnreise.length > 0
      ? heuteAnreise
      : heuteAbreise.length > 0
      ? heuteAbreise
      : offeneAnfragen.length > 0
      ? offeneAnfragen
      : aktiveBuchungen.slice(0, 5);

    return allActive.map(b => {
      const gastRec = extractRecordId(b.fields.gast) ? gaesteMap.get(extractRecordId(b.fields.gast)!) : undefined;
      const gastName = gastRec ? `${gastRec.fields.vorname ?? ''} ${gastRec.fields.nachname ?? ''}`.trim() : tx('Gast');
      const zimRec = extractRecordId(b.fields.zimmer) ? zimmerMap.get(extractRecordId(b.fields.zimmer)!) : undefined;
      const zimName = zimRec?.fields.bezeichnung ?? '';
      const s = lookupKey(b.fields.status);
      const statusColor =
        s === 'eingecheckt' ? 'text-emerald-600' :
        s === 'angefragt' ? 'text-amber-600' :
        s === 'bestaetigt' ? 'text-blue-600' : 'text-muted-foreground';
      const statusLabel =
        s === 'eingecheckt' ? tx('Eingecheckt') :
        s === 'angefragt' ? tx('Angefragt') :
        s === 'bestaetigt' ? tx('Bestätigt') :
        s === 'ausgecheckt' ? tx('Ausgecheckt') : tx('Unbekannt');

      const action =
        s === 'bestaetigt' && b.fields.anreise === today
          ? { label: tx('Check-in'), onClick: () => checkinBuchung(b) }
          : s === 'angefragt'
          ? { label: tx('Bestätigen'), onClick: () => confirmBuchung(b) }
          : s === 'eingecheckt' && b.fields.abreise === today
          ? { label: tx('Check-out'), onClick: () => checkoutBuchung(b) }
          : undefined;

      return {
        id: b.record_id,
        title: gastName,
        secondLine: (
          <>
            <span className={`font-medium ${statusColor}`}>{statusLabel}</span>
            {zimName ? <span className="text-muted-foreground"> · {zimName}</span> : null}
            {b.fields.anreise && (
              <span className="text-muted-foreground"> · {formatDate(b.fields.anreise)}{b.fields.abreise ? `–${formatDate(b.fields.abreise)}` : ''}</span>
            )}
          </>
        ),
        action,
      };
    });
  }, [kpiFilter, offeneAnfragen, heuteAbreise, heuteAnreise, aktiveBuchungen, gaesteMap, zimmerMap, today, checkinBuchung, confirmBuchung, checkoutBuchung]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{contextLine}</p>
        </div>
        <Button
          onClick={() => crud.buchungen.openCreate({ status: 'angefragt' })}
          className="shrink-0"
        >
          <IconCalendar size={16} className="mr-2 shrink-0" />
          {tx('Neue Buchung')}
        </Button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          offeneAnfragen.length > 0 ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: tx('Buchung bestätigen'),
                onClick: () => erstAnfrage && confirmBuchung(erstAnfrage),
              }}
            >
              {heroGast
                ? tx`${heroGast.fields.vorname ?? ''} ${heroGast.fields.nachname ?? ''} — Anfrage vom ${formatDate(erstAnfrage?.fields.anreise)}`
                : tx`${offeneAnfragen.length} offene Buchungsanfragen warten auf Bestätigung`}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Freie Zimmer')}
              value={freieZimmer}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={freieZimmer === 0 ? 'warning' : freieZimmer <= 2 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Anreisen heute')}
              value={heuteAnreise.length}
              icon={<IconLogin size={16} className="shrink-0" />}
              tone={heuteAnreise.length > 0 ? 'primary' : 'default'}
              onClick={() => toggleFilter('anreise')}
              active={kpiFilter === 'anreise'}
            />
            <StatStripItem
              title={tx('Abreisen heute')}
              value={heuteAbreise.length}
              icon={<IconLogout size={16} className="shrink-0" />}
              tone={heuteAbreise.length > 0 ? 'warning' : 'default'}
              onClick={() => toggleFilter('abreise')}
              active={kpiFilter === 'abreise'}
            />
            <StatStripItem
              title={tx('Anfragen offen')}
              value={offeneAnfragen.length}
              icon={<IconCheck size={16} className="shrink-0" />}
              tone={offeneAnfragen.length > 0 ? 'warning' : 'default'}
              onClick={() => toggleFilter('anfragen')}
              active={kpiFilter === 'anfragen'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconReceipt size={16} className="shrink-0" />}
              tone={ueberfaelligeRechnungen.length > 0 ? 'destructive' : offeneRechnungen.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <ResourceTimeline
            events={timelineEvents}
            groups={groups}
            axis="day"
            defaultRange="week"
            locale={dateFnsLocale()}
            onEventClick={ev => {
              const rid = ev.id.split(':')[1] ?? '';
              const b = buchungen.find(x => x.record_id === rid);
              if (b) crud.buchungen.openDetail(b);
            }}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            onRangeCreate={(start, end, group) => {
              const anreise = format(start, 'yyyy-MM-dd');
              const abreise = format(end, 'yyyy-MM-dd');
              const zimmerUrl = group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined;
              crud.buchungen.openCreate({
                anreise,
                abreise,
                ...(zimmerUrl ? { zimmer: zimmerUrl } : {}),
                status: 'angefragt',
              });
            }}
            onEmptyClick={(date, group) => {
              const anreise = format(date, 'yyyy-MM-dd');
              const zimmerUrl = group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined;
              crud.buchungen.openCreate({
                anreise,
                ...(zimmerUrl ? { zimmer: zimmerUrl } : {}),
                status: 'angefragt',
              });
            }}
            renderGroupHeader={group => {
              const isBelegt = belegteZimmerHeute.has(group.key);
              return (
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{group.label}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    isBelegt ? 'bg-emerald-100 text-emerald-700' : 'bg-secondary text-muted-foreground'
                  }`}>
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
              title={worklistTitle}
              items={primaryWorkItems}
              onItemClick={id => {
                const b = buchungen.find(x => x.record_id === id);
                if (b) crud.buchungen.openDetail(b);
              }}
              max={6}
              empty={{
                text: tx('Keine Buchungen — ruhiger Tag!'),
                action: {
                  label: tx('Neue Buchung anlegen'),
                  onClick: () => crud.buchungen.openCreate({ status: 'angefragt' }),
                },
              }}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={rechnungItems}
              onItemClick={id => {
                const r = rechnungen.find(x => x.record_id === id);
                if (r) crud.rechnungen.openDetail(r);
              }}
              max={5}
              empty={{
                text: tx('Alle Rechnungen beglichen.'),
                action: {
                  label: tx('Rechnung erstellen'),
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
