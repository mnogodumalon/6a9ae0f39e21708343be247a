/**
 * Gast einchecken — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (status=bestaetigt) → 2) Begleitperson (optional) → 3) Bestätigen & aktualisieren.
 * Reads: buchungen (gefiltert auf bestaetigt), gaeste.
 * Writes: buchungen update (status=eingecheckt, ggf. begleitperson).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  fieldText,
  fieldLookup,
  fieldDate,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function GastEincheckPage() {
  const [step, setStep] = useState(1);
  const [mitBegleitperson, setMitBegleitperson] = useState(false);
  const [buchungId, setBuchungId] = useState<string | undefined>(undefined);

  // Schritt 1: Buchungen mit status=bestaetigt
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: [],
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('gast') ?? tx('Unbekannter Gast'),
      subtitle: ctx.ref('zimmer') ?? undefined,
      status: fieldLookup(b, 'status') ?? undefined,
      stats: [
        { label: tx('Anreise'), value: fieldDate(b, 'anreise') ?? '—' },
        { label: tx('Abreise'), value: fieldDate(b, 'abreise') ?? '—' },
      ],
    }),
  });

  // Schritt 2: Begleitperson aus Gäste
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
    }),
  });

  // Form: nur die Felder, die wir aktualisieren
  const f = useStepForm('buchungen', {
    fields: ['begleitperson'],
    steps: { begleitperson: 2 },
    required: { begleitperson: false },
  });

  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'checkin',
        entity: 'buchungen',
        form: f,
        updates: buchungId ?? '',
        values: () => {
          const vals: Record<string, unknown> = { status: 'eingecheckt' };
          if (mitBegleitperson && f.get('begleitperson')) {
            vals['begleitperson'] = f.get('begleitperson');
          }
          return vals;
        },
        primary: true,
        verb: 'update',
      },
    ],
    { draftKey: 'gast-einchecken' }
  );

  // Buchung-Record für Summary-Anzeige
  const selectedBuchung = buchungId ? buchungen.recordOf(buchungId) : undefined;
  const gastName = buchungId ? buchungen.labelOf(buchungId) ?? '—' : '—';
  const zimmerName = selectedBuchung ? (buchungen.refLabel(selectedBuchung, 'zimmer') ?? '—') : '—';
  const anreise = selectedBuchung ? (fieldDate(selectedBuchung, 'anreise') ?? '—') : '—';
  const abreise = selectedBuchung ? (fieldDate(selectedBuchung, 'abreise') ?? '—') : '—';

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      subtitle={tx('Bestätigte Buchung auf eingecheckt setzen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung zum Check-in markieren.'),
        needs: [tx('Name des Gastes oder Zimmernummer'),],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Buchung wählen')}
        description={tx('Nur bestätigte Buchungen können eingecheckt werden.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId ?? null}
          avatar="none"
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
          emptyText={tx('Keine bestätigten Buchungen gefunden.')}
          create={false}
          onSelect={id => {
            setBuchungId(id);
            setStep(2);
          }}
        />
      </WizardStep>

      {/* Schritt 2: Begleitperson (optional) */}
      <WizardStep
        label={tx('Begleitperson')}
        heading={tx('Begleitperson eintragen (optional)')}
        description={tx('Falls eine Begleitperson mitreist, kann sie hier ausgewählt werden.')}
        enabledIf={true}
      >
        {step === 2 && !buchungId ? (
          <StepNav
            onBack={() => setStep(1)}
            nextDisabled
          >
            {tx('Bitte zuerst eine Buchung auswählen.')}
          </StepNav>
        ) : (
          <div className="space-y-4">
            {!mitBegleitperson ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {tx('Reist der Gast allein an, kannst du diesen Schritt überspringen.')}
                </p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
                    onClick={() => setMitBegleitperson(true)}
                  >
                    {tx('Begleitperson angeben')}
                  </button>
                  <button
                    type="button"
                    className="px-4 py-2 rounded-lg bg-secondary text-foreground text-sm font-medium"
                    onClick={() => setStep(3)}
                  >
                    {tx('Ohne Begleitperson weiter')}
                  </button>
                </div>
                <StepNav
                  onBack={() => setStep(1)}
                  hideBack={false}
                  nextLabel={tx('Ohne Begleitperson weiter')}
                  onNext={() => { setStep(3); }}
                />
              </div>
            ) : (
              <>
                <EntitySelectStep
                  {...gaeste.select}
                  selectedId={f.get('begleitperson') as string | null}
                  avatar="initials"
                  searchPlaceholder={tx('Gast suchen …')}
                  emptyText={tx('Kein passender Gast gefunden.')}
                  create={{ fields: ['vorname', 'nachname', 'email', 'telefon'], title: tx('Neuen Gast anlegen') }}
                  onSelect={id => {
                    f.set('begleitperson', id, gaeste.labelOf(id));
                  }}
                />
                <StepNav
                  onBack={() => { setMitBegleitperson(false); }}
                  backLabel={tx('Zurück (ohne Begleitperson)')}
                  onNext={() => { setStep(3); }}
                  nextStepLabel={tx('Bestätigung')}
                />
              </>
            )}
          </div>
        )}
      </WizardStep>

      {/* Schritt 3: Bestätigung */}
      <WizardStep
        label={tx('Bestätigung')}
        heading={tx('Alles richtig?')}
      >
        {step === 3 && !buchungId ? (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht zuerst eine Buchungsauswahl.')}
          </StepNav>
        ) : !submit.result ? (
          <SummaryStep
            forms={[f]}
            submit={submit}
            whatHappensNext={tx('Die Buchung wird sofort auf „Eingecheckt" gesetzt.')}
            confirmLabel={tx('Jetzt einchecken')}
            items={[
              { key: 'gast', label: tx('Gast'), value: gastName, step: 1 },
              { key: 'zimmer', label: tx('Zimmer'), value: zimmerName, step: 1 },
              { key: 'zeitraum', label: tx('Zeitraum'), value: `${anreise} – ${abreise}`, step: 1, keys: ['anreise', 'abreise'] },
              ...(mitBegleitperson && f.get('begleitperson')
                ? [{ key: 'begleitperson', label: tx('Begleitperson'), value: gaeste.labelOf(f.get('begleitperson') as string) ?? '—', step: 2, keys: ['begleitperson'] }]
                : []),
            ]}
          />
        ) : null}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          verb="updated"
          title={tx('Gast eingecheckt')}
          actions={{ copy: false, print: false }}
          facts={[
            { label: tx('Gast'), value: gastName },
            { label: tx('Zimmer'), value: zimmerName },
            { label: tx('Zeitraum'), value: `${anreise} – ${abreise}` },
            ...(mitBegleitperson && f.get('begleitperson')
              ? [{ label: tx('Begleitperson'), value: gaeste.labelOf(f.get('begleitperson') as string) ?? '—' }]
              : []),
          ]}
          whatHappensNext={tx('Die Buchung ist jetzt als „Eingecheckt" markiert.')}
          next={[
            {
              label: tx('Rechnung stellen'),
              href: '#/intents/rechnung-stellen',
            },
            {
              label: tx('Zum Dashboard'),
              href: '#/',
            },
          ]}
          submit={submit}
          restartLabel={tx('Weiteren Gast einchecken')}
        />
      )}
    </IntentWizardShell>
  );
}
