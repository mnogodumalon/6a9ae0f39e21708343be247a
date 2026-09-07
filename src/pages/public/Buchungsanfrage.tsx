import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  listPublicRecords,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { createPublicPort } from '@/lib/journey/publicPort';
import { JourneyPortError, useStepForm, useJourneySubmit, occupancyFor, type JourneyPort } from '@/lib/journey';
import { IntentWizardShell, type WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { EntitySelectStep, type SelectItem } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Field } from '@/components/blocks/Field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { tx } from '@/i18n';
import { IconBed, IconBuilding, IconUsers } from '@tabler/icons-react';

const SLUG = 'buchungsanfrage';

interface ZimmerRecord {
  id: string;
  bezeichnung: string;
  kategorie: string | null;
  preis_pro_nacht: number | null;
  etage: number | null;
  balkon: boolean | null;
  foto: string | null;
}

interface BuchungRecord {
  id: string;
  zimmer: unknown;
  anreise: string | null;
  abreise: string | null;
  status: string | null;
}

function katLabel(key: string | null): string {
  if (key === 'einzelzimmer') return 'Einzelzimmer';
  if (key === 'doppelzimmer') return 'Doppelzimmer';
  if (key === 'suite') return 'Suite';
  return key ?? '';
}

export default function Buchungsanfrage() {
  const STEPS: WizardStep[] = [
  { label: tx('Zimmer wählen') },
  { label: tx('Reisezeitraum') },
  { label: tx('Kontaktdaten') },
  { label: tx('Prüfen') },
];

  const PENDING_PORT: JourneyPort = {
  door: 'public',
  list: async () => { throw new JourneyPortError(tx('public page config not loaded yet')); },
  count: async () => null,
  get: async () => null,
  create: async () => { throw new JourneyPortError(tx('public page config not loaded yet')); },
  ref: (appId, id) => `/apps/${appId}/records/${id}`,
};

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState(1);

  const [zimmerList, setZimmerList] = useState<ZimmerRecord[]>([]);
  const [buchungen, setBuchungen] = useState<BuchungRecord[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        if (!c) { setUnavailable(true); setLoading(false); return; }
        const p = c.pages[SLUG] ?? null;
        if (!p) { setUnavailable(true); setLoading(false); return; }
        setCfg(c);
        setPage(p);
        setLoading(false);

        const zimmerEp = p.endpoints?.find(e => e.op === 'list' && e.entity === 'zimmer');
        const buchEp = p.endpoints?.find(e => e.op === 'list' && e.entity === 'buchungen');

        Promise.all([
          zimmerEp
            ? listPublicRecords(c, p, { appId: zimmerEp.app_id, limit: 100 })
            : Promise.resolve<Record<string, { id: string; fields: Record<string, unknown>; created_at: string | null; updated_at: string | null }>>({ }),
          buchEp
            ? listPublicRecords(c, p, { appId: buchEp.app_id, limit: 500 })
            : Promise.resolve<Record<string, { id: string; fields: Record<string, unknown>; created_at: string | null; updated_at: string | null }>>({ }),
        ]).then(([zMap, bMap]) => {
          setZimmerList(
            Object.values(zMap).map(r => ({
              id: r.id,
              bezeichnung: (r.fields.bezeichnung as string) ?? '',
              kategorie: (r.fields.kategorie as string) ?? null,
              preis_pro_nacht: (r.fields.preis_pro_nacht as number) ?? null,
              etage: (r.fields.etage as number) ?? null,
              balkon: (r.fields.balkon as boolean) ?? null,
              foto: (r.fields.foto as string) ?? null,
            }))
          );
          setBuchungen(
            Object.values(bMap).map(r => ({
              id: r.id,
              zimmer: r.fields.zimmer,
              anreise: (r.fields.anreise as string) ?? null,
              abreise: (r.fields.abreise as string) ?? null,
              status: (r.fields.status as string) ?? null,
            }))
          );
          setDataLoaded(true);
        });
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : PENDING_PORT), [cfg, page]);

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

  const selectedZimmerId = buchung.get('zimmer') as string | null | undefined;

  const blocked = useMemo(() => {
    if (!selectedZimmerId) return [];
    return occupancyFor(
      'buchungen',
      buchungen.map(b => ({
        fields: { zimmer: b.zimmer, anreise: b.anreise, abreise: b.abreise, status: b.status },
      })),
      { resource: selectedZimmerId }
    );
  }, [buchungen, selectedZimmerId]);

  const submit = useJourneySubmit(port, [
    { key: 'gast', entity: 'gaeste', form: gast },
    {
      key: 'buchung',
      entity: 'buchungen',
      form: buchung,
      primary: true,
      needs: ['gast'],
      link: { gast: 'gast' },
    },
  ], { draftKey: 'buchungsanfrage' });

  if (loading || (!unavailable && !dataLoaded)) {
    return <PublicShell loading={true} />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable={true} />;
  }

  const zimmerItems: SelectItem[] = zimmerList.map(z => ({
    id: z.id,
    title: z.bezeichnung,
    subtitle: katLabel(z.kategorie),
    stats: [
      ...(z.preis_pro_nacht != null ? [{ label: tx('Preis'), value: `${z.preis_pro_nacht} €` }] : []),
      ...(z.etage != null ? [{ label: tx('Etage'), value: String(z.etage) }] : []),
      ...(z.balkon ? [{ label: tx('Balkon'), value: tx('ja') }] : []),
    ],
    icon: z.foto
      ? <img src={z.foto} alt={z.bezeichnung} className="w-full h-full object-cover rounded-xl" />
      : <IconBed size={22} />,
  }));

  const handleZimmerSelect = (id: string) => {
    const found = zimmerList.find(z => z.id === id);
    buchung.set('zimmer', id, found?.bezeichnung);
    // reset dates when room changes
    buchung.set('anreise', null);
    buchung.set('abreise', null);
    if (cfg && page) prepareChallenge(cfg, page, 'POST', `/apps/${page.endpoints?.find(e => e.op === 'create' && e.entity === 'buchungen')?.app_id}/records`);
  };

  const restart = () => {
    gast.reset();
    buchung.reset();
    submit.reset();
    setStep(1);
  };

  return (
    <PublicShell title={tx('Zimmer anfragen')} description={tx('Wähle dein Wunschzimmer, prüfe die Verfügbarkeit und hinterlasse uns deine Kontaktdaten.')}>
      <IntentWizardShell
        steps={STEPS}
        currentStep={step}
        onStepChange={setStep}
        back={false}
        forms={[gast, buchung]}
        draftKey="buchungsanfrage"
      >
        {/* Schritt 1: Zimmer wählen */}
        {step === 1 && !submit.result && (
          <div className="space-y-4">
            <EntitySelectStep
              items={zimmerItems}
              selectedId={selectedZimmerId ?? null}
              onSelect={handleZimmerSelect}
              avatar="none"
              create={false}
              emptyIcon={<IconBuilding size={48} />}
              emptyText={tx('Momentan sind keine Zimmer verfügbar.')}
              searchPlaceholder={tx('Zimmer suchen …')}
            />
            <StepNav
              onNext={() => {
                if (!buchung.validate(['zimmer'])) return;
                setStep(2);
              }}
              nextStepLabel={tx('Weiter zu Zeitraum')}
            />
          </div>
        )}

        {/* Schritt 2: Reisezeitraum */}
        {step === 2 && !submit.result && (
          <div className="space-y-4">
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', { blocked })}
              legend={tx('Belegte Nächte sind durchgestrichen und nicht wählbar.')}
            />
            <Field form={buchung} name="personen">
              <Input {...buchung.field('personen')} placeholder="1" />
            </Field>
            <StepNav
              onNext={() => {
                if (!buchung.validate(['anreise', 'abreise'])) return;
                setStep(3);
              }}
              nextStepLabel={tx('Weiter zu Kontakt')}
            />
          </div>
        )}

        {/* Schritt 3: Kontaktdaten */}
        {step === 3 && !submit.result && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field form={gast} name="vorname">
                <Input {...gast.field('vorname')} placeholder={tx('z. B. Maria')} />
              </Field>
              <Field form={gast} name="nachname">
                <Input {...gast.field('nachname')} placeholder={tx('z. B. Muster')} />
              </Field>
            </div>
            <Field form={gast} name="email">
              <Input {...gast.field('email')} placeholder={tx('z. B. maria@beispiel.de')} />
            </Field>
            <Field form={gast} name="telefon">
              <Input {...gast.field('telefon')} placeholder={tx('z. B. +49 170 123 4567')} />
            </Field>
            <Field form={buchung} name="bemerkung">
              <Textarea {...buchung.field('bemerkung')} rows={3} placeholder={tx('Besondere Wünsche, Anreisezeit …')} />
            </Field>
            <StepNav
              onNext={() => {
                if (!gast.validate(['vorname', 'nachname', 'email', 'telefon'])) return;
                setStep(4);
              }}
              nextStepLabel={tx('Zur Überprüfung')}
            />
          </div>
        )}

        {/* Schritt 4: Zusammenfassung */}
        {step === 4 && !submit.result && (
          <SummaryStep
            forms={[buchung, gast]}
            submit={submit}
            whatHappensNext={tx('Wir melden uns innerhalb eines Werktages per E-Mail oder Telefon mit einer Bestätigung.')}
            confirmLabel={tx('Anfrage absenden')}
            items={[
              {
                key: 'zimmer_name',
                keys: ['zimmer'],
                label: tx('Zimmer'),
                value: zimmerList.find(z => z.id === selectedZimmerId)?.bezeichnung ?? '—',
                step: 1,
              },
            ]}
          />
        )}

        {/* Erfolgsmeldung */}
        {submit.result && (
          <SuccessStep
            result={submit.result}
            forms={[buchung, gast]}
            next={[
              {
                label: tx('Weitere Anfrage stellen'),
                onClick: restart,
                icon: <IconUsers size={16} />,
              },
            ]}
          />
        )}
      </IntentWizardShell>
    </PublicShell>
  );
}
