/**
 * Neue Buchung — 4-Schritt-Wizard.
 * Steps: 1) Gast wählen → 2) Zeitraum wählen → 3) Zimmer wählen → 4) Details → 5) Prüfen & anlegen.
 * Reads: gaeste, zimmer, zusatzleistungen, buchungen (Belegung). Writes: buchungen.
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *   StepNav, Field, Bound, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  useOccupancy,
  fieldText,
  fieldNumber,
  fieldLookup,
  combineFilters,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // Gast-Suche (Schritt 1)
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
      subtitle: fieldText(g, 'email') || fieldText(g, 'telefon'),
    }),
    orderby: ['r.v_nachname asc'],
  });

  // Hauptformular für buchungen
  const buchung = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 3,
      zusatzleistungen_buchung: 4,
      personen: 4,
      begleitperson: 4,
      bemerkung: 4,
    },
    required: {
      begleitperson: false,
      zusatzleistungen_buchung: false,
      personen: false,
      bemerkung: false,
    },
  });

  // Anreise/Abreise aus dem Formular lesen (für Verfügbarkeitscheck)
  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;
  const zimmerId = buchung.get('zimmer') as string | null;

  // Belegung — für AvailabilityRangePicker immer mit aktuellem Zimmer
  const belegung = useOccupancy(servicePort, 'buchungen', {
    resource: zimmerId ?? undefined,
  });

  // Zimmer-Suche — nach Verfügbarkeit filtern wenn Zeitraum gewählt
  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung'),
      subtitle: [
        fieldLookup(z, 'kategorie')?.label,
        fieldNumber(z, 'preis_pro_nacht') != null
          ? tx`${fieldNumber(z, 'preis_pro_nacht')?.toLocaleString('de-DE')} €/Nacht`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
    }),
  });

  // Zusatzleistungen — nur aktive
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    filter: "r.v_aktiv == True",
    where: r => r.fields['aktiv'] === true,
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name'),
      subtitle: fieldNumber(z, 'preis') != null
        ? `${fieldNumber(z, 'preis')?.toLocaleString('de-DE')} €`
        : undefined,
    }),
  });

  // Begleitperson — alle Gäste
  const begleitpersonen = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
    }),
  });

  // Plan: buchungen anlegen
  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'buchung',
        entity: 'buchungen',
        form: buchung,
        values: { status: 'bestaetigt' },
        primary: true,
      },
    ],
    { draftKey: 'neue-buchung' },
  );

  const gastName = buchung.get('gast')
    ? gaeste.labelOf(buchung.get('gast') as string) ?? tx('Gast')
    : null;
  const zimmerName = buchung.get('zimmer')
    ? zimmer.labelOf(buchung.get('zimmer') as string) ?? tx('Zimmer')
    : null;

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      forms={[buchung]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Gast und Zimmer buchen — freie Zimmer im gewählten Zeitraum.'),
        needs: [tx('Name des Gastes'), tx('Anreise- und Abreisedatum')],
      }}
    >
      {/* Schritt 1: Gast wählen */}
      <WizardStep
        label={tx('Gast')}
        description={tx('Gast suchen oder neu anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={buchung.get('gast') as string | null}
          onSelect={id => {
            buchung.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          avatar="initials"
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
          searchPlaceholder={tx('Name oder E-Mail …')}
        />
      </WizardStep>

      {/* Schritt 2: Zeitraum wählen */}
      <WizardStep
        label={tx('Zeitraum')}
        description={tx('An- und Abreisedatum wählen.')}
        needs={['gast']}
      >
        <div className="space-y-4">
          <AvailabilityRangePicker
            {...buchung.range('anreise', 'abreise', {
              blocked: [],
              unit: 'nights',
            })}
          />
          <StepNav
            onNext={() => buchung.validate(['anreise', 'abreise'])}
            nextStepLabel={tx('Zimmer')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3: Zimmer wählen */}
      <WizardStep
        label={tx('Zimmer')}
        description={
          anreise && abreise
            ? tx('Nur freie Zimmer im gewählten Zeitraum.')
            : tx('Alle verfügbaren Zimmer.')
        }
        needs={['anreise', 'abreise']}
      >
        <EntitySelectStep
          {...zimmer.select}
          selectedId={buchung.get('zimmer') as string | null}
          onSelect={id => {
            buchung.set('zimmer', id, zimmer.labelOf(id));
            setStep(4);
          }}
          avatar="none"
          emptyText={tx('Im gewählten Zeitraum sind keine Zimmer frei.')}
          create={false}
          searchPlaceholder={tx('Zimmerbezeichnung …')}
        />
      </WizardStep>

      {/* Schritt 4: Details */}
      <WizardStep
        label={tx('Details')}
        description={tx('Zusatzleistungen und weitere Angaben (alle optional).')}
        needs={['zimmer']}
      >
        <div className="space-y-6">
          {/* Zusatzleistungen — multipleapplookup multi-pick */}
          <Field form={buchung} name="zusatzleistungen_buchung">
            <EntitySelectStep
              {...zusatzleistungen.select}
              {...buchung.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
              avatar="none"
              emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
              create={false}
            />
          </Field>

          <Bound form={buchung} name="personen" hint={tx('Anzahl Personen')} />

          {/* Begleitperson — single applookup */}
          <Field form={buchung} name="begleitperson">
            <EntitySelectStep
              {...begleitpersonen.select}
              selectedId={buchung.get('begleitperson') as string | null}
              onSelect={id => buchung.set('begleitperson', id, begleitpersonen.labelOf(id))}
              avatar="initials"
              create={false}
              searchPlaceholder={tx('Name der Begleitperson …')}
            />
          </Field>

          <Bound form={buchung} name="bemerkung" rows={3} />

          <StepNav
            onNext={() => buchung.validate(['personen'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 5: Prüfen & anlegen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            whatHappensNext={tx(
              'Die Buchung wird sofort als bestätigt angelegt und erscheint in der Übersicht.',
            )}
          />
        )}
      </WizardStep>

      {/* Erfolg */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          submit={submit}
          next={[
            { label: tx('Gast einchecken'), href: '#/intents/gast-einchecken' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx(
            'Den Gast beim Einchecken über den Ablauf „Gast einchecken" erfassen.',
          )}
        />
      )}
    </IntentWizardShell>
  );
}
