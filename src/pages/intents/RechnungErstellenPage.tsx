/**
 * Rechnung erstellen — 2-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur ausgecheckte ohne bestehende Rechnung) → 2) Rechnungsdetails → 3) Prüfen & anlegen.
 * Reads: buchungen, rechnungen, gaeste (via ref), zimmer (via ref).
 * Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, ChoiceGroup, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate, todayIso } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LOOKUP_OPTIONS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import { tx } from '@/i18n';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';
import { Input } from '@/components/ui/input';

const today = new Date();
const in14Days = format(addDays(today, 14), 'yyyy-MM-dd');

export default function RechnungErstellenPage() {
  // Keep rechnungen in data to build the "already invoiced" exclusion set
  const data = useDashboardData({ omit: ['buchungen'] });
  const [step, setStep] = useState(1);

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'ausgecheckt'",
    where: r => fieldLookup(r, 'status')?.key === 'ausgecheckt',
    searchFields: [],
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerName = ctx.ref('zimmer') ?? tx('Unbekanntes Zimmer');
      const anreise = fieldDate(b, 'anreise') ?? '';
      const abreise = fieldDate(b, 'abreise') ?? '';
      return {
        id: b.id,
        title: `${gastName} — ${zimmerName}`,
        subtitle: anreise && abreise ? `${anreise} – ${abreise}` : undefined,
        stats: [
          ...(anreise ? [{ label: tx('Anreise'), value: anreise }] : []),
          ...(abreise ? [{ label: tx('Abreise'), value: abreise }] : []),
        ],
      };
    },
  });

  const rechnung = useStepForm('rechnungen', {
    steps: { buchung: 1, betrag: 2, rechnungsdatum: 2, faellig_am: 2, zahlungsstatus: 2 },
    initial: {
      rechnungsdatum: todayIso(),
      faellig_am: in14Days,
      zahlungsstatus: LOOKUP_OPTIONS['rechnungen']?.['zahlungsstatus']?.[0]?.key ?? 'offen',
    },
  });

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'rechnung',
      entity: 'rechnungen',
      form: rechnung,
      primary: true,
      values: { buchung: rechnung.get('buchung') as string },
    },
  ], { draftKey: 'rechnung-erstellen' });

  const restart = () => { submit.reset(); rechnung.reset(); setStep(1); };

  // Build a set of buchung IDs that already have a Rechnung
  const buchungIdsMitRechnung = new Set(
    data.rechnungen
      .map(r => extractRecordId(r.fields.buchung))
      .filter((id): id is string => Boolean(id))
  );

  // Client-side exclusion: hide buchungen that already have a Rechnung
  const buchungenFiltered = {
    ...buchungen.select,
    items: buchungen.select.items.filter(item => !buchungIdsMitRechnung.has(item.id)),
  };

  const selectedBuchungId = rechnung.get('buchung') as string | undefined;
  const selectedBuchung = selectedBuchungId ? buchungen.recordOf(selectedBuchungId) : null;

  return (
    <IntentWizardShell
      title={tx('Rechnung erstellen')}
      currentStep={step}
      onStepChange={setStep}
      loading={data.loading}
      error={data.error}
      onRetry={data.fetchAll}
      forms={[rechnung]}
      draftKey="rechnung-erstellen"
      intro={{
        description: tx('Eine ausgecheckte Buchung auswählen und die Rechnung ausstellen.'),
        needs: [tx('Ausgecheckte Buchung'), tx('Rechnungsbetrag in EUR')],
      }}
    >
      <WizardStep
        label={tx('Buchung wählen')}
        description={tx('Nur ausgecheckte Buchungen ohne bestehende Rechnung werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungenFiltered}
          selectedId={selectedBuchungId}
          emptyText={tx('Keine ausgecheckten Buchungen ohne Rechnung gefunden.')}
          searchPlaceholder={tx('Nach Gast oder Zimmer suchen …')}
          onSelect={id => {
            rechnung.set('buchung', id, buchungen.labelOf(id));
            setStep(2);
          }}
          create={false}
        />
      </WizardStep>

      <WizardStep
        label={tx('Rechnung')}
        description={tx('Betrag, Datum und Zahlungsstatus der Rechnung erfassen.')}
      >
        {rechnung.get('buchung') ? (
          <div className="space-y-5">
            {selectedBuchung && (
              <div className="rounded-xl bg-secondary p-4 text-sm space-y-1">
                <p className="font-medium">{buchungen.labelOf(selectedBuchungId!)}</p>
                {fieldDate(selectedBuchung, 'anreise') && (
                  <p className="text-muted-foreground">
                    {tx('Anreise')}: {fieldDate(selectedBuchung, 'anreise')}
                    {fieldDate(selectedBuchung, 'abreise') && ` – ${tx('Abreise')}: ${fieldDate(selectedBuchung, 'abreise')}`}
                  </p>
                )}
              </div>
            )}

            <Field form={rechnung} name="betrag" hint={tx('In EUR, z. B. 149.50')}>
              <Input {...rechnung.number('betrag')} placeholder="0.00" />
            </Field>

            <Bound form={rechnung} name="rechnungsdatum" />
            <Bound form={rechnung} name="faellig_am" />

            <Field form={rechnung} name="zahlungsstatus">
              <ChoiceGroup
                {...rechnung.choice('zahlungsstatus')}
                options={LOOKUP_OPTIONS['rechnungen']?.['zahlungsstatus'] ?? []}
              />
            </Field>

            <StepNav
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
            whatHappensNext={tx('Die Rechnung wird der Buchung zugeordnet und erscheint sofort in der Rechnungsübersicht.')}
            confirmLabel={tx('Rechnung ausstellen')}
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
          whatHappensNext={tx('Die Rechnung kann in der Rechnungsübersicht eingesehen und bei Zahlungseingang aktualisiert werden.')}
        />
      )}
    </IntentWizardShell>
  );
}
