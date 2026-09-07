import { useEffect, useMemo, useState } from 'react';
import { tx } from '@/i18n';
import {
  loadPublicPagesConfig,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
  type PublicRecordResult,
} from '@/lib/publicClient';
import { PublicShell } from '@/components/PublicShell';
import { IntentWizardShell } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Field } from '@/components/blocks/Field';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Bound } from '@/components/blocks/Bound';
import {
  useStepForm,
  useJourneySubmit,
  useOccupancy,
  useRecordSearch,
  occupancyFor,
  fieldText,
  fieldNumber,
  fieldLookup,
  fieldRef,
} from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import type { JourneyRecord } from '@/lib/journey';
import { IconBed, IconStar, IconUsers, IconBuildingSkyscraper } from '@tabler/icons-react';

// ─── Wizard step definitions ──────────────────────────────────────────────────

// ─── Inner page (rendered after cfg + page are loaded) ────────────────────────

interface InnerProps {
  cfg: PublicPagesConfig;
  page: PublicPageConfig;
}

function BuchungsanfrageInner({ cfg, page }: InnerProps) {
  const STEPS = [
  {
    label: tx('Zeitraum'),
    key: 'zeitraum',
    heading: tx('Zeitraum wählen'),
    description: tx('An- und Abreisedatum wählen — belegte Nächte sind gesperrt.'),
  },
  {
    label: tx('Zimmer'),
    key: 'zimmer',
    heading: tx('Zimmer wählen'),
    description: tx('Nur Zimmer, die im gewählten Zeitraum frei sind.'),
  },
  {
    label: tx('Kontakt'),
    key: 'kontakt',
    heading: tx('Ihre Kontaktdaten'),
    description: tx('Damit wir Ihre Anfrage bearbeiten und bestätigen können.'),
  },
  {
    label: tx('Prüfen'),
    key: 'pruefen',
  },
];

  const port = useMemo(() => createPublicPort(cfg, page), [cfg, page]);

  // ── Forms ──────────────────────────────────────────────────────────────────
  const buchung = useStepForm('buchungen', {
    fields: ['anreise', 'abreise', 'zimmer', 'personen', 'bemerkung'],
    required: { anreise: true, abreise: true, zimmer: true },
    steps: { anreise: 1, abreise: 1, zimmer: 2, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: true },
    steps: { vorname: 3, nachname: 3, email: 3, telefon: 3 },
    autoComplete: true,
  });

  // ── Wizard step ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);

  // ── Occupancy — buchungen list endpoint provides blocking records ──────────
  const occupancy = useOccupancy(port, 'buchungen');

  // ── Room search — zimmer list endpoint, filter by free in selected range ───
  const selectedZimmerId = buchung.get('zimmer') as string | null;
  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;

  const zimmerSearch = useRecordSearch(port, 'zimmer', {
    searchFields: ['bezeichnung'],
    orderby: ['r.v_bezeichnung asc'],
    where: occupancy.freeIn(anreise, abreise),
    toItem: (r: JourneyRecord) => ({
      id: r.id,
      title: fieldText(r, 'bezeichnung'),
      subtitle: (() => {
        const kat = fieldLookup(r, 'kategorie');
        const preis = fieldNumber(r, 'preis_pro_nacht');
        const etage = fieldNumber(r, 'etage');
        const balkon = r.fields.balkon as boolean | null;
        const parts: string[] = [];
        if (kat?.label) parts.push(kat.label);
        if (etage !== null) parts.push(tx`Etage ${etage}`);
        if (balkon) parts.push(tx('Balkon'));
        if (preis !== null) parts.push(tx`${preis} €/Nacht`);
        return parts.join(' · ');
      })(),
      icon: <IconBed size={20} className="text-muted-foreground shrink-0" />,
    }),
  });

  // ── Submit plan: create gast first, then link it to buchung ───────────────
  const submit = useJourneySubmit(
    port,
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
    { draftKey: 'buchungsanfrage' }
  );

  // ── Blocked nights from occupancy ─────────────────────────────────────────
  const blocked = useMemo(
    () => occupancyFor('buchungen', occupancy.blocked.map(b => ({
      id: '',
      fields: { anreise: b.start, abreise: b.end ?? null, status: 'bestaetigt', zimmer: null },
      createdAt: null,
    } as JourneyRecord)), { resource: selectedZimmerId }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [occupancy.blocked, selectedZimmerId]
  );

  // ── Restart ────────────────────────────────────────────────────────────────
  function restart() {
    submit.reset();
    buchung.reset();
    gast.reset();
    setStep(1);
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <IntentWizardShell
      steps={STEPS}
      currentStep={step}
      onStepChange={setStep}
      back={false}
      forms={[buchung, gast]}
      draftKey="buchungsanfrage"
      intro={{
        description: tx('Wählen Sie Zeitraum und Zimmer — wir bestätigen Ihre Anfrage per E-Mail.'),
        needs: [tx('An- und Abreisedatum'), tx('Wunschzimmer'), tx('Kontaktdaten')],
        estimatedMinutes: 3,
      }}
      loading={occupancy.loading}
      error={occupancy.error ? new Error(occupancy.error) : null}
      onRetry={occupancy.reload}
    >
      {/* ── Schritt 1: Zeitraum ── */}
      {step === 1 && !submit.done && (
        <div className="space-y-6">
          <Field form={buchung} name="anreise" label={tx('Zeitraum')}>
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', { blocked, minNights: 1 })}
            />
          </Field>
          <StepNav
            onNext={() => buchung.validate(['anreise', 'abreise'])}
            nextStepLabel={tx('Zimmer')}
            hideBack
          />
        </div>
      )}

      {/* ── Schritt 2: Zimmer ── */}
      {step === 2 && !submit.done && (
        <div className="space-y-6">
          <EntitySelectStep
            {...zimmerSearch.select}
            selectedId={selectedZimmerId}
            onSelect={(id) => {
              const label = zimmerSearch.labelOf(id) ?? id;
              buchung.set('zimmer', id, label);
            }}
            avatar="none"
            columns={2}
            searchPlaceholder={tx('Zimmer suchen…')}
            emptyIcon={<IconBed size={32} className="text-muted-foreground" />}
            emptyText={
              anreise && abreise
                ? tx('Für den gewählten Zeitraum sind keine Zimmer verfügbar.')
                : tx('Bitte zuerst den Zeitraum wählen.')
            }
          />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => buchung.validate(['zimmer'])}
            nextStepLabel={tx('Kontakt')}
          />
        </div>
      )}

      {/* ── Schritt 3: Kontaktdaten ── */}
      {step === 3 && !submit.done && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Bound form={gast} name="vorname" />
            <Bound form={gast} name="nachname" />
          </div>
          <Bound form={gast} name="email" />
          <Bound form={gast} name="telefon" />

          <div className="border-t pt-4 space-y-4">
            <Field form={buchung} name="personen">
              <div className="flex items-center gap-2">
                <IconUsers size={16} className="text-muted-foreground shrink-0" />
                <input
                  {...buchung.number('personen')}
                  className="border rounded px-3 py-2 w-full text-sm"
                  placeholder={tx('z. B. 2')}
                  min={1}
                />
              </div>
            </Field>
            <Bound form={buchung} name="bemerkung" rows={3} />
          </div>

          <StepNav
            onBack={() => setStep(2)}
            onNext={() =>
              gast.validate(['vorname', 'nachname', 'email']) &&
              buchung.validate(['personen'])
            }
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      )}

      {/* ── Schritt 4: Zusammenfassung ── */}
      {step === 4 && !submit.done && (
        <SummaryStep
          forms={[buchung, gast]}
          submit={submit}
          whatHappensNext={tx('Wir melden uns innerhalb von 24 Stunden per E-Mail, um Ihre Anfrage zu bestätigen.')}
          confirmLabel={tx('Anfrage absenden')}
        />
      )}

      {/* ── Erfolg ── */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung, gast]}
          whatHappensNext={tx('Wir melden uns innerhalb von 24 Stunden per E-Mail, um Ihre Anfrage zu bestätigen.')}
          next={[{ label: tx('Weitere Anfrage stellen'), onClick: restart }]}
          referencePrefix="BA"
          submit={submit}
        />
      )}
    </IntentWizardShell>
  );
}

// ─── Public page shell (loads config, handles unavailable) ────────────────────

export default function Buchungsanfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig('buchungsanfrage')
      .then((c) => {
        setCfg(c);
        setPage(c?.pages['buchungsanfrage'] ?? null);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  if (loading || unavailable || !cfg || !page) {
    return <PublicShell loading={loading} unavailable={!loading} />;
  }

  return (
    <PublicShell
      title={tx('Zimmer anfragen')}
      description={tx('Prüfen Sie die Verfügbarkeit und stellen Sie eine unverbindliche Buchungsanfrage.')}
    >
      <BuchungsanfrageInner cfg={cfg} page={page} />
    </PublicShell>
  );
}
