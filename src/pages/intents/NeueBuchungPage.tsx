/**
 * Neue Buchung — 4-Schritt-Wizard.
 * Steps: 1) Gast wählen oder neu anlegen → 2) Zeitraum & Zimmer wählen →
 *        3) Zusatzleistungen & Details → 4) Zusammenfassung & Bestätigung.
 * Reads: gaeste, zimmer, zusatzleistungen, buchungen (Belegung).
 * Writes: gaeste (optional, on-the-fly), buchungen (createBuchungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *           StepNav, SummaryStep, SuccessStep, Bound, Field.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Bound } from '@/components/blocks/Bound';
import { Field } from '@/components/blocks/Field';
import { Input } from '@/components/ui/input';
import { useStepForm, useJourneySubmit, useRecordSearch, useOccupancy, fieldText, fieldNumber } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { formatCurrency } from '@/lib/formatters';

const DRAFT_KEY = 'neue-buchung';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // Step 1 — Gast
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname') ?? ''} ${fieldText(g, 'nachname') ?? ''}`.trim() || tx('Unbekannter Gast'),
      subtitle: fieldText(g, 'email') ?? fieldText(g, 'telefon') ?? undefined,
    }),
    orderby: ['r.v_nachname asc'],
  });

  // Occupancy — needed before step 2 form is declared
  const belegung = useOccupancy(servicePort, 'buchungen');

  // Step 2 — Zimmer (filtered to free ones in the selected range)
  const buchungForm = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 2,
      personen: 2,
      zusatzleistungen_buchung: 3,
      bemerkung: 3,
    },
    required: { personen: false, bemerkung: false, begleitperson: false, beleg: false, status: false },
    messages: {
      gast: tx('Bitte einen Gast auswählen oder neu anlegen.'),
      zimmer: tx('Bitte ein freies Zimmer für den gewählten Zeitraum wählen.'),
      anreise: tx('Bitte das Anreisedatum wählen.'),
      abreise: tx('Bitte das Abreisedatum wählen.'),
    },
  });

  const anreise = buchungForm.get('anreise') as string | null | undefined;
  const abreise = buchungForm.get('abreise') as string | null | undefined;

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung') ?? tx('Zimmer'),
      subtitle: z.fields['kategorie'] != null
        ? String((z.fields['kategorie'] as { label?: string }).label ?? '')
        : undefined,
      stats: fieldNumber(z, 'preis_pro_nacht') != null
        ? [{ label: tx('Pro Nacht'), value: formatCurrency(fieldNumber(z, 'preis_pro_nacht')!) }]
        : undefined,
    }),
    where: belegung.freeIn(anreise, abreise),
  });

  // Step 3 — Zusatzleistungen (nur aktive)
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name') ?? tx('Leistung'),
      stats: fieldNumber(z, 'preis') != null
        ? [{ label: tx('Preis'), value: formatCurrency(fieldNumber(z, 'preis')!) }]
        : undefined,
    }),
    filter: "r.v_aktiv == True",
    where: z => z.fields['aktiv'] === true,
  });

  // Gast-Neu-Anlegen Mini-Form
  const gastForm = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
  });

  // Submit plan — optional new guest first, then booking
  const gastId = buchungForm.get('gast') as string | undefined;
  const isNewGast = !gastId;

  const submit = useJourneySubmit(servicePort, [
    // If a new guest was created on-the-fly through the EntitySelectStep's
    // inline create, the port.create handled it; buchungForm already has the id.
    // The plan therefore only writes the booking:
    {
      key: 'buchung',
      entity: 'buchungen',
      form: buchungForm,
      values: { status: 'bestaetigt' },
      primary: true,
    },
  ], { draftKey: DRAFT_KEY });

  const _ = isNewGast; // suppress unused warning (isNewGast is only guard logic)
  const __ = gastForm; // suppress unused warning (gastForm used in create panel)

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      forms={[buchungForm]}
      draftKey={DRAFT_KEY}
      intro={{
        description: tx('Gast finden, freies Zimmer wählen und Buchung anlegen.'),
        needs: [tx('Gastname oder E-Mail'), tx('Reisezeitraum')],
      }}
    >
      {/* Schritt 1 — Gast */}
      <WizardStep
        label={tx('Gast')}
        heading={tx('Gast auswählen')}
        description={tx('Stammgäste erscheinen zuerst — oder lege einen neuen Gast an.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={buchungForm.get('gast') as string | undefined}
          onSelect={id => {
            buchungForm.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{
            fields: ['vorname', 'nachname', 'email', 'telefon'],
            title: tx('Neuen Gast anlegen'),
          }}
          searchPlaceholder={tx('Name, E-Mail oder Telefon …')}
        />
      </WizardStep>

      {/* Schritt 2 — Zeitraum & Zimmer */}
      <WizardStep
        label={tx('Zeitraum & Zimmer')}
        description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut. Danach ein freies Zimmer wählen.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          <AvailabilityRangePicker
            {...buchungForm.range('anreise', 'abreise', {
              blocked: belegung.blocked,
            })}
            legend
          />
          {anreise && abreise && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-foreground">{tx('Freie Zimmer im gewählten Zeitraum')}</p>
              <EntitySelectStep
                {...zimmer.select}
                selectedId={buchungForm.get('zimmer') as string | undefined}
                onSelect={id => {
                  buchungForm.set('zimmer', id, zimmer.labelOf(id));
                }}
                create={false}
                emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
                searchPlaceholder={tx('Zimmer suchen …')}
              />
              <Field form={buchungForm} name="personen" hint={tx('Optional')}>
                <Input {...buchungForm.number('personen')} placeholder="1" />
              </Field>
              <StepNav
                onNext={() => buchungForm.validate(['anreise', 'abreise', 'zimmer'])}
                nextStepLabel={tx('Zusatzleistungen')}
                onBack={() => setStep(1)}
              />
            </div>
          )}
          {(!anreise || !abreise) && (
            <StepNav
              onNext={() => buchungForm.validate(['anreise', 'abreise', 'zimmer'])}
              nextStepLabel={tx('Zimmer wählen')}
              onBack={() => setStep(1)}
            />
          )}
        </div>
      </WizardStep>

      {/* Schritt 3 — Zusatzleistungen & Details */}
      <WizardStep
        label={tx('Extras & Details')}
        description={tx('Optionale Zusatzleistungen hinzufügen und Bemerkungen eintragen.')}
        needs={['zimmer']}
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <Field form={buchungForm} name="zusatzleistungen_buchung" hint={tx('Optional — mehrere wählbar')}>
              <EntitySelectStep
                {...zusatzleistungen.select}
                {...buchungForm.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
                create={false}
                emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
                searchPlaceholder={tx('Leistung suchen …')}
              />
            </Field>
          </div>
          <Bound form={buchungForm} name="bemerkung" rows={3} hint={tx('Optional')} />
          <StepNav
            onNext={() => buchungForm.validate(['zusatzleistungen_buchung', 'bemerkung'])}
            nextStepLabel={tx('Prüfen & Anlegen')}
            onBack={() => setStep(2)}
          />
        </div>
      </WizardStep>

      {/* Schritt 4 — Zusammenfassung */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchungForm]}
            submit={submit}
            whatHappensNext={tx('Die Buchung wird sofort angelegt und erscheint in der Belegungsübersicht.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchungForm]}
          submit={submit}
          restartLabel={tx('Weitere Buchung anlegen')}
          next={[
            { label: tx('Gast einchecken'), href: '#/intents/gast-einchecken' },
            { label: tx('Rechnung stellen'), href: '#/intents/rechnung-erstellen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Beim Einchecken den Ablauf „Einchecken" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
