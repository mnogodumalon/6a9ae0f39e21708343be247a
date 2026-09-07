import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import {
  loadPublicPagesConfig,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { tx } from '@/i18n';
import {
  useStepForm,
  useJourneySubmit,
  occupancyFor,
} from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import type { JourneyPort } from '@/lib/journey/port';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { EntitySelectStep, type SelectItem } from '@/components/blocks/EntitySelectStep';
import { Field } from '@/components/blocks/Field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { IconBed, IconPhoto } from '@tabler/icons-react';

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
  fields: Record<string, unknown>;
}

export default function Buchungsanfrage() {
  const DISABLED_PORT: JourneyPort = {
  door: 'public',
  list: () => Promise.resolve([]),
  count: () => Promise.resolve(null),
  get: () => Promise.resolve(null),
  create: () => Promise.reject(new Error(tx('port not ready'))),
  ref: () => '',
};

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState(1);

  const [zimmerList, setZimmerList] = useState<ZimmerRecord[]>([]);
  const [buchungenList, setBuchungenList] = useState<BuchungRecord[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        const p = c?.pages[SLUG] ?? null;
        setPage(p);
        setLoading(false);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  const port = useMemo(
    () => (cfg && page ? createPublicPort(cfg, page) : null),
    [cfg, page],
  );

  useEffect(() => {
    if (!port) return;
    let cancelled = false;
    Promise.all([
      port.list('zimmer'),
      port.list('buchungen'),
    ]).then(([zRows, bRows]) => {
      if (cancelled) return;
      setZimmerList(zRows.map(r => ({
        id: r.id,
        bezeichnung: (r.fields.bezeichnung as string) ?? '',
        kategorie: (r.fields.kategorie as string) ?? null,
        preis_pro_nacht: (r.fields.preis_pro_nacht as number) ?? null,
        etage: (r.fields.etage as number) ?? null,
        balkon: (r.fields.balkon as boolean) ?? null,
        foto: (r.fields.foto as string) ?? null,
      })));
      setBuchungenList(bRows.map(r => ({ id: r.id, fields: r.fields })));
      setDataLoaded(true);
    });
    return () => { cancelled = true; };
  }, [port]);

  // Forms
  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 1, nachname: 1, email: 1, telefon: 1 },
    autoComplete: true,
  });

  const buchung = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'personen', 'bemerkung'],
    required: { zimmer: true, anreise: true, abreise: true, personen: false, bemerkung: false },
    steps: { zimmer: 2, anreise: 3, abreise: 3, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  const submit = useJourneySubmit(port ?? DISABLED_PORT, [
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

  const selectedZimmerId = buchung.get('zimmer') as string | null | undefined;

  const blocked = useMemo(
    () => occupancyFor('buchungen', buchungenList, { resource: selectedZimmerId ?? undefined }),
    [buchungenList, selectedZimmerId],
  );

  const zimmerItems: SelectItem[] = useMemo(
    () => zimmerList.map(z => {
      const stats: { label: string; value: string | number }[] = [];
      if (z.preis_pro_nacht != null) stats.push({ label: tx('Preis/Nacht'), value: `${z.preis_pro_nacht} €` });
      if (z.etage != null) stats.push({ label: tx('Etage'), value: z.etage });
      if (z.balkon != null) stats.push({ label: tx('Balkon'), value: z.balkon ? tx('Ja') : tx('Nein') });
      return {
        id: z.id,
        title: z.bezeichnung,
        subtitle: z.kategorie ?? undefined,
        icon: z.foto
          ? <img src={z.foto} alt={z.bezeichnung} className="w-full h-full object-cover rounded-xl" />
          : <IconBed size={22} />,
        stats,
      };
    }),
    [zimmerList],
  );

  const restart = () => {
    gast.reset();
    buchung.reset();
    setStep(1);
  };

  if (loading || (!loading && !unavailable && !cfg)) {
    return <PublicShell loading={true} />;
  }
  if (unavailable || !cfg || !page) {
    return <PublicShell unavailable={true} />;
  }

  const handleFirstInteraction = () => {
    const ep = page.endpoints?.find(e => e.op === 'create' && e.entity === 'buchungen');
    if (ep?.app_id && cfg) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  };

  return (
    <PublicShell title={tx('Zimmer anfragen')} description={tx('Stellen Sie Ihre Buchungsanfrage in wenigen Schritten.')}>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onFocus={handleFirstInteraction} onClick={handleFirstInteraction}>
        <IntentWizardShell
          currentStep={step}
          onStepChange={setStep}
          back={false}
          forms={[gast, buchung]}
          draftKey="buchungsanfrage"
          loading={!dataLoaded && !submit?.result}
        >
          {/* Step 1: Kontaktdaten */}
          <WizardStep
            label={tx('Kontaktdaten')}
            heading={tx('Ihre Kontaktdaten')}
            description={tx('Damit wir Ihre Anfrage bearbeiten können.')}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field form={gast} name="vorname">
                  <Input {...gast.field('vorname')} />
                </Field>
                <Field form={gast} name="nachname">
                  <Input {...gast.field('nachname')} />
                </Field>
              </div>
              <Field form={gast} name="email">
                <Input {...gast.field('email')} type="email" />
              </Field>
              <Field form={gast} name="telefon">
                <Input {...gast.field('telefon')} type="tel" />
              </Field>
            </div>
            <StepNav
              onNext={() => gast.validate(['vorname', 'nachname'])}
              nextStepLabel={tx('Zimmer wählen')}
            />
          </WizardStep>

          {/* Step 2: Zimmer wählen */}
          <WizardStep
            label={tx('Zimmer wählen')}
            heading={tx('Zimmer auswählen')}
            description={tx('Wählen Sie ein Zimmer aus. Die Verfügbarkeit sehen Sie im nächsten Schritt.')}
          >
            <Field form={buchung} name="zimmer" label={tx('Zimmer')}>
              <EntitySelectStep
                items={zimmerItems}
                avatar="none"
                selectedId={selectedZimmerId ?? null}
                onSelect={(id) => {
                  const z = zimmerList.find(z => z.id === id);
                  buchung.set('zimmer', id, z?.bezeichnung ?? id);
                }}
                create={false}
                emptyIcon={<IconPhoto size={48} />}
                emptyText={tx('Keine Zimmer verfügbar.')}
                columns={2}
              />
            </Field>
            <StepNav
              onNext={() => buchung.validate(['zimmer'])}
              nextStepLabel={tx('Zeitraum wählen')}
            />
          </WizardStep>

          {/* Step 3: Zeitraum wählen */}
          <WizardStep
            label={tx('Zeitraum')}
            heading={tx('Reisezeitraum wählen')}
            description={tx('Belegte Nächte sind ausgegraut und nicht buchbar.')}
            needs={['zimmer']}
          >
            <div className="space-y-4">
              <AvailabilityRangePicker
                {...buchung.range('anreise', 'abreise', { blocked })}
              />
              <Field form={buchung} name="personen">
                <Input {...buchung.field('personen')} type="number" min={1} />
              </Field>
              <Field form={buchung} name="bemerkung">
                <Textarea {...buchung.field('bemerkung')} rows={3} />
              </Field>
            </div>
            <StepNav
              onNext={() => buchung.validate(['anreise', 'abreise'])}
              nextStepLabel={tx('Zusammenfassung')}
            />
          </WizardStep>

          {/* Step 4: Zusammenfassung */}
          <WizardStep label={tx('Zusammenfassung')}>
            {submit && !submit.result && (
              <SummaryStep
                forms={[gast, buchung]}
                submit={submit}
                whatHappensNext={tx('Wir prüfen Ihre Anfrage und melden uns so schnell wie möglich per E-Mail oder Telefon.')}
                confirmLabel={tx('Anfrage absenden')}
              />
            )}
          </WizardStep>

          {/* Erfolg */}
          {submit?.result && (
            <SuccessStep
              result={submit.result}
              forms={[gast, buchung]}
              whatHappensNext={tx('Wir prüfen Ihre Anfrage und melden uns so schnell wie möglich per E-Mail oder Telefon.')}
              next={[
                { label: tx('Weitere Anfrage stellen'), onClick: restart },
              ]}
            />
          )}
        </IntentWizardShell>
      </div>
    </PublicShell>
  );
}
