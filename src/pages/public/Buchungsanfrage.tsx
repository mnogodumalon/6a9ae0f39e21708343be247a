import { useEffect, useMemo, useState } from 'react';
import { PublicShell } from '@/components/PublicShell';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Input } from '@/components/ui/input';
import { tx } from '@/i18n';
import type { SummaryItem } from '@/lib/journey';
import {
  loadPublicPagesConfig,
  createPublicRecord,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { useStepForm, useJourneySubmit, clearJourneyDraft } from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';

const SLUG = 'buchungsanfrage';
const GAESTE_APP_ID = '6a9ae0d06909bb394e9727fd';
const BUCHUNGEN_APP_ID = '6a9ae0d693daa9eb8f498b3a';

const KATEGORIEN = [
  { key: 'einzelzimmer', label: tx('Einzelzimmer') },
  { key: 'doppelzimmer', label: tx('Doppelzimmer') },
  { key: 'suite', label: tx('Suite') },
] as const;

type KategKey = typeof KATEGORIEN[number]['key'];

export default function Buchungsanfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [step, setStep] = useState(1);
  const [kategorie, setKategorie] = useState<KategKey | null>(null);

  useEffect(() => {
    loadPublicPagesConfig(SLUG).then(c => {
      if (!c || !c.pages[SLUG]) {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      setCfg(c);
      setPage(c.pages[SLUG]);
      setLoading(false);
    }).catch(e => {
      if (e instanceof PageUnavailableError) setUnavailable(true);
      setLoading(false);
    });
  }, []);

  const port = useMemo(() => (cfg && page ? createPublicPort(cfg, page) : null), [cfg, page]);

  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 1, nachname: 1, email: 1, telefon: 1 },
    autoComplete: true,
  });

  const buchung = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'bemerkung'],
    required: { zimmer: false, anreise: true, abreise: true, bemerkung: false },
    steps: { zimmer: 2, anreise: 2, abreise: 2, bemerkung: 2 },
    autoComplete: true,
  });

  const submit = useJourneySubmit(
    port ?? {
      door: 'public' as const,
      async list() { return []; },
      async count() { return null; },
      async get() { return null; },
      async create() { return { id: '', fields: {}, createdAt: null }; },
      ref() { return ''; },
    },
    useMemo(() => {
      if (!cfg || !page) return [];
      const gasteEp = page.endpoints?.find(e => e.op === 'create' && e.app_id === GAESTE_APP_ID);
      return [
        {
          key: 'gast',
          label: tx('Gast anlegen'),
          run: async () => {
            const gastPage: PublicPageConfig = {
              ...page,
              entity: 'gaeste',
              app_id: GAESTE_APP_ID,
              fields: gasteEp?.fields ?? page.fields,
              endpoints: page.endpoints,
            };
            const vals = gast.payload();
            const result = await createPublicRecord(cfg, gastPage, vals);
            return { id: result.id, fields: result.fields as Record<string, unknown>, createdAt: result.created_at };
          },
        },
        {
          key: 'buchung',
          label: tx('Buchungsanfrage erstellen'),
          entity: 'buchungen' as const,
          primary: true,
          needs: ['gast'],
          form: buchung,
          values: (ctx) => {
            const gastId = ctx.done['gast']?.id ?? '';
            const katLabel = KATEGORIEN.find(k => k.key === kategorie)?.label ?? '';
            const bemerkungs = buchung.values['bemerkung'] as string | undefined;
            const bemerkungFull = [
              kategorie ? tx`Zimmerkategorie: ${katLabel}` : '',
              bemerkungs ?? '',
            ].filter(Boolean).join('\n');
            return {
              gast: gastId,
              bemerkung: bemerkungFull || undefined,
            };
          },
        },
      ];
    }, [cfg, page, gast, buchung, kategorie]),
    { draftKey: SLUG },
  );

  const handleFocus = () => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'create' && e.app_id === GAESTE_APP_ID);
    if (ep) {
      prepareChallenge(cfg, { ...page, app_id: GAESTE_APP_ID }, 'POST', `/apps/${GAESTE_APP_ID}/records`);
    }
    prepareChallenge(cfg, page, 'POST', `/apps/${BUCHUNGEN_APP_ID}/records`);
  };

  const restart = () => {
    gast.reset();
    buchung.reset();
    setKategorie(null);
    setStep(1);
    submit.reset();
    clearJourneyDraft(SLUG);
  };

  if (loading || unavailable) {
    return <PublicShell loading={loading} unavailable={unavailable} />;
  }

  return (
    <PublicShell title={tx('Zimmer anfragen')} description={tx('Stellen Sie Ihre Buchungsanfrage — wir melden uns schnellstmöglich.')}>
      <div onFocus={handleFocus}>
        <IntentWizardShell
          currentStep={step}
          onStepChange={setStep}
          back={false}
          forms={[gast, buchung]}
          draftKey={SLUG}
          intro={{
            description: tx('Jetzt Zimmer anfragen — in 3 Schritten zur Buchungsanfrage.'),
            estimatedMinutes: 2,
          }}
        >
          <WizardStep
            label={tx('Kontaktdaten')}
            description={tx('Ihre Kontaktdaten — wir nutzen sie nur für diese Anfrage.')}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field form={gast} name="email">
                  <Input {...gast.field('email')} />
                </Field>
                <Field form={gast} name="telefon">
                  <Input {...gast.field('telefon')} />
                </Field>
              </div>
            </div>
            <StepNav
              onNext={() => gast.validate(['vorname', 'nachname'])}
              nextStepLabel={tx('Zeitraum wählen')}
            />
          </WizardStep>

          <WizardStep
            label={tx('Zeitraum & Zimmer')}
            description={tx('Wählen Sie Ihre Wunsch-Zimmerkategorie und den Aufenthaltszeitraum.')}
          >
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium mb-2">
                  {tx('Zimmerkategorie')}
                  <span aria-hidden="true" className="text-muted-foreground"> *</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {KATEGORIEN.map(k => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => setKategorie(k.key)}
                      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        kategorie === k.key
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-card border-border text-foreground hover:bg-muted'
                      }`}
                      aria-pressed={kategorie === k.key}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Bound form={buchung} name="anreise" as="date" />
                <Bound form={buchung} name="abreise" as="date" />
              </div>

              <Bound form={buchung} name="bemerkung" as="textarea" rows={3} hint={tx('Besondere Wünsche, Allergien oder Anmerkungen (optional)')} />
            </div>
            <StepNav
              onNext={() => {
                if (!kategorie) return tx('Bitte eine Zimmerkategorie auswählen.');
                return buchung.validate(['anreise', 'abreise']);
              }}
              nextStepLabel={tx('Prüfen & Absenden')}
            />
          </WizardStep>

          <WizardStep label={tx('Prüfen & Absenden')}>
            {!submit.result && (
              <SummaryStep
                forms={[gast, buchung]}
                submit={submit}
                items={kategorie ? ([{ key: 'zimmerkategorie', label: tx('Zimmerkategorie'), value: KATEGORIEN.find(k => k.key === kategorie)?.label ?? '', keys: ['zimmerkategorie'], fieldId: 'zimmerkategorie', step: 2 }] satisfies SummaryItem[]) : []}
                whatHappensNext={tx('Wir prüfen die Verfügbarkeit und melden uns schnellstmöglich per E-Mail oder Telefon.')}
                confirmLabel={tx('Anfrage absenden')}
              />
            )}
          </WizardStep>

          {submit.result && (
            <SuccessStep
              result={submit.result}
              forms={[gast, buchung]}
              title={tx('Anfrage eingegangen!')}
              whatHappensNext={tx('Wir prüfen die Verfügbarkeit und melden uns schnellstmöglich bei Ihnen.')}
              next={[{ label: tx('Weitere Anfrage stellen'), onClick: restart }]}
              referencePrefix="A"
            />
          )}
        </IntentWizardShell>
      </div>
    </PublicShell>
  );
}
