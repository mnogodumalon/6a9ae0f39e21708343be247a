import { useCallback, useEffect, useMemo, useState } from 'react';
import { tx } from '@/i18n';
import {
  loadPublicPagesConfig,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { PublicShell } from '@/components/PublicShell';
import { IntentWizardShell, type WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Field } from '@/components/blocks/Field';
import { createPublicPort } from '@/lib/journey/publicPort';
import { useStepForm, useJourneySubmit, occupancyFor } from '@/lib/journey';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  IconBed,
  IconCheck,
  IconStar,
  IconDoor,
} from '@tabler/icons-react';
import { formatCurrency } from '@/lib/formatters';

// ─── Zimmer-Typen (nur intern für die Darstellung) ───────────────────────────

interface ZimmerRecord {
  id: string;
  bezeichnung: string;
  kategorie: string | null;
  kategorieLabel: string;
  preis_pro_nacht: number | null;
  balkon: boolean | null;
  foto: string | null;
}

interface BuchungRecord {
  id: string;
  zimmerId: string | null;
  anreise: string | null;
  abreise: string | null;
  status: string | null;
}

const SLUG = 'buchungsanfrage';

// ─── Hilfsfunktion: record-URL → ID ──────────────────────────────────────────
function extractId(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const parts = value.split('/');
  return parts[parts.length - 1] ?? null;
}

// ─── Hauptkomponente ─────────────────────────────────────────────────────────

