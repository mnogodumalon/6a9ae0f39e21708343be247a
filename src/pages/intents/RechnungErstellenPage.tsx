/**
 * Rechnung erstellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (ausgecheckt/eingecheckt) → 2) Rechnungsdetails erfassen → 3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert nach status). Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, StepNav, SummaryStep, SuccessStep, Bound.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Bound } from '@/components/blocks/Bound';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate, todayIso } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { addDays, parseISO } from 'date-fns';
import { format } from 'date-fns';

export default function RechnungErstellenPage() {
  const [step, setStep] = useState(1);

  // Buchungen mit Status 'ausgecheckt' oder 'eingecheckt'
  // Buchungen ist eine Link-Entity (gast, zimmer als applookups) — keine eigenen String-Felder
  // außer bemerkung. Suche daher über den Gast-Namen via ctx.ref.
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status in ['ausgecheckt', 'eingecheckt']",
    where: r => {
      const key = fieldLookup(r, 'status')?.key;
      return key === 'ausgecheckt' || key === 'eingecheckt';
    },
    searchFields: [],
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('gast') ?? tx('Unbekannter Gast'),
      subtitle: [
        ctx.ref('zimmer'),
        fieldDate(b, 'anreise') && fieldDate(b, 'abreise')
          ? `${fieldDate(b, 'anreise')} – ${fieldDate(b, 'abreise')}`
          : undefined,
      ].filter(Boolean).join(' · '),
      status: fieldLookup(b, 'status') ?? undefined,
    }),
  });

  const today = todayIso();
  const faelligDefault = format(addDays(parseISO(today), 14), 'yyyy-MM-dd');

  const rechnung = useStepForm('rechnungen', {
    steps: {
      buchung: 1,
      betrag: 2,
      rechnungsdatum: 2,
      faellig_am: 2,
      zahlungsstatus: 2,
    },
    initial: {
      rechnungsdatum: today,
      faellig_am: faelligDefault,
      zahlungsstatus: 'offen',
    },
  });

  const submit = useJourneySubmit(servicePort, [
    { key: 'rechnung', entity: 'rechnungen', form: rechnung, primary: true },
  ], { draftKey: 'rechnung-erstellen' });

  const buchungId = rechnung.get('buchung') as string | undefined;
  const gastLabel = buchungId ? buchungen.labelOf(buchungId) : undefined;

  return (
    <IntentWizardShell
      title={tx('Rechnung erstellen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[rechnung]}
      draftKey="rechnung-erstellen"
      intro={{
        description: tx('Eine Rechnung zu einer bestehenden Buchung anlegen.'),
        needs: [tx('Buchung (ausgecheckt oder eingecheckt)'), tx('Rechnungsbetrag')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        description={tx('Buchung auswählen, für die eine Rechnung gestellt werden soll.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId}
          onSelect={id => {
            rechnung.set('buchung', id, buchungen.labelOf(id));
            setStep(2);
          }}
          emptyText={tx('Keine Buchungen mit Status „Eingecheckt" oder „Ausgecheckt" gefunden.')}
          create={false}
          searchPlaceholder={tx('Buchung suchen …')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Rechnungsdetails')}
        description={tx('Betrag, Datum und Zahlungsstatus der Rechnung festlegen.')}
        needs={['buchung']}
      >
        <div className="space-y-4">
          {gastLabel && (
            <p className="text-sm text-muted-foreground">
              {tx('Buchung')}: <span className="font-medium text-foreground">{gastLabel}</span>
            </p>
          )}
          <Bound form={rechnung} name="betrag" hint={tx('Preis in Euro')} />
          <Bound form={rechnung} name="rechnungsdatum" />
          <Bound form={rechnung} name="faellig_am" />
          <Bound form={rechnung} name="zahlungsstatus" as="choice" />
          <StepNav
            onNext={() => rechnung.validate(['betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung erscheint sofort in der Rechnungsübersicht und kann gedruckt oder versendet werden.')}
            confirmLabel={tx('Rechnung anlegen')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          next={[
            { label: tx('Weitere Rechnung stellen'), onClick: () => { submit.reset(); rechnung.reset(); setStep(1); } },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Bei Zahlungseingang den Zahlungsstatus in der Rechnung auf „Bezahlt" setzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
