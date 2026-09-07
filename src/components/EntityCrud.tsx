/**
 * EntityCrud — pre-generated CRUD + overlay plumbing for the dashboard.
 * Compose it; NEVER re-roll dialog state, submit handlers, an overlay stack
 * or a RecordOverlayHost in the page — this file owns all of it.
 *
 * API at a glance:
 *   const data = useDashboardData();
 *   const crud = useEntityCrud(data, {
 *     // optional — the ONE semantic slot on the overlay: the record's next
 *     // workflow step. Return undefined for types without one.
 *     footer: (top) => top.type === 'gaeste'
 *       ? { label: …, onClick: () => … }
 *       : undefined,
 *   });
 *
 *   `top.type` is the SAME camelCase key as `crud.<entity>` — one spelling
 *   per entity, everywhere in this API.
 *   …
 *   crud.gaeste.openCreate({ …defaults })   // create dialog, prefilled — defaults are
 *                                       // shape-tolerant: bare lookup keys / record ids are fine
 *   crud.gaeste.openEdit(record)            // edit dialog (recordId + defaults wired)
 *   crud.gaeste.openDetail(record)          // record overlay — pass the RAW record,
 *                                       // enrichment is resolved inside
 *   crud.overlay                         // RecordOverlayStack<OverlayItem> for drills:
 *                                       // push / pop / replace / close
 *   crud.enriched.gaeste              // the display-ready array for EVERY entity —
 *                                       // Enriched* where relations exist, the raw array
 *                                       // otherwise. Reuse these; never call enrich*()
 *                                       // in the page, and never guess which entity has
 *                                       // one: they all do.
 *   {crud.surfaces}                      // render ONCE at the end of the page JSX:
 *                                       // all entity dialogs + the overlay host
 *
 * Built in (do NOT re-implement): optimistic update + Rückgängig counter-write
 * on edit, fetchAll-on-error, edit-from-overlay, and per-entity overlay bodies
 * (RecordHeader + <{Entity}Details> with every relation reachable and the
 * contextual "+" prefilled). Drag writes (onEventDrop/onCardMove) stay YOURS:
 * optimistic setter first, PATCH in background, undoToast with counter-write.
 *
 * Overlay content per entity (the host renders these — you never compose
 * Details blocks yourself):
 *   gaeste: vorname, nachname, email, telefon, website, plz, ort, newsletter, …  ·  ← buchungen (list + contextual +) · ← buchungen (list + contextual +)
 *   zimmer: bezeichnung, kategorie, preis_pro_nacht, etage, balkon, foto  ·  ← buchungen (list + contextual +)
 *   zusatzleistungen: name, preis, aktiv  ·  ← buchungen (list + contextual +)
 *   buchungen: gast, zimmer, anreise, abreise, status, personen, begleitperson, zusatzleistungen_buchung, …  ·  → gaeste · → zimmer · → zusatzleistungen · ← rechnungen (list + contextual +)
 *   rechnungen: buchung, betrag, rechnungsdatum, faellig_am, zahlungsstatus, zahlungseingang  ·  → buchungen
 */
