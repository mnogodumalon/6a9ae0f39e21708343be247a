/**
 * Rechnung stellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (ausgecheckt oder bestätigt) → 2) Rechnungsdetails erfassen → 3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert nach status). Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, Bound, Field, ChoiceGroup,
 *           StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { addDays, differenceInCalendarDays, parseISO } from 'date-fns';
import { format } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Bound } from '@/components/blocks/Bound';
import { Field } from '@/components/blocks/Field';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useRecordSearch,
  useStepForm,
  useJourneySubmit,
  fieldText,
  fieldLookup,
  fieldDate,
  fieldNumber,
  fieldRef,
  todayIso,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function RechnungStellenPage() {
  const [step, setStep] = useState(1);

  // Schritt 1: Buchungen mit Status 'ausgecheckt' oder 'bestaetigt' suchen
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    searchFields: ['bemerkung'],
    filter: "r.v_status in ['ausgecheckt', 'bestaetigt']",
    where: r => {
      const s = fieldLookup(r, 'status');
      return s?.key === 'ausgecheckt' || s?.key === 'bestaetigt';
    },
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerName = ctx.ref('zimmer') ?? '';
      const anreise = fieldDate(b, 'anreise') ?? '';
      const abreise = fieldDate(b, 'abreise') ?? '';
      const zeitraum = anreise && abreise
        ? `${anreise} – ${abreise}`
        : anreise || '';
      return {
        id: b.id,
        title: gastName,
        subtitle: [zimmerName, zeitraum].filter(Boolean).join(' · '),
        status: fieldLookup(b, 'status') ?? undefined,
      };
    },
  });

  // Hilfsfunktion: Betrag aus Buchungsdaten vorausberechnen
  const computeBetrag = (buchungId: string): string => {
    const rec = buchungen.recordOf(buchungId);
    if (!rec) return '';
    const anreise = fieldDate(rec, 'anreise');
    const abreise = fieldDate(rec, 'abreise');
    const preis = fieldNumber(rec, 'preis_pro_nacht');
    if (!anreise || !abreise || preis == null) return '';
    const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
    if (naechte <= 0) return '';
    return String(Math.round(naechte * preis * 100) / 100);
  };

  // Schritt 2: Rechnungsformular
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
    {
      key: 'rechnung',
      entity: 'rechnungen',
      form: rechnung,
      primary: true,
    },
  ], { draftKey: 'rechnung-stellen' });

  const buchungId = rechnung.get('buchung') as string | undefined;

  // Wenn eine Buchung gewählt wird, Betrag vorausfüllen
  const handleBuchungSelect = (id: string) => {
    rechnung.set('buchung', id, buchungen.labelOf(id));
    const betrag = computeBetrag(id);
    if (betrag) {
      rechnung.set('betrag', betrag);
    }
    setStep(2);
  };

  return (
    <IntentWizardShell
      title={tx('Rechnung stellen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[rechnung]}
      draftKey="rechnung-stellen"
      intro={{
        description: tx('Zu einer abgeschlossenen oder bestätigten Buchung eine Rechnung anlegen.'),
        needs: [tx('Eine ausgecheckte oder bestätigte Buchung')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Bitte eine ausgecheckte oder bestätigte Buchung auswählen, für die noch keine Rechnung gestellt wurde.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId ?? null}
          onSelect={handleBuchungSelect}
          emptyText={tx('Keine Buchungen mit dem Status „ausgecheckt" oder „bestätigt" gefunden.')}
          avatar="none"
          create={false}
        />
      </WizardStep>

      {/* Schritt 2: Rechnungsdetails */}
      <WizardStep
        label={tx('Rechnung')}
        description={tx('Betrag, Datum und Zahlungsstatus für die Rechnung festlegen.')}
        needs={['buchung']}
      >
        <div className="space-y-4">
          <Bound
            form={rechnung}
            name="betrag"
            hint={tx('Betrag in €, ggf. aus Preis pro Nacht × Nächte vorausgefüllt')}
          />
          <Bound form={rechnung} name="rechnungsdatum" />
          <Bound form={rechnung} name="faellig_am" />
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

      {/* Schritt 3: Prüfen & Anlegen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung wird sofort angelegt und erscheint in der Rechnungsübersicht.')}
          />
        )}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          submit={submit}
          whatHappensNext={tx('Die Rechnung ist gespeichert. Du kannst sie in der Rechnungsübersicht einsehen.')}
          next={[
            { label: tx('Weitere Rechnung stellen'), href: '#/intents/rechnung-stellen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
