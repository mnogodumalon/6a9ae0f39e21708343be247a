/**
 * Buchungsanfrage — Öffentliche Buchungsanfrage für Pension Seeblick.
 *
 * Ablauf (4 Schritte):
 *   1. Zeitraum wählen — An- und Abreisedatum via AvailabilityRangePicker
 *   2. Zimmer wählen — nur freie Zimmer im gewählten Zeitraum
 *   3. Kontaktdaten — Vorname, Nachname, E-Mail, Telefon, Personen, Bemerkung
 *   4. Zusammenfassung + Absenden
 *
 * Schreibt zwei Records: erst einen Gäste-Eintrag, dann eine Buchung
 * mit Status 'angefragt' und Verweis auf den neuen Gast.
 */
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
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Field } from '@/components/blocks/Field';
import { createPublicPort } from '@/lib/journey/publicPort';
import { useStepForm } from '@/lib/journey/useStepForm';
import { useJourneySubmit } from '@/lib/journey/useJourneySubmit';
import { occupancyFor } from '@/lib/journey/occupancy';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { tx } from '@/i18n';
import { IconBed, IconCheck } from '@tabler/icons-react';

const SLUG = 'buchungsanfrage';

// ─── Zimmer-Typ aus der öffentlichen List-Response ───────────────────────────

interface ZimmerRecord {
  id: string;
  bezeichnung: string;
  kategorie: string | null;
  preis_pro_nacht: number | null;
}

function formatPreis(preis: number | null): string {
  if (preis === null) return '';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(preis);
}

// ─── Hauptkomponente ─────────────────────────────────────────────────────────

