import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  listPublicRecords,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
  type PublicRecordResult,
} from '@/lib/publicClient';
import { tx } from '@/i18n';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  useStepForm,
  useJourneySubmit,
  useOccupancy,
  useRecordSearch,
  occupancyFor,
} from '@/lib/journey';
import type { JourneyRecord } from '@/lib/journey';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import type { WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';

const SLUG = 'buchungsanfrage';

interface ZimmerItem {
  id: string;
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string | number }[];
}

export default function Buchungsanfrage() {
  const STEPS: WizardStep[] = [
  {
    label: tx('Zeitraum'),
    heading: tx('Zeitraum wählen'),
    description: tx('Wähle dein Anreise- und Abreisedatum. Belegte Nächte sind markiert und nicht auswählbar.'),
  },
  {
    label: tx('Zimmer'),
    heading: tx('Zimmer wählen'),
    description: tx('Wähle ein Zimmer für deinen Aufenthalt.'),
  },
  {
    label: tx('Kontakt'),
    heading: tx('Deine Kontaktdaten'),
    description: tx('Bitte gib deine Kontaktdaten für die Buchungsbestätigung an.'),
  },
  {
    label: tx('Prüfen'),
    heading: tx('Anfrage prüfen'),
  },
];

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState(1);

  // Raw buchungen records for occupancy calculation (all)
  const [buchungenRecords, setBuchungenRecords] = useState<PublicRecordResult[]>([]);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setLoading(false);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) {
          setUnavailable(true);
          setLoading(false);
        } else {
          setUnavailable(true);
          setLoading(false);
        }
      });
  }, []);

  // Load all buchungen for occupancy once config is ready
  useEffect(() => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.entity === 'buchungen' && e.op === 'list');
    if (!ep?.app_id) return;
    listPublicRecords(cfg, page, { appId: ep.app_id, limit: 500 })
      .then(res => setBuchungenRecords(Object.values(res)))
      .catch(() => {});
  }, [cfg, page]);

  // ALL hooks before any early return
  const port = useMemo(
    () => (cfg && page ? createPublicPort(cfg, page) : null),
    [cfg, page],
  );

  // Step forms
  const buchungForm = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'personen', 'bemerkung'],
    required: { zimmer: true, anreise: true, abreise: true },
    steps: { anreise: 1, abreise: 1, zimmer: 2, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });
  const gaestForm = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 3, nachname: 3, email: 3, telefon: 3 },
    autoComplete: true,
  });

  const gewaehlterZimmerId = buchungForm.get('zimmer') as string | null;

  // Occupancy for selected room (using raw buchungen records)
  const occupancyBlocked = useMemo(() => {
    const asJourneyRecords = buchungenRecords.map(r => ({
      id: r.id,
      fields: r.fields as Record<string, unknown>,
      createdAt: r.created_at ?? null,
    }));
    return occupancyFor('buchungen', asJourneyRecords, {
      resource: gewaehlterZimmerId ?? undefined,
    });
  }, [buchungenRecords, gewaehlterZimmerId]);

  // Zimmer search via port
  const zimmerSearch = useRecordSearch<EntityKey, ZimmerItem>(
    port ?? { door: 'public', list: async () => [], count: async () => null, get: async () => null, create: async () => { throw new Error(); }, ref: () => '' },
    'zimmer',
    {
      searchFields: ['bezeichnung'],
      toItem: (r): ZimmerItem => ({
        id: r.id,
        title: (r.fields.bezeichnung as string) ?? '',
        subtitle: (() => {
          const kat = r.fields.kategorie as { label: string } | undefined;
          const preis = r.fields.preis_pro_nacht as number | undefined;
          const parts: string[] = [];
          if (kat?.label) parts.push(kat.label);
          if (preis != null) parts.push(tx`${preis.toLocaleString('de-DE')} €/Nacht`);
          return parts.join(' · ') || undefined;
        })(),
      }),
    },
  );

  // Submit plan: first create guest, then booking linked to guest
  const submit = useJourneySubmit(
    port ?? { door: 'public', list: async () => [], count: async () => null, get: async () => null, create: async () => { throw new Error(); }, ref: () => '' },
    [
      { key: 'gast', entity: 'gaeste', form: gaestForm },
      {
        key: 'buchung',
        entity: 'buchungen',
        form: buchungForm,
        primary: true,
        needs: ['gast'],
        link: { gast: 'gast' },
      },
    ],
    { draftKey: 'buchungsanfrage' },
  );

  if (loading) {
    return <PublicShell loading />;
  }
  if (unavailable || !cfg || !page || !port) {
    return <PublicShell unavailable />;
  }

  const anreise = buchungForm.get('anreise') as string | null;
  const abreise = buchungForm.get('abreise') as string | null;

  function handleZimmerSelect(id: string) {
    const label = zimmerSearch.labelOf(id) ?? id;
    buchungForm.set('zimmer', id, label);
    prepareChallenge(cfg!, page!, 'POST', `/apps/${page!.endpoints?.find(e => e.entity === 'buchungen' && e.op === 'create')?.app_id}/records`);
    setStep(3);
  }

  function handleRestart() {
    submit.reset();
    gaestForm.reset();
    buchungForm.reset();
    setStep(1);
  }

  return (
    <PublicShell title={tx('Zimmer anfragen')} description={tx('Stelle deine Buchungsanfrage — wir melden uns so schnell wie möglich.')}>
      <IntentWizardShell
        steps={STEPS}
        currentStep={step}
        onStepChange={setStep}
        back={false}
        forms={[buchungForm, gaestForm]}
        draftKey="buchungsanfrage"
      >
        {/* Step 1: Zeitraum */}
        {step === 1 && !submit.done && (
          <div className="space-y-4">
            <AvailabilityRangePicker
              {...buchungForm.range('anreise', 'abreise', {
                blocked: occupancyBlocked,
                minNights: 1,
                unit: 'nights',
              })}
            />
            <StepNav
              hideBack
              onNext={() => buchungForm.validate(['anreise', 'abreise'])}
              nextStepLabel={tx('Zimmer wählen')}
            />
          </div>
        )}

        {/* Step 2: Zimmer wählen */}
        {step === 2 && !submit.done && (
          <div className="space-y-4">
            <EntitySelectStep
              {...zimmerSearch.select}
              avatar="none"
              columns={2}
              selectedId={gewaehlterZimmerId}
              onSelect={handleZimmerSelect}
              invalid={!!buchungForm.error('zimmer')}
              searchPlaceholder={tx('Zimmer suchen…')}
              emptyText={tx('Keine Zimmer verfügbar.')}
            />
            <StepNav
              onBack={() => setStep(1)}
              onNext={() => buchungForm.validate(['zimmer'])}
              nextStepLabel={tx('Kontaktdaten')}
            />
          </div>
        )}

        {/* Step 3: Kontaktdaten */}
        {step === 3 && !submit.done && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field form={gaestForm} name="vorname">
                <input
                  {...gaestForm.field('vorname')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={tx('z. B. Maria')}
                />
              </Field>
              <Field form={gaestForm} name="nachname">
                <input
                  {...gaestForm.field('nachname')}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder={tx('z. B. Mustermann')}
                />
              </Field>
            </div>
            <Field form={gaestForm} name="email">
              <input
                {...gaestForm.field('email')}
                type="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={tx('z. B. maria@beispiel.de')}
              />
            </Field>
            <Field form={gaestForm} name="telefon">
              <input
                {...gaestForm.field('telefon')}
                type="tel"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={tx('z. B. +49 151 12345678')}
              />
            </Field>
            <Field form={buchungForm} name="personen">
              <input
                {...buchungForm.number('personen')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder={tx('Anzahl Personen')}
              />
            </Field>
            <Field form={buchungForm} name="bemerkung">
              <textarea
                {...buchungForm.field('bemerkung')}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                placeholder={tx('Besondere Wünsche, Anmerkungen …')}
              />
            </Field>
            <StepNav
              onBack={() => setStep(2)}
              onNext={() => gaestForm.validate(['vorname', 'nachname'])}
              nextStepLabel={tx('Anfrage prüfen')}
            />
          </div>
        )}

        {/* Step 4: Zusammenfassung */}
        {step === 4 && !submit.done && (
          <SummaryStep
            forms={[buchungForm, gaestForm]}
            submit={submit}
            whatHappensNext={tx('Wir prüfen deine Anfrage und melden uns so schnell wie möglich per E-Mail oder Telefon bei dir.')}
            confirmLabel={tx('Anfrage absenden')}
          />
        )}

        {/* Erfolg */}
        {submit.result && (
          <SuccessStep
            result={submit.result}
            forms={[buchungForm, gaestForm]}
            whatHappensNext={tx('Wir prüfen deine Anfrage und melden uns in Kürze bei dir. Bitte halte eine Bestätigung per E-Mail im Blick.')}
            next={[{ label: tx('Weitere Anfrage stellen'), onClick: handleRestart }]}
            referencePrefix="B"
          />
        )}
      </IntentWizardShell>
    </PublicShell>
  );
}

// Needed for type inference in useRecordSearch generic call
type EntityKey = 'zimmer';