import { useState, useMemo, type ReactNode } from 'react';
import type { Gaeste, Zimmer, Zusatzleistungen, Buchungen, Rechnungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { LivingAppsService, createRecordUrl } from '@/services/livingAppsService';
import { enrichBuchungen, enrichRechnungen } from '@/lib/enrich';
import type { EnrichedBuchungen, EnrichedRechnungen } from '@/types/enriched';
import { useDashboardData } from '@/hooks/useDashboardData';
import {
  useRecordOverlayStack, RecordOverlayHost, RecordHeader,
  type RecordOverlayStack,
} from '@/components/widgets/RecordView';
import { GaesteDialog, type GaesteDialogDefaults } from '@/components/dialogs/GaesteDialog';
import { GaesteDetails } from '@/components/details/GaesteDetails';
import { ZimmerDialog, type ZimmerDialogDefaults } from '@/components/dialogs/ZimmerDialog';
import { ZimmerDetails } from '@/components/details/ZimmerDetails';
import { ZusatzleistungenDialog, type ZusatzleistungenDialogDefaults } from '@/components/dialogs/ZusatzleistungenDialog';
import { ZusatzleistungenDetails } from '@/components/details/ZusatzleistungenDetails';
import { BuchungenDialog, type BuchungenDialogDefaults } from '@/components/dialogs/BuchungenDialog';
import { BuchungenDetails } from '@/components/details/BuchungenDetails';
import { RechnungenDialog, type RechnungenDialogDefaults } from '@/components/dialogs/RechnungenDialog';
import { RechnungenDetails } from '@/components/details/RechnungenDetails';
import { AI_PHOTO_SCAN, AI_PHOTO_LOCATION } from '@/config/ai-features';
import { t, appLabel } from '@/i18n';
import { undoToast } from '@/lib/polish';
import { formatDate } from '@/lib/formatters';

// The overlay union — one branch per entity, `record` typed the way the data
// flows: Enriched* where enrichment exists, the raw record type otherwise.
// The host resolves enrichment itself; pages pass raw records everywhere.
export type OverlayItem =
  | { type: 'gaeste'; record: Gaeste }
  | { type: 'zimmer'; record: Zimmer }
  | { type: 'zusatzleistungen'; record: Zusatzleistungen }
  | { type: 'buchungen'; record: EnrichedBuchungen }
  | { type: 'rechnungen'; record: EnrichedRechnungen };

/** The useDashboardData() return — pass it in, never re-fetch inside. */
export type EntityCrudData = ReturnType<typeof useDashboardData>;

export interface EntityCrudOptions {
  /** Per-type overlay footer — the record's next workflow step. */
  footer?: (top: OverlayItem) => ReactNode | { label: ReactNode; onClick: () => void } | undefined;
  placement?: 'side' | 'center';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface EntityCrudApi<TRecord, TDefaults> {
  /** Open the create dialog, optionally prefilled (shape-tolerant defaults). */
  openCreate: (defaults?: TDefaults) => void;
  /** Open the edit dialog for a record (recordId + defaults are wired). */
  openEdit: (record: TRecord) => void;
  /** Open the record overlay (raw record is fine — enrichment resolved inside). */
  openDetail: (record: TRecord) => void;
}

export interface EntityCrud {
  /** The overlay stack for drills: push / pop / replace / close. */
  overlay: RecordOverlayStack<OverlayItem>;
  /** Render ONCE at the end of the page JSX — all dialogs + the overlay host. */
  surfaces: ReactNode;
  gaeste: EntityCrudApi<Gaeste, GaesteDialogDefaults>;
  zimmer: EntityCrudApi<Zimmer, ZimmerDialogDefaults>;
  zusatzleistungen: EntityCrudApi<Zusatzleistungen, ZusatzleistungenDialogDefaults>;
  buchungen: EntityCrudApi<Buchungen, BuchungenDialogDefaults>;
  rechnungen: EntityCrudApi<Rechnungen, RechnungenDialogDefaults>;
  /** The display-ready array per entity: Enriched* where an enrich function
   *  exists, the raw array otherwise. One key per entity so no page has to
   *  know which is which. Reuse these; never re-enrich in the page. */
  enriched: { gaeste: Gaeste[]; zimmer: Zimmer[]; zusatzleistungen: Zusatzleistungen[]; buchungen: EnrichedBuchungen[]; rechnungen: EnrichedRechnungen[] };
}

export function useEntityCrud(data: EntityCrudData, options?: EntityCrudOptions): EntityCrud {
  const overlay = useRecordOverlayStack<OverlayItem>();
  const [gaesteDialog, setGaesteDialog] = useState<{ defaults?: GaesteDialogDefaults; editing?: Gaeste } | null>(null);
  const [zimmerDialog, setZimmerDialog] = useState<{ defaults?: ZimmerDialogDefaults; editing?: Zimmer } | null>(null);
  const [zusatzleistungenDialog, setZusatzleistungenDialog] = useState<{ defaults?: ZusatzleistungenDialogDefaults; editing?: Zusatzleistungen } | null>(null);
  const [buchungenDialog, setBuchungenDialog] = useState<{ defaults?: BuchungenDialogDefaults; editing?: Buchungen } | null>(null);
  const [rechnungenDialog, setRechnungenDialog] = useState<{ defaults?: RechnungenDialogDefaults; editing?: Rechnungen } | null>(null);
  const enrichedBuchungen = useMemo(() => enrichBuchungen(data.buchungen, { gaesteMap: data.gaesteMap, zimmerMap: data.zimmerMap, zusatzleistungenMap: data.zusatzleistungenMap }), [data.buchungen, data.gaesteMap, data.zimmerMap, data.zusatzleistungenMap]);
  const enrichedRechnungen = useMemo(() => enrichRechnungen(data.rechnungen, { buchungenMap: data.buchungenMap }), [data.rechnungen, data.buchungenMap]);

  function detailGaeste(record: Gaeste, push = false) {
    const item: OverlayItem = { type: 'gaeste', record };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitGaeste(fields: Gaeste['fields']) {
    const editing = gaesteDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setGaeste(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateGaesteEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('gaeste')} — ${t('crud_updated')}`, async () => {
        data.setGaeste(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateGaesteEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createGaesteEntry(fields);
      undoToast(`${appLabel('gaeste')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  function detailZimmer(record: Zimmer, push = false) {
    const item: OverlayItem = { type: 'zimmer', record };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitZimmer(fields: Zimmer['fields']) {
    const editing = zimmerDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setZimmer(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateZimmerEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('zimmer')} — ${t('crud_updated')}`, async () => {
        data.setZimmer(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateZimmerEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createZimmerEntry(fields);
      undoToast(`${appLabel('zimmer')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  function detailZusatzleistungen(record: Zusatzleistungen, push = false) {
    const item: OverlayItem = { type: 'zusatzleistungen', record };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitZusatzleistungen(fields: Zusatzleistungen['fields']) {
    const editing = zusatzleistungenDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setZusatzleistungen(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateZusatzleistungenEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('zusatzleistungen')} — ${t('crud_updated')}`, async () => {
        data.setZusatzleistungen(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateZusatzleistungenEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createZusatzleistungenEntry(fields);
      undoToast(`${appLabel('zusatzleistungen')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  function detailBuchungen(record: Buchungen, push = false) {
    const rec = enrichedBuchungen.find(r => r.record_id === record.record_id);
    if (!rec) return;
    const item: OverlayItem = { type: 'buchungen', record: rec };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitBuchungen(fields: Buchungen['fields']) {
    const editing = buchungenDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setBuchungen(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateBuchungenEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('buchungen')} — ${t('crud_updated')}`, async () => {
        data.setBuchungen(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateBuchungenEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createBuchungenEntry(fields);
      undoToast(`${appLabel('buchungen')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  function detailRechnungen(record: Rechnungen, push = false) {
    const rec = enrichedRechnungen.find(r => r.record_id === record.record_id);
    if (!rec) return;
    const item: OverlayItem = { type: 'rechnungen', record: rec };
    if (push) overlay.push(item); else overlay.replace(item);
  }

  async function submitRechnungen(fields: Rechnungen['fields']) {
    const editing = rechnungenDialog?.editing;
    if (editing) {
      const prev = editing;
      data.setRechnungen(list => list.map(r => (r.record_id === editing.record_id ? { ...r, fields } : r)));
      try {
        await LivingAppsService.updateRechnungenEntry(editing.record_id, fields);
      } catch (err) {
        data.fetchAll();
        throw err;
      }
      undoToast(`${appLabel('rechnungen')} — ${t('crud_updated')}`, async () => {
        data.setRechnungen(list => list.map(r => (r.record_id === prev.record_id ? prev : r)));
        try { await LivingAppsService.updateRechnungenEntry(prev.record_id, prev.fields); } catch { data.fetchAll(); }
      });
    } else {
      await LivingAppsService.createRechnungenEntry(fields);
      undoToast(`${appLabel('rechnungen')} — ${t('crud_created')}`);
      data.fetchAll();
    }
  }

  const surfaces = (
    <>
      <GaesteDialog
        open={gaesteDialog !== null}
        onClose={() => setGaesteDialog(null)}
        onSubmit={submitGaeste}
        defaultValues={gaesteDialog?.defaults}
        recordId={gaesteDialog?.editing?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Gaeste']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Gaeste']}
      />
      <ZimmerDialog
        open={zimmerDialog !== null}
        onClose={() => setZimmerDialog(null)}
        onSubmit={submitZimmer}
        defaultValues={zimmerDialog?.defaults}
        recordId={zimmerDialog?.editing?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Zimmer']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Zimmer']}
      />
      <ZusatzleistungenDialog
        open={zusatzleistungenDialog !== null}
        onClose={() => setZusatzleistungenDialog(null)}
        onSubmit={submitZusatzleistungen}
        defaultValues={zusatzleistungenDialog?.defaults}
        recordId={zusatzleistungenDialog?.editing?.record_id}
        enablePhotoScan={AI_PHOTO_SCAN['Zusatzleistungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Zusatzleistungen']}
      />
      <BuchungenDialog
        open={buchungenDialog !== null}
        onClose={() => setBuchungenDialog(null)}
        onSubmit={submitBuchungen}
        defaultValues={buchungenDialog?.defaults}
        recordId={buchungenDialog?.editing?.record_id}
        gaesteList={data.gaeste}
        zimmerList={data.zimmer}
        zusatzleistungenList={data.zusatzleistungen}
        enablePhotoScan={AI_PHOTO_SCAN['Buchungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Buchungen']}
      />
      <RechnungenDialog
        open={rechnungenDialog !== null}
        onClose={() => setRechnungenDialog(null)}
        onSubmit={submitRechnungen}
        defaultValues={rechnungenDialog?.defaults}
        recordId={rechnungenDialog?.editing?.record_id}
        buchungenList={data.buchungen}
        enablePhotoScan={AI_PHOTO_SCAN['Rechnungen']}
        enablePhotoLocation={AI_PHOTO_LOCATION['Rechnungen']}
      />
      <RecordOverlayHost
        overlay={overlay}
        placement={options?.placement}
        size={options?.size}
        footer={options?.footer}
        render={(top) => {
          if (top.type === 'gaeste') {
            return (
              <>
                <RecordHeader title={top.record.fields.vorname ?? appLabel('gaeste')} subtitle={undefined} />
                <GaesteDetails
                  record={top.record}
                  buchungenGastList={data.buchungen}
                  onOpenBuchungenGast={(r) => detailBuchungen(r, true)}
                  onAddBuchungenGast={() => setBuchungenDialog({ defaults: { gast: createRecordUrl(APP_IDS.GAESTE, top.record.record_id) } })}
                  buchungenBegleitpersonList={data.buchungen}
                  onOpenBuchungenBegleitperson={(r) => detailBuchungen(r, true)}
                  onAddBuchungenBegleitperson={() => setBuchungenDialog({ defaults: { begleitperson: createRecordUrl(APP_IDS.GAESTE, top.record.record_id) } })}
                />
              </>
            );
          }
          if (top.type === 'zimmer') {
            return (
              <>
                <RecordHeader title={top.record.fields.bezeichnung ?? appLabel('zimmer')} subtitle={undefined} />
                <ZimmerDetails
                  record={top.record}
                  buchungenList={data.buchungen}
                  onOpenBuchungen={(r) => detailBuchungen(r, true)}
                  onAddBuchungen={() => setBuchungenDialog({ defaults: { zimmer: createRecordUrl(APP_IDS.ZIMMER, top.record.record_id) } })}
                />
              </>
            );
          }
          if (top.type === 'zusatzleistungen') {
            return (
              <>
                <RecordHeader title={top.record.fields.name ?? appLabel('zusatzleistungen')} subtitle={undefined} />
                <ZusatzleistungenDetails
                  record={top.record}
                  buchungenList={data.buchungen}
                  onOpenBuchungen={(r) => detailBuchungen(r, true)}
                  onAddBuchungen={() => setBuchungenDialog({ defaults: { zusatzleistungen_buchung: [createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, top.record.record_id)] } })}
                />
              </>
            );
          }
          if (top.type === 'buchungen') {
            return (
              <>
                <RecordHeader title={appLabel('buchungen')} subtitle={top.record.fields.anreise ? formatDate(top.record.fields.anreise) : undefined} />
                <BuchungenDetails
                  record={top.record}
                  gaesteList={data.gaeste}
                  onOpenGaeste={(r) => detailGaeste(r, true)}
                  zimmerList={data.zimmer}
                  onOpenZimmer={(r) => detailZimmer(r, true)}
                  zusatzleistungenList={data.zusatzleistungen}
                  rechnungenList={data.rechnungen}
                  onOpenRechnungen={(r) => detailRechnungen(r, true)}
                  onAddRechnungen={() => setRechnungenDialog({ defaults: { buchung: createRecordUrl(APP_IDS.BUCHUNGEN, top.record.record_id) } })}
                />
              </>
            );
          }
          if (top.type === 'rechnungen') {
            return (
              <>
                <RecordHeader title={appLabel('rechnungen')} subtitle={top.record.fields.rechnungsdatum ? formatDate(top.record.fields.rechnungsdatum) : undefined} />
                <RechnungenDetails
                  record={top.record}
                  buchungenList={data.buchungen}
                  onOpenBuchungen={(r) => detailBuchungen(r, true)}
                />
              </>
            );
          }
          return null;
        }}
        onEdit={(top) => {
          overlay.close();
          if (top.type === 'gaeste') setGaesteDialog({ editing: top.record, defaults: top.record.fields });
          if (top.type === 'zimmer') setZimmerDialog({ editing: top.record, defaults: top.record.fields });
          if (top.type === 'zusatzleistungen') setZusatzleistungenDialog({ editing: top.record, defaults: top.record.fields });
          if (top.type === 'buchungen') setBuchungenDialog({ editing: top.record, defaults: top.record.fields });
          if (top.type === 'rechnungen') setRechnungenDialog({ editing: top.record, defaults: top.record.fields });
        }}
      />
    </>
  );

  return {
    overlay,
    surfaces,
    gaeste: {
      openCreate: (defaults?: GaesteDialogDefaults) => setGaesteDialog({ defaults }),
      openEdit: (record: Gaeste) => setGaesteDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Gaeste) => detailGaeste(record, false),
    },
    zimmer: {
      openCreate: (defaults?: ZimmerDialogDefaults) => setZimmerDialog({ defaults }),
      openEdit: (record: Zimmer) => setZimmerDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Zimmer) => detailZimmer(record, false),
    },
    zusatzleistungen: {
      openCreate: (defaults?: ZusatzleistungenDialogDefaults) => setZusatzleistungenDialog({ defaults }),
      openEdit: (record: Zusatzleistungen) => setZusatzleistungenDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Zusatzleistungen) => detailZusatzleistungen(record, false),
    },
    buchungen: {
      openCreate: (defaults?: BuchungenDialogDefaults) => setBuchungenDialog({ defaults }),
      openEdit: (record: Buchungen) => setBuchungenDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Buchungen) => detailBuchungen(record, false),
    },
    rechnungen: {
      openCreate: (defaults?: RechnungenDialogDefaults) => setRechnungenDialog({ defaults }),
      openEdit: (record: Rechnungen) => setRechnungenDialog({ editing: record, defaults: record.fields }),
      openDetail: (record: Rechnungen) => detailRechnungen(record, false),
    },
    enriched: { gaeste: data.gaeste, zimmer: data.zimmer, zusatzleistungen: data.zusatzleistungen, buchungen: enrichedBuchungen, rechnungen: enrichedRechnungen },
  };
}
