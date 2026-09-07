import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  PageUnavailableError,
  prepareChallenge,
  type PublicPageConfig,
  type PublicPagesConfig,
  type PublicRecordResult,
} from '@/lib/publicClient';
import { tx } from '@/i18n';
import {
  createPublicPort,
} from '@/lib/journey/publicPort';
import {
  occupancyFor,
  useStepForm,
  useJourneySubmit,
} from '@/lib/journey';
import { IntentWizardShell, type WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { EntitySelectStep, type SelectItem } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';

// ─── Zimmer-Darstellung ──────────────────────────────────────────────────────

interface ZimmerData {
  id: string;
  bezeichnung: string;
  kategorie: string | null;
  kategorieLabel: string | null;
  preis_pro_nacht: number | null;
  balkon: boolean;
  foto: string | null;
}

function parseZimmer(r: PublicRecordResult): ZimmerData {
  const KATEGORIE_LABELS: Record<string, string> = {
  einzelzimmer: 'Einzelzimmer',
  doppelzimmer: 'Doppelzimmer',
  suite: 'Suite',
};

  const lv = r.fields.kategorie as { key?: string; label?: string } | null | undefined;
  const kategorieKey = lv?.key ?? (r.fields.kategorie as string | null | undefined) ?? null;
  return {
    id: r.id,
    bezeichnung: (r.fields.bezeichnung as string) ?? '',
    kategorie: kategorieKey,
    kategorieLabel: kategorieKey ? (KATEGORIE_LABELS[kategorieKey] ?? kategorieKey) : null,
    preis_pro_nacht: (r.fields.preis_pro_nacht as number) ?? null,
    balkon: Boolean(r.fields.balkon),
    foto: (r.fields.foto as string) ?? null,
  };
}

// ─── Wizard-Schritte ─────────────────────────────────────────────────────────

// ─── Hauptkomponente ─────────────────────────────────────────────────────────

export default function Buchungsanfrage() {
  const STEPS: WizardStep[] = [
  { label: tx('Kontaktdaten'), description: tx('Geben Sie Ihre Kontaktdaten ein.') },
  { label: tx('Zimmer wählen'), description: tx('Wählen Sie Ihr Wunschzimmer.') },
  { label: tx('Zeitraum wählen'), description: tx('Wählen Sie Anreise- und Abreisedatum.') },
  { label: tx('Bestätigung') },
];

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError, setCfgError] = useState(false);

  const [zimmerList, setZimmerList] = useState<ZimmerData[]>([]);
  const [buchungenRaw, setBuchungenRaw] = useState<PublicRecordResult[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [step, setStep] = useState(1);

  // Config laden
  useEffect(() => {
    loadPublicPagesConfig('buchungsanfrage')
      .then(c => {
        setCfg(c);
        setPage(c?.pages['buchungsanfrage'] ?? null);
        setCfgLoading(false);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) {
          setCfgError(true);
        }
        setCfgLoading(false);
      });
  }, []);

  // Zimmer + Buchungen laden sobald Config da
  useEffect(() => {
    if (!cfg || !page) return;
    setDataLoading(true);

    const zimmerEp = page.endpoints?.find(e => e.entity === 'zimmer' && e.op === 'list');
    const buchEp = page.endpoints?.find(e => e.entity === 'buchungen' && e.op === 'list');

    const loadZimmer = zimmerEp?.app_id
      ? import('@/lib/publicClient').then(m =>
          m.listPublicRecords(cfg, page, { appId: zimmerEp.app_id! })
        )
      : Promise.resolve<Record<string, PublicRecordResult>>({});

    const loadBuch = buchEp?.app_id
      ? import('@/lib/publicClient').then(m =>
          m.listPublicRecords(cfg, page, { appId: buchEp.app_id! })
        )
      : Promise.resolve<Record<string, PublicRecordResult>>({});

    Promise.all([loadZimmer, loadBuch])
      .then(([zMap, bMap]) => {
        setZimmerList(Object.values(zMap).map(parseZimmer));
        setBuchungenRaw(Object.values(bMap));
        setDataLoading(false);
      })
      .catch(() => setDataLoading(false));
  }, [cfg, page]);

  // Port + Formulare (alle Hooks vor Early Returns!)
  const port = useMemo(
    () => (cfg && page ? createPublicPort(cfg, page) : null),
    [cfg, page],
  );

  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true },
    steps: { vorname: 1, nachname: 1, email: 1, telefon: 1 },
    autoComplete: true,
  });

  const buchung = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'personen', 'bemerkung'],
    required: { zimmer: true, anreise: true, abreise: true },
    steps: { zimmer: 2, anreise: 3, abreise: 3, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  const submit = useJourneySubmit(
    // port kann null sein vor dem Laden — useJourneySubmit darf nicht mit null aufgerufen werden,
    // deshalb haben wir einen Dummy-Port-Guard:
    port ?? ({} as ReturnType<typeof createPublicPort>),
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

  // Early returns NACH allen Hooks
  if (cfgLoading) return <PublicShell loading />;
  if (cfgError || !cfg || !page || !port) return <PublicShell unavailable />;

  // Challenge vorbereiten beim ersten Klick
  const gasteEp = page.endpoints?.find(e => e.entity === 'gaeste' && e.op === 'create');
  const buchEpCreate = page.endpoints?.find(e => e.entity === 'buchungen' && e.op === 'create');
  function onFirstInteraction() {
    if (gasteEp?.app_id) prepareChallenge(cfg!, page!, 'POST', `/apps/${gasteEp.app_id}/records`);
    if (buchEpCreate?.app_id) prepareChallenge(cfg!, page!, 'POST', `/apps/${buchEpCreate.app_id}/records`);
  }

  // Gewähltes Zimmer ermitteln für Belegungskalender
  const selectedZimmerId = (buchung.get('zimmer') as string | null) ?? null;

  // Belegte Nächte für gewähltes Zimmer
  const blocked = occupancyFor(
    'buchungen',
    buchungenRaw.map(r => ({
      id: r.id,
      fields: r.fields,
      createdAt: r.created_at ?? null,
    })),
    { resource: selectedZimmerId ?? undefined },
  );

  // Zimmer als SelectItems
  const zimmerItems: SelectItem[] = zimmerList.map(z => ({
    id: z.id,
    title: z.bezeichnung,
    subtitle: [
      z.kategorieLabel,
      z.preis_pro_nacht != null
        ? tx`${z.preis_pro_nacht.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / Nacht`
        : null,
      z.balkon ? tx('Balkon') : null,
    ]
      .filter(Boolean)
      .join(' · '),
    icon: z.foto ? (
      <img
        src={z.foto}
        alt={z.bezeichnung}
        className="h-full w-full object-cover"
      />
    ) : undefined,
  }));

  const selectedZimmerItem = zimmerItems.find(z => z.id === selectedZimmerId) ?? null;

  function restart() {
    gast.reset();
    buchung.reset();
    submit.reset();
    setStep(1);
  }

  return (
    <PublicShell
      title={tx('Zimmer anfragen')}
      description={tx('Wählen Sie Ihr Zimmer und stellen Sie eine unverbindliche Buchungsanfrage.')}
    >
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div onFocus={onFirstInteraction} onClick={onFirstInteraction} role="presentation">
        <IntentWizardShell
          steps={STEPS}
          currentStep={step}
          onStepChange={setStep}
          back={false}
          forms={[gast, buchung]}
          draftKey="buchungsanfrage"
          loading={dataLoading}
        >
          {/* Schritt 1: Kontaktdaten */}
          {step === 1 && !submit.result && (
            <div className="space-y-4">
              <Field form={gast} name="vorname">
                <input {...gast.field('vorname')} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </Field>
              <Field form={gast} name="nachname">
                <input {...gast.field('nachname')} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </Field>
              <Field form={gast} name="email">
                <input {...gast.field('email')} type="email" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </Field>
              <Field form={gast} name="telefon">
                <input {...gast.field('telefon')} type="tel" className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
              </Field>
              <StepNav
                onNext={() => gast.validate(['vorname', 'nachname', 'email'])}
                nextStepLabel={tx('Zimmer wählen')}
                hideBack
              />
            </div>
          )}

          {/* Schritt 2: Zimmer wählen */}
          {step === 2 && !submit.result && (
            <div className="space-y-4">
              <EntitySelectStep
                items={zimmerItems}
                selectedId={selectedZimmerId}
                onSelect={id => {
                  const z = zimmerList.find(z => z.id === id);
                  buchung.set('zimmer', id, z?.bezeichnung ?? id);
                }}
                avatar="none"
                columns={1}
                searchPlaceholder={tx('Zimmer suchen …')}
                emptyText={tx('Keine Zimmer verfügbar.')}
              />
              {selectedZimmerItem && (
                <p className="text-sm text-muted-foreground">
                  {tx('Gewählt')}: <strong>{selectedZimmerItem.title}</strong>
                </p>
              )}
              <StepNav
                onBack={() => setStep(1)}
                onNext={() => buchung.validate(['zimmer'])}
                nextStepLabel={tx('Zeitraum wählen')}
              />
            </div>
          )}

          {/* Schritt 3: Zeitraum wählen */}
          {step === 3 && !submit.result && (
            <div className="space-y-4">
              {!selectedZimmerId && (
                <p className="text-sm text-amber-600">
                  {tx('Bitte zuerst ein Zimmer wählen.')}
                </p>
              )}
              <AvailabilityRangePicker
                {...buchung.range('anreise', 'abreise', { blocked, minNights: 1 })}
              />
              <Field form={buchung} name="personen">
                <input
                  {...buchung.number('personen')}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </Field>
              <Field form={buchung} name="bemerkung">
                <Bound form={buchung} name="bemerkung" rows={3} />
              </Field>
              <StepNav
                onBack={() => setStep(2)}
                onNext={() => buchung.validate(['anreise', 'abreise'])}
                nextStepLabel={tx('Prüfen & absenden')}
              />
            </div>
          )}

          {/* Schritt 4: Bestätigung / Zusammenfassung */}
          {step === 4 && !submit.result && (
            <SummaryStep
              forms={[gast, buchung]}
              submit={submit}
              whatHappensNext={tx('Wir prüfen Ihre Anfrage und melden uns innerhalb eines Werktages per E-Mail.')}
            />
          )}

          {/* Erfolgsseite */}
          {submit.result && (
            <SuccessStep
              result={submit.result}
              forms={[gast, buchung]}
              whatHappensNext={tx('Wir prüfen Ihre Anfrage und melden uns innerhalb eines Werktages per E-Mail.')}
              next={[{ label: tx('Neue Anfrage stellen'), onClick: restart }]}
              submit={submit}
              restartLabel={tx('Neue Anfrage stellen')}
            />
          )}
        </IntentWizardShell>
      </div>
    </PublicShell>
  );
}
