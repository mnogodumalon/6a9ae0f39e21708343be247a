/**
 * Rechnung stellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (ausgecheckt oder eingecheckt) → 2) Rechnungsdetails eingeben → 3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert nach status=ausgecheckt||eingecheckt). Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, ChoiceGroup, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { Bound } from '@/components/blocks/Bound';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  fieldLookup,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { LOOKUP_OPTIONS } from '@/types/app';
import { tx } from '@/i18n';
import { Field } from '@/components/blocks/Field';

const today = format(new Date(), 'yyyy-MM-dd');
const defaultZahlungsstatus = LOOKUP_OPTIONS['rechnungen']?.['zahlungsstatus']?.[0]?.key ?? 'offen';

export default function RechnungStellenPage() {
  const [step, setStep] = useState(1);

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    searchFields: ['bemerkung'],
    filter: "r.v_status == 'ausgecheckt' or r.v_status == 'eingecheckt'",
    where: r => {
      const key = fieldLookup(r, 'status')?.key;
      return key === 'ausgecheckt' || key === 'eingecheckt';
    },
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('zimmer') ?? tx('Zimmer unbekannt'),
      subtitle: ctx.ref('gast') ?? undefined,
      status: fieldLookup(b, 'status') ?? undefined,
    }),
  });

  const f = useStepForm('rechnungen', {
    steps: {
      buchung: 1,
      betrag: 2,
      rechnungsdatum: 2,
      faellig_am: 2,
      zahlungsstatus: 2,
    },
    initial: {
      rechnungsdatum: today,
      zahlungsstatus: defaultZahlungsstatus,
    },
  });

  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'rechnung',
        entity: 'rechnungen',
        form: f,
        primary: true,
      },
    ],
    { draftKey: 'rechnung-stellen' },
  );

  return (
    <IntentWizardShell
      title={tx('Rechnung stellen')}
      forms={[f]}
      draftKey="rechnung-stellen"
      currentStep={step}
      onStepChange={setStep}
      intro={{
        description: tx('Eine Rechnung zu einer abgeschlossenen oder laufenden Buchung erstellen.'),
        needs: [tx('Buchung (ausgecheckt oder eingecheckt)'), tx('Rechnungsbetrag'), tx('Fälligkeitsdatum')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Buchung wählen')}
        description={tx('Nur ausgecheckte und eingecheckte Buchungen können abgerechnet werden.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={f.get('buchung') as string}
          onSelect={id => f.set('buchung', id, buchungen.labelOf(id))}
          emptyText={tx('Keine abrechnungsfähigen Buchungen gefunden. Bitte zuerst den Gast auschecken.')}
          create={false}
          searchPlaceholder={tx('Nach Bemerkung suchen …')}
        />
        <StepNav
          hideBack
          onNext={() => f.validate(['buchung'])}
          nextStepLabel={tx('Rechnungsdetails')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Details')}
        heading={tx('Rechnungsdetails eingeben')}
        description={tx('Betrag, Datum und Zahlungsstatus für diese Rechnung festlegen.')}
        needs={['buchung']}
      >
        <div className="space-y-4">
          <Bound form={f} name="betrag" />
          <Bound form={f} name="rechnungsdatum" />
          <Bound form={f} name="faellig_am" />
          <div>
            <Field form={f} name="zahlungsstatus">
              <ChoiceGroup {...f.choice('zahlungsstatus')} />
            </Field>
          </div>
          <StepNav
            onNext={() => f.validate(['betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[f]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung wird sofort angelegt und ist in der Rechnungsübersicht sichtbar.')}
            confirmLabel={tx('Rechnung erstellen')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          next={[
            { label: tx('Weitere Rechnung stellen'), onClick: () => { submit.reset(); f.reset(); } },
            { label: tx('Neue Buchung'), href: '#/intents/neue-buchung' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Den Zahlungseingang nach Bezahlung in der Rechnungsübersicht eintragen.')}
        />
      )}
    </IntentWizardShell>
  );
}
