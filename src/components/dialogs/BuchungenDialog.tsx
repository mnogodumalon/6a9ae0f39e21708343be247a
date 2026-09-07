/**
 * BuchungenDialog — pre-generated create/edit dialog for Buchungen.
 *
 * Props: open, onClose, onSubmit(fields) => Promise<void>, defaultValues?,
 * recordId? (pass when EDITING — enables the attachments section),
 * gaesteList (full hook array — resolves the Gaeste applookup),
 * zimmerList (full hook array — resolves the Zimmer applookup),
 * zusatzleistungenList (full hook array — resolves the Zusatzleistungen applookup),
 * enablePhotoScan?, enablePhotoLocation?.
 *
 * defaultValues is SHAPE-TOLERANT and its prop type is the EXPORTED
 * BuchungenDialogDefaults — NOT the entity field type: lookup fields accept
 * the bare KEY string (or LookupValue), applookup fields the bare record id
 * (or record URL); the dialog normalizes. Type prefill STATE with the export:
 *  ❌ useState<Partial<Buchungen['fields']>>({ … })   // LookupValue fields reject string prefills (TS2322)
 *  ✓ useState<BuchungenDialogDefaults | undefined>(undefined)
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { Buchungen, Gaeste, Zimmer, Zusatzleistungen, LookupValue } from '@/types/app';
import { APP_IDS, LOOKUP_OPTIONS } from '@/types/app';
import { extractRecordId, createRecordUrl, cleanFieldsForApi, extractRecordIds, uploadFile, getUserProfile, LivingAppsService } from '@/services/livingAppsService';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ComputedContext } from '@/config/form-enhancements/types';
import { applyFieldOrder, flattenFieldOrder, applyDefaults, evalComputed, numberInputProps, clampNumberValue, classifyComputed, extractApplookupRefs, mergeApplookupRefs, resolveApplookupRef } from '@/config/form-enhancements/types';
import { formEnhancements, computedDeps, computedApplookupRefs } from '@/config/form-enhancements/Buchungen';
import { AttachmentsSection } from '@/components/AttachmentsSection';
import { requiredMessage } from '@/lib/journey/messages';
import { t, appLabel, fieldLabel, lookupLabel, localeTag, CURRENCY } from '@/i18n';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, MultiCombobox } from '@/components/Combobox';
import { GaesteDialog } from '@/components/dialogs/GaesteDialog';
import { ZimmerDialog } from '@/components/dialogs/ZimmerDialog';
import { ZusatzleistungenDialog } from '@/components/dialogs/ZusatzleistungenDialog';
import { DatePicker } from '@/components/DatePicker';
import { Checkbox } from '@/components/ui/checkbox';
import { IconAlertCircle, IconCamera, IconChevronDown, IconCircleCheck, IconClipboard, IconFileText, IconLoader2, IconPhotoPlus, IconSparkles, IconUpload, IconX } from '@tabler/icons-react';
import { fileToDataUri, extractFromInput, extractPhotoMeta, reverseGeocode, dataUriToBlob } from '@/lib/ai';
import { lookupKey } from '@/lib/formatters';

/** Widened prefill type for BuchungenDialog.defaultValues — see file header. */
export type BuchungenDialogDefaults = Omit<Buchungen['fields'], 'status'> & {
    status?: LookupValue | string;
  };

interface BuchungenDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (fields: Buchungen['fields']) => Promise<void>;
  /** SHAPE-TOLERANT: lookup fields accept the bare key (string) or the
   *  LookupValue object; applookup fields the bare record id or the full
   *  record URL — the dialog normalizes both. */
  defaultValues?: BuchungenDialogDefaults;
  /** Record id when editing — enables the attachments section. Omit on create. */
  recordId?: string;
  gaesteList: Gaeste[];
  zimmerList: Zimmer[];
  zusatzleistungenList: Zusatzleistungen[];
  enablePhotoScan?: boolean;
  enablePhotoLocation?: boolean;
}

// defaultValues are SHAPE-TOLERANT: the dialog resolves bare lookup keys via
// its own options and bare record ids via the field's target app — consumers
// never carry the LookupValue/record-URL shape in their head.
const NORMALIZE_LOOKUPS: Record<string, readonly { key: string; label: string }[]> = {
  status: LOOKUP_OPTIONS['buchungen']?.['status'] ?? [],
};
const NORMALIZE_APPLOOKUPS: Record<string, string> = {
  gast: APP_IDS.GAESTE,
  zimmer: APP_IDS.ZIMMER,
  begleitperson: APP_IDS.GAESTE,
  zusatzleistungen_buchung: APP_IDS.ZUSATZLEISTUNGEN,
};
function normalizeDefaults(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const [k, opts] of Object.entries(NORMALIZE_LOOKUPS)) {
    const v = out[k];
    if (typeof v === 'string') out[k] = opts.find(o => o.key === v) ?? { key: v, label: v };
    else if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'string' ? opts.find(o => o.key === x) ?? { key: x, label: x } : x));
  }
  for (const [k, appId] of Object.entries(NORMALIZE_APPLOOKUPS)) {
    const v = out[k];
    if (typeof v === 'string' && v !== '' && !v.startsWith('http')) out[k] = createRecordUrl(appId, v);
    else if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'string' && x !== '' && !x.startsWith('http') ? createRecordUrl(appId, x) : x));
  }
  return out;
}

