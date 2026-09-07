/**
 * Neue Buchung — 4-Schritt-Wizard.
 * Steps: 1) Gast wählen (oder neu anlegen) → 2) Zeitraum & Zimmer (Verfügbarkeit geprüft)
 *        → 3) Zusatzleistungen & Bemerkung → 4) Prüfen & anlegen.
 * Reads: gaeste, zimmer, zusatzleistungen, buchungen (Belegungsregel).
 * Writes: buchungen (createBuchungenEntry) mit status='bestaetigt'.
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Bound } from '@/components/blocks/Bound';
import { Field } from '@/components/blocks/Field';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  useOccupancy,
  fieldText,
  fieldNumber,
  fieldLookup,
  fieldRef,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // Gäste-Suche (Schritt 1)
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
      subtitle: fieldText(g, 'email') || fieldText(g, 'telefon') || undefined,
    }),
    orderby: ['r.v_nachname asc'],
  });

  // Belegungsregel für buchungen (kein festes resource — für den Picker)
  const belegungGlobal = useOccupancy(servicePort, 'buchungen', {});

  // Formular
  const f = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 2,
      personen: 2,
      begleitperson: 2,
      zusatzleistungen_buchung: 3,
      bemerkung: 3,
    },
    initial: { status: 'bestaetigt' },
  });

  // Anreise/Abreise aus dem Formular lesen (für Zimmersuche-Filter)
  const anreise = f.get('anreise') as string | null | undefined;
  const abreise = f.get('abreise') as string | null | undefined;

  // Zimmer-Belegungsregel (ohne festes Zimmer — zeigt alle freien)
  const belegung = useOccupancy(servicePort, 'buchungen', {});

  // Zimmer-Suche — nur freie im gewählten Zeitraum
  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung'),
      subtitle: fieldLookup(z, 'kategorie')?.label,
      stats: fieldNumber(z, 'preis_pro_nacht') != null
        ? [{ label: tx('Preis/Nacht'), value: `${fieldNumber(z, 'preis_pro_nacht')} €` }]
        : [],
    }),
  });

  // Begleitperson-Suche (Schritt 2, optional — alle Gäste außer dem Hauptgast)
  const begleitGaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim(),
      subtitle: fieldText(g, 'email') || undefined,
    }),
  });

  // Zusatzleistungen — nur aktive anzeigen
  const zusatzleistungen = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    filter: "r.v_aktiv == True",
    where: r => r.fields['aktiv'] === true,
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name'),
      stats: fieldNumber(z, 'preis') != null
        ? [{ label: tx('Preis'), value: `${fieldNumber(z, 'preis')} €` }]
        : [],
    }),
  });

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'buchung',
      entity: 'buchungen',
      form: f,
      primary: true,
      values: { status: 'bestaetigt' },
    },
  ], { draftKey: 'neue-buchung' });

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Gast und Zimmer in drei Schritten buchen — Verfügbarkeit wird live geprüft.'),
        needs: [tx('Gastnamen oder E-Mail'), tx('An- und Abreisedatum')],
      }}
    >
      {/* Schritt 1: Gast */}
      <WizardStep
        label={tx('Gast')}
        description={tx('Stammgast suchen oder neuen Gast direkt anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={f.get('gast') as string | undefined}
          onSelect={id => {
            f.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'], title: tx('Neuen Gast anlegen') }}
          searchPlaceholder={tx('Vorname, Nachname oder E-Mail …')}
          avatar="initials"
        />
      </WizardStep>

      {/* Schritt 2: Zeitraum & Zimmer */}
      <WizardStep
        label={tx('Zeitraum & Zimmer')}
        description={tx('Zeitraum wählen — nur freie Zimmer werden angezeigt.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          {/* Datum-Range-Picker */}
          <AvailabilityRangePicker
            {...f.range('anreise', 'abreise', { blocked: belegungGlobal.blocked })}
          />

          {/* Zimmerwahl — nur wenn Zeitraum gewählt */}
          {anreise && abreise ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{tx('Freies Zimmer wählen')}</p>
              <EntitySelectStep
                {...zimmer.select}
                selectedId={f.get('zimmer') as string | undefined}
                onSelect={id => {
                  f.set('zimmer', id, zimmer.labelOf(id));
                }}
                create={false}
                emptyText={tx('Im gewählten Zeitraum sind keine Zimmer frei.')}
                avatar="none"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tx('Bitte zuerst An- und Abreise wählen, um freie Zimmer zu sehen.')}
            </p>
          )}

          {/* Personen-Anzahl */}
          <Bound form={f} name="personen" hint={tx('Anzahl der Gäste inkl. Hauptgast')} />

          {/* Begleitperson (optional) */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">{tx('Begleitperson')}</p>
            <p className="text-xs text-muted-foreground">{tx('Optional — weiterer Gast aus der Datenbank.')}</p>
            <EntitySelectStep
              {...begleitGaeste.select}
              selectedId={f.get('begleitperson') as string | undefined}
              onSelect={id => {
                f.set('begleitperson', id, begleitGaeste.labelOf(id));
              }}
              create={false}
              avatar="initials"
              searchPlaceholder={tx('Begleitperson suchen …')}
            />
          </div>

          <StepNav
            onBack={() => setStep(1)}
            onNext={() => f.validate(['anreise', 'abreise', 'zimmer'])}
            nextStepLabel={tx('Zusatzleistungen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3: Zusatzleistungen & Bemerkung */}
      <WizardStep
        label={tx('Zusatzleistungen')}
        description={tx('Optionale Zusatzleistungen hinzufügen und eine Bemerkung hinterlassen.')}
        needs={['anreise', 'abreise', 'zimmer']}
      >
        <div className="space-y-6">
          <Field form={f} name="zusatzleistungen_buchung" hint={tx('Optional — nur aktive Leistungen werden angezeigt.')}>
            <EntitySelectStep
              {...zusatzleistungen.select}
              {...f.records('zusatzleistungen_buchung', zusatzleistungen.labelOf)}
              emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
              avatar="none"
            />
          </Field>

          <Bound form={f} name="bemerkung" rows={3} />

          <StepNav
            onBack={() => setStep(2)}
            onNext={() => f.validate(['zusatzleistungen_buchung', 'bemerkung'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 4: Prüfen & anlegen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.result && (
          <SummaryStep
            forms={[f]}
            submit={submit}
            items={[
              { key: 'status_preset', label: tx('Status'), value: tx('Bestätigt') },
            ]}
            whatHappensNext={tx('Die Buchung wird sofort angelegt und ist im System sichtbar.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          submit={submit}
          restartLabel={tx('Weitere Buchung')}
          next={[
            { label: tx('Gast einchecken'), href: '#/intents/gast-einchecken' },
            { label: tx('Rechnung stellen'), href: '#/intents/rechnung-stellen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Du kannst den Gast jetzt einchecken oder direkt eine Rechnung erstellen.')}
        />
      )}
    </IntentWizardShell>
  );
}