export default function Buchungsanfrage() {
  const STEPS: WizardStep[] = [
  { label: tx('Zimmer wählen'), key: 'zimmer' },
  { label: tx('Zeitraum wählen'), key: 'zeitraum' },
  { label: tx('Kontaktdaten'), key: 'kontakt' },
  { label: tx('Prüfen & Absenden'), key: 'zusammenfassung' },
];

  const KATEGORIE_LABELS: Record<string, string> = {
  einzelzimmer: 'Einzelzimmer',
  doppelzimmer: 'Doppelzimmer',
  suite: 'Suite',
};

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [zimmerList, setZimmerList] = useState<ZimmerRecord[]>([]);
  const [buchungenList, setBuchungenList] = useState<BuchungRecord[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [step, setStep] = useState(1);
  const [selectedZimmerId, setSelectedZimmerId] = useState<string | null>(null);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        const p = c?.pages[SLUG] ?? null;
        setPage(p);
        setLoading(false);
        return { c, p };
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  // Zimmer und Buchungen laden, sobald cfg/page bereit
  useEffect(() => {
    if (!cfg || !page) return;
    const loadData = async () => {
      try {
        const { listPublicRecords } = await import('@/lib/publicClient');
        const zimmerEp = page.endpoints?.find(e => e.entity === 'zimmer' && e.op === 'list');
        const buchungenEp = page.endpoints?.find(e => e.entity === 'buchungen' && e.op === 'list');

        const [zimmerMap, buchungenMap] = await Promise.all([
          zimmerEp
            ? listPublicRecords(cfg, page, { appId: zimmerEp.app_id, limit: 500 })
            : Promise.resolve<Record<string, { id: string; fields: Record<string, unknown>; created_at: string | null; updated_at: string | null }>>( {}),
          buchungenEp
            ? listPublicRecords(cfg, page, { appId: buchungenEp.app_id, limit: 500 })
            : Promise.resolve<Record<string, { id: string; fields: Record<string, unknown>; created_at: string | null; updated_at: string | null }>>({}),
        ]);

        setZimmerList(
          Object.values(zimmerMap).map(r => ({
            id: r.id,
            bezeichnung: (r.fields.bezeichnung as string) ?? '',
            kategorie: (r.fields.kategorie as string) ?? null,
            kategorieLabel: KATEGORIE_LABELS[(r.fields.kategorie as string) ?? ''] ?? (r.fields.kategorie as string) ?? '',
            preis_pro_nacht: (r.fields.preis_pro_nacht as number) ?? null,
            balkon: (r.fields.balkon as boolean) ?? null,
            foto: (r.fields.foto as string) ?? null,
          })),
        );
        setBuchungenList(
          Object.values(buchungenMap).map(r => ({
            id: r.id,
            zimmerId: extractId(r.fields.zimmer as string),
            anreise: (r.fields.anreise as string) ?? null,
            abreise: (r.fields.abreise as string) ?? null,
            status: (r.fields.status as string) ?? null,
          })),
        );
        setDataLoaded(true);
      } catch {
        setDataLoaded(true);
      }
    };
    loadData();
  }, [cfg, page]);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);

  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 3, nachname: 3, email: 3, telefon: 3 },
    autoComplete: true,
  });

  const buchung = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'personen', 'bemerkung'],
    required: { zimmer: true, anreise: true, abreise: true, personen: false, bemerkung: false },
    steps: { zimmer: 1, anreise: 2, abreise: 2, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  const submit = useJourneySubmit(
    port ?? {
      door: 'public' as const,
      async list() { return []; },
      async count() { return null; },
      async get() { return null; },
      async create() { return { id: '', fields: {}, createdAt: null }; },
      ref: () => '',
    },
    [
      { key: 'gast', entity: 'gaeste', form: gast },
      {
        key: 'buchung',
        entity: 'buchungen',
        form: buchung,
        primary: true,
        needs: ['gast'],
        link: { gast: 'gast' },
      },
    ],
    { draftKey: 'buchungsanfrage' },
  );

  const handleRestart = useCallback(() => {
    gast.reset?.();
    buchung.reset?.();
    setSelectedZimmerId(null);
    setStep(1);
  }, [gast, buchung]);

  // blocked nights für das gewählte Zimmer
  const blockedNights = useMemo(() => {
    return occupancyFor(
      'buchungen',
      buchungenList.map(b => ({
        fields: {
          zimmer: b.zimmerId,
          anreise: b.anreise,
          abreise: b.abreise,
          status: b.status,
        },
      })),
      { resource: selectedZimmerId ?? undefined },
    );
  }, [buchungenList, selectedZimmerId]);

  const selectedZimmer = zimmerList.find(z => z.id === selectedZimmerId) ?? null;

  // prepareChallenge beim ersten Interagieren
  const handleFirstInteraction = useCallback(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'create' && e.entity === 'buchungen');
    if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  }, [cfg, page]);

  if (loading || (!cfg && !unavailable)) {
    return <PublicShell loading={loading} unavailable={false} />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable />;
  }

  return (
    <PublicShell title={tx('Zimmer anfragen')} description={tx('Stellen Sie eine Buchungsanfrage — wir melden uns schnellstmöglich.')}>
      <div onClick={handleFirstInteraction} onKeyDown={handleFirstInteraction}>
        <IntentWizardShell
          steps={STEPS}
          currentStep={step}
          onStepChange={setStep}
          back={false}
          forms={[gast, buchung]}
          draftKey="buchungsanfrage"
        >
          {/* ── Schritt 1: Zimmer wählen ── */}
          {step === 1 && !submit.result && (
            <div className="space-y-4">
              {!dataLoaded && (
                <p className="text-sm text-muted-foreground">{tx('Zimmer werden geladen…')}</p>
              )}
              {dataLoaded && zimmerList.length === 0 && (
                <p className="text-sm text-muted-foreground">{tx('Aktuell sind keine Zimmer verfügbar.')}</p>
              )}
              <div className="space-y-3">
                {zimmerList.map(z => (
                  <button
                    key={z.id}
                    type="button"
                    onClick={() => {
                      setSelectedZimmerId(z.id);
                      buchung.set('zimmer', z.id, z.bezeichnung);
                    }}
                    className={[
                      'w-full text-left rounded-xl border-2 transition-all overflow-hidden',
                      selectedZimmerId === z.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40 bg-card',
                    ].join(' ')}
                  >
                    {z.foto && (
                      <img
                        src={z.foto}
                        alt={z.bezeichnung}
                        className="w-full h-40 object-cover"
                      />
                    )}
                    {!z.foto && (
                      <div className="w-full h-24 bg-muted flex items-center justify-center">
                        <IconBed size={36} className="text-muted-foreground" stroke={1.5} />
                      </div>
                    )}
                    <div className="p-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold truncate">{z.bezeichnung}</span>
                          {z.kategorie === 'suite' && (
                            <span className="flex items-center gap-0.5 text-xs text-amber-600">
                              <IconStar size={12} className="shrink-0" />
                              {z.kategorieLabel}
                            </span>
                          )}
                          {z.kategorie !== 'suite' && z.kategorieLabel && (
                            <span className="text-xs text-muted-foreground">{z.kategorieLabel}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                          {z.preis_pro_nacht != null && (
                            <span>{formatCurrency(z.preis_pro_nacht)} {tx('/ Nacht')}</span>
                          )}
                          {z.balkon && (
                            <span className="flex items-center gap-1">
                              <IconDoor size={14} className="shrink-0" />
                              {tx('Balkon')}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedZimmerId === z.id && (
                        <span className="shrink-0 bg-primary text-primary-foreground rounded-full p-0.5">
                          <IconCheck size={16} />
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
              {buchung.error('zimmer') && (
                <p className="text-sm text-destructive">{buchung.error('zimmer')}</p>
              )}
              <StepNav
                hideBack
                onNext={() => buchung.validate(['zimmer'])}
                nextStepLabel={tx('Zeitraum wählen')}
              />
            </div>
          )}

          {/* ── Schritt 2: Zeitraum wählen ── */}
          {step === 2 && !submit.result && (
            <div className="space-y-5">
              {selectedZimmer && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-sm">
                  <IconBed size={16} className="shrink-0 text-muted-foreground" />
                  <span className="font-medium">{selectedZimmer.bezeichnung}</span>
                  {selectedZimmer.preis_pro_nacht != null && (
                    <span className="text-muted-foreground ml-auto shrink-0">
                      {formatCurrency(selectedZimmer.preis_pro_nacht)} {tx('/ Nacht')}
                    </span>
                  )}
                </div>
              )}
              <Field form={buchung} name="anreise" label={tx('Reisezeitraum')}>
                <AvailabilityRangePicker
                  {...buchung.range('anreise', 'abreise', { blocked: blockedNights })}
                  legend={tx('Belegte Nächte sind ausgegraut und nicht wählbar.')}
                />
              </Field>
              <StepNav
                onNext={() => buchung.validate(['anreise', 'abreise'])}
                nextStepLabel={tx('Kontaktdaten')}
              />
            </div>
          )}

          {/* ── Schritt 3: Kontaktdaten ── */}
          {step === 3 && !submit.result && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field form={gast} name="vorname">
                  <Input {...gast.field('vorname')} />
                </Field>
                <Field form={gast} name="nachname">
                  <Input {...gast.field('nachname')} />
                </Field>
              </div>
              <Field form={gast} name="email">
                <Input {...gast.field('email')} />
              </Field>
              <Field form={gast} name="telefon">
                <Input {...gast.field('telefon')} />
              </Field>
              <Field form={buchung} name="personen" hint={tx('Anzahl der Personen inklusive Ihnen')}>
                <Input {...buchung.number('personen')} min={1} max={10} />
              </Field>
              <Field form={buchung} name="bemerkung" hint={tx('Besondere Wünsche, Allergien, Anreisezeit …')}>
                <Textarea {...buchung.field('bemerkung')} rows={3} />
              </Field>
              <StepNav
                onNext={() =>
                  Promise.all([
                    gast.validate(['vorname', 'nachname', 'email', 'telefon']),
                    buchung.validate(['personen', 'bemerkung']),
                  ]).then(results => results.every(Boolean) as boolean)
                }
                nextStepLabel={tx('Prüfen & Absenden')}
              />
            </div>
          )}

          {/* ── Schritt 4: Zusammenfassung ── */}
          {step === 4 && !submit.result && (
            <SummaryStep
              forms={[gast, buchung]}
              submit={submit}
              whatHappensNext={tx('Wir prüfen die Verfügbarkeit und melden uns innerhalb eines Werktages per E-Mail oder Telefon.')}
              confirmLabel={tx('Anfrage absenden')}
            />
          )}

          {/* ── Erfolgsmeldung ── */}
          {submit.result && (
            <SuccessStep
              result={submit.result}
              forms={[gast, buchung]}
              whatHappensNext={tx('Wir prüfen die Verfügbarkeit und melden uns innerhalb eines Werktages.')}
              next={[{ label: tx('Weitere Anfrage stellen'), onClick: handleRestart }]}
            />
          )}
        </IntentWizardShell>
      </div>
    </PublicShell>
  );
}
