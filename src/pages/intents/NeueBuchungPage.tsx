/**
 * Neue Buchung — 3-Schritt-Wizard.
 * Steps: 1) Gast wählen (oder neu anlegen) → 2) Zimmer und Zeitraum wählen → 3) Zusatzleistungen & Details → Prüfen & anlegen.
 * Reads: gaeste, zimmer, zusatzleistungen. Writes: buchungen (createBuchungenEntry).
 * Composes: IntentWizardShell, EntitySelectStep, AvailabilityRangePicker, StepNav, SummaryStep, SuccessStep.
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
import { useStepForm, useJourneySubmit, useRecordSearch, useOccupancy, fieldText, fieldNumber, fieldLookup } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { IconUsers, IconBed } from '@tabler/icons-react';

export default function NeueBuchungPage() {
  const [step, setStep] = useState(1);

  // ── Step 1: Gast ──────────────────────────────────────────────────────────
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim() || tx('Unbekannt'),
      subtitle: fieldText(g, 'email') || fieldText(g, 'telefon') || undefined,
    }),
  });

  // ── Step 2: Zimmer (gefiltert nach Zeitraum via useOccupancy) ─────────────
  const buchung = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 2,
      zusatzleistungen_buchung: 3,
      personen: 3,
      begleitperson: 3,
      bemerkung: 3,
    },
  });

  const anreise = buchung.get('anreise') as string | null;
  const abreise = buchung.get('abreise') as string | null;

  // Occupancy hook: reads all buchungen through the port, applies the configured rule
  // (freeKeys: storniert, angefragt — these do NOT block a room)
  const belegung = useOccupancy(servicePort, 'buchungen', {
    resource: buchung.get('zimmer') as string | undefined,
  });

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    where: belegung.freeIn(anreise, abreise),
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung') || tx('Zimmer'),
      subtitle: fieldLookup(z, 'kategorie')?.label,
      stats: fieldNumber(z, 'preis_pro_nacht') != null
        ? [{ label: tx('pro Nacht'), value: `${fieldNumber(z, 'preis_pro_nacht')?.toFixed(2)} €` }]
        : undefined,
    }),
  });

  // ── Step 3: Begleitperson (zweiter Gast-Lookup) ───────────────────────────
  const begleitpersonen = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim() || tx('Unbekannt'),
      subtitle: fieldText(g, 'email') || undefined,
    }),
  });

  // Zusatzleistungen: nur aktive (where: aktiv === true)
  const zusatz = useRecordSearch(servicePort, 'zusatzleistungen', {
    searchFields: ['name'],
    filter: "r.v_aktiv == True",
    where: r => r.fields['aktiv'] === true,
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'name') || tx('Zusatzleistung'),
      stats: fieldNumber(z, 'preis') != null
        ? [{ label: tx('Preis'), value: `${fieldNumber(z, 'preis')?.toFixed(2)} €` }]
        : undefined,
    }),
  });

  // ── Plan ──────────────────────────────────────────────────────────────────
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
        description: tx('Gast zuordnen, freies Zimmer im Wunschzeitraum wählen und Extras buchen.'),
        needs: [tx('Gast'), tx('An- und Abreisedatum'), tx('Zimmer')],
      }}
    >
      {/* ── Schritt 1: Gast wählen ─────────────────────────────────────── */}
      <WizardStep
        label={tx('Gast')}
        heading={tx('Gast auswählen')}
        description={tx('Bestehenden Gast suchen oder neuen Gast anlegen.')}
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

      {/* ── Schritt 2: Zimmer und Zeitraum ─────────────────────────────── */}
      <WizardStep
        label={tx('Zimmer & Zeitraum')}
        description={tx('Reisezeitraum wählen — nur freie Zimmer werden angezeigt.')}
        needs={['gast']}
      >
        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-foreground mb-2">
              {tx('An- und Abreise')}
            </p>
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', { blocked: belegung.blocked })}
              months={2}
              disablePast
              legend={tx('Belegt')}
            />
          </div>

          {anreise && abreise ? (
            <div>
              <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                <IconBed size={16} className="shrink-0 text-muted-foreground" />
                {tx('Zimmer wählen')}
              </p>
              <EntitySelectStep
                {...zimmer.select}
                selectedId={buchung.get('zimmer') as string}
                onSelect={id => {
                  buchung.set('zimmer', id, zimmer.labelOf(id));
                }}
                emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
                create={false}
                searchPlaceholder={tx('Nach Bezeichnung suchen …')}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {tx('Bitte zuerst An- und Abreisedatum wählen, um freie Zimmer zu sehen.')}
            </p>
          )}

          <StepNav
            onBack={() => setStep(1)}
            onNext={() => buchung.validate(['anreise', 'abreise', 'zimmer'])}
            nextStepLabel={tx('Extras & Details')}
          />
        </div>
      </WizardStep>

      {/* ── Schritt 3: Zusatzleistungen & Details ──────────────────────── */}
      <WizardStep
        label={tx('Extras & Details')}
        description={tx('Zusatzleistungen, Personenanzahl und weitere Details festhalten.')}
        needs={['anreise', 'abreise', 'zimmer']}
      >
        <div className="space-y-5">
          <Field form={buchung} name="zusatzleistungen_buchung" hint={tx('Optional — mehrere wählbar')}>
            <EntitySelectStep
              {...zusatz.select}
              {...buchung.records('zusatzleistungen_buchung', zusatz.labelOf)}
              emptyText={tx('Keine aktiven Zusatzleistungen verfügbar.')}
              create={false}
              searchPlaceholder={tx('Leistung suchen …')}
            />
          </Field>

          <Bound form={buchung} name="personen" hint={tx('Anzahl der Personen inklusive Hauptgast')} />

          <div>
            <p className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <IconUsers size={16} className="shrink-0 text-muted-foreground" />
              {tx('Begleitperson (optional)')}
            </p>
            <EntitySelectStep
              {...begleitpersonen.select}
              selectedId={buchung.get('begleitperson') as string}
              onSelect={id => {
                buchung.set('begleitperson', id, begleitpersonen.labelOf(id));
              }}
              create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
              createLabel={tx('Neue Begleitperson anlegen')}
              searchPlaceholder={tx('Nach Name suchen …')}
            />
          </div>

          <Bound form={buchung} name="bemerkung" rows={3} />

          <StepNav
            onBack={() => setStep(2)}
            onNext={() => buchung.validate(['personen'])}
            nextStepLabel={tx('Prüfen & anlegen')}
          />
        </div>
      </WizardStep>

      {/* ── Schritt 4: Prüfen & Bestätigen ─────────────────────────────── */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            whatHappensNext={tx('Die Buchung erscheint sofort im Belegungsplan und erhält den Status „Bestätigt".')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {/* ── Erfolg ─────────────────────────────────────────────────────── */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          next={[
            {
              label: tx('Einchecken'),
              href: '#/intents/gast-einchecken',
            },
            {
              label: tx('Rechnung stellen'),
              href: '#/intents/rechnung-stellen',
            },
            {
              label: tx('Weitere Buchung'),
              onClick: () => {
                submit.reset();
                buchung.reset();
                setStep(1);
              },
            },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Den Gast am Anreisetag mit „Einchecken" empfangen oder direkt eine Rechnung stellen.')}
        />
      )}
    </IntentWizardShell>
  );
}
