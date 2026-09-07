import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { tx, appLabel } from '@/i18n';
import { dateFnsLocale } from '@/i18n';
import { format, parseISO, isToday, isBefore, isAfter, startOfDay } from 'date-fns';
import { useMemo, useState } from 'react';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { formatDate, formatCurrency, lookupKey } from '@/lib/formatters';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, lookupOption } from '@/types/app';
import type { EnrichedBuchungen } from '@/types/enriched';
import {
  IconBed, IconLogin, IconLogout, IconAlertTriangle, IconReceipt, IconPlus,
  IconCalendarEvent, IconCheck,
} from '@tabler/icons-react';
import { DashboardGrid } from '@/components/DashboardGrid';
import { HeroBanner } from '@/components/HeroBanner';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import {
  ResourceTimeline,
  type ResourceEvent,
  type ResourceGroup,
} from '@/components/widgets/ResourceTimeline';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    buchungen, setBuchungen, zimmer, rechnungen, gaeste,
    gaesteMap, zimmerMap, fetchAll,
  } = data;

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = top.record as EnrichedBuchungen;
        const statusKey = lookupKey(b.fields.status);
        if (statusKey === 'angefragt') {
          return {
            label: tx('Bestätigen'),
            onClick: () => advanceBuchung(b, 'bestaetigt'),
          };
        }
        if (statusKey === 'bestaetigt') {
          return {
            label: tx('Einchecken'),
            onClick: () => advanceBuchung(b, 'eingecheckt'),
          };
        }
        if (statusKey === 'eingecheckt') {
          return {
            label: tx('Auschecken'),
            onClick: () => advanceBuchung(b, 'ausgecheckt'),
          };
        }
      }
      if (top.type === 'rechnungen') {
        const r = top.record;
        const zKey = lookupKey(r.fields.zahlungsstatus);
        if (zKey !== 'bezahlt') {
          return {
            label: tx('Als bezahlt markieren'),
            onClick: () => markRechnungBezahlt(r.record_id),
          };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen as EnrichedBuchungen[];
  const clock = useClock();
  const todayStr = format(clock, 'yyyy-MM-dd');

  // --- Shared advance helper (used by hero, worklist, overlay footer) ---
  function advanceBuchung(b: EnrichedBuchungen, newStatus: string) {
    const prev = b.fields.status;
    const newLookup = lookupOption('buchungen', 'status', newStatus);
    setBuchungen(prev2 => prev2.map(x =>
      x.record_id === b.record_id
        ? { ...x, fields: { ...x.fields, status: newLookup } }
        : x
    ));
    const guestName = b.gastName || tx('Gast');
    void LivingAppsService.updateBuchungenEntry(b.record_id, { status: newStatus })
      .then(() => {
        undoToast(tx`${guestName} — Status aktualisiert`, () => {
          setBuchungen(prev2 => prev2.map(x =>
            x.record_id === b.record_id
              ? { ...x, fields: { ...x.fields, status: prev } }
              : x
          ));
          void LivingAppsService.updateBuchungenEntry(b.record_id, { status: lookupKey(prev) ?? newStatus });
        });
      })
      .catch(() => void fetchAll());
  }

  function markRechnungBezahlt(rechnungId: string) {
    void LivingAppsService.updateRechnungenEntry(rechnungId, {
      zahlungsstatus: 'bezahlt',
      zahlungseingang: format(clock, "yyyy-MM-dd'T'HH:mm"),
    }).then(() => {
      undoToast(tx('Rechnung als bezahlt markiert'));
      void fetchAll();
    }).catch(() => void fetchAll());
  }

  // --- Groups: Zimmer als Ressourcenachse ---
  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
      tone: 'default' as const,
    })),
    [zimmer]
  );

  // --- Events: Buchungen als Bars ---
  const statusTone = (b: EnrichedBuchungen) => {
    const key = lookupKey(b.fields.status);
    if (key === 'storniert') return 'default' as const;
    if (key === 'eingecheckt') return 'success' as const;
    if (key === 'ausgecheckt') return 'default' as const;
    if (key === 'angefragt') return 'warning' as const;
    return 'primary' as const;
  };

  const events = useMemo<ResourceEvent[]>(
    () => enrichedBuchungen
      .filter(b => !!b.fields.anreise && lookupKey(b.fields.status) !== 'storniert')
      .map(b => ({
        id: `buchung:${b.record_id}`,
        start: b.fields.anreise!,
        end: b.fields.abreise,
        allDay: true,
        title: b.gastName || tx('Gast'),
        subtitle: b.fields.abreise ? `${formatDate(b.fields.anreise)} – ${formatDate(b.fields.abreise)}` : formatDate(b.fields.anreise),
        tone: statusTone(b),
        group: extractRecordId(b.fields.zimmer) ?? '',
      })),
    [enrichedBuchungen]
  );

  // --- KPI-Berechnungen ---
  const anreisenHeute = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.anreise === todayStr &&
      lookupKey(b.fields.status) !== 'storniert'
    ),
    [enrichedBuchungen, todayStr]
  );

  const abreisenHeute = useMemo(
    () => enrichedBuchungen.filter(b =>
      b.fields.abreise === todayStr &&
      lookupKey(b.fields.status) !== 'storniert'
    ),
    [enrichedBuchungen, todayStr]
  );

  const belegtHeute = useMemo(
    () => enrichedBuchungen.filter(b => {
      const key = lookupKey(b.fields.status);
      if (key === 'storniert') return false;
      if (!b.fields.anreise) return false;
      const anreise = b.fields.anreise;
      const abreise = b.fields.abreise ?? todayStr;
      return anreise <= todayStr && abreise >= todayStr;
    }),
    [enrichedBuchungen, todayStr]
  );

  const anfragen = useMemo(
    () => enrichedBuchungen.filter(b => lookupKey(b.fields.status) === 'angefragt'),
    [enrichedBuchungen]
  );

  const offeneRechnungen = useMemo(
    () => crud.enriched.rechnungen.filter(r => {
      const key = lookupKey(r.fields.zahlungsstatus);
      return key === 'offen' || key === 'teilweise_bezahlt';
    }),
    [crud.enriched.rechnungen]
  );

  // Filter für Worklist
  const [filterAnreisen, setFilterAnreisen] = useState(false);

  // --- Drag & Drop (Umbuchung) ---
  const handleEventDrop = async (
    id: string,
    newStart: string,
    newEnd?: string,
    newGroup?: string
  ): Promise<string | void> => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const bFound = buchungen.find(b => b.record_id === rid);
    if (!bFound) return;

    // Doppelbelegung prüfen
    if (newGroup) {
      const overlap = enrichedBuchungen.find(b => {
        if (b.record_id === rid) return false;
        if (lookupKey(b.fields.status) === 'storniert') return false;
        const bRoom = extractRecordId(b.fields.zimmer);
        if (bRoom !== newGroup) return false;
        const bAnreise = b.fields.anreise ?? '';
        const bAbreise = b.fields.abreise ?? bAnreise;
        const newEnd2 = newEnd ?? newStart;
        return bAnreise <= newEnd2 && bAbreise >= newStart;
      });
      if (overlap) {
        return tx('Zimmer ist in diesem Zeitraum bereits belegt');
      }
    }

    const prevAnreise = bFound.fields.anreise;
    const prevAbreise = bFound.fields.abreise;
    const prevZimmer = bFound.fields.zimmer;
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
      undoToast(tx('Buchung verschoben'), () => {
        setBuchungen(prev => prev.map(b =>
          b.record_id === rid
            ? { ...b, fields: { ...b.fields, anreise: prevAnreise, abreise: prevAbreise, zimmer: prevZimmer } }
            : b
        ));
        void LivingAppsService.updateBuchungenEntry(rid, {
          anreise: prevAnreise,
          abreise: prevAbreise,
          ...(prevZimmer ? { zimmer: prevZimmer } : {}),
        });
      });
    } catch {
      void fetchAll();
    }
  };

  const handleEventResize = async (id: string, newStart: string, newEnd: string): Promise<string | void> => {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;

    // Doppelbelegung prüfen
    const bFound = buchungen.find(b => b.record_id === rid);
    if (!bFound) return;
    const roomId = extractRecordId(bFound.fields.zimmer);
    if (roomId) {
      const overlap = enrichedBuchungen.find(b => {
        if (b.record_id === rid) return false;
        if (lookupKey(b.fields.status) === 'storniert') return false;
        if (extractRecordId(b.fields.zimmer) !== roomId) return false;
        const bAnreise = b.fields.anreise ?? '';
        const bAbreise = b.fields.abreise ?? bAnreise;
        return bAnreise <= newEnd && bAbreise >= newStart;
      });
      if (overlap) {
        return tx('Zimmer ist in diesem Zeitraum bereits belegt');
      }
    }

    const prevAnreise = bFound.fields.anreise;
    const prevAbreise = bFound.fields.abreise;

    setBuchungen(prev => prev.map(b =>
      b.record_id === rid
        ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
        : b
    ));
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      undoToast(tx('Buchungsdauer geändert'), () => {
        setBuchungen(prev => prev.map(b =>
          b.record_id === rid
            ? { ...b, fields: { ...b.fields, anreise: prevAnreise, abreise: prevAbreise } }
            : b
        ));
        void LivingAppsService.updateBuchungenEntry(rid, { anreise: prevAnreise, abreise: prevAbreise });
      });
    } catch {
      void fetchAll();
    }
  };

  // --- Kontext-Zeile ---
  const contextLine = useMemo(() => {
    const anreisenNamen = anreisenHeute.map(b => b.gastName).filter(Boolean);
    const abreisenNamen = abreisenHeute.map(b => b.gastName).filter(Boolean);
    if (anreisenNamen.length === 0 && abreisenNamen.length === 0) {
      if (belegtHeute.length > 0) {
        return tx`${String(belegtHeute.length)} Zimmer belegt — ruhiger Tag.`;
      }
      return tx('Heute keine Ankünfte oder Abreisen.');
    }
    const parts: string[] = [];
    if (anreisenNamen.length > 0) {
      parts.push(tx`Heute kommen ${namen(anreisenNamen)}.`);
    }
    if (abreisenNamen.length > 0) {
      parts.push(tx`Heute reisen ${namen(abreisenNamen)} ab.`);
    }
    return parts.join(' ');
  }, [anreisenHeute, abreisenHeute, belegtHeute]);

  // --- Hero: offene Anfragen ---
  const neuesteAnfrage = anfragen[0];

  return (
    <div className="space-y-6">
      {/* Seiten-Kopf */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {gruss(clock)}
          </h1>
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

      <DashboardGrid
        variant="wide"
        hero={
          anfragen.length > 0 && neuesteAnfrage ? (
            <HeroBanner
              icon={<IconAlertTriangle size={18} />}
              action={{
                label: tx('Bestätigen'),
                onClick: () => advanceBuchung(neuesteAnfrage, 'bestaetigt'),
              }}
            >
              <b>{namen(anfragen.map(b => b.gastName).filter(Boolean))}</b>{' '}
              {anfragen.length === 1
                ? tx`wartet auf Bestätigung — Anreise ${formatDate(neuesteAnfrage.fields.anreise)}.`
                : tx`warten auf Bestätigung (${String(anfragen.length)} Anfragen).`}
            </HeroBanner>
          ) : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Belegt heute')}
              value={`${belegtHeute.length} / ${zimmer.length}`}
              icon={<IconBed size={16} className="shrink-0" />}
              tone={belegtHeute.length === zimmer.length ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Anreisen heute')}
              value={anreisenHeute.length}
              icon={<IconLogin size={16} className="shrink-0" />}
              tone={anreisenHeute.length > 0 ? 'primary' : 'default'}
              onClick={() => setFilterAnreisen(f => !f)}
              active={filterAnreisen}
            />
            <StatStripItem
              title={tx('Abreisen heute')}
              value={abreisenHeute.length}
              icon={<IconLogout size={16} className="shrink-0" />}
              tone="default"
            />
            <StatStripItem
              title={tx('Offene Anfragen')}
              value={anfragen.length}
              icon={<IconCalendarEvent size={16} className="shrink-0" />}
              tone={anfragen.length > 0 ? 'warning' : 'default'}
            />
          </StatStrip>
        }
        primary={
          <ResourceTimeline
            events={filterAnreisen
              ? events.filter(ev => {
                  const rid = ev.id.split(':')[1] ?? '';
                  return anreisenHeute.some(b => b.record_id === rid);
                })
              : events}
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
              // Doppelbelegung prüfen
              const startStr = format(start, 'yyyy-MM-dd');
              const endStr = format(end, 'yyyy-MM-dd');
              if (group) {
                const blocked = enrichedBuchungen.find(b => {
                  if (lookupKey(b.fields.status) === 'storniert') return false;
                  if (extractRecordId(b.fields.zimmer) !== group) return false;
                  const bAnreise = b.fields.anreise ?? '';
                  const bAbreise = b.fields.abreise ?? bAnreise;
                  return bAnreise <= endStr && bAbreise >= startStr;
                });
                if (blocked) return;
              }
              crud.buchungen.openCreate({
                anreise: startStr,
                abreise: endStr,
                ...(group ? { zimmer: group } : {}),
                status: 'bestaetigt',
              });
            }}
            onEmptyClick={(date, group) => {
              const dayStr = format(date, 'yyyy-MM-dd');
              crud.buchungen.openCreate({
                anreise: dayStr,
                ...(group ? { zimmer: group } : {}),
                status: 'bestaetigt',
              });
            }}
            renderGroupHeader={group => {
              const z = zimmer.find(x => x.record_id === group.key);
              const isOccupied = belegtHeute.some(b =>
                extractRecordId(b.fields.zimmer) === group.key
              );
              return (
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="truncate text-sm font-medium text-foreground">{group.label}</span>
                  {isOccupied && (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-500" title={tx('Belegt')} />
                  )}
                </div>
              );
            }}
          />
        }
        aside={
          <>
            <WorkList
              title={tx('Heute — Ankünfte & Abreisen')}
              items={[
                ...anreisenHeute.map(b => ({
                  id: `a:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-primary">{tx('Anreise')}</span>
                      <span className="text-muted-foreground"> · {b.zimmerName}</span>
                    </>
                  ),
                  action: lookupKey(b.fields.status) === 'bestaetigt'
                    ? {
                        label: tx('Einchecken'),
                        onClick: () => advanceBuchung(b, 'eingecheckt'),
                      }
                    : undefined,
                })),
                ...abreisenHeute.map(b => ({
                  id: `ab:${b.record_id}`,
                  title: b.gastName || tx('Gast'),
                  secondLine: (
                    <>
                      <span className="font-medium text-amber-600">{tx('Abreise')}</span>
                      <span className="text-muted-foreground"> · {b.zimmerName}</span>
                    </>
                  ),
                  action: lookupKey(b.fields.status) === 'eingecheckt'
                    ? {
                        label: tx('Auschecken'),
                        onClick: () => advanceBuchung(b, 'ausgecheckt'),
                      }
                    : undefined,
                })),
              ]}
              onItemClick={id => {
                const rid = id.replace(/^[a-z]+:/, '');
                const b = buchungen.find(x => x.record_id === rid);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: tx('Heute keine Ankünfte oder Abreisen — ruhiger Tag!'),
                action: {
                  label: tx('Neue Buchung anlegen'),
                  onClick: () => crud.buchungen.openCreate({ status: 'bestaetigt' }),
                },
              }}
              max={8}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={offeneRechnungen.map(r => {
                const buchId = extractRecordId(r.fields.buchung);
                const buch = buchId ? buchungen.find(b => b.record_id === buchId) : undefined;
                const gastId = buch ? extractRecordId(buch.fields.gast) : undefined;
                const gast = gastId ? gaesteMap.get(gastId) : undefined;
                const gastName = gast
                  ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
                  : tx('Gast');
                return {
                  id: r.record_id,
                  title: gastName,
                  secondLine: (
                    <>
                      <span className={
                        lookupKey(r.fields.zahlungsstatus) === 'offen'
                          ? 'font-medium text-destructive'
                          : 'font-medium text-amber-600'
                      }>
                        {r.fields.zahlungsstatus?.label ?? tx('Offen')}
                      </span>
                      {r.fields.betrag != null && (
                        <span className="text-muted-foreground"> · {formatCurrency(r.fields.betrag)}</span>
                      )}
                    </>
                  ),
                  action: {
                    label: tx('Bezahlt'),
                    onClick: () => markRechnungBezahlt(r.record_id),
                  },
                };
              })}
              onItemClick={id => {
                const r = rechnungen.find(x => x.record_id === id);
                if (r) crud.rechnungen.openDetail(r);
              }}
              empty={{
                text: tx('Alle Rechnungen bezahlt — super!'),
              }}
              max={6}
            />
          </>
        }
      />

      {crud.surfaces}
    </div>
  );
}