export function BuchungenDialog({ open, onClose, onSubmit, defaultValues, recordId, gaesteList, zimmerList, zusatzleistungenList, enablePhotoScan = true, enablePhotoLocation = true }: BuchungenDialogProps) {
  const [fields, setFields] = useState<Partial<Buchungen['fields']>>({});
  const [saving, setSaving] = useState(false);
  const normalizedDefaults = useMemo<Record<string, unknown> | undefined>(
    () => (defaultValues ? normalizeDefaults(defaultValues as Record<string, unknown>) : undefined),
    [defaultValues],
  );
  // Dirty-tracking: in edit-mode the Speichern button is disabled until the
  // user actually changes something. JSON.stringify is good enough for our
  // fields (plain values + LookupValue objects + string arrays).
  const isDirty = useMemo(() => {
    if (!normalizedDefaults) return true;  // create-mode: always allow submit
    try {
      return JSON.stringify(fields) !== JSON.stringify(normalizedDefaults);
    } catch {
      return true;
    }
  }, [fields, normalizedDefaults]);
  // Inline-Create state for "Gaeste" target. The dropdown's
  // "+ Neuer …" option opens a sub-dialog; on submit we POST, add the new
  // record to the local `extraGaeste` list, and select it in
  // the originating Combobox via the captured `createGaesteField`.
  const [createGaesteOpen, setCreateGaesteOpen] = useState(false);
  const [createGaesteInitial, setCreateGaesteInitial] = useState('');
  const [createGaesteField, setCreateGaesteField] = useState<string>('');
  const [extraGaeste, setExtraGaeste] = useState< Gaeste[]>([]);
  const gaesteListAll = useMemo(
    () => [...gaesteList, ...extraGaeste],
    [gaesteList, extraGaeste],
  );
  function openCreateGaeste(fieldKey: string, q: string) {
    setCreateGaesteField(fieldKey);
    setCreateGaesteInitial(q);
    setCreateGaesteOpen(true);
  }
  // Inline-Create state for "Zimmer" target. The dropdown's
  // "+ Neuer …" option opens a sub-dialog; on submit we POST, add the new
  // record to the local `extraZimmer` list, and select it in
  // the originating Combobox via the captured `createZimmerField`.
  const [createZimmerOpen, setCreateZimmerOpen] = useState(false);
  const [createZimmerInitial, setCreateZimmerInitial] = useState('');
  const [createZimmerField, setCreateZimmerField] = useState<string>('');
  const [extraZimmer, setExtraZimmer] = useState< Zimmer[]>([]);
  const zimmerListAll = useMemo(
    () => [...zimmerList, ...extraZimmer],
    [zimmerList, extraZimmer],
  );
  function openCreateZimmer(fieldKey: string, q: string) {
    setCreateZimmerField(fieldKey);
    setCreateZimmerInitial(q);
    setCreateZimmerOpen(true);
  }
  // Inline-Create state for "Zusatzleistungen" target. The dropdown's
  // "+ Neuer …" option opens a sub-dialog; on submit we POST, add the new
  // record to the local `extraZusatzleistungen` list, and select it in
  // the originating Combobox via the captured `createZusatzleistungenField`.
  const [createZusatzleistungenOpen, setCreateZusatzleistungenOpen] = useState(false);
  const [createZusatzleistungenInitial, setCreateZusatzleistungenInitial] = useState('');
  const [createZusatzleistungenField, setCreateZusatzleistungenField] = useState<string>('');
  const [extraZusatzleistungen, setExtraZusatzleistungen] = useState< Zusatzleistungen[]>([]);
  const zusatzleistungenListAll = useMemo(
    () => [...zusatzleistungenList, ...extraZusatzleistungen],
    [zusatzleistungenList, extraZusatzleistungen],
  );
  function openCreateZusatzleistungen(fieldKey: string, q: string) {
    setCreateZusatzleistungenField(fieldKey);
    setCreateZusatzleistungenInitial(q);
    setCreateZusatzleistungenOpen(true);
  }
  const [showErrors, setShowErrors] = useState(false);
  const REQUIRED_FIELDS = ['gast', 'zimmer', 'anreise', 'abreise', 'status'] as const;
  const missingRequired = REQUIRED_FIELDS.filter(k => {
    const v = (fields as Record<string, unknown>)[k];
    return v == null || v === '' || (Array.isArray(v) && v.length === 0);
  });
  const [aiOpen, setAiOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [usePersonalInfo, setUsePersonalInfo] = useState(() => {
    try { return localStorage.getItem('ai-use-personal-info') === 'true'; } catch { return false; }
  });
  const [showProfileInfo, setShowProfileInfo] = useState(false);
  const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [aiText, setAiText] = useState('');

  // Computed-field plumbing. Pure no-op when formEnhancements.computed is {}.
  // The number renderer uses computedValues only as a fallback when the user
  // hasn't typed anything — clearing the input always restores the computation.
  // computedContext exposes applookup list props so { kind: 'applookup', ... }
  // operands can resolve to numeric fields on the target record.
  const computedContext = useMemo<ComputedContext>(() => ({
    lookupLists: {
      'gast': gaesteList,
      'zimmer': zimmerList,
      'begleitperson': gaesteList,
      'zusatzleistungen_buchung': zusatzleistungenList,
    },
  }), [gaesteList, zimmerList, gaesteList, zusatzleistungenList, ]);
  const computedValues = useMemo<Record<string, number | null>>(() => {
    let out: Record<string, number | null> = {};
    const entries = Object.entries(formEnhancements.computed);
    for (let i = 0; i < 5; i++) {
      const merged: Record<string, unknown> = { ...(fields as Record<string, unknown>) };
      for (const [k, v] of Object.entries(out)) {
        if (v === null) continue;
        const cur = merged[k];
        if (cur === undefined || cur === null || cur === '') merged[k] = v;
      }
      const next: Record<string, number | null> = {};
      let changed = false;
      for (const [key, spec] of entries) {
        const v = evalComputed(spec, merged, computedContext);
        next[key] = v;
        if (v !== out[key]) changed = true;
      }
      out = next;
      if (!changed) break;
    }
    return out;
  }, [fields, computedContext]);

  useEffect(() => {
    if (open) {
      setFields(applyDefaults(normalizedDefaults ?? {}, formEnhancements.defaults) as Partial<Buchungen['fields']>);
      setPreview(null);
      setScanSuccess(false);
      setAiText('');
      setSubmitError(null);
    }
  }, [open, normalizedDefaults]);
  useEffect(() => {
    try { localStorage.setItem('ai-use-personal-info', String(usePersonalInfo)); } catch {}
  }, [usePersonalInfo]);
  async function handleShowProfileInfo() {
    if (showProfileInfo) { setShowProfileInfo(false); return; }
    setProfileLoading(true);
    try {
      const p = await getUserProfile();
      setProfileData(p);
    } catch {
      setProfileData(null);
    } finally {
      setProfileLoading(false);
      setShowProfileInfo(true);
    }
  }

  // Submit errors surface IN the dialog (it is modal — a banner in the page
  // body would be hidden behind it). A consumer onSubmit that THROWS (the
  // documented "throw to prevent closing" validation pattern) lands here:
  // the dialog stays open, nothing is saved, the message is visible.
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (missingRequired.length > 0) {
      setShowErrors(true);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      // Fill empty number slots from computed values; user-typed values always win.
      // CRITICAL: only backend-mapped keys may be backfilled. Virtual computeds
      // (sub-agent invents `_netto`, `_bestellung_gesamtbetrag` etc. for the
      // "Berechnungen" display) have no backend counterpart — writing them
      // triggers a 422 from the Living-Apps API ("field does not exist").
      const merged = { ...fields };
      for (const [key, val] of Object.entries(computedValues)) {
        if (val === null) continue;
        if (!backendFieldSet.has(key)) continue;
        const cur = (merged as Record<string, unknown>)[key];
        if (cur === undefined || cur === null || cur === '') {
          (merged as Record<string, unknown>)[key] = val;
        }
      }
      const clean = cleanFieldsForApi(merged, 'buchungen');
      await onSubmit(clean as Buchungen['fields']);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error && err.message ? err.message : t('submit_error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleAiExtract(file?: File) {
    if (!file && !aiText.trim()) return;
    setScanning(true);
    setScanSuccess(false);
    try {
      let uri: string | undefined;
      let gps: { latitude: number; longitude: number } | null = null;
      let geoAddr = '';
      const parts: string[] = [];
      if (file) {
        const [dataUri, meta] = await Promise.all([fileToDataUri(file), extractPhotoMeta(file)]);
        uri = dataUri;
        if (file.type.startsWith('image/')) setPreview(uri);
        gps = enablePhotoLocation ? meta?.gps ?? null : null;
        if (gps) {
          geoAddr = await reverseGeocode(gps.latitude, gps.longitude);
          parts.push(`Location coordinates: ${gps.latitude}, ${gps.longitude}`);
          if (geoAddr) parts.push(`Reverse-geocoded address: ${geoAddr}`);
        }
        if (meta?.dateTime) {
          parts.push(`Date taken: ${meta.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')}`);
        }
      }
      const contextParts: string[] = [];
      if (parts.length) {
        contextParts.push(`<photo-metadata>\nThe following metadata was extracted from the photo\'s EXIF data:\n${parts.join('\n')}\n</photo-metadata>`);
      }
      contextParts.push(`<available-records field="gast" entity="Gäste">\n${JSON.stringify(gaesteList.map(r => ({ record_id: r.record_id, ...r.fields })), null, 2)}\n</available-records>`);
      contextParts.push(`<available-records field="zimmer" entity="Zimmer">\n${JSON.stringify(zimmerList.map(r => ({ record_id: r.record_id, ...r.fields })), null, 2)}\n</available-records>`);
      contextParts.push(`<available-records field="begleitperson" entity="Gäste">\n${JSON.stringify(gaesteList.map(r => ({ record_id: r.record_id, ...r.fields })), null, 2)}\n</available-records>`);
      contextParts.push(`<available-records field="zusatzleistungen_buchung" entity="Zusatzleistungen">\n${JSON.stringify(zusatzleistungenList.map(r => ({ record_id: r.record_id, ...r.fields })), null, 2)}\n</available-records>`);
      if (usePersonalInfo) {
        try {
          const profile = await getUserProfile();
          contextParts.push(`<user-profile>\nThe following is the logged-in user\'s personal information. Use this to pre-fill relevant fields like name, email, address, company etc. when appropriate:\n${JSON.stringify(profile, null, 2)}\n</user-profile>`);
        } catch (err) {
          console.warn('Failed to fetch user profile:', err);
        }
      }
      const photoContext = contextParts.length ? contextParts.join('\n') : undefined;
      const schema = `{\n  "gast": string | null, // Display name from Gäste (see <available-records>)\n  "zimmer": string | null, // Display name from Zimmer (see <available-records>)\n  "anreise": string | null, // YYYY-MM-DD\n  "abreise": string | null, // YYYY-MM-DD\n  "status": LookupValue | null, // Status (select one key: "storniert" | "bestaetigt" | "angefragt" | "eingecheckt" | "ausgecheckt") mapping: storniert=Storniert, bestaetigt=Bestätigt, angefragt=Angefragt, eingecheckt=Eingecheckt, ausgecheckt=Ausgecheckt\n  "personen": number | null, // Personen\n  "begleitperson": string | null, // Display name from Gäste (see <available-records>)\n  "zusatzleistungen_buchung": string[] | null, // Display names from Zusatzleistungen, one per referenced record (see <available-records>)\n  "bemerkung": string | null, // Bemerkung\n}`;
      const raw = await extractFromInput<Record<string, unknown>>(schema, {
        dataUri: uri,
        userText: aiText.trim() || undefined,
        photoContext,
        intent: DIALOG_INTENT,
      });
      setFields(prev => {
        const merged = { ...prev } as Record<string, unknown>;
        function matchName(name: string, candidates: string[]): boolean {
          const n = name.toLowerCase().trim();
          return candidates.some(c => c.toLowerCase().includes(n) || n.includes(c.toLowerCase()));
        }
        const applookupKeys = new Set<string>(["gast", "zimmer", "begleitperson", "zusatzleistungen_buchung"]);
        for (const [k, v] of Object.entries(raw)) {
          if (applookupKeys.has(k)) continue;
          if (v != null) merged[k] = v;
        }
        const gastName = raw['gast'] as string | null;
        if (gastName) {
          const gastMatch = gaesteList.find(r => matchName(gastName!, [[r.fields.vorname ?? '', r.fields.nachname ?? ''].filter(Boolean).join(' ')]));
          if (gastMatch) merged['gast'] = createRecordUrl(APP_IDS.GAESTE, gastMatch.record_id);
        }
        const zimmerName = raw['zimmer'] as string | null;
        if (zimmerName) {
          const zimmerMatch = zimmerList.find(r => matchName(zimmerName!, [String(r.fields.bezeichnung ?? '')]));
          if (zimmerMatch) merged['zimmer'] = createRecordUrl(APP_IDS.ZIMMER, zimmerMatch.record_id);
        }
        const begleitpersonName = raw['begleitperson'] as string | null;
        if (begleitpersonName) {
          const begleitpersonMatch = gaesteList.find(r => matchName(begleitpersonName!, [[r.fields.vorname ?? '', r.fields.nachname ?? ''].filter(Boolean).join(' ')]));
          if (begleitpersonMatch) merged['begleitperson'] = createRecordUrl(APP_IDS.GAESTE, begleitpersonMatch.record_id);
        }
        const zusatzleistungen_buchungNames = raw['zusatzleistungen_buchung'];
        if (Array.isArray(zusatzleistungen_buchungNames) && zusatzleistungen_buchungNames.length > 0) {
          const zusatzleistungen_buchungUrls = (zusatzleistungen_buchungNames as unknown[])
            .map(n => zusatzleistungenList.find(r => matchName(String(n), [String(r.fields.name ?? '')])))
            .filter((r): r is NonNullable<typeof r> => Boolean(r))
            .map(r => createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, r.record_id));
          if (zusatzleistungen_buchungUrls.length > 0) merged['zusatzleistungen_buchung'] = zusatzleistungen_buchungUrls;
        }
        return merged as Partial<Buchungen['fields']>;
      });
      // Upload scanned file to file fields
      if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
        try {
          const blob = dataUriToBlob(uri!);
          const fileUrl = await uploadFile(blob, file.name);
          setFields(prev => ({ ...prev, beleg: fileUrl }));
        } catch (uploadErr) {
          console.error('File upload failed:', uploadErr);
        }
      }
      setAiText('');
      setScanSuccess(true);
      setTimeout(() => setScanSuccess(false), 3000);
    } catch (err) {
      console.error(`${t('scan_error')}:`, err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) handleAiExtract(f);
    e.target.value = '';
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      handleAiExtract(file);
    }
  }, []);

  const DIALOG_INTENT = defaultValues
    ? t('edit_entity', { entity: appLabel('buchungen') })
    : t('new_entity', { entity: appLabel('buchungen') });

  const fieldBlocks: Record<string, React.ReactNode> = {
    'gast': (
      <div key="gast" className="space-y-1.5">
        <Label htmlFor="gast">{fieldLabel('buchungen', 'gast')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <Combobox
          id="gast"
          placeholder="Welcher Gast bucht?"
          items={gaesteListAll.map(r => ({
            id: r.record_id,
            label: String(r.fields.vorname ?? r.record_id),
          }))}
          value={extractRecordId(fields.gast)}
          onChange={id => setFields(f => ({ ...f, gast: id ? createRecordUrl(APP_IDS.GAESTE, id) : undefined }))}
          onCreateNew={(q) => openCreateGaeste("gast", q)}
          createLabel={t('create_in', { entity: appLabel('gaeste') })}
        />
        {showErrors && !fields.gast && (
          <p className="text-xs text-destructive mt-1" role="alert">{requiredMessage('buchungen', 'gast')}</p>
        )}
      </div>
    ),
    'zimmer': (
      <div key="zimmer" className="space-y-1.5">
        <Label htmlFor="zimmer">{fieldLabel('buchungen', 'zimmer')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <Combobox
          id="zimmer"
          placeholder="Welches Zimmer?"
          items={zimmerListAll.map(r => ({
            id: r.record_id,
            label: String(r.fields.bezeichnung ?? r.record_id),
          }))}
          value={extractRecordId(fields.zimmer)}
          onChange={id => setFields(f => ({ ...f, zimmer: id ? createRecordUrl(APP_IDS.ZIMMER, id) : undefined }))}
          onCreateNew={(q) => openCreateZimmer("zimmer", q)}
          createLabel={t('create_in', { entity: appLabel('zimmer') })}
        />
        {showErrors && !fields.zimmer && (
          <p className="text-xs text-destructive mt-1" role="alert">{requiredMessage('buchungen', 'zimmer')}</p>
        )}
      </div>
    ),
    'anreise': (
      <div key="anreise" className="space-y-1.5">
        <Label htmlFor="anreise">{fieldLabel('buchungen', 'anreise')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <DatePicker
          id="anreise"
          placeholder="Wann kommt der Gast?"
          mode="date"
          value={fields.anreise ?? null}
          onChange={v => setFields(f => ({ ...f, anreise: v ?? undefined }))}
          required
        />
        {showErrors && !fields.anreise && (
          <p className="text-xs text-destructive mt-1" role="alert">{requiredMessage('buchungen', 'anreise')}</p>
        )}
      </div>
    ),
    'abreise': (
      <div key="abreise" className="space-y-1.5">
        <Label htmlFor="abreise">{fieldLabel('buchungen', 'abreise')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <DatePicker
          id="abreise"
          placeholder="Wann reist der Gast ab?"
          mode="date"
          value={fields.abreise ?? null}
          onChange={v => setFields(f => ({ ...f, abreise: v ?? undefined }))}
          required
        />
        {showErrors && !fields.abreise && (
          <p className="text-xs text-destructive mt-1" role="alert">{requiredMessage('buchungen', 'abreise')}</p>
        )}
      </div>
    ),
    'status': (
      <div key="status" className="space-y-1.5">
        <Label htmlFor="status">{fieldLabel('buchungen', 'status')} <span className="text-destructive" aria-hidden="true">*</span></Label>
        <div role="radiogroup" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            role="radio"
            aria-checked={lookupKey(fields.status) === 'storniert'}
            onClick={() => setFields(f => ({ ...f, status: (lookupKey(f.status) === 'storniert' ? undefined : 'storniert') as any }))}
            className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              lookupKey(fields.status) === 'storniert'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-input hover:bg-accent'
            }`}
          >
            {lookupLabel('buchungen', 'status', 'storniert') ?? 'Storniert'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lookupKey(fields.status) === 'bestaetigt'}
            onClick={() => setFields(f => ({ ...f, status: (lookupKey(f.status) === 'bestaetigt' ? undefined : 'bestaetigt') as any }))}
            className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              lookupKey(fields.status) === 'bestaetigt'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-input hover:bg-accent'
            }`}
          >
            {lookupLabel('buchungen', 'status', 'bestaetigt') ?? 'Bestätigt'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lookupKey(fields.status) === 'angefragt'}
            onClick={() => setFields(f => ({ ...f, status: (lookupKey(f.status) === 'angefragt' ? undefined : 'angefragt') as any }))}
            className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              lookupKey(fields.status) === 'angefragt'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-input hover:bg-accent'
            }`}
          >
            {lookupLabel('buchungen', 'status', 'angefragt') ?? 'Angefragt'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lookupKey(fields.status) === 'eingecheckt'}
            onClick={() => setFields(f => ({ ...f, status: (lookupKey(f.status) === 'eingecheckt' ? undefined : 'eingecheckt') as any }))}
            className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              lookupKey(fields.status) === 'eingecheckt'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-input hover:bg-accent'
            }`}
          >
            {lookupLabel('buchungen', 'status', 'eingecheckt') ?? 'Eingecheckt'}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={lookupKey(fields.status) === 'ausgecheckt'}
            onClick={() => setFields(f => ({ ...f, status: (lookupKey(f.status) === 'ausgecheckt' ? undefined : 'ausgecheckt') as any }))}
            className={`inline-flex items-center justify-center min-h-9 max-sm:min-h-11 max-sm:px-4 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              lookupKey(fields.status) === 'ausgecheckt'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-input hover:bg-accent'
            }`}
          >
            {lookupLabel('buchungen', 'status', 'ausgecheckt') ?? 'Ausgecheckt'}
          </button>
        </div>
        {showErrors && !fields.status && (
          <p className="text-xs text-destructive mt-1" role="alert">{requiredMessage('buchungen', 'status')}</p>
        )}
      </div>
    ),
    'personen': (
      <div key="personen" className="space-y-1.5">
        <Label htmlFor="personen">{fieldLabel('buchungen', 'personen')}</Label>
        <Input
          id="personen"
          type="number"
          inputMode="decimal"
          step="any"
          {...numberInputProps(formEnhancements, 'personen')}
          placeholder="z. B. 2"
          value={fields.personen !== undefined ? fields.personen : (computedValues['personen'] ?? '')}
          onChange={e => setFields(f => ({ ...f, personen: clampNumberValue(formEnhancements, 'personen', e.target.value) }))}
        />
      </div>
    ),
    'begleitperson': (
      <div key="begleitperson" className="space-y-1.5">
        <Label htmlFor="begleitperson">{fieldLabel('buchungen', 'begleitperson')}</Label>
        <Combobox
          id="begleitperson"
          placeholder="Begleitperson (optional)"
          items={gaesteListAll.map(r => ({
            id: r.record_id,
            label: String(r.fields.vorname ?? r.record_id),
          }))}
          value={extractRecordId(fields.begleitperson)}
          onChange={id => setFields(f => ({ ...f, begleitperson: id ? createRecordUrl(APP_IDS.GAESTE, id) : undefined }))}
          onCreateNew={(q) => openCreateGaeste("begleitperson", q)}
          createLabel={t('create_in', { entity: appLabel('gaeste') })}
        />
      </div>
    ),
    'zusatzleistungen_buchung': (
      <div key="zusatzleistungen_buchung" className="space-y-1.5">
        <Label htmlFor="zusatzleistungen_buchung">{fieldLabel('buchungen', 'zusatzleistungen_buchung')}</Label>
        <MultiCombobox
          id="zusatzleistungen_buchung"
          placeholder="Welche Leistungen buchen?"
          items={zusatzleistungenListAll.map(r => ({
            id: r.record_id,
            label: String(r.fields.name ?? r.record_id),
          }))}
          values={extractRecordIds(fields.zusatzleistungen_buchung)}
          onChange={ids => setFields(f => ({ ...f, zusatzleistungen_buchung: ids.length ? ids.map(id => createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, id)) as any : undefined }))}
          onCreateNew={(q) => openCreateZusatzleistungen("zusatzleistungen_buchung", q)}
          createLabel={t('create_in', { entity: appLabel('zusatzleistungen') })}
        />
      </div>
    ),
    'bemerkung': (
      <div key="bemerkung" className="space-y-1.5">
        <Label htmlFor="bemerkung">{fieldLabel('buchungen', 'bemerkung')}</Label>
        <Textarea
          id="bemerkung"
          placeholder="Spezielle Wünsche, Diäten, Anfahrtsinfo..."
          value={fields.bemerkung ?? ''}
          onChange={e => setFields(f => ({ ...f, bemerkung: e.target.value }))}
          rows={3}
        />
      </div>
    ),
    'beleg': (
      <div key="beleg" className="space-y-1.5">
        <Label htmlFor="beleg">{fieldLabel('buchungen', 'beleg')}</Label>
        {fields.beleg ? (
          <div className="flex items-center gap-3 rounded-lg border p-2">
            <div className="relative h-14 w-14 shrink-0 rounded-md bg-muted overflow-hidden">
              <div className="absolute inset-0 flex items-center justify-center">
                <IconFileText size={20} className="text-muted-foreground" />
              </div>
              <img
                src={fields.beleg}
                alt=""
                className="relative h-full w-full object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate text-foreground">{fields.beleg.split("/").pop()}</p>
              <div className="flex gap-2 mt-1">
                <label
                  className="text-xs text-primary hover:underline cursor-pointer"
                >
                  {t('fr_change')}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const fileUrl = await uploadFile(file, file.name);
                        setFields(f => ({ ...f, beleg: fileUrl }));
                      } catch (err) { console.error('Upload failed:', err); }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setFields(f => ({ ...f, beleg: undefined }))}
                >
                  {t('fr_remove')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <label
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
          >
            <IconUpload size={20} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">{t('fr_upload_file')}</span>
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const fileUrl = await uploadFile(file, file.name);
                  setFields(f => ({ ...f, beleg: fileUrl }));
                } catch (err) { console.error('Upload failed:', err); }
              }}
            />
          </label>
        )}
      </div>
    ),
  };
  const orderedFields = applyFieldOrder(Object.keys(fieldBlocks), formEnhancements.fieldOrder);
  const orderedFieldsKey = orderedFields.map((it) => typeof it === 'string' ? it : it.row.join('+')).join(',');

  // Render-Modell für Computed-Felder:
  //
  //   • BACKEND-FELDER mit computed-Eintrag (z.B. gesamtpreis bei einer
  //     Katzenpension) bleiben als normales Eingabe-Feld stehen. Der Number-
  //     Input nutzt den computed-Wert als Vorschlag, der User kann jederzeit
  //     überschreiben (clearing → restore computed).
  //   • VIRTUELLE computed-Keys (Eintrag in formEnhancements.computed, ABER
  //     kein passendes Backend-Feld in orderedFields) erscheinen NICHT als
  //     Input, sondern unten als kompakte 'Berechnungen'-Übersicht oder als
  //     Inline-Hint unter dem letzten beitragenden Input.
  const FIELD_LABELS: Record<string, string> = {"gast": "Gast", "zimmer": "Zimmer", "anreise": "Anreise", "abreise": "Abreise", "status": "Status", "personen": "Personen", "begleitperson": "Begleitperson", "zusatzleistungen_buchung": "Zusatzleistungen", "bemerkung": "Bemerkung", "beleg": "Beleg"};
  const CURRENCY_KEYS = new Set<string>([]);
  // Applookup-Referenz-Labels: pro applookup-Feld in dieser Form (ownKey)
  // eine Map { lookupKey: label } für ALLE Felder des Target-Schemas. Wird
  // beim Render-Walk gefiltert auf die in der computed-Formel tatsächlich
  // referenzierten lookupKeys (siehe applookupRefs unten).
  const APPLOOKUP_LABELS: Record<string, Record<string, string>> = {"gast": {"vorname": "Vorname", "nachname": "Nachname", "email": "E-Mail", "telefon": "Telefon", "website": "Website", "plz": "PLZ", "ort": "Ort", "newsletter": "Newsletter", "anmerkungen": "Anmerkungen"}, "zimmer": {"bezeichnung": "Bezeichnung", "kategorie": "Kategorie", "preis_pro_nacht": "Preis pro Nacht (€)", "etage": "Etage", "balkon": "Balkon", "foto": "Foto"}, "begleitperson": {"vorname": "Vorname", "nachname": "Nachname", "email": "E-Mail", "telefon": "Telefon", "website": "Website", "plz": "PLZ", "ort": "Ort", "newsletter": "Newsletter", "anmerkungen": "Anmerkungen"}, "zusatzleistungen_buchung": {"name": "Name", "preis": "Preis (€)", "aktiv": "Aktiv"}};
  const inputFields = useMemo(() => flattenFieldOrder(orderedFields), [orderedFieldsKey]);
  const backendFieldSet = useMemo(() => new Set(inputFields), [inputFields.join(',')]);
  const virtualComputed = useMemo(
    () => Object.fromEntries(
      Object.entries(formEnhancements.computed).filter(([k]) => !backendFieldSet.has(k)),
    ),
    [backendFieldSet],
  );
  const virtualFormEnhancements = useMemo(
    () => ({ ...formEnhancements, computed: virtualComputed }),
    [virtualComputed],
  );
  const computedLayout = useMemo(
    () => classifyComputed(virtualFormEnhancements, inputFields, computedDeps),
    [virtualFormEnhancements, inputFields.join(',')],
  );
  // Applookup-Referenzen: pro ownKey (Lookup-Feld im Form) die Liste der
  // lookupKeys, die in irgendeiner computed-Formel referenziert werden.
  // MODUS-1: aus dem Spec-Tree extrahiert. MODUS-2: aus dem Build-Time-
  // Export computedApplookupRefs (parse-formulas hat Regex-Pairs gesammelt).
  // Pro (ownKey, lookupKey)-Paar nur einmal; pro ownKey können aber mehrere
  // lookupKeys gleichzeitig auftauchen (z.B. einzelpreis UND karten10_preis
  // beim Yoga-Kurs), und alle werden separat als Inline-Hint gerendert.
  const applookupRefs = useMemo(
    () => mergeApplookupRefs(
      extractApplookupRefs(formEnhancements.computed),
      computedApplookupRefs,
    ),
    [],
  );
  function summaryLabel(k: string): string {
    if (FIELD_LABELS[k]) return FIELD_LABELS[k];
    // Leading underscore(s) als Virtual-Marker abstreifen; Unterstriche zu
    // Leerzeichen, jedes Wort kapitalisieren. Umlaute kommen vom Sub-Agent
    // direkt im Key (z. B. `_buchung_dauer_nächte`) — JS/TS/Vite unterstützen
    // Unicode-Identifier nativ, daher keine ASCII-Transliteration nötig.
    return k.replace(/^_+/, '')
      .split('_')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  function formatSummaryValue(k: string, v: unknown): string {
    if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return '—';
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return String(v);
    // Backend-Feld mit €-Label ODER virtueller Computed-Key, dessen Name nach Geld aussieht.
    const looksLikeCurrency = CURRENCY_KEYS.has(k) || /(?:kosten|preis|betrag|gesamt|netto|brutto|summe|mwst|rabatt|anzahlung|umsatz|saldo)/i.test(k);
    if (looksLikeCurrency) {
      return n.toLocaleString(localeTag(), { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return n.toLocaleString(localeTag(), { maximumFractionDigits: 2 });
  }

  return (
    <>
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[92vh] flex flex-col overflow-hidden p-0 gap-0 max-sm:[&>button]:size-10 max-sm:[&>button]:grid max-sm:[&>button]:place-items-center max-sm:[&>button]:rounded-full max-sm:[&>button]:border max-sm:[&>button]:border-input max-sm:[&>button]:bg-background max-sm:[&>button]:opacity-100 max-sm:[&>button>svg]:size-5">
        <DialogHeader className="px-6 pt-5 pb-3 border-b flex flex-row items-center gap-3 space-y-0">
          <DialogTitle className="flex-1 truncate text-left">{DIALOG_INTENT}</DialogTitle>
          {enablePhotoScan && (
            <button
              type="button"
              onClick={() => setAiOpen(o => !o)}
              aria-expanded={aiOpen}
              aria-controls="ai-fill-panel"
              className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 max-sm:py-2.5 max-sm:px-4 text-xs font-semibold transition-all mr-7 max-sm:mr-12 shadow-sm ${
                aiOpen
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                  : 'bg-primary/10 text-primary border border-primary/30 hover:bg-primary/15 hover:border-primary/50'
              }`}
            >
              <IconSparkles className={`h-3.5 w-3.5 ${aiOpen ? '' : 'text-primary'}`} />
              <span className="hidden sm:inline">{t('smart_fill')}</span>
              <IconChevronDown className={`h-3 w-3 transition-transform ${aiOpen ? 'rotate-180' : ''}`} />
            </button>
          )}
        </DialogHeader>
        {enablePhotoScan && aiOpen && (
          <div id="ai-fill-panel" className="border-b bg-muted/20 px-6 py-4 space-y-3">
            <p className="text-xs text-muted-foreground">{t('scan_header_sub')}</p>
            <div className="flex items-start gap-2 pl-0.5">
              <Checkbox
                id="ai-use-personal-info"
                checked={usePersonalInfo}
                onCheckedChange={(v) => setUsePersonalInfo(!!v)}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground leading-snug">
                <Label htmlFor="ai-use-personal-info" className="text-xs font-normal text-muted-foreground cursor-pointer inline">
                  {t('useinfo_label')}
                </Label>
                {' '}
                <button type="button" onClick={handleShowProfileInfo} className="text-xs text-primary hover:underline whitespace-nowrap">
                  {profileLoading ? t('useinfo_loading') : `(${t('useinfo_more')})`}
                </button>
              </span>
            </div>
            {showProfileInfo && (
              <div className="rounded-md border bg-muted/50 p-2 text-xs max-h-40 overflow-y-auto">
                <p className="font-medium mb-1">{t('profile_preamble')}</p>
                {profileData ? Object.values(profileData).map((v, i) => (
                  <span key={i}>{i > 0 && ", "}{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                )) : (
                  <span className="text-muted-foreground">{t('useinfo_error')}</span>
                )}
              </div>
            )}

            <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelect} />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileSelect} />

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !scanning && fileInputRef.current?.click()}
              className={`
                relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer
                ${scanning
                  ? 'border-primary/40 bg-primary/5'
                  : scanSuccess
                    ? 'border-green-500/40 bg-green-50/50 dark:bg-green-950/20'
                    : dragOver
                      ? 'border-primary bg-primary/10 scale-[1.01]'
                      : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'
                }
              `}
            >
              {scanning ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <IconLoader2 className="h-7 w-7 text-primary animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{t('scan_analyzing')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('scan_analyzing_sub')}</p>
                  </div>
                </div>
              ) : scanSuccess ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-14 w-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <IconCircleCheck className="h-7 w-7 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">{t('scan_success')}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t('scan_success_sub')}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="h-14 w-14 rounded-full bg-primary/8 flex items-center justify-center">
                    <IconPhotoPlus className="h-7 w-7 text-primary/70" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">{t('scan_upload')}</p>
                  </div>
                </div>
              )}

              {preview && !scanning && (
                <div className="absolute top-2 right-2">
                  <div className="relative group">
                    <img src={preview} alt="" className="h-10 w-10 rounded-md object-cover border shadow-sm" />
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); setPreview(null); }}
                      className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-muted-foreground/80 text-white flex items-center justify-center"
                    >
                      <IconX className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10 text-xs" disabled={scanning}
                onClick={e => { e.stopPropagation(); cameraInputRef.current?.click(); }}>
                <IconCamera className="h-3.5 w-3.5 mr-1" />{t('scan_camera_btn')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-10 text-xs" disabled={scanning}
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                <IconUpload className="h-3.5 w-3.5 mr-1" />{t('scan_file_btn')}
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-10 text-xs" disabled={scanning}
                onClick={e => {
                  e.stopPropagation();
                  if (fileInputRef.current) {
                    fileInputRef.current.accept = 'application/pdf,.pdf';
                    fileInputRef.current.click();
                    setTimeout(() => { if (fileInputRef.current) fileInputRef.current.accept = 'image/*,application/pdf'; }, 100);
                  }
                }}>
                <IconFileText className="h-3.5 w-3.5 mr-1" />{t('scan_doc_btn')}
              </Button>
            </div>

            <div className="relative">
              <Textarea
                placeholder={t('scan_text_placeholder')}
                value={aiText}
                onChange={e => {
                  setAiText(e.target.value);
                  const el = e.target;
                  el.style.height = 'auto';
                  el.style.height = Math.min(Math.max(el.scrollHeight, 56), 96) + 'px';
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && aiText.trim() && !scanning) {
                    e.preventDefault();
                    handleAiExtract();
                  }
                }}
                disabled={scanning}
                rows={2}
                className="pr-12 resize-none text-sm overflow-y-auto"
              />
              <button
                type="button"
                className="absolute right-2 top-2 h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                disabled={scanning}
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard.readText();
                    if (text) setAiText(prev => prev ? prev + '\n' + text : text);
                  } catch {}
                }}
                title={t('paste')}
              >
                <IconClipboard className="h-4 w-4" />
              </button>
            </div>
            {aiText.trim() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full h-9 text-xs"
                disabled={scanning}
                onClick={() => handleAiExtract()}
              >
                <IconSparkles className="h-3.5 w-3.5 mr-1.5" />{t('scan_text_analyze')}
              </Button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col min-h-0 min-w-0 max-sm:[&_input]:h-11">
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-4 space-y-4 min-w-0">
            {(() => {
              const renderField = (k: string) => {
                const inlineHints = computedLayout.anchors[k] ?? [];
                const refs = applookupRefs[k] ?? [];
                return (
                  <div key={k} className="space-y-1.5 min-w-0">
                    {fieldBlocks[k]}
                    {refs.map(({ lookupKey }) => {
                      // Show the live numeric value the formula will pull from
                      // the selected lookup target (e.g. "Monatspreis: 34,90 €"
                      // under the Tarif combobox). Hidden while no lookup is
                      // selected or the target field is non-numeric.
                      const v = resolveApplookupRef(k, lookupKey, fields as Record<string, unknown>, computedContext);
                      if (v === null) return null;
                      const lbl = APPLOOKUP_LABELS[k]?.[lookupKey] ?? lookupKey;
                      const text = formatSummaryValue(lookupKey, v);
                      return (
                        <div key={`alh-${k}-${lookupKey}`} className="flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
                          <span className="text-primary/70">→</span>
                          <span>{lbl}</span>
                          <span className="ml-auto font-medium tabular-nums text-foreground">{text}</span>
                        </div>
                      );
                    })}
                    {inlineHints.map((cKey) => {
                      const v = computedValues[cKey];
                      const text = formatSummaryValue(cKey, v);
                      if (text === '—') return null;
                      return (
                        <div key={cKey} className="flex items-center gap-1.5 pl-3 text-xs text-muted-foreground">
                          <span className="text-primary/70">→</span>
                          <span>{summaryLabel(cKey)}</span>
                          <span className="ml-auto font-medium tabular-nums text-foreground">{text}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              };
              return orderedFields.map((item, idx) => {
                if (typeof item === 'string') return renderField(item);
                const cols = item.cols ?? `repeat(${item.row.length}, minmax(0, 1fr))`;
                return (
                  <div key={`row-${idx}`} className="grid gap-3" style={{ gridTemplateColumns: cols }}>
                    {item.row.map(renderField)}
                  </div>
                );
              });
            })()}
            {(computedLayout.aggregates.length > 0 || computedLayout.finalTotal) && (
              <div className="mt-6 pt-4 border-t border-border space-y-1.5">
                {computedLayout.aggregates.length > 0 && (
                  <dl className="space-y-1.5 pb-2">
                    {computedLayout.aggregates.map((k) => {
                      const userVal = (fields as Record<string, unknown>)[k];
                      const computed = computedValues[k];
                      const v = userVal !== undefined && userVal !== null && userVal !== '' ? userVal : computed;
                      return (
                        <div key={k} className="flex justify-between items-baseline gap-3">
                          <dt className="text-sm text-muted-foreground truncate">{summaryLabel(k)}</dt>
                          <dd className="text-sm font-medium tabular-nums whitespace-nowrap">{formatSummaryValue(k, v)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
                {computedLayout.finalTotal && (() => {
                  const k = computedLayout.finalTotal;
                  const userVal = (fields as Record<string, unknown>)[k];
                  const computed = computedValues[k];
                  const v = userVal !== undefined && userVal !== null && userVal !== '' ? userVal : computed;
                  // Innere Border nur wenn aggregates existieren — sonst hätten wir
                  // zwei direkt aufeinanderfolgende Striche (Outer + Inner) mit nur
                  // einer Aggregat-Zeile dazwischen → zu viel visuelles Rauschen.
                  const sep = computedLayout.aggregates.length > 0 ? 'pt-3 border-t border-border' : 'pt-1';
                  return (
                    <div className={`flex justify-between items-baseline gap-3 ${sep}`}>
                      <span className="text-base font-semibold text-foreground">{summaryLabel(k)}</span>
                      <span className="text-lg font-bold tabular-nums whitespace-nowrap text-foreground">{formatSummaryValue(k, v)}</span>
                    </div>
                  );
                })()}
              </div>
            )}
            {showErrors && missingRequired.length > 0 && (
              <p className="text-xs text-destructive flex items-center gap-1.5" role="alert">
                <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
                {t('missing_required')}
              </p>
            )}
            {recordId && (
              <div className="pt-2 border-t border-border">
                <AttachmentsSection appId={APP_IDS.BUCHUNGEN} recordId={recordId} />
              </div>
            )}
          </div>
          {submitError && (
            <div className="flex items-start gap-2 border-t border-destructive/20 bg-destructive/10 px-6 py-2.5 text-sm text-destructive" role="alert">
              <IconAlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{submitError}</span>
            </div>
          )}
          <DialogFooter className="sticky bottom-0 border-t bg-background/95 backdrop-blur px-6 py-3 gap-2 max-sm:flex-row">
            <Button type="button" variant="outline" onClick={onClose} className="max-sm:h-12 max-sm:flex-1 max-sm:text-base">{t('cancel')}</Button>
            <Button
              type="submit"
              className="max-sm:h-12 max-sm:flex-1 max-sm:text-base"
              disabled={saving || !isDirty || (showErrors && missingRequired.length > 0)}
            >
              {saving ? t('saving') : defaultValues ? t('save') : t('create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {createGaesteOpen && (
      <GaesteDialog
        open={createGaesteOpen}
        onClose={() => setCreateGaesteOpen(false)}
        onSubmit={async (newFields) => {
          const result = await LivingAppsService.createGaesteEntry(newFields as any) as { id?: string };
          if (result?.id) {
            const newRec = { record_id: result.id, fields: newFields } as unknown as Gaeste;
            setExtraGaeste(prev => [...prev, newRec]);
            const url = createRecordUrl(APP_IDS.GAESTE, result.id);
            setFields(prev => ({ ...prev, [createGaesteField]: url } as any));
          }
          setCreateGaesteOpen(false);
        }}
        defaultValues={createGaesteInitial
          ? ({ vorname: createGaesteInitial } as any)
          : undefined}
      />
    )}
    {createZimmerOpen && (
      <ZimmerDialog
        open={createZimmerOpen}
        onClose={() => setCreateZimmerOpen(false)}
        onSubmit={async (newFields) => {
          const result = await LivingAppsService.createZimmerEntry(newFields as any) as { id?: string };
          if (result?.id) {
            const newRec = { record_id: result.id, fields: newFields } as unknown as Zimmer;
            setExtraZimmer(prev => [...prev, newRec]);
            const url = createRecordUrl(APP_IDS.ZIMMER, result.id);
            setFields(prev => ({ ...prev, [createZimmerField]: url } as any));
          }
          setCreateZimmerOpen(false);
        }}
        defaultValues={createZimmerInitial
          ? ({ bezeichnung: createZimmerInitial } as any)
          : undefined}
      />
    )}
    {createZusatzleistungenOpen && (
      <ZusatzleistungenDialog
        open={createZusatzleistungenOpen}
        onClose={() => setCreateZusatzleistungenOpen(false)}
        onSubmit={async (newFields) => {
          const result = await LivingAppsService.createZusatzleistungenEntry(newFields as any) as { id?: string };
          if (result?.id) {
            const newRec = { record_id: result.id, fields: newFields } as unknown as Zusatzleistungen;
            setExtraZusatzleistungen(prev => [...prev, newRec]);
            const url = createRecordUrl(APP_IDS.ZUSATZLEISTUNGEN, result.id);
            setFields(prev => ({ ...prev, [createZusatzleistungenField]: url } as any));
          }
          setCreateZusatzleistungenOpen(false);
        }}
        defaultValues={createZusatzleistungenInitial
          ? ({ name: createZusatzleistungenInitial } as any)
          : undefined}
      />
    )}
    </>
  );
}