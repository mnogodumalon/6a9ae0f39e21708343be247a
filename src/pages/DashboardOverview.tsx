import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isBefore, startOfDay } from 'date-fns';
import { tx, appLabel } from '@/i18n';
import { dateFnsLocale } from '@/i18n';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { APP_IDS, LOOKUP_OPTIONS, lookupOption } from '@/types/app';
import { extractRecordId, createRecordUrl, LivingAppsService } from '@/services/livingAppsService';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
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
  IconLogin,
  IconLogout,
  IconAlertCircle,
  IconReceipt,
  IconPlus,
  IconCheck,
} from '@tabler/icons-react';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste,
    zimmer,
    buchungen,
    rechnungen,
    setBuchungen,
    fetchAll,
    gaesteMap,
    zimmerMap,
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
            label: tx('Bestätigen'),
            onClick: () => void confirmBuchung(b),
          };
        }
        if (status === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => void checkinBuchung(b),
          };
        }
        if (status === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => void checkoutBuchung(b),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // ── Buchungs-Status-Hilfen ──────────────────────────────────────────────
  async function confirmBuchung(b: (typeof buchungen)[number]) {
    const prev = buchungen;
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'bestaetigt') } }
        : x
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'bestaetigt' });
      const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      const name = gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : '';
      undoToast(tx`${name} — Buchung bestätigt`, async () => {
        setBuchungen(prev);
        await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'angefragt' });
      });
    } catch {
      fetchAll();
    }
  }

  async function checkinBuchung(b: (typeof buchungen)[number]) {
    const prev = buchungen;
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'eingecheckt') } }
        : x
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'eingecheckt' });
      const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      const name = gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : '';
      undoToast(tx`${name} — eingecheckt`, async () => {
        setBuchungen(prev);
        await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'bestaetigt' });
      });
    } catch {
      fetchAll();
    }
  }

  async function checkoutBuchung(b: (typeof buchungen)[number]) {
    const prev = buchungen;
    setBuchungen(prev => prev.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: lookupOption('buchungen', 'status', 'ausgecheckt') } }
        : x
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'ausgecheckt' });
      const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      const name = gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : '';
      undoToast(tx`${name} — ausgecheckt`, async () => {
        setBuchungen(prev);
        await LivingAppsService.updateBuchungenEntry(b.record_id, { status: 'eingecheckt' });
      });
    } catch {
      fetchAll();
    }
  }

  // ── Abgeleitete Daten ───────────────────────────────────────────────────
  const aktiveBuchungen = useMemo(
    () => buchungen.filter(b => {
      const s = lookupKey(b.fields.status);
      return s !== 'storniert';
    }),
    [buchungen]
  );

  const anreiseHeute = useMemo(
    () => aktiveBuchungen.filter(b => b.fields.anreise === today && lookupKey(b.fields.status) === 'bestaetigt'),
    [aktiveBuchungen, today]
  );

  const abreiseHeute = useMemo(
    () => aktiveBuchungen.filter(b => b.fields.abreise === today && lookupKey(b.fields.status) === 'eingecheckt'),
    [aktiveBuchungen, today]
  );

  const eingecheckt = useMemo(
    () => aktiveBuchungen.filter(b => lookupKey(b.fields.status) === 'eingecheckt'),
    [aktiveBuchungen]
  );

  const angefragte = useMemo(
    () => aktiveBuchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [aktiveBuchungen]
  );

  const offeneRechnungen = useMemo(
    () => rechnungen.filter(r => {
      const s = lookupKey(r.fields.zahlungsstatus);
      return s === 'offen' || s === 'teilweise_bezahlt';
    }),
    [rechnungen]
  );

  // ── Kontext-Zeile ───────────────────────────────────────────────────────
  const contextLine = useMemo(() => {
    const anreiseNamen = anreiseHeute.map(b => {
      const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : '';
    }).filter(Boolean);

    const abreiseNamen = abreiseHeute.map(b => {
      const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : '';
    }).filter(Boolean);

    if (anreiseNamen.length > 0 && abreiseNamen.length > 0) {
      return tx`${namen(anreiseNamen)} reist an — ${namen(abreiseNamen)} reist ab.`;
    }
    if (anreiseNamen.length > 0) {
      return tx`Heute reist an: ${namen(anreiseNamen)}.`;
    }
    if (abreiseNamen.length > 0) {
      return tx`Heute reist ab: ${namen(abreiseNamen)}.`;
    }
    if (eingecheckt.length > 0) {
      return tx`${eingecheckt.length} ${eingecheckt.length === 1 ? tx('Gast') : tx('Gäste')} aktuell eingecheckt — ruhiger Tag.`;
    }
    return tx('Keine Ankünfte oder Abreisen heute.');
  }, [anreiseHeute, abreiseHeute, eingecheckt, gaesteMap]);

  // ── ResourceTimeline Groups + Events ───────────────────────────────────
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
    })),
    [zimmer]
  );

  const events = useMemo<ResourceEvent[]>(
    () =>
      aktiveBuchungen
        .filter(b => !!b.fields.anreise && !!b.fields.zimmer)
        .map(b => {
          const s = lookupKey(b.fields.status);
          const tone =
            s === 'eingecheckt' ? 'success' as const :
            s === 'angefragt' ? 'warning' as const :
            s === 'ausgecheckt' ? 'default' as const :
            'primary' as const;
          const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
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
            tone,
            group: extractRecordId(b.fields.zimmer) ?? '',
          };
        }),
    [aktiveBuchungen, gaesteMap]
  );

  // ── Drag: Reschedule + Cross-Zimmer ────────────────────────────────────
  const handleEventDrop = async (id: string, newStart: string, newEnd?: string, newGroup?: string) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;

    // Doppelbelegung prüfen
    if (newGroup) {
      const conflict = aktiveBuchungen.find(b => {
        if (b.record_id === rid) return false;
        if (extractRecordId(b.fields.zimmer) !== newGroup) return false;
        const bStart = b.fields.anreise ?? '';
        const bEnd = b.fields.abreise ?? bStart;
        const newE = newEnd ?? newStart;
        return bStart < newE && bEnd > newStart;
      });
      if (conflict) {
        const g = gaesteMap.get(extractRecordId(conflict.fields.gast) ?? '');
        const name = g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : tx('Gast');
        return tx`Zimmer belegt — ${name} ist in diesem Zeitraum bereits eingebucht.`;
      }
    }

    const prev = buchungen;
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
      const b = buchungen.find(x => x.record_id === rid);
      const gast = b ? gaesteMap.get(extractRecordId(b.fields.gast) ?? '') : undefined;
      const name = gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : '';
      undoToast(tx`${name} — Buchung verschoben`, async () => {
        setBuchungen(prev);
        const original = prev.find(x => x.record_id === rid);
        if (original) {
          await LivingAppsService.updateBuchungenEntry(rid, {
            anreise: original.fields.anreise,
            abreise: original.fields.abreise,
            zimmer: original.fields.zimmer ?? undefined,
          });
        }
      });
    } catch {
      fetchAll();
    }
  };

  const handleEventResize = async (id: string, newStart: string, newEnd: string) => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = buchungen;
    setBuchungen(prev => prev.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      undoToast(tx('Aufenthaltsdauer angepasst'), async () => {
        setBuchungen(prev);
        const original = prev.find(x => x.record_id === rid);
        if (original) {
          await LivingAppsService.updateBuchungenEntry(rid, {
            anreise: original.fields.anreise,
            abreise: original.fields.abreise,
          });
        }
      });
    } catch {
      fetchAll();
    }
  };

  // ── Hero-Signal: Abreise überfällig (eingecheckt aber Abreise verstrichen) ──
  const ueberfaelligAuschecken = useMemo(
    () => eingecheckt.filter(b => {
      if (!b.fields.abreise) return false;
      return isBefore(startOfDay(parseISO(b.fields.abreise)), startOfDay(clock));
    }),
    [eingecheckt, clock]
  );

  // ── KPI Filter-State ────────────────────────────────────────────────────
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const toggleFilter = (key: string) => setKpiFilter(f => f === key ? null : key);

  // ── WorkList Anreise ────────────────────────────────────────────────────
  const anreiseItems = useMemo(() => {
    return anreiseHeute.map(b => {
      const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      const z = zimmerMap.get(extractRecordId(b.fields.zimmer) ?? '');
      return {
        id: b.record_id,
        title: gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : tx('Unbekannter Gast'),
        secondLine: (
          <span className="text-muted-foreground text-xs">
            {z?.fields.bezeichnung ?? tx('Kein Zimmer')} · {b.fields.personen ?? 1} {b.fields.personen === 1 ? tx('Person') : tx('Personen')}
          </span>
        ),
        action: {
          label: tx('Einchecken'),
          onClick: () => void checkinBuchung(b),
        },
      };
    });
  }, [anreiseHeute, gaesteMap, zimmerMap]);

  // ── WorkList Anfragen ───────────────────────────────────────────────────
  const anfrageItems = useMemo(() => {
    return angefragte.slice(0, 8).map(b => {
      const gast = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
      const z = zimmerMap.get(extractRecordId(b.fields.zimmer) ?? '');
      return {
        id: b.record_id,
        title: gast ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim() : tx('Unbekannter Gast'),
        secondLine: (
          <span className="text-muted-foreground text-xs">
            {z?.fields.bezeichnung ?? '—'} · {formatDate(b.fields.anreise)} – {formatDate(b.fields.abreise)}
          </span>
        ),
        action: {
          label: tx('Bestätigen'),
          onClick: () => void confirmBuchung(b),
        },
      };
    });
  }, [angefragte, gaesteMap, zimmerMap]);

  // ── KPI-Werte ───────────────────────────────────────────────────────────
  const belegteZimmer = eingecheckt.length;
  const gesamt = zimmer.length;

  return (
    <div className="space-y-6">
      {/* Seitenüberschrift */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground truncate">
            {gruss(clock)}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 truncate max-w-xl">
            {contextLine}
          </p>
        </div>
        <button
          onClick={() => crud.buchungen.openCreate({})}
          className="mt-2 sm:mt-0 shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <IconPlus size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          ueberfaelligAuschecken.length > 0 ? (
            <HeroBanner
              icon={<IconLogout size={18} />}
              action={{
                label: tx('Auschecken'),
                onClick: () => void checkoutBuchung(ueberfaelligAuschecken[0]),
              }}
            >
              <b>
                {namen(ueberfaelligAuschecken.map(b => {
                  const g = gaesteMap.get(extractRecordId(b.fields.gast) ?? '');
                  return g ? `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim() : '';
                }).filter(Boolean))}
              </b>{' '}
              {tx('— Abreise war')} {formatDate(ueberfaelligAuschecken[0].fields.abreise)}
              {tx(', bitte auschecken.')}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Belegt')}
              value={`${belegteZimmer} / ${gesamt}`}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={belegteZimmer === gesamt ? 'warning' : belegteZimmer > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Anreise heute')}
              value={anreiseHeute.length}
              icon={<IconLogin size={16} className="shrink-0" />}
              tone={anreiseHeute.length > 0 ? 'primary' : 'default'}
              onClick={() => toggleFilter('anreise')}
              active={kpiFilter === 'anreise'}
            />
            <StatStripItem
              title={tx('Abreise heute')}
              value={abreiseHeute.length}
              icon={<IconLogout size={16} className="shrink-0" />}
              tone={abreiseHeute.length > 0 ? 'warning' : 'default'}
              onClick={() => toggleFilter('abreise')}
              active={kpiFilter === 'abreise'}
            />
            <StatStripItem
              title={tx('Offene Anfragen')}
              value={angefragte.length}
              icon={<IconAlertCircle size={16} className="shrink-0" />}
              tone={angefragte.length > 0 ? 'warning' : 'default'}
              onClick={() => toggleFilter('anfragen')}
              active={kpiFilter === 'anfragen'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconReceipt size={16} className="shrink-0" />}
              tone={offeneRechnungen.length > 0 ? 'destructive' : 'default'}
              onClick={() => toggleFilter('rechnungen')}
              active={kpiFilter === 'rechnungen'}
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
                zimmer: group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined,
              });
            }}
            onEmptyClick={(date, group) => {
              crud.buchungen.openCreate({
                anreise: format(date, 'yyyy-MM-dd'),
                zimmer: group ? createRecordUrl(APP_IDS.ZIMMER, group) : undefined,
              });
            }}
            renderGroupHeader={group => {
              const z = zimmerMap.get(group.key);
              const kat = z?.fields.kategorie?.label;
              const preis = z?.fields.preis_pro_nacht;
              return (
                <div className="flex w-full flex-col min-w-0">
                  <span className="truncate text-sm font-medium text-foreground leading-tight">
                    {group.label}
                  </span>
                  {kat && (
                    <span className="truncate text-[11px] text-muted-foreground leading-tight">
                      {kat}{preis != null ? ` · ${formatCurrency(preis)}` : ''}
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
              title={tx('Heute ankommen')}
              items={anreiseItems}
              onItemClick={id => {
                const b = buchungen.find(x => x.record_id === id);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: abreiseHeute.length > 0
                  ? tx('Alle eingecheckt — reibungsloser Morgen!')
                  : tx('Keine Ankünfte heute.'),
                action: {
                  label: tx('Buchung anlegen'),
                  onClick: () => crud.buchungen.openCreate({ anreise: today }),
                },
              }}
            />
            <WorkList
              title={tx('Offene Anfragen')}
              items={anfrageItems}
              onItemClick={id => {
                const b = buchungen.find(x => x.record_id === id);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: angefragte.length === 0
                  ? tx('Keine offenen Anfragen.')
                  : tx('Alle Anfragen bearbeitet.'),
                action: {
                  label: tx('Neue Buchung'),
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
