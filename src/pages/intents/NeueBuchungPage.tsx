/**
 * Neue Buchung — 4-Schritt-Wizard.
 * Steps: 1) Gast wählen → 2) Zeitraum & Zimmer → 3) Details & Extras → 4) Zusammenfassung & Anlegen.
 * Reads: gaeste, zimmer, zusatzleistungen. Writes: buchungen (createBuchungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *           StepNav, SummaryStep, SuccessStep, useStepForm, useJourneySubmit, useRecordSearch, useOccupancy.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
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
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  const buchung = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 2,
      personen: 3,
      begleitperson: 3,
      zusatzleistungen_buchung: 3,
      bemerkung: 3,
    },
  });

  const anreise = buchung.get('anreise') as string | undefined;
  const abreise = buchung.get('abreise') as string | undefined;
  const zimmerId = buchung.get('zimmer') as string | undefined;

  // Belegungsdaten: frei wenn status ∈ storniert | angefragt
  const belegung = useOccupancy(servicePort, 'buchungen', {
    resource: zimmerId,
  });

  // Gäste (Schritt 1 und Schritt 3 Begleitperson)
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname') ?? ''} ${fieldText(g, 'nachname') ?? ''}`.trim() || tx('Unbekannter Gast'),
      subtitle: fieldText(g, 'email') ?? fieldText(g, 'telefon') ?? undefined,
    }),
  });

  // Zimmer — nur freie im gewählten Zeitraum (wo: belegung.freeIn)
  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung') ?? tx('Zimmer'),
      subtitle: fieldLookup(z, 'kategorie')?.label ?? undefined,
      stats: fieldNumber(z, 'preis_pro_nacht') != null
        ? [{ label: tx('pro Nacht'), value: `${fieldNumber(z, 'preis_pro_nacht')} €` }]
        : undefined,
    }),
  });

  // Zusatzleistungen — nur aktive
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    filter: "r.v_aktiv == True",
    where: r => fieldLookup(r, 'aktiv') !== null
      ? (r.fields as Record<string, unknown>).aktiv === true
      : true,
    searchFields: ['name'],
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name') ?? tx('Zusatzleistung'),
      stats: fieldNumber(z, 'preis') != null
        ? [{ label: tx('Preis'), value: `${fieldNumber(z, 'preis')} €` }]
        : undefined,
    }),
  });

  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'buchung',
        entity: 'buchungen',
        form: buchung,
        primary: true,
        values: { status: 'bestaetigt' },
      },
    ],
    { draftKey: 'neue-buchung' },
  );

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      forms={[buchung]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Gast, Zeitraum und Zimmer wählen — die Buchung wird sofort bestätigt.'),
        needs: [tx('Name des Gastes'), tx('An- und Abreisedatum'), tx('Zimmerwahl')],
      }}
    >
      {/* Schritt 1: Gast wählen */}
      <WizardStep
        label={tx('Gast')}
        description={tx('Vorhandenen Gast suchen oder neu anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={buchung.get('gast') as string | undefined}
          onSelect={id => {
            buchung.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
          createLabel={tx('Neuen Gast anlegen')}
          searchPlaceholder={tx('Gast suchen …')}
        />
      </WizardStep>

      {/* Schritt 2: Zeitraum und Zimmer */}
      <WizardStep
        label={tx('Zeitraum & Zimmer')}
        description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut. Danach ein freies Zimmer wählen.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          <AvailabilityRangePicker
            {...buchung.range('anreise', 'abreise', { blocked: belegung.blocked })}
            disablePast
            legend
          />

          {anreise && abreise && (
            <>
              <div className="border-t pt-4">
                <EntitySelectStep
                  {...zimmer.select}
                  selectedId={buchung.get('zimmer') as string | undefined}
                  onSelect={id => {
                    buchung.set('zimmer', id, zimmer.labelOf(id));
                  }}
                  emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
                  create={false}
                  searchPlaceholder={tx('Zimmer suchen …')}
                />
              </div>
              <StepNav
                onNext={() => buchung.validate(['anreise', 'abreise', 'zimmer'])}
                nextStepLabel={tx('Details')}
              />
            </>
          )}

          {(!anreise || !abreise) && (
            <StepNav
              onNext={() => buchung.validate(['anreise', 'abreise'])}
              nextStepLabel={tx('Zimmer wählen')}
              nextDisabled
            />
          )}
        </div>
      </WizardStep>

      {/* Schritt 3: Details und Extras */}
      <WizardStep
        label={tx('Details & Extras')}
        description={tx('Personenzahl und Zusatzleistungen ergänzen.')}
        needs={['anreise', 'abreise', 'zimmer']}
      >
        <div className="space-y-4">
          <Bound form={buchung} name="personen" />

          <Field form={buchung} name="begleitperson">
            <EntitySelectStep
              {...gaeste.select}
              selectedId={buchung.get('begleitperson') as string | undefined}
              onSelect={id => {
                buchung.set('begleitperson', id, gaeste.labelOf(id));
              }}
              create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
              createLabel={tx('Neuen Gast anlegen')}
              searchPlaceholder={tx('Begleitperson suchen …')}
            />
          </Field>

          <Field form={buchung} name="zusatzleistungen_buchung">
            <EntitySelectStep
              {...zusatzleistungen.select}
              {...buchung.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
              create={false}
              emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
              searchPlaceholder={tx('Zusatzleistung suchen …')}
            />
          </Field>

          <Bound form={buchung} name="bemerkung" rows={3} />

          <StepNav
            onNext={() => buchung.validate([])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 4: Zusammenfassung */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            whatHappensNext={tx('Die Buchung wird mit Status „Bestätigt" angelegt und ist sofort in der Belegungsübersicht sichtbar.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {/* Erfolg */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          whatHappensNext={tx('Beim Eintreffen des Gastes den Ablauf „Einchecken" starten.')}
          next={[
            { label: tx('Noch eine Buchung'), onClick: () => { submit.reset(); buchung.reset(); setStep(1); } },
            { label: tx('Einchecken'), href: '#/intents/gast-einchecken' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
