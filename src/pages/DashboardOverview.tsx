import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isBefore, startOfDay, addDays } from 'date-fns';
import type { DashboardData } from '@/hooks/useDashboardData';
import { useEntityCrud } from '@/components/EntityCrud';
import { tx, appLabel, dateFnsLocale } from '@/i18n';
import { LivingAppsService, extractRecordId, createRecordUrl } from '@/services/livingAppsService';
import { APP_IDS, lookupOption } from '@/types/app';
import { formatDate, formatCurrency } from '@/lib/formatters';
import { useClock, gruss, namen, undoToast } from '@/lib/polish';
import { DashboardGrid } from '@/components/DashboardGrid';
import { StatStrip, StatStripItem } from '@/components/StatCard';
import { WorkList } from '@/components/WorkList';
import { HeroBanner } from '@/components/HeroBanner';
import {
  ResourceTimeline,
  type ResourceEvent,
  type ResourceGroup,
  type ResourceTone,
} from '@/components/widgets/ResourceTimeline';
import {
  IconBed,
  IconAlertTriangle,
  IconLogin,
  IconLogout,
  IconCalendarCheck,
  IconReceipt,
  IconCurrencyEuro,
  IconPlus,
} from '@tabler/icons-react';

export default function DashboardOverview({ data }: { data: DashboardData }) {
  const {
    gaeste, zimmer, buchungen, rechnungen,
    gaesteMap, zimmerMap, buchungenMap,
    setBuchungen, fetchAll,
  } = data;

  const clock = useClock();
  const todayKey = format(clock, 'yyyy-MM-dd');

  const crud = useEntityCrud(data, {
    footer: (top) => {
      if (top.type === 'buchungen') {
        const b = buchungen.find(x => x.record_id === top.record.record_id);
        const statusKey = b?.fields.status?.key;
        if (statusKey === 'bestaetigt') {
          return { label: tx('Einchecken'), onClick: () => doCheckin(top.record.record_id) };
        }
        if (statusKey === 'eingecheckt') {
          return { label: tx('Auschecken'), onClick: () => doCheckout(top.record.record_id) };
        }
      }
      return undefined;
    },
  });

  const enrichedBuchungen = crud.enriched.buchungen;
  const enrichedRechnungen = crud.enriched.rechnungen;

  // ── Shared advance helpers ────────────────────────────────────────────────

  async function doCheckin(id: string) {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    const neu = lookupOption('buchungen', 'status', 'eingecheckt');
    setBuchungen(bs => bs.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, status: neu } } : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'eingecheckt' });
      undoToast(tx('Eingecheckt'), async () => {
        setBuchungen(bs => bs.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, status: prev.fields.status } } : b));
        await LivingAppsService.updateBuchungenEntry(id, { status: prev.fields.status?.key ?? 'bestaetigt' });
      });
    } catch {
      await fetchAll();
    }
  }

  async function doCheckout(id: string) {
    const prev = buchungen.find(b => b.record_id === id);
    if (!prev) return;
    const neu = lookupOption('buchungen', 'status', 'ausgecheckt');
    setBuchungen(bs => bs.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, status: neu } } : b));
    try {
      await LivingAppsService.updateBuchungenEntry(id, { status: 'ausgecheckt' });
      undoToast(tx('Ausgecheckt'), async () => {
        setBuchungen(bs => bs.map(b => b.record_id === id ? { ...b, fields: { ...b.fields, status: prev.fields.status } } : b));
        await LivingAppsService.updateBuchungenEntry(id, { status: prev.fields.status?.key ?? 'eingecheckt' });
      });
    } catch {
      await fetchAll();
    }
  }

  // ── Derived sets ─────────────────────────────────────────────────────────

  const heute = startOfDay(clock);
  const morgen = addDays(heute, 1);

  const anreisenHeute = useMemo(
    () => buchungen.filter(b => b.fields.anreise === todayKey && b.fields.status?.key !== 'storniert' && b.fields.status?.key !== 'ausgecheckt'),
    [buchungen, todayKey],
  );

  const abreisenHeute = useMemo(
    () => buchungen.filter(b => b.fields.abreise === todayKey && b.fields.status?.key === 'eingecheckt'),
    [buchungen, todayKey],
  );

  const nochNichtEingecheckt = useMemo(
    () => anreisenHeute.filter(b => b.fields.status?.key !== 'eingecheckt'),
    [anreisenHeute],
  );

  const offeneRechnungen = useMemo(
    () => rechnungen.filter(r => r.fields.zahlungsstatus?.key === 'offen' || r.fields.zahlungsstatus?.key === 'teilweise_bezahlt'),
    [rechnungen],
  );

  const ueberfaelligeRechnungen = useMemo(
    () => offeneRechnungen.filter(r => r.fields.faellig_am && isBefore(parseISO(r.fields.faellig_am), heute)),
    [offeneRechnungen, heute],
  );

  const belegtHeute = useMemo(
    () => buchungen.filter(b => {
      const s = b.fields.status?.key;
      if (!b.fields.anreise) return false;
      if (s === 'storniert' || s === 'ausgecheckt') return false;
      const an = b.fields.anreise;
      const ab = b.fields.abreise ?? todayKey;
      return an <= todayKey && ab >= todayKey;
    }),
    [buchungen, todayKey],
  );

  const auslastung = zimmer.length > 0 ? Math.round((belegtHeute.length / zimmer.length) * 100) : 0;

  // ── ResourceTimeline ──────────────────────────────────────────────────────

  const groups = useMemo<ResourceGroup[]>(
    () => zimmer.map(z => ({
      key: z.record_id,
      label: z.fields.bezeichnung ?? z.record_id,
    })),
    [zimmer],
  );

  const EVENT_PREFIX = 'buchung';

  function toneForBuchung(statusKey: string | undefined): ResourceTone {
    if (statusKey === 'eingecheckt') return 'success';
    if (statusKey === 'angefragt') return 'warning';
    if (statusKey === 'storniert') return 'destructive';
    return 'primary';
  }

  const events = useMemo<ResourceEvent[]>(
    () =>
      buchungen
        .filter(b => !!b.fields.anreise && b.fields.status?.key !== 'storniert')
        .map(b => {
          const gastId = extractRecordId(b.fields.gast);
          const gast = gastId ? gaesteMap.get(gastId) : undefined;
          const gastName = gast
            ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
            : tx('Gast');
          return {
            id: `${EVENT_PREFIX}:${b.record_id}`,
            start: b.fields.anreise!,
            end: b.fields.abreise,
            allDay: true,
            title: gastName,
            subtitle: b.fields.status?.label,
            tone: toneForBuchung(b.fields.status?.key),
            group: extractRecordId(b.fields.zimmer) ?? '',
          };
        }),
    [buchungen, gaesteMap],
  );

  // ── Drag reschedule ───────────────────────────────────────────────────────

  async function onEventDrop(id: string, newStart: string, newEnd?: string, newGroup?: string): Promise<void | string> {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;

    // Double-booking check
    if (newGroup) {
      const conflict = buchungen.find(b => {
        if (b.record_id === rid) return false;
        if (b.fields.status?.key === 'storniert') return false;
        const bZimmer = extractRecordId(b.fields.zimmer);
        if (bZimmer !== newGroup) return false;
        const bAn = b.fields.anreise;
        const bAb = b.fields.abreise ?? bAn ?? '';
        const newAb = newEnd ?? newStart;
        return bAn && bAn <= newAb && bAb >= newStart;
      });
      if (conflict) {
        const conflictGastId = extractRecordId(conflict.fields.gast);
        const conflictGast = conflictGastId ? gaesteMap.get(conflictGastId) : undefined;
        const name = conflictGast
          ? `${conflictGast.fields.vorname ?? ''} ${conflictGast.fields.nachname ?? ''}`.trim()
          : tx('eine andere Buchung');
        return tx`Zimmer belegt (${name})`;
      }
    }

    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;

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
      undoToast(tx('Buchung verschoben'), async () => {
        setBuchungen(bs =>
          bs.map(b =>
            b.record_id === rid
              ? { ...b, fields: prev.fields }
              : b,
          ),
        );
        await LivingAppsService.updateBuchungenEntry(rid, {
          anreise: prev.fields.anreise,
          abreise: prev.fields.abreise,
          zimmer: prev.fields.zimmer,
        });
      });
    } catch {
      await fetchAll();
    }
  }

  async function onEventResize(id: string, newStart: string, newEnd: string): Promise<void> {
    const rid = id.split(':')[1] ?? '';
    if (!rid) return;
    const prev = buchungen.find(b => b.record_id === rid);
    if (!prev) return;
    setBuchungen(bs =>
      bs.map(b =>
        b.record_id === rid
          ? { ...b, fields: { ...b.fields, anreise: newStart, abreise: newEnd } }
          : b,
      ),
    );
    try {
      await LivingAppsService.updateBuchungenEntry(rid, { anreise: newStart, abreise: newEnd });
      undoToast(tx('Aufenthalt angepasst'), async () => {
        setBuchungen(bs => bs.map(b => b.record_id === rid ? { ...b, fields: prev.fields } : b));
        await LivingAppsService.updateBuchungenEntry(rid, {
          anreise: prev.fields.anreise,
          abreise: prev.fields.abreise,
        });
      });
    } catch {
      await fetchAll();
    }
  }

  // ── Context line ──────────────────────────────────────────────────────────

  function contextLine() {
    const parts: string[] = [];
    if (anreisenHeute.length > 0) {
      const names = anreisenHeute.map(b => {
        const gId = extractRecordId(b.fields.gast);
        const g = gId ? gaesteMap.get(gId) : undefined;
        return g?.fields.nachname ?? g?.fields.vorname ?? '';
      }).filter(Boolean);
      parts.push(namen(names) + tx` reist an`);
    }
    if (abreisenHeute.length > 0) {
      const names = abreisenHeute.map(b => {
        const gId = extractRecordId(b.fields.gast);
        const g = gId ? gaesteMap.get(gId) : undefined;
        return g?.fields.nachname ?? g?.fields.vorname ?? '';
      }).filter(Boolean);
      parts.push(namen(names) + tx` reist ab`);
    }
    if (parts.length === 0) {
      return zimmer.length > 0
        ? tx`Heute keine An- oder Abreisen geplant.`
        : tx`Willkommen in der Pension — richte zuerst die Zimmer ein.`;
    }
    return parts.join(' · ');
  }

  // ── Hero: ausstehende Abreisen (eingecheckt, fällig heute) ───────────────

  const ersteAbreise = abreisenHeute[0];
  const ersteAbreiseGast = ersteAbreise
    ? (() => {
        const gId = extractRecordId(ersteAbreise.fields.gast);
        return gId ? gaesteMap.get(gId) : undefined;
      })()
    : undefined;

  const showHero = abreisenHeute.length > 0;

  // ── WorkList: Anreisen heute ──────────────────────────────────────────────

  const anreisenItems = useMemo(() => anreisenHeute.map(b => {
    const gId = extractRecordId(b.fields.gast);
    const gast = gId ? gaesteMap.get(gId) : undefined;
    const gastName = gast
      ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
      : tx('Unbekannter Gast');
    const zId = extractRecordId(b.fields.zimmer);
    const zimmerName = zId ? zimmerMap.get(zId)?.fields.bezeichnung ?? '' : '';
    const statusKey = b.fields.status?.key;
    return {
      id: b.record_id,
      title: gastName,
      secondLine: (
        <>
          {zimmerName && <span className="text-muted-foreground">{zimmerName} · </span>}
          <span
            className={
              statusKey === 'eingecheckt'
                ? 'font-medium text-emerald-600'
                : statusKey === 'angefragt'
                ? 'font-medium text-amber-600'
                : 'font-medium text-primary'
            }
          >
            {b.fields.status?.label ?? tx('Bestätigt')}
          </span>
        </>
      ),
      action:
        statusKey === 'bestaetigt'
          ? { label: tx('Einchecken'), onClick: () => doCheckin(b.record_id) }
          : statusKey === 'eingecheckt'
          ? { label: tx('Auschecken'), onClick: () => doCheckout(b.record_id) }
          : undefined,
    };
  }), [anreisenHeute, gaesteMap, zimmerMap]);

  // ── WorkList: offene Rechnungen ───────────────────────────────────────────

  const rechnungenItems = useMemo(() => offeneRechnungen.slice(0, 8).map(r => {
    const bId = extractRecordId(r.fields.buchung);
    const buchung = bId ? buchungenMap.get(bId) : undefined;
    const gastId = buchung ? extractRecordId(buchung.fields.gast) : undefined;
    const gast = gastId ? gaesteMap.get(gastId) : undefined;
    const gastName = gast
      ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
      : tx('Buchung');
    const faellig = r.fields.faellig_am;
    const isUeberfaellig = faellig && isBefore(parseISO(faellig), heute);
    return {
      id: r.record_id,
      title: gastName,
      secondLine: (
        <>
          <span
            className={
              isUeberfaellig
                ? 'font-medium text-red-600'
                : 'text-muted-foreground'
            }
          >
            {r.fields.zahlungsstatus?.label}
          </span>
          {r.fields.betrag != null && (
            <span className="text-muted-foreground"> · {formatCurrency(r.fields.betrag)}</span>
          )}
          {faellig && (
            <span className="text-muted-foreground"> · {tx('fällig')} {formatDate(faellig)}</span>
          )}
        </>
      ),
    };
  }), [offeneRechnungen, buchungenMap, gaesteMap, heute]);

  // ── Empty state ───────────────────────────────────────────────────────────

  if (zimmer.length === 0 && buchungen.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <IconBed size={48} className="text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold mb-1">{tx('Pension einrichten')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{tx('Füge zuerst die Zimmer der Pension hinzu.')}</p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => crud.zimmer.openCreate({})}
        >
          <IconPlus size={16} />
          {tx('Erstes Zimmer anlegen')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{gruss(clock)}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{contextLine()}</p>
        </div>
        <button
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 self-start"
          onClick={() => crud.buchungen.openCreate({})}
        >
          <IconPlus size={16} className="shrink-0" />
          {tx('Neue Buchung')}
        </button>
      </div>

      <DashboardGrid
        variant="wide"
        hero={
          showHero && ersteAbreiseGast
            ? (
              <HeroBanner
                icon={<IconLogout size={18} />}
                action={{
                  label: tx('Auschecken'),
                  onClick: () => ersteAbreise && doCheckout(ersteAbreise.record_id),
                }}
              >
                {abreisenHeute.length === 1
                  ? tx`${`${ersteAbreiseGast.fields.vorname ?? ''} ${ersteAbreiseGast.fields.nachname ?? ''}`.trim()} reist heute ab — Checkout ausstehend.`
                  : tx`${String(abreisenHeute.length)} Gäste reisen heute ab — Checkout ausstehend.`}
              </HeroBanner>
            )
            : undefined
        }
        kpis={
          <StatStrip>
            <StatStripItem
              title={tx('Belegt heute')}
              value={`${belegtHeute.length} / ${zimmer.length}`}
              icon={<IconBed size={16} />}
              tone={auslastung >= 80 ? 'success' : auslastung >= 50 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Anreisen heute')}
              value={anreisenHeute.length}
              icon={<IconLogin size={16} />}
              tone={nochNichtEingecheckt.length > 0 ? 'warning' : anreisenHeute.length > 0 ? 'primary' : 'default'}
            />
            <StatStripItem
              title={tx('Abreisen heute')}
              value={abreisenHeute.length}
              icon={<IconLogout size={16} />}
              tone={abreisenHeute.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Offene Rechnungen')}
              value={offeneRechnungen.length}
              icon={<IconReceipt size={16} />}
              tone={ueberfaelligeRechnungen.length > 0 ? 'destructive' : offeneRechnungen.length > 0 ? 'warning' : 'default'}
            />
            <StatStripItem
              title={tx('Auslastung')}
              value={`${auslastung} %`}
              icon={<IconCurrencyEuro size={16} />}
              tone={auslastung >= 80 ? 'success' : 'default'}
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
              const b = buchungen.find(x => x.record_id === rid);
              if (b) crud.buchungen.openDetail(b);
            }}
            onEventDrop={onEventDrop}
            onEventResize={onEventResize}
            onRangeCreate={(start, end, group) => {
              const anreise = format(start, 'yyyy-MM-dd');
              const abreise = format(end, 'yyyy-MM-dd');
              crud.buchungen.openCreate({
                anreise,
                abreise,
                zimmer: group ?? undefined,
              });
            }}
            onEmptyClick={(date, group) => {
              crud.buchungen.openCreate({
                anreise: format(date, 'yyyy-MM-dd'),
                zimmer: group ?? undefined,
              });
            }}
            renderEvent={(ev, meta) => (
              <div className="flex items-center gap-1 truncate text-xs">
                <IconBed className="h-3 w-3 shrink-0 opacity-70" />
                {meta.isStart && (
                  <span className="truncate font-medium">{ev.title}</span>
                )}
              </div>
            )}
            renderGroupHeader={group => {
              const z = zimmer.find(x => x.record_id === group.key);
              const kat = z?.fields.kategorie?.label;
              const preis = z?.fields.preis_pro_nacht;
              return (
                <div
                  className="flex w-full flex-col gap-0.5 cursor-pointer"
                  onClick={() => z && crud.zimmer.openDetail(z)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && z && crud.zimmer.openDetail(z)}
                >
                  <span className="truncate text-sm font-medium text-foreground">{group.label}</span>
                  {kat && (
                    <span className="truncate text-[11px] text-muted-foreground">
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
              title={tx('Heute')}
              items={
                anreisenHeute.length === 0 && abreisenHeute.length === 0
                  ? []
                  : [
                      ...anreisenItems,
                      ...abreisenHeute
                        .filter(b => !anreisenHeute.find(a => a.record_id === b.record_id))
                        .map(b => {
                          const gId = extractRecordId(b.fields.gast);
                          const gast = gId ? gaesteMap.get(gId) : undefined;
                          const gastName = gast
                            ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
                            : tx('Gast');
                          const zId = extractRecordId(b.fields.zimmer);
                          const zimmerName = zId ? zimmerMap.get(zId)?.fields.bezeichnung ?? '' : '';
                          return {
                            id: b.record_id,
                            title: gastName,
                            secondLine: (
                              <>
                                {zimmerName && <span className="text-muted-foreground">{zimmerName} · </span>}
                                <span className="font-medium text-amber-600">{tx('Abreise')}</span>
                              </>
                            ),
                            action: { label: tx('Auschecken'), onClick: () => doCheckout(b.record_id) },
                          };
                        }),
                    ]
              }
              onItemClick={id => {
                const b = buchungen.find(x => x.record_id === id);
                if (b) crud.buchungen.openDetail(b);
              }}
              empty={{
                text: tx('Heute keine An- oder Abreisen'),
                action: { label: tx('Neue Buchung'), onClick: () => crud.buchungen.openCreate({}) },
              }}
            />
            <WorkList
              title={tx('Offene Rechnungen')}
              items={rechnungenItems}
              onItemClick={id => {
                const r = rechnungen.find(x => x.record_id === id);
                if (r) crud.rechnungen.openDetail(r);
              }}
              empty={{
                text: tx('Keine offenen Rechnungen'),
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
