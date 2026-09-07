/**
 * Neue Buchung — 3-Schritt-Wizard.
 * Steps: 1) Gast wählen oder neu anlegen → 2) Zeitraum & Zimmer wählen → 3) Extras & Bestätigung.
 * Reads: gaeste, zimmer, zusatzleistungen, buchungen (Belegung).
 * Writes: buchungen (createBuchungenEntry via servicePort).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  useOccupancy,
  fieldText,
  fieldNumber,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // Step 1: Gast-Suche
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
      subtitle: fieldText(g, 'email') || fieldText(g, 'telefon') || undefined,
    }),
    orderby: ['r.v_nachname asc'],
  });

  // Step 2: Belegung (zimmer-resource) — Blocked Nights für den AvailabilityRangePicker
  // resource = buchung.get('zimmer') zum Zeitpunkt der Zimmerauswahl (noch leer → alle Blöcke anzeigen)
  const belegung = useOccupancy(servicePort, 'buchungen', {});

  // Step 2b: Zimmer-Suche — gefiltert nach frei im gewählten Zeitraum
  const buchung = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 2,
      personen: 2,
      zusatzleistungen_buchung: 3,
      bemerkung: 3,
    },
    required: { personen: false, begleitperson: false, zusatzleistungen_buchung: false, bemerkung: false },
    messages: {
      gast: tx('Bitte einen Gast auswählen oder neu anlegen.'),
      zimmer: tx('Bitte ein freies Zimmer für den gewählten Zeitraum wählen.'),
    },
  });

  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung'),
      subtitle: fieldNumber(z, 'preis_pro_nacht') != null
        ? tx`${fieldNumber(z, 'preis_pro_nacht')!.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} / Nacht`
        : undefined,
      avatar: 'none' as const,
    }),
  });

  // Step 3: Zusatzleistungen (multipleapplookup, nur aktive)
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    filter: "r.v_aktiv == True",
    where: r => r.fields['aktiv'] === true,
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name'),
      subtitle: fieldNumber(z, 'preis') != null
        ? tx`${fieldNumber(z, 'preis')!.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`
        : undefined,
      avatar: 'none' as const,
    }),
  });

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'buchung',
      entity: 'buchungen',
      form: buchung,
      primary: true,
      values: { status: 'bestaetigt' },
    },
  ], { draftKey: 'neue-buchung' });

  const gastName = buchung.get('gast') ? (buchung.labels['gast'] ?? tx('Gast')) : tx('Gast');
  const zimmerName = buchung.get('zimmer') ? (buchung.labels['zimmer'] ?? tx('Zimmer')) : tx('Zimmer');

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      subtitle={tx('Gast einbuchen in 3 Schritten')}
      currentStep={step}
      onStepChange={setStep}
      forms={[buchung]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Einen Gast für einen bestimmten Zeitraum in ein freies Zimmer einbuchen.'),
        needs: [tx('Name oder E-Mail des Gastes'), tx('Gewünschte An- und Abreise')],
      }}
    >
      {/* ── Schritt 1: Gast ── */}
      <WizardStep
        label={tx('Gast')}
        description={tx('Stammgäste suchen oder einen neuen Gast anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={buchung.get('gast') as string | null}
          onSelect={id => {
            buchung.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'], title: tx('Neuen Gast anlegen') }}
          searchPlaceholder={tx('Nach Name, E-Mail oder Telefon suchen …')}
        />
      </WizardStep>

      {/* ── Schritt 2: Zeitraum & Zimmer ── */}
      <WizardStep
        label={tx('Zeitraum & Zimmer')}
        description={tx('An- und Abreise wählen, dann ein freies Zimmer auswählen.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          {/* Zeitraum */}
          <div>
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', {
                blocked: belegung.blocked,
                minNights: 1,
              })}
              legend={tx('Belegte Nächte sind ausgegraut')}
            />
          </div>

          {/* Zimmerauswahl — nur wenn Zeitraum gewählt */}
          {anreise && abreise ? (
            <div className="space-y-2">
              <Field form={buchung} name="zimmer">
                <EntitySelectStep
                  {...zimmer.select}
                  {...buchung.records('zimmer', zimmer.labelOf)}
                  onToggle={undefined as never}
                  selectedIds={undefined as never}
                  onSelect={id => {
                    buchung.set('zimmer', id, zimmer.labelOf(id));
                  }}
                  selectedId={buchung.get('zimmer') as string | null}
                  avatar="none"
                  create={false}
                  emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
                  columns={2}
                />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tx('Bitte zuerst An- und Abreise wählen, um freie Zimmer zu sehen.')}
            </p>
          )}

          {/* Personen (optional) */}
          <Bound form={buchung} name="personen" hint={tx('Anzahl der Personen inkl. Hauptgast')} />

          <StepNav
            onNext={() => buchung.validate(['anreise', 'abreise', 'zimmer'])}
            nextStepLabel={tx('Extras & Bestätigung')}
          />
        </div>
      </WizardStep>

      {/* ── Schritt 3: Extras & Bestätigung ── */}
      <WizardStep
        label={tx('Extras & Bestätigung')}
        description={tx('Optionale Zusatzleistungen wählen und Buchung bestätigen.')}
        needs={['zimmer']}
      >
        <div className="space-y-4">
          <Field form={buchung} name="zusatzleistungen_buchung" hint={tx('Mehrfachauswahl möglich')}>
            <EntitySelectStep
              {...zusatzleistungen.select}
              {...buchung.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
              avatar="none"
              create={false}
              searchPlaceholder={tx('Zusatzleistung suchen …')}
            />
          </Field>

          <Bound form={buchung} name="bemerkung" rows={3} hint={tx('Interne Anmerkungen zur Buchung')} />

          <StepNav
            onNext={() => buchung.validate(['gast', 'anreise', 'abreise', 'zimmer'])}
            nextStepLabel={tx('Prüfen & Anlegen')}
          />
        </div>
      </WizardStep>

      {/* ── Prüfen & Anlegen ── */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            whatHappensNext={tx('Die Buchung wird sofort als „Bestätigt" angelegt und erscheint in der Buchungsübersicht.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          title={tx('Buchung angelegt')}
          whatHappensNext={tx('Den Gast beim Einchecken im Ablauf „Einchecken" empfangen.')}
          next={[
            {
              label: tx('Gast einchecken'),
              href: '#/intents/gast-einchecken',
            },
            {
              label: tx('Weitere Buchung'),
              onClick: () => { submit.reset(); buchung.reset(); setStep(1); },
            },
            {
              label: tx('Zum Dashboard'),
              href: '#/',
            },
          ]}
          facts={[
            { label: tx('Gast'), value: gastName },
            { label: tx('Zimmer'), value: zimmerName },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
