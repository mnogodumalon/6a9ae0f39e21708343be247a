/**
 * Rechnung erstellen — 4-Schritt-Wizard.
 * Steps: 1) Buchung wählen (ausgecheckt oder bestätigt, noch keine Rechnung) →
 *        2) Rechnungsdetails (Betrag, Datum, Fälligkeit, Zahlungsstatus) →
 *        3) Zusammenfassung & Anlegen →
 *        4) Erfolg.
 * Reads: buchungen (gefiltert auf status ausgecheckt/bestaetigt), rechnungen (für Exists-Check).
 * Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, ChoiceGroup, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Field } from '@/components/blocks/Field';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/DatePicker';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate, todayIso } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LOOKUP_OPTIONS } from '@/types/app';
import { tx } from '@/i18n';
import { format, addDays, parseISO } from 'date-fns';

const HEX_ID_RE = /([0-9a-f]{24})\/?$/;

function extractId(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  const m = HEX_ID_RE.exec(url.trim());
  return m ? m[1] : null;
}

export default function RechnungErstellenPage() {
  const [step, setStep] = useState(1);

  // Rechnungen laden, um zu ermitteln welche Buchungen bereits eine Rechnung haben.
  // buchungen werden über useRecordSearch gesucht, daher hier omit.
  const data = useDashboardData({ omit: ['gaeste', 'zimmer', 'zusatzleistungen', 'buchungen'] });

  const rechnungenBuchungIds = new Set(
    data.rechnungen
      .map(r => extractId(r.fields.buchung))
      .filter((id): id is string => id !== null)
  );

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'ausgecheckt' or r.v_status == 'bestaetigt'",
    where: r => {
      const statusKey = fieldLookup(r, 'status')?.key;
      return (statusKey === 'ausgecheckt' || statusKey === 'bestaetigt') &&
        !rechnungenBuchungIds.has(r.id);
    },
    searchFields: [],
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('gast') ?? tx('Ohne Gast'),
      subtitle: ctx.ref('zimmer') ?? '',
      stats: [
        {
          label: tx('Anreise'),
          value: fieldDate(b, 'anreise')
            ? format(parseISO(fieldDate(b, 'anreise')!), 'dd.MM.yyyy')
            : '—',
        },
        {
          label: tx('Abreise'),
          value: fieldDate(b, 'abreise')
            ? format(parseISO(fieldDate(b, 'abreise')!), 'dd.MM.yyyy')
            : '—',
        },
      ],
    }),
  });

  const zahlungsstatusOptions = LOOKUP_OPTIONS?.['rechnungen']?.['zahlungsstatus'] ?? [];
  const defaultZahlungsstatus = zahlungsstatusOptions[0]?.key ?? 'offen';

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
      faellig_am: format(addDays(new Date(), 14), 'yyyy-MM-dd'),
      zahlungsstatus: defaultZahlungsstatus,
    },
  });

  // Plan: buchung als plain id — der Port konvertiert in die RecordUrl
  const submit = useJourneySubmit(servicePort, [
    {
      key: 'rechnung',
      entity: 'rechnungen',
      form: rechnung,
      primary: true,
    },
  ], { draftKey: 'rechnung-erstellen' });

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
        description: tx('Zu einer ausgecheckten oder bestätigten Buchung eine Rechnung anlegen.'),
        needs: [tx('Buchung auswählen'), tx('Gesamtbetrag'), tx('Rechnungsdatum')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        description={tx('Buchung wählen, für die noch keine Rechnung existiert.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={rechnung.get('buchung') as string | undefined}
          onSelect={id => {
            rechnung.set('buchung', id, buchungen.labelOf(id));
            setStep(2);
          }}
          emptyText={tx('Keine ausgecheckten oder bestätigten Buchungen ohne Rechnung gefunden.')}
          create={false}
        />
      </WizardStep>

      <WizardStep
        label={tx('Rechnungsdetails')}
        description={tx('Betrag, Datum und Zahlungsstatus der Rechnung erfassen.')}
        needs={['buchung']}
      >
        <div className="space-y-4">
          <Field form={rechnung} name="betrag" hint={tx('Gesamtbetrag inkl. Zusatzleistungen eingeben')}>
            <Input {...rechnung.number('betrag')} />
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
      </WizardStep>

      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung wird sofort angelegt und ist in der Buchungsübersicht sichtbar.')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          submit={submit}
          next={[
            { label: tx('Weitere Rechnung erstellen'), href: '#/intents/rechnung-erstellen' },
            { label: tx('Neue Buchung'), href: '#/intents/neue-buchung' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Die Rechnung ist angelegt und kann bei Bedarf gedruckt werden.')}
        />
      )}
    </IntentWizardShell>
  );
}
