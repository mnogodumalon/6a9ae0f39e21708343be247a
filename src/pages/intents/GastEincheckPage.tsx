/**
 * Gast einchecken — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur status='bestaetigt') → 2) Details bestätigen + Anmerkung → 3) Prüfen & einchecken.
 * Reads: buchungen (gefiltert nach status='bestaetigt'). Writes: buchungen (updateBuchungenEntry — status → 'eingecheckt').
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, Field, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Field } from '@/components/blocks/Field';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { Textarea } from '@/components/ui/textarea';
import { tx } from '@/i18n';
import { format, parseISO } from 'date-fns';
import { dateFnsLocale } from '@/i18n';

export default function GastEincheckPage() {
  const data = useDashboardData({ omit: ['buchungen'] });

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: ['bemerkung'],
    toItem: b => {
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const anreiseStr = anreise ? format(parseISO(anreise), 'dd.MM.yyyy', { locale: dateFnsLocale() }) : '';
      const abreiseStr = abreise ? format(parseISO(abreise), 'dd.MM.yyyy', { locale: dateFnsLocale() }) : '';
      const gastName = b.fields['gastName'] as string | undefined;
      const zimmerName = b.fields['zimmerName'] as string | undefined;
      return {
        id: b.id,
        title: gastName ?? tx('Unbekannter Gast'),
        subtitle: zimmerName ?? '',
        stats: anreiseStr && abreiseStr
          ? [{ label: tx('Zeitraum'), value: `${anreiseStr} – ${abreiseStr}` }]
          : [],
      };
    },
  });

  const detailsForm = useStepForm('buchungen', {
    fields: ['bemerkung'],
    steps: { bemerkung: 2 },
    messages: {
      gast: tx('Bitte einen Gast auswählen.'),
      zimmer: tx('Bitte ein Zimmer auswählen.'),
      anreise: tx('Bitte das Anreisedatum wählen.'),
      abreise: tx('Bitte das Abreisedatum wählen.'),
      status: tx('Bitte einen Status wählen.'),
    },
  });

  const [step, setStep] = useState(1);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [gastName, setGastName] = useState<string | undefined>(undefined);
  const [zimmerName, setZimmerName] = useState<string | undefined>(undefined);
  const [anreiseIso, setAnreiseIso] = useState<string | undefined>(undefined);
  const [abreiseIso, setAbreiseIso] = useState<string | undefined>(undefined);
  const [personenCount, setPersonenCount] = useState<number | undefined>(undefined);

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'eincheck',
      run: async () => {
        if (!selectedId) throw new Error(tx('Keine Buchung ausgewählt'));
        const bemerkung = detailsForm.get('bemerkung') as string | undefined;
        return LivingAppsService.updateBuchungenEntry(selectedId, {
          status: 'eingecheckt',
          ...(bemerkung !== undefined ? { bemerkung } : {}),
        });
      },
    },
  ], { draftKey: 'gast-einchecken' });

  const restart = () => {
    submit.reset();
    detailsForm.reset();
    setSelectedId(undefined);
    setGastName(undefined);
    setZimmerName(undefined);
    setAnreiseIso(undefined);
    setAbreiseIso(undefined);
    setPersonenCount(undefined);
    setStep(1);
  };

  const anreiseFormatted = anreiseIso ? format(parseISO(anreiseIso), 'dd.MM.yyyy', { locale: dateFnsLocale() }) : '–';
  const abreiseFormatted = abreiseIso ? format(parseISO(abreiseIso), 'dd.MM.yyyy', { locale: dateFnsLocale() }) : '–';

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      loading={data.loading}
      error={data.error}
      onRetry={data.fetchAll}
      forms={[detailsForm]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung auswählen und den Gast einchecken.'),
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
            const rec = buchungen.recordOf(id);
            setSelectedId(id);
            if (rec) {
              setGastName((rec.fields['gastName'] as string | undefined) ?? buchungen.labelOf(id));
              setZimmerName(rec.fields['zimmerName'] as string | undefined);
              setAnreiseIso(fieldDate(rec, 'anreise') ?? undefined);
              setAbreiseIso(fieldDate(rec, 'abreise') ?? undefined);
              setPersonenCount(rec.fields['personen'] as number | undefined);
            } else {
              setGastName(buchungen.labelOf(id));
            }
            setStep(2);
          }}
          emptyText={tx('Keine bestätigten Buchungen vorhanden.')}
          create={false}
          searchPlaceholder={tx('Nach Buchung suchen …')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Details bestätigen')}
        description={tx('Buchungsdetails prüfen und optionale Anmerkung zum Check-in hinzufügen.')}
      >
        {selectedId ? (
          <div className="space-y-6">
            <div className="rounded-2xl bg-card shadow-lg p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">{tx('Gast')}</p>
                  <p className="font-medium text-foreground">{gastName ?? '–'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{tx('Zimmer')}</p>
                  <p className="font-medium text-foreground">{zimmerName ?? '–'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{tx('Anreise')}</p>
                  <p className="font-medium text-foreground">{anreiseFormatted}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{tx('Abreise')}</p>
                  <p className="font-medium text-foreground">{abreiseFormatted}</p>
                </div>
                {personenCount !== undefined && (
                  <div>
                    <p className="text-muted-foreground text-xs">{tx('Personen')}</p>
                    <p className="font-medium text-foreground">{personenCount}</p>
                  </div>
                )}
              </div>
            </div>

            <Field form={detailsForm} name="bemerkung" hint={tx('Optional')}>
              <Textarea {...detailsForm.field('bemerkung')} rows={3} placeholder={tx('Anmerkung zum Check-in …')} />
            </Field>

            <StepNav
              onBack={() => setStep(1)}
              onNext={() => detailsForm.validate(['bemerkung'])}
              nextStepLabel={tx('Prüfen & einchecken')}
            />
          </div>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Bitte zuerst eine Buchung auswählen.')}
          </StepNav>
        )}
      </WizardStep>

      <WizardStep label={tx('Prüfen & einchecken')}>
        {!submit.done && (
          <SummaryStep
            forms={[detailsForm]}
            submit={submit}
            items={[
              { key: 'gast', label: tx('Gast'), value: gastName ?? '–', fieldId: 'gast', keys: [] },
              { key: 'zimmer', label: tx('Zimmer'), value: zimmerName ?? '–', fieldId: 'zimmer', keys: [] },
              { key: 'anreise', label: tx('Anreise'), value: anreiseFormatted, fieldId: 'anreise', keys: [] },
              { key: 'abreise', label: tx('Abreise'), value: abreiseFormatted, fieldId: 'abreise', keys: [] },
              { key: 'status', label: tx('Neuer Status'), value: tx('Eingecheckt'), fieldId: 'status', keys: [] },
            ]}
            whatHappensNext={tx('Der Status der Buchung wird sofort auf „Eingecheckt" gesetzt.')}
            confirmLabel={tx('Jetzt einchecken')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          title={`${gastName ?? tx('Gast')} – ${zimmerName ?? tx('Zimmer')}`}
          verb="updated"
          actions={{ copy: false, print: false }}
          next={[
            { label: tx('Weiteren Gast einchecken'), onClick: restart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Der Gast ist eingecheckt. Bei der Abreise den Ablauf „Gast auschecken" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