export default function Buchungsanfrage() {
  const KATEGORIE_LABELS: Record<string, string> = {
  einzelzimmer: 'Einzelzimmer',
  doppelzimmer: 'Doppelzimmer',
  suite: 'Suite',
};

  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  // Alle Buchungen (für Belegungskalender) und alle Zimmer
  const [buchungenRecords, setBuchungenRecords] = useState<Record<string, PublicRecordResult>>({});
  const [zimmerRecords, setZimmerRecords] = useState<ZimmerRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  const [step, setStep] = useState(1);

  // ─── Formulare ───────────────────────────────────────────────────────────
  // Schritt 1+2: buchungen-Felder (anreise, abreise, zimmer, personen, bemerkung)
  const buchung = useStepForm('buchungen', {
    fields: ['anreise', 'abreise', 'zimmer', 'personen', 'bemerkung'],
    required: { anreise: true, abreise: true, zimmer: true, personen: false, bemerkung: false },
    steps: { anreise: 1, abreise: 1, zimmer: 2, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  // Schritt 3: Gäste-Felder
  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 3, nachname: 3, email: 3, telefon: 3 },
    autoComplete: true,
  });

  // ─── Config laden ────────────────────────────────────────────────────────
  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        if (!c) { setUnavailable(true); setLoading(false); return; }
        setCfg(c);
        const p = c.pages[SLUG] ?? null;
        setPage(p);
        setLoading(false);
        if (!p) { setUnavailable(true); return; }

        // Buchungen + Zimmer laden
        setDataLoading(true);
        const buchungenEp = p.endpoints?.find(e => e.op === 'list' && e.entity === 'buchungen');
        const zimmerEp    = p.endpoints?.find(e => e.op === 'list' && e.entity === 'zimmer');
        const bPromise = buchungenEp
          ? listPublicRecords(c, p, { appId: buchungenEp.app_id, limit: 500 })
          : Promise.resolve<Record<string, PublicRecordResult>>({});
        const zPromise = zimmerEp
          ? listPublicRecords(c, p, { appId: zimmerEp.app_id, limit: 200 })
          : Promise.resolve<Record<string, PublicRecordResult>>({});

        Promise.all([bPromise, zPromise]).then(([b, z]) => {
          setBuchungenRecords(b);
          const zimmer: ZimmerRecord[] = Object.values(z).map(r => ({
            id: r.id,
            bezeichnung: (r.fields.bezeichnung as string) ?? '',
            kategorie: (r.fields.kategorie as string) ?? null,
            preis_pro_nacht: (r.fields.preis_pro_nacht as number) ?? null,
          }));
          setZimmerRecords(zimmer);
          setDataLoading(false);
        }).catch(() => setDataLoading(false));
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) setUnavailable(true);
        setLoading(false);
      });
  }, []);

  // ─── Port + Submit ────────────────────────────────────────────────────────
  const port = useMemo(() => cfg && page ? createPublicPort(cfg, page) : null, [cfg, page]);

  const submit = useJourneySubmit(
    port ?? { door: 'public', list: async () => [], count: async () => null, get: async () => null, create: async () => ({ id: '', fields: {}, createdAt: null }), ref: () => '' },
    [
      { key: 'gast',    entity: 'gaeste',   form: gast,   label: tx('Gast anlegen') },
      { key: 'buchung', entity: 'buchungen', form: buchung, primary: true,
        needs: ['gast'], link: { gast: 'gast' },
        label: tx('Buchungsanfrage absenden'),
      },
    ],
    { draftKey: 'buchungsanfrage' },
  );

  // ─── Belegungsberechnung ─────────────────────────────────────────────────
  const selectedZimmerId = buchung.get('zimmer') as string | null;

  const buchungenList = useMemo(
    () => Object.values(buchungenRecords).map(r => ({ fields: r.fields as Record<string, unknown> })),
    [buchungenRecords],
  );

  const blocked = useMemo(
    () => occupancyFor('buchungen', buchungenList, { resource: selectedZimmerId ?? undefined }),
    [buchungenList, selectedZimmerId],
  );

  // ─── Freie Zimmer filtern ────────────────────────────────────────────────
  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;

  const freieZimmer = useMemo(() => {
    if (!anreise || !abreise) return zimmerRecords;
    return zimmerRecords.filter(z => {
      const belegtFuerZimmer = occupancyFor(
        'buchungen',
        buchungenList,
        { resource: z.id },
      );
      // Prüfen ob der gewünschte Zeitraum frei ist
      for (const b of belegtFuerZimmer) {
        const bStart = b.start;
        const bEnd   = b.end ?? '';
        // Überlappung: anreise < bEnd && abreise > bStart
        if (anreise < bEnd && abreise > bStart) return false;
      }
      return true;
    });
  }, [zimmerRecords, buchungenList, anreise, abreise]);

  // ─── Challenge vorwärmen ─────────────────────────────────────────────────
  const handleFirstInteraction = () => {
    if (!cfg || !page) return;
    const ep = page.endpoints?.find(e => e.op === 'create' && e.entity === 'gaeste');
    if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  };

  // ─── Neustart ────────────────────────────────────────────────────────────
  const restart = () => {
    submit.reset();
    buchung.reset();
    gast.reset();
    setStep(1);
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loading) return <PublicShell loading />;
  if (unavailable || !cfg || !page) return <PublicShell unavailable />;

  return (
    <PublicShell
      title={tx('Zimmer anfragen')}
      description={tx('Stellen Sie jetzt eine unverbindliche Buchungsanfrage — wir melden uns schnellstmöglich.')}
      wide
    >
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div onPointerDown={handleFirstInteraction} onFocus={handleFirstInteraction}>
        <IntentWizardShell
          currentStep={step}
          onStepChange={setStep}
          back={false}
          forms={[buchung, gast]}
          draftKey="buchungsanfrage"
          loading={dataLoading}
        >
          {/* Schritt 1: Zeitraum wählen */}
          <WizardStep
            label={tx('Zeitraum')}
            description={tx('Wähle dein Anreise- und Abreisedatum. Bereits belegte Nächte sind ausgegraut.')}
          >
            <div className="space-y-4">
              <AvailabilityRangePicker
                {...buchung.range('anreise', 'abreise', { blocked })}
                legend={tx('Belegte Nächte sind ausgegraut und nicht buchbar.')}
              />
            </div>
            <StepNav
              onNext={() => buchung.validate(['anreise', 'abreise'])}
              nextStepLabel={tx('Zimmer wählen')}
            />
          </WizardStep>

          {/* Schritt 2: Zimmer wählen */}
          <WizardStep
            label={tx('Zimmer')}
            description={tx('Diese Zimmer sind für deinen Zeitraum verfügbar.')}
            needs={['anreise', 'abreise']}
          >
            <div className="space-y-3">
              {freieZimmer.length === 0 ? (
                <div className="rounded-2xl border border-border bg-muted/30 p-6 text-center">
                  <IconBed size={36} stroke={1.5} className="text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {tx('Für diesen Zeitraum sind leider keine Zimmer verfügbar. Bitte wähle einen anderen Zeitraum.')}
                  </p>
                </div>
              ) : (
                freieZimmer.map(z => {
                  const selected = selectedZimmerId === z.id;
                  return (
                    <button
                      key={z.id}
                      type="button"
                      onClick={() => buchung.set('zimmer', z.id, z.bezeichnung)}
                      className={`w-full text-left rounded-2xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:bg-accent'
                      }`}
                      aria-pressed={selected}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground">{z.bezeichnung}</p>
                          {z.kategorie && (
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {KATEGORIE_LABELS[z.kategorie] ?? z.kategorie}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 flex flex-col items-end gap-1">
                          {z.preis_pro_nacht !== null && (
                            <p className="text-sm font-semibold text-foreground">
                              {formatPreis(z.preis_pro_nacht)}
                              <span className="font-normal text-muted-foreground"> / {tx('Nacht')}</span>
                            </p>
                          )}
                          {selected && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                              <IconCheck size={12} stroke={2.5} />
                              {tx('Ausgewählt')}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
            {buchung.error('zimmer') && (
              <p className="text-sm text-destructive mt-2" role="alert">{buchung.error('zimmer')}</p>
            )}
            <StepNav
              onNext={() => buchung.validate(['zimmer'])}
              nextStepLabel={tx('Kontaktdaten')}
            />
          </WizardStep>

          {/* Schritt 3: Kontaktdaten */}
          <WizardStep
            label={tx('Kontaktdaten')}
            description={tx('Damit wir deine Anfrage bearbeiten können, brauchen wir deine Kontaktdaten.')}
            needs={['zimmer']}
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
                <Input {...gast.field('email')} />
              </Field>
              <Field form={gast} name="telefon">
                <Input {...gast.field('telefon')} />
              </Field>
              <Field form={buchung} name="personen" hint={tx('Wie viele Personen reisen an?')}>
                <Input {...buchung.field('personen')} />
              </Field>
              <Field form={buchung} name="bemerkung" hint={tx('Besondere Wünsche oder Anmerkungen (optional)')}>
                <Textarea {...buchung.field('bemerkung')} rows={3} />
              </Field>
            </div>
            <StepNav
              onNext={() => {
                const gastOk    = gast.validate(['vorname', 'nachname', 'email', 'telefon']);
                const buchungOk = buchung.validate(['personen', 'bemerkung']);
                return gastOk !== false && buchungOk !== false;
              }}
              nextStepLabel={tx('Zusammenfassung')}
            />
          </WizardStep>

          {/* Schritt 4: Zusammenfassung */}
          <WizardStep label={tx('Zusammenfassung')} needs={['vorname', 'nachname']}>
            {!submit.result && (
              <SummaryStep
                forms={[buchung, gast]}
                submit={submit}
                whatHappensNext={tx('Wir prüfen deine Anfrage und melden uns innerhalb von 24 Stunden per E-Mail oder Telefon.')}
                confirmLabel={tx('Anfrage absenden')}
              />
            )}
          </WizardStep>

          {/* Erfolgsschritt */}
          {submit.result && (
            <SuccessStep
              result={submit.result}
              forms={[buchung, gast]}
              whatHappensNext={tx('Wir prüfen Ihre Anfrage und melden uns innerhalb von 24 Stunden per E-Mail oder Telefon bei Ihnen.')}
              submit={submit}
              restartLabel={tx('Weitere Anfrage stellen')}
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
