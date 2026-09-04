/**
 * Rechnung erstellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung auswählen → 2) Rechnungsdetails eingeben → 3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert: bestaetigt|eingecheckt|ausgecheckt). Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, ChoiceGroup, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Field } from '@/components/blocks/Field';
import { DatePicker } from '@/components/DatePicker';
import { Input } from '@/components/ui/input';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  fieldText,
  fieldLookup,
  fieldDate,
  todayIso,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LOOKUP_OPTIONS } from '@/types/app';
import { tx } from '@/i18n';

export default function RechnungErstellenPage() {
  const data = useDashboardData({ omit: ['buchungen'] });

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status in ['bestaetigt','eingecheckt','ausgecheckt']",
    where: r => ['bestaetigt', 'eingecheckt', 'ausgecheckt'].includes(fieldLookup(r, 'status')?.key ?? ''),
    searchFields: ['bemerkung'],
    toItem: b => {
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const zeitraum = anreise && abreise
        ? `${format(new Date(anreise), 'dd.MM.yy')} – ${format(new Date(abreise), 'dd.MM.yy')}`
        : anreise
          ? format(new Date(anreise), 'dd.MM.yy')
          : '';
      const gastName = fieldText(b, 'gastName') ?? '';
      const zimmerName = fieldText(b, 'zimmerName') ?? '';
      return {
        id: b.id,
        title: gastName || tx('Unbekannter Gast'),
        subtitle: [zimmerName, zeitraum].filter(Boolean).join(' · '),
        status: fieldLookup(b, 'status') ?? undefined,
      };
    },
  });

  const [step, setStep] = useState(1);

  const rechnung = useStepForm('rechnungen', {
    steps: {
      buchung: 1,
      betrag: 2,
      rechnungsdatum: 2,
      faellig_am: 2,
      zahlungsstatus: 2,
    },
    initial: {
      rechnungsdatum: todayIso(),
      zahlungsstatus: LOOKUP_OPTIONS['rechnungen']?.['zahlungsstatus']?.[0]?.key ?? 'offen',
    },
  });

  const submit = useJourneySubmit(servicePort, [
    { key: 'rechnung', entity: 'rechnungen', form: rechnung, primary: true },
  ], { draftKey: 'rechnung-erstellen' });

  const restart = () => { submit.reset(); rechnung.reset(); setStep(1); };

  const buchungId = rechnung.get('buchung') as string | undefined;
  const buchungLabel = buchungId ? (buchungen.labelOf(buchungId) ?? '') : '';

  return (
    <IntentWizardShell
      title={tx('Rechnung erstellen')}
      currentStep={step} onStepChange={setStep}
      loading={data.loading} error={data.error} onRetry={data.fetchAll}
      forms={[rechnung]} draftKey="rechnung-erstellen"
      intro={{
        description: tx('Rechnung zu einer bestehenden Buchung anlegen.'),
        needs: [tx('Buchungsreferenz'), tx('Rechnungsbetrag')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Zu welcher Buchung?')}
        description={tx('Nur bestätigte, laufende und abgeschlossene Aufenthalte werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId}
          onSelect={id => { rechnung.set('buchung', id, buchungen.labelOf(id)); setStep(2); }}
          emptyText={tx('Keine Buchung mit passendem Status gefunden. Bitte erst eine Buchung bestätigen.')}
          create={false}
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Details')}
        heading={tx('Betrag und Fälligkeit?')}
        description={tx('Betrag, Datum und Zahlungsstatus für diese Rechnung festlegen.')}
      >
        {buchungId ? (
          <div className="space-y-4">
            <Field form={rechnung} name="betrag" hint={tx('Euro')}>
              <Input {...rechnung.number('betrag')} placeholder="0,00" />
            </Field>
            <Field form={rechnung} name="rechnungsdatum">
              <DatePicker {...rechnung.date('rechnungsdatum')} />
            </Field>
            <Field form={rechnung} name="faellig_am">
              <DatePicker {...rechnung.date('faellig_am')} />
            </Field>
            <Field form={rechnung} name="zahlungsstatus">
              <ChoiceGroup {...rechnung.choice('zahlungsstatus')} />
            </Field>
            <StepNav
              onBack={() => setStep(1)}
              onNext={() => rechnung.validate(['betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus'])}
              nextStepLabel={tx('Prüfen')}
            />
          </div>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Bitte zuerst eine Buchung auswählen.')}
          </StepNav>
        )}
      </WizardStep>

      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            items={[
              {
                key: '_buchung',
                label: tx('Buchung'),
                value: buchungLabel,
                keys: ['buchung'],
                fieldId: 'buchung',
                step: 1,
              },
            ]}
            whatHappensNext={tx('Die Rechnung wird sofort in der Buchung vermerkt und kann gedruckt werden.')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          next={[
            { label: tx('Weitere Rechnung erstellen'), onClick: restart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Den Zahlungseingang nach Bezahlung im Rechnungsstatus nachtragen.')}
        />
      )}
    </IntentWizardShell>
  );
}
