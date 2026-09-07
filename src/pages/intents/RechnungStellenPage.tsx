/**
 * Rechnung stellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur eingecheckt/ausgecheckt) → 2) Rechnungsdaten erfassen → 3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert nach status). Writes: rechnungen (createRechnungenEntry); optional update buchungen status.
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, ChoiceGroup, Bound, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { addDays, format } from 'date-fns';
import { IconAlertTriangle } from '@tabler/icons-react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useRecordSearch,
  useRecordCount,
  useStepForm,
  useJourneySubmit,
  fieldLookup,
  fieldDate,
  fieldRef,
  refFilter,
  todayIso,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

const DRAFT_KEY = 'rechnung-stellen';

export default function RechnungStellenPage() {
  const [step, setStep] = useState(1);
  const [gewaehlterBuchungId, setGewaehlterBuchungId] = useState<string | null>(null);
  const [gastName, setGastName] = useState<string>('');

  // Step 1: Buchung — nur eingecheckt oder ausgecheckt qualifizieren
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status in ['eingecheckt', 'ausgecheckt']",
    where: r => {
      const key = fieldLookup(r, 'status')?.key;
      return key === 'eingecheckt' || key === 'ausgecheckt';
    },
    searchFields: [],
    toItem: (b, ctx) => ({
      id: b.id,
      title: ctx.ref('gast') ?? tx('Ohne Gast'),
      subtitle: [ctx.ref('zimmer'), fieldDate(b, 'anreise') && fieldDate(b, 'abreise') ? `${fieldDate(b, 'anreise')} – ${fieldDate(b, 'abreise')}` : undefined].filter(Boolean).join(' · '),
      status: fieldLookup(b, 'status') ?? undefined,
    }),
  });

  // Prüfen ob für diese Buchung bereits eine Rechnung existiert
  const existierendeRechnungen = useRecordCount(servicePort, 'rechnungen', {
    filter: gewaehlterBuchungId ? refFilter('buchung', gewaehlterBuchungId) : undefined,
    where: r => fieldRef(r, 'buchung') === gewaehlterBuchungId,
    enabled: Boolean(gewaehlterBuchungId),
  });

  // Berechne Standard-Fälligkeitsdatum (14 Tage nach heute)
  const defaultFaelligAm = format(addDays(new Date(), 14), 'yyyy-MM-dd');

  // Step 2: Rechnungsdaten
  const rechnungForm = useStepForm('rechnungen', {
    fields: ['betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus'],
    steps: { betrag: 2, rechnungsdatum: 2, faellig_am: 2, zahlungsstatus: 2 },
    required: { faellig_am: false, rechnungsdatum: false, zahlungsstatus: false },
    initial: {
      rechnungsdatum: todayIso(),
      faellig_am: defaultFaelligAm,
      zahlungsstatus: 'offen',
    },
  });

  // Plan: Rechnung anlegen (buchung als plain id, der Port konvertiert)
  // Optional: buchung auf 'ausgecheckt' setzen wenn noch 'eingecheckt'
  const submit = useJourneySubmit(servicePort, [
    {
      key: 'rechnung',
      entity: 'rechnungen',
      form: rechnungForm,
      values: { buchung: gewaehlterBuchungId ?? '' },
      primary: true,
    },
    {
      key: 'status_update',
      run: async () => {
        if (!gewaehlterBuchungId) return;
        const buchungRecord = buchungen.recordOf(gewaehlterBuchungId);
        if (!buchungRecord) return;
        if (fieldLookup(buchungRecord, 'status')?.key === 'eingecheckt') {
          await servicePort.update('buchungen', gewaehlterBuchungId, { status: 'ausgecheckt' });
        }
      },
    },
  ], { draftKey: DRAFT_KEY });

  const handleRestart = () => {
    submit.reset();
    rechnungForm.reset({ rechnungsdatum: todayIso(), faellig_am: defaultFaelligAm, zahlungsstatus: 'offen' });
    setGewaehlterBuchungId(null);
    setGastName('');
    setStep(1);
  };

  // Labels für SuccessStep
  const buchungRecord = gewaehlterBuchungId ? buchungen.recordOf(gewaehlterBuchungId) : undefined;
  const zimmerName = buchungRecord ? (buchungen.refLabel(buchungRecord, 'zimmer') ?? '') : '';

  return (
    <IntentWizardShell
      title={tx('Rechnung stellen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[rechnungForm]}
      draftKey={DRAFT_KEY}
      intro={{
        description: tx('Für eine bestehende Buchung eine Rechnung anlegen.'),
        needs: [tx('Buchung (eingecheckt oder ausgecheckt)'), tx('Rechnungsbetrag in EUR')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Nur Buchungen mit Status „Eingecheckt" oder „Ausgecheckt" können abgerechnet werden.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={gewaehlterBuchungId ?? null}
          emptyText={tx('Keine qualifizierte Buchung gefunden — es müssen Gäste eingecheckt oder ausgecheckt sein.')}
          create={false}
          onSelect={id => {
            const rec = buchungen.recordOf(id);
            const gName = (rec ? buchungen.refLabel(rec, 'gast') : undefined) ?? buchungen.labelOf(id) ?? id;
            setGewaehlterBuchungId(id);
            setGastName(gName);
            setStep(2);
          }}
        />
        {/* Warnung: bereits eine Rechnung vorhanden */}
        {gewaehlterBuchungId && existierendeRechnungen.count !== null && existierendeRechnungen.count > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <IconAlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            <span>
              {existierendeRechnungen.count === 1
                ? tx('Für diese Buchung wurde bereits eine Rechnung erstellt.')
                : tx('Für diese Buchung wurden bereits mehrere Rechnungen erstellt.')}
            </span>
          </div>
        )}
        <StepNav
          hideBack
          onNext={() => {
            if (!gewaehlterBuchungId) return tx('Bitte eine Buchung auswählen.');
          }}
          nextStepLabel={tx('Rechnungsdaten')}
        />
      </WizardStep>

      {/* Schritt 2: Rechnungsdaten */}
      <WizardStep
        label={tx('Rechnungsdaten')}
        description={tx('Betrag, Datum und Zahlungsstatus für die Rechnung festlegen.')}
        needs={['betrag']}
      >
        <div className="space-y-4">
          <Bound form={rechnungForm} name="betrag" hint={tx('Gesamtbetrag in EUR')} />
          <Bound form={rechnungForm} name="rechnungsdatum" />
          <Bound form={rechnungForm} name="faellig_am" hint={tx('Standard: 14 Tage nach Rechnungsdatum')} />
          <Bound form={rechnungForm} name="zahlungsstatus" />
          <StepNav
            onBack={() => setStep(1)}
            onNext={() => rechnungForm.validate(['betrag'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3: Prüfen & Bestätigen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnungForm]}
            submit={submit}
            items={[
              {
                key: '_buchung',
                label: tx('Buchung'),
                value: gastName
                  ? zimmerName
                    ? `${gastName} · ${zimmerName}`
                    : gastName
                  : gewaehlterBuchungId ?? '—',
              },
            ]}
            whatHappensNext={tx('Die Rechnung wird angelegt. Wenn die Buchung noch auf „Eingecheckt" steht, wird sie automatisch auf „Ausgecheckt" gesetzt.')}
          />
        )}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnungForm]}
          facts={[
            { label: tx('Gast'), value: gastName ?? '—' },
            { label: tx('Betrag'), value: rechnungForm.get('betrag') ? `${rechnungForm.get('betrag')} €` : '—' },
            { label: tx('Fällig am'), value: (rechnungForm.get('faellig_am') as string) ?? defaultFaelligAm },
          ]}
          whatHappensNext={tx('Die Rechnung ist jetzt in der Rechnungsübersicht sichtbar.')}
          submit={submit}
          restartLabel={tx('Weitere Rechnung stellen')}
          next={[
            { label: tx('Weitere Rechnung stellen'), onClick: handleRestart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
