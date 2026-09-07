/**
 * Neue Buchung — 3-Schritt-Wizard.
 * Steps: 1) Gast finden oder neu anlegen → 2) Zeitraum & Zimmer wählen → 3) Extras & Abschluss → Prüfen & Bestätigen.
 * Reads: gaeste (search), zimmer (search, free in range), zusatzleistungen (search, aktiv=true).
 * Writes: buchungen (createBuchungenEntry) with status='bestaetigt'.
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *            StepNav, SummaryStep, SuccessStep, Bound, Field.
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
import { formatCurrency } from '@/lib/formatters';
import { IconUsers, IconCurrencyEuro } from '@tabler/icons-react';

const DRAFT_KEY = 'neue-buchung';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // Step 1: Gast
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim() || tx('Unbekannter Gast'),
      subtitle: fieldText(g, 'email') || fieldText(g, 'telefon'),
    }),
  });

  // Step 2: Zimmer mit Belegungsprüfung
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
    required: {
      // begleitperson und beleg sind für diesen Flow nicht erforderlich
      begleitperson: false,
      beleg: false,
    },
  });

  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;
  const belegung = useOccupancy(servicePort, 'buchungen', {});

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung'),
      subtitle: fieldNumber(z, 'preis_pro_nacht') != null
        ? tx`${formatCurrency(fieldNumber(z, 'preis_pro_nacht')!)} / Nacht`
        : undefined,
      stats: fieldNumber(z, 'etage') != null
        ? [{ label: tx('Etage'), value: String(fieldNumber(z, 'etage')) }]
        : [],
    }),
  });

  // Step 3: Zusatzleistungen (nur aktive)
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    filter: "r.v_aktiv == True",
    where: r => {
      const aktiv = r.fields?.aktiv;
      return aktiv === true || aktiv === 'True';
    },
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name'),
      subtitle: fieldNumber(z, 'preis') != null
        ? formatCurrency(fieldNumber(z, 'preis')!)
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
    { draftKey: DRAFT_KEY },
  );

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      forms={[buchung]}
      draftKey={DRAFT_KEY}
      intro={{
        description: tx('Gast auswählen, Zeitraum und Zimmer buchen, Extras ergänzen.'),
        needs: [tx('Gast'), tx('An- und Abreisedatum'), tx('Zimmer')],
      }}
    >
      {/* Schritt 1 — Gast */}
      <WizardStep
        label={tx('Gast')}
        heading={tx('Gast auswählen')}
        description={tx('Bestehenden Gast suchen oder neu anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={buchung.get('gast') as string}
          onSelect={id => {
            buchung.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
          createLabel={tx('Neuen Gast anlegen')}
          searchPlaceholder={tx('Nach Name, E-Mail oder Telefon suchen …')}
        />
      </WizardStep>

      {/* Schritt 2 — Zeitraum und Zimmer */}
      <WizardStep
        label={tx('Zeitraum & Zimmer')}
        heading={tx('Zeitraum und Zimmer wählen')}
        description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut. Danach ein freies Zimmer auswählen.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          {/* Zeitraum */}
          <div>
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', {
                blocked: belegung.blocked,
                unit: 'nights',
              })}
            />
          </div>

          {/* Zimmer — nur wenn Zeitraum gewählt */}
          {anreise && abreise ? (
            <div>
              <p className="text-sm font-medium text-foreground mb-3">
                {tx('Zimmer')}
              </p>
              <EntitySelectStep
                {...zimmer.select}
                selectedId={buchung.get('zimmer') as string}
                onSelect={id => {
                  buchung.set('zimmer', id, zimmer.labelOf(id));
                }}
                create={false}
                emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
                searchPlaceholder={tx('Zimmer suchen …')}
              />
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              <IconUsers size={32} className="mx-auto mb-2 text-muted-foreground" stroke={1.5} />
              {tx('Bitte zuerst An- und Abreise wählen, um freie Zimmer zu sehen.')}
            </div>
          )}

          {/* Personen */}
          <Bound form={buchung} name="personen" />

          <StepNav
            onBack={() => setStep(1)}
            onNext={() => buchung.validate(['anreise', 'abreise', 'zimmer'])}
            nextStepLabel={tx('Extras')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3 — Extras */}
      <WizardStep
        label={tx('Extras')}
        heading={tx('Zusatzleistungen & Bemerkungen')}
        description={tx('Optionale Zusatzleistungen hinzufügen und Hinweise hinterlassen.')}
        needs={['anreise', 'abreise', 'zimmer']}
      >
        <div className="space-y-6">
          <div>
            <Field form={buchung} name="zusatzleistungen_buchung" hint={tx('Optional — mehrere wählbar')}>
              <EntitySelectStep
                {...zusatzleistungen.select}
                {...buchung.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
                create={false}
                emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
                searchPlaceholder={tx('Zusatzleistung suchen …')}
              />
            </Field>
          </div>

          <Bound form={buchung} name="bemerkung" rows={3} />

          <StepNav
            onBack={() => setStep(2)}
            onNext={() => buchung.validate(['zusatzleistungen_buchung', 'bemerkung'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 4 — Zusammenfassung */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            items={[
              {
                key: '_status',
                label: tx('Status'),
                value: tx('Bestätigt'),
                keys: ['status'],
              },
            ]}
            whatHappensNext={tx(
              'Die Buchung wird sofort als „Bestätigt" angelegt und erscheint in der Belegungsübersicht.',
            )}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          next={[
            {
              label: tx('Gast einchecken'),
              href: '#/intents/gast-einchecken',
            },
            {
              label: tx('Weitere Buchung anlegen'),
              onClick: () => {
                submit.reset();
                buchung.reset();
                setStep(1);
              },
            },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx(
            'Beim Eintreffen des Gastes den Ablauf „Gast einchecken" nutzen.',
          )}
        />
      )}
    </IntentWizardShell>
  );
}
