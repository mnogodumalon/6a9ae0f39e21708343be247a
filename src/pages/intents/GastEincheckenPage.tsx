/**
 * Gast einchecken — 2-Schritt-Wizard.
 * Steps: 1) Buchung suchen (nur bestätigte) → 2) Details prüfen → SummaryStep → Status auf 'eingecheckt' setzen.
 * Reads: buchungen (gefiltert auf status=bestaetigt), gaeste, zimmer, zusatzleistungen.
 * Writes: buchungen (updateBuchungenEntry — status: 'eingecheckt').
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldText, fieldLookup, fieldDate, fieldRef } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { tx } from '@/i18n';
import { useState } from 'react';
import { IconLogin } from '@tabler/icons-react';

export default function GastEincheckenPage() {
  const data = useDashboardData({ omit: ['buchungen'] });
  const [step, setStep] = useState(1);

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: ['bemerkung'],
    toItem: b => {
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const subtitle = [
        fieldText(b, 'zimmerName') || '',
        anreise ? formatDate(anreise) : '',
        abreise ? `– ${formatDate(abreise)}` : '',
      ].filter(Boolean).join(' ');
      return {
        id: b.id,
        title: fieldText(b, 'gastName') || tx('Unbekannter Gast'),
        subtitle,
      };
    },
  });

  const buchungForm = useStepForm('buchungen', {
    steps: { buchung: 1 },
  });

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'einchecken',
      run: async () => {
        const buchungId = buchungForm.get('buchung') as string;
        return LivingAppsService.updateBuchungenEntry(buchungId, { status: 'eingecheckt' });
      },
    },
  ], { draftKey: 'gast-einchecken' });

  const restart = () => { submit.reset(); buchungForm.reset(); setStep(1); };

  // Daten der gewählten Buchung für den Bestätigungs-Step
  const buchungId = buchungForm.get('buchung') as string | undefined;
  const buchungRecord = buchungId ? buchungen.recordOf(buchungId) : null;

  const gastName = buchungRecord ? (fieldText(buchungRecord, 'gastName') || tx('Unbekannt')) : '—';
  const zimmerName = buchungRecord ? (fieldText(buchungRecord, 'zimmerName') || tx('Unbekannt')) : '—';
  const anreise = buchungRecord ? fieldDate(buchungRecord, 'anreise') : null;
  const abreise = buchungRecord ? fieldDate(buchungRecord, 'abreise') : null;
  const personen = buchungRecord ? buchungRecord.fields['personen'] as number | undefined : undefined;
  const zusatzleistungen = buchungRecord ? (buchungRecord.fields['zusatzleistungen_buchungName'] as string | undefined) : undefined;

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      loading={data.loading}
      error={data.error}
      onRetry={data.fetchAll}
      forms={[buchungForm]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Bestätigte Buchung finden und den Gast einchecken.'),
        needs: [tx('Name des Gastes oder Zimmernummer')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Welche Buchung?')}
        description={tx('Nur bestätigte Buchungen werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId}
          onSelect={id => {
            buchungForm.set('buchung', id, buchungen.labelOf(id));
            setStep(2);
          }}
          emptyText={tx('Keine bestätigte Buchung gefunden. Bitte Suchbegriff ändern.')}
          create={false}
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
        />
      </WizardStep>

      <WizardStep
        label={tx('Prüfen')}
        heading={tx('Alles korrekt?')}
        description={tx('Buchungsdetails vor dem Einchecken prüfen.')}
      >
        {buchungId ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-card shadow-lg p-5 space-y-3">
              <div className="flex items-center gap-2 text-primary">
                <IconLogin size={20} stroke={1.5} />
                <span className="font-semibold text-base">{gastName}</span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">{tx('Zimmer')}</dt>
                  <dd className="font-medium truncate">{zimmerName}</dd>
                </div>
                {typeof personen === 'number' && (
                  <div>
                    <dt className="text-muted-foreground">{tx('Personen')}</dt>
                    <dd className="font-medium">{personen}</dd>
                  </div>
                )}
                {anreise && (
                  <div>
                    <dt className="text-muted-foreground">{tx('Anreise')}</dt>
                    <dd className="font-medium">{formatDate(anreise)}</dd>
                  </div>
                )}
                {abreise && (
                  <div>
                    <dt className="text-muted-foreground">{tx('Abreise')}</dt>
                    <dd className="font-medium">{formatDate(abreise)}</dd>
                  </div>
                )}
                {zusatzleistungen && (
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">{tx('Zusatzleistungen')}</dt>
                    <dd className="font-medium">{zusatzleistungen}</dd>
                  </div>
                )}
              </dl>
            </div>
            <StepNav
              onNext={() => buchungForm.validate(['buchung'])}
              nextStepLabel={tx('Bestätigen')}
            />
          </div>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Bitte zuerst eine Buchung auswählen.')}
          </StepNav>
        )}
      </WizardStep>

      <WizardStep label={tx('Abschluss')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchungForm]}
            submit={submit}
            title={tx('Einchecken bestätigen')}
            confirmLabel={tx('Jetzt einchecken')}
            items={[
              { key: 'gast', label: tx('Gast'), value: gastName, keys: ['buchung'], fieldId: 'gast' },
              { key: 'zimmer', label: tx('Zimmer'), value: zimmerName, keys: ['buchung'], fieldId: 'zimmer' },
              ...(anreise ? [{ key: 'anreise', label: tx('Anreise'), value: formatDate(anreise), keys: ['buchung'], fieldId: 'anreise' }] : []),
              ...(abreise ? [{ key: 'abreise', label: tx('Abreise'), value: formatDate(abreise), keys: ['buchung'], fieldId: 'abreise' }] : []),
            ]}
            whatHappensNext={tx('Die Buchung wird auf "Eingecheckt" gesetzt und ist sofort im System sichtbar.')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          verb="updated"
          actions={{ copy: false, print: false }}
          next={[
            { label: tx('Weiteren Gast einchecken'), onClick: restart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Beim Auschecken den Ablauf „Gast auschecken" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
