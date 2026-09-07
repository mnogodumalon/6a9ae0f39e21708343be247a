/**
 * Gast einchecken — 2-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur bestätigte) → 2) Bestätigen & Status auf 'eingecheckt' setzen.
 * Reads: buchungen (filter: status=bestaetigt), gaeste (via ctx.ref), zimmer (via ctx.ref).
 * Writes: buchungen (update status='eingecheckt').
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldText, fieldLookup, fieldDate } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { formatDate } from '@/lib/formatters';

export default function GastEincheckPage() {
  const [step, setStep] = useState(1);

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: ['bemerkung'],
    toItem: (b, ctx) => {
      const zimmerName = ctx.ref('zimmer') ?? tx('Zimmer unbekannt');
      const gastName = ctx.ref('gast') ?? tx('Gast unbekannt');
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const zeitraum = anreise && abreise
        ? `${formatDate(anreise)} – ${formatDate(abreise)}`
        : anreise
          ? formatDate(anreise)
          : '';
      return {
        id: b.id,
        title: gastName,
        subtitle: `${zimmerName}${zeitraum ? ` · ${zeitraum}` : ''}`,
        status: fieldLookup(b, 'status') ?? undefined,
      };
    },
  });

  const f = useStepForm('buchungen', {
    steps: { _buchung: 1 },
    fields: [],
    required: {
      gast: false,
      zimmer: false,
      anreise: false,
      abreise: false,
      status: false,
      personen: false,
      begleitperson: false,
      zusatzleistungen_buchung: false,
      bemerkung: false,
      beleg: false,
    },
  });

  const [buchungId, setBuchungId] = useState<string | null>(null);

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'checkin',
      entity: 'buchungen',
      form: f,
      updates: buchungId ?? '',
      primary: true,
      values: { status: 'eingecheckt' },
    },
  ], { draftKey: 'gast-einchecken' });

  const selectedRecord = buchungId ? buchungen.recordOf(buchungId) : null;
  const gastName = buchungId ? buchungen.refLabel(selectedRecord!, 'gast') ?? tx('Gast unbekannt') : '';
  const zimmerName = buchungId ? buchungen.refLabel(selectedRecord!, 'zimmer') ?? tx('Zimmer unbekannt') : '';
  const anreise = selectedRecord ? fieldDate(selectedRecord, 'anreise') : null;
  const abreise = selectedRecord ? fieldDate(selectedRecord, 'abreise') : null;
  const personen = selectedRecord ? fieldText(selectedRecord, 'personen') : null;

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung auf "Eingecheckt" setzen.'),
        needs: [tx('Bestätigte Buchung')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Buchung wählen')}
        description={tx('Nur bestätigte, noch nicht eingecheckte Buchungen werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId ?? undefined}
          onSelect={id => {
            setBuchungId(id);
            f.set('_buchung', id, buchungen.labelOf(id));
            setStep(2);
          }}
          emptyText={tx('Keine bestätigten Buchungen vorhanden. Bitte zuerst eine Buchung bestätigen.')}
          create={false}
          searchPlaceholder={tx('Buchung suchen …')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Bestätigen')}
        heading={tx('Einchecken bestätigen')}
        description={tx('Buchungsdetails prüfen und den Gast einchecken.')}
      >
        {!submit.done ? (
          buchungId ? (
            <SummaryStep
              forms={[f]}
              submit={submit}
              confirmLabel={tx('Jetzt einchecken')}
              whatHappensNext={tx('Der Buchungsstatus wird auf „Eingecheckt" gesetzt.')}
              items={[
                { key: 'gast', fieldId: 'gast', label: tx('Gast'), value: gastName, step: 1, keys: ['_buchung'] },
                { key: 'zimmer', fieldId: 'zimmer', label: tx('Zimmer'), value: zimmerName, step: 1, keys: ['_buchung'] },
                ...(anreise ? [{ key: 'anreise', fieldId: 'anreise', label: tx('Anreise'), value: formatDate(anreise), step: 1, keys: ['_buchung'] }] : []),
                ...(abreise ? [{ key: 'abreise', fieldId: 'abreise', label: tx('Abreise'), value: formatDate(abreise), step: 1, keys: ['_buchung'] }] : []),
                ...(personen ? [{ key: 'personen', fieldId: 'personen', label: tx('Personen'), value: personen, step: 1, keys: ['_buchung'] }] : []),
                { key: 'neuer_status', fieldId: 'status', label: tx('Neuer Status'), value: tx('Eingecheckt'), step: 1, keys: [] },
              ]}
            />
          ) : (
            <StepNav onBack={() => setStep(1)}>
              {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
            </StepNav>
          )
        ) : null}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          actions={{ copy: false, print: false }}
          next={[
            { label: tx('Weiteren Gast einchecken'), href: '#/intents/gast-einchecken' },
            { label: tx('Rechnung stellen'), href: '#/intents/rechnung-stellen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Die Buchung ist nun als eingecheckt markiert. Du kannst jetzt eine Rechnung erstellen.')}
        />
      )}
    </IntentWizardShell>
  );
}
