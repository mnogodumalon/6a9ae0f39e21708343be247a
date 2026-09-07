/**
 * Gast einchecken — 2-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur Status "bestaetigt") → 2) Bestätigen & Status auf "eingecheckt" setzen.
 * Reads: buchungen (mit ctx.ref für gastName und zimmerName).
 * Writes: buchungen (updateBuchungenEntry — Status-Flip auf "eingecheckt").
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, SummaryStep, SuccessStep, StepNav.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function GastEincheckenPage() {
  // buchungen hat nur 'bemerkung' als String-Feld — der Gast- und Zimmername
  // kommen via ctx.ref. searchFields: [] da keine eigenen Text-Suchfelder sinnvoll sind.
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: [],
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('gast') ?? tx('Unbekannter Gast'),
      subtitle: [ctx.ref('zimmer'), fieldDate(b, 'anreise')].filter(Boolean).join(' · '),
    }),
  });

  const [step, setStep] = useState(1);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Update-only: kein useStepForm nötig da alle Values im Plan stehen
  const f = useStepForm('buchungen', {
    fields: [],
    steps: {},
    required: {},
  });

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'checkin',
      entity: 'buchungen',
      updates: selectedId ?? '',
      values: { status: 'eingecheckt' },
      primary: true,
      verb: 'update',
    },
  ], { draftKey: 'gast-einchecken' });

  // Buchungsdetails für die Summary aus dem ausgewählten Datensatz
  const selectedRecord = selectedId ? buchungen.recordOf(selectedId) : undefined;

  const summaryItems = selectedRecord ? [
    { key: 'gast', label: tx('Gast'), value: buchungen.labelOf(selectedId!) ?? '—' },
    { key: 'zimmer', label: tx('Zimmer'), value: buchungen.refLabel(selectedRecord, 'zimmer') ?? '—' },
    { key: 'anreise', label: tx('Anreise'), value: fieldDate(selectedRecord, 'anreise') ?? '—' },
    { key: 'abreise', label: tx('Abreise'), value: fieldDate(selectedRecord, 'abreise') ?? '—' },
  ] : [];

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestehende Buchung auf eingecheckt setzen.'),
        needs: [tx('Bestätigte Buchung')],
      }}
    >
      <WizardStep
        label={tx('Buchung wählen')}
        description={tx('Nur bestätigte Buchungen können eingecheckt werden.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={selectedId}
          onSelect={id => {
            setSelectedId(id);
            setStep(2);
          }}
          emptyText={tx('Keine bestätigten Buchungen vorhanden.')}
          create={false}
          searchPlaceholder={tx('Gast suchen…')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Bestätigen')}
        description={tx('Buchungsdetails prüfen und Gast einchecken.')}
      >
        {!selectedId && !submit.result && (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht eine ausgewählte Buchung aus Schritt 1.')}
          </StepNav>
        )}
        {selectedId && !submit.done && (
          <SummaryStep
            forms={[f]}
            submit={submit}
            items={summaryItems}
            whatHappensNext={tx('Der Status der Buchung wird sofort auf „Eingecheckt" gesetzt.')}
            confirmLabel={tx('Jetzt einchecken')}
          />
        )}
        {submit.result && (
          <SuccessStep
            result={submit.result}
            facts={summaryItems}
            title={tx('Gast eingecheckt')}
            verb="updated"
            actions={{ copy: false, print: false }}
            next={[
              { label: tx('Nächsten Gast einchecken'), onClick: () => { submit.reset(); f.reset(); setSelectedId(undefined); setStep(1); } },
              { label: tx('Rechnung stellen'), href: '#/intents/rechnung-erstellen' },
              { label: tx('Zum Dashboard'), href: '#/' },
            ]}
          />
        )}
      </WizardStep>
    </IntentWizardShell>
  );
}
