/**
 * Neue Buchung — 4-Schritt-Wizard.
 * Steps: 1) Gast wählen oder neu anlegen → 2) Zeitraum wählen (An-/Abreise, Personen)
 *        → 3) Zimmer wählen (nur freie Zimmer im gewählten Zeitraum)
 *        → 4) Zusatzleistungen & Bemerkung → Prüfen & anlegen.
 * Reads: gaeste, zimmer, zusatzleistungen, buchungen (für Belegung).
 * Writes: buchungen (createBuchungenEntry); ggf. gaeste (createGaesteEntry via InlineCreate).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *           EntitySelectStep (multi), StepNav, SummaryStep, SuccessStep, Field, Bound.
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
  fieldLookup,
  fieldNumber,
  occupancyFor,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { formatCurrency } from '@/lib/formatters';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  const data = useDashboardData({ omit: ['gaeste', 'zimmer', 'zusatzleistungen'] });
  const [step, setStep] = useState(1);

  // Schritt 1: Gast-Suche (alle Gäste sind buchbar)
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email', 'telefon'],
    toItem: g => ({
      id: g.id,
      title: `${g.fields.vorname ?? ''} ${g.fields.nachname ?? ''}`.trim(),
      subtitle: String(g.fields.email ?? g.fields.telefon ?? ''),
    }),
  });

  // Schritt 3: Zimmer-Suche — Filterung nach Belegung im JS-Fallback (where),
  // server-seitig zählen wir alle und grenzen per where ein.
  const anreise = () => buchung.get('anreise') as string | null;
  const abreise = () => buchung.get('abreise') as string | null;

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    toItem: z => {
      const kat = fieldLookup(z, 'kategorie');
      const preis = fieldNumber(z, 'preis_pro_nacht');
      return {
        id: z.id,
        title: String(z.fields.bezeichnung ?? ''),
        subtitle: kat
          ? `${kat.label}${preis != null ? tx` · ${formatCurrency(preis)}/Nacht` : ''}`
          : preis != null ? tx`${formatCurrency(preis)}/Nacht` : undefined,
      };
    },
    // Fallback-Filter: freie Zimmer im gewählten Zeitraum
    where: z => {
      const von = anreise();
      const bis = abreise();
      if (!von || !bis) return true; // vor Zeitraum-Schritt: alles zeigen
      const blocked = occupancyFor('buchungen', data.buchungen ?? [], { resource: z.id });
      // Zimmer ist frei, wenn kein blocked-Eintrag die gewählten Nächte belegt
      for (let i = 0; i < blocked.length; i++) {
        const b = blocked[i];
        const start = b.start;
        const end = b.end ?? start;
        if (start < bis && end > von) return false;
      }
      return true;
    },
  });

  // Schritt 4: Zusatzleistungen (aktiv=true), Mehrfachauswahl
  const zusatz = useRecordSearch(servicePort, 'zusatzleistungen', {
    where: z => z.fields.aktiv === true,
    searchFields: ['name'],
    toItem: z => ({
      id: z.id,
      title: String(z.fields.name ?? ''),
      subtitle: z.fields.preis != null
        ? `${formatCurrency(z.fields.preis as number)}`
        : undefined,
    }),
  });

  // Formular für die gesamte Buchung (ein useStepForm für alle Felder)
  const buchung = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      personen: 2,
      zimmer: 3,
      zusatzleistungen_buchung: 4,
      bemerkung: 4,
    },
  });

  // Plan: eine Buchung anlegen — Gast und Zimmer als plain IDs (port wandelt in URLs)
  const submit = useJourneySubmit(servicePort, [
    {
      key: 'buchung',
      entity: 'buchungen',
      form: buchung,
      primary: true,
      values: { status: 'bestaetigt' },
    },
  ], { draftKey: 'neue-buchung' });

  const restart = () => {
    submit.reset();
    buchung.reset();
    gaeste.reload();
    zimmer.reload();
    setStep(1);
  };

  // Belegte Nächte für das gewählte Zimmer
  const zimmerId = buchung.get('zimmer') as string | null | undefined;
  const blocked = occupancyFor(
    'buchungen',
    data.buchungen ?? [],
    { resource: zimmerId ?? undefined },
  );

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      loading={data.loading}
      error={data.error}
      onRetry={data.fetchAll}
      forms={[buchung]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Gast, Zeitraum und Zimmer in einem Ablauf buchen.'),
        needs: [tx('Gastname oder E-Mail'), tx('An- und Abreisedatum'), tx('Zimmerwunsch')],
      }}
    >
      {/* Schritt 1: Gast wählen oder neu anlegen */}
      <WizardStep
        label={tx('Gast')}
        description={tx('Suche nach einem bestehenden Gast oder lege einen neuen an.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          avatar="initials"
          selectedId={buchung.get('gast') as string}
          onSelect={id => {
            buchung.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          searchPlaceholder={tx('Vorname, Nachname oder E-Mail …')}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
          createLabel={tx('Neuen Gast anlegen')}
        />
      </WizardStep>

      {/* Schritt 2: Zeitraum wählen */}
      <WizardStep
        label={tx('Zeitraum')}
        description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut.')}
      >
        {!buchung.get('gast') ? (
          <StepNav
            onBack={() => setStep(1)}
            nextDisabled
          >
            {tx('Bitte zuerst einen Gast auswählen.')}
          </StepNav>
        ) : (
          <div className="space-y-6">
            <AvailabilityRangePicker
              {...buchung.range('anreise', 'abreise', {
                blocked: zimmerId ? blocked : [],
              })}
              legend={tx('Belegte Nächte sind durchgestrichen und nicht wählbar.')}
              disablePast
            />
            <div className="max-w-xs">
              <Bound form={buchung} name="personen" hint={tx('Anzahl Personen inkl. Begleitpersonen')} />
            </div>
            <StepNav
              onBack={() => setStep(1)}
              onNext={() => buchung.validate(['anreise', 'abreise'])}
              nextStepLabel={tx('Zimmer wählen')}
            />
          </div>
        )}
      </WizardStep>

      {/* Schritt 3: Zimmer wählen (nur freie Zimmer) */}
      <WizardStep
        label={tx('Zimmer')}
        description={tx('Nur freie Zimmer im gewählten Zeitraum werden angezeigt.')}
      >
        {!buchung.get('anreise') || !buchung.get('abreise') ? (
          <StepNav
            onBack={() => setStep(2)}
            nextDisabled
          >
            {tx('Bitte zuerst einen Zeitraum wählen.')}
          </StepNav>
        ) : (
          <EntitySelectStep
            {...zimmer.select}
            avatar="none"
            selectedId={buchung.get('zimmer') as string}
            onSelect={id => {
              buchung.set('zimmer', id, zimmer.labelOf(id));
              setStep(4);
            }}
            searchPlaceholder={tx('Zimmerbezeichnung …')}
            emptyText={tx('Kein Zimmer ist im gewählten Zeitraum frei.')}
            create={false}
          />
        )}
      </WizardStep>

      {/* Schritt 4: Zusatzleistungen & Bemerkung */}
      <WizardStep
        label={tx('Extras')}
        description={tx('Optionale Zusatzleistungen und Bemerkungen zur Buchung.')}
      >
        {!buchung.get('zimmer') ? (
          <StepNav
            onBack={() => setStep(3)}
            nextDisabled
          >
            {tx('Bitte zuerst ein Zimmer wählen.')}
          </StepNav>
        ) : (
          <div className="space-y-6">
            <Field form={buchung} name="zusatzleistungen_buchung">
              <EntitySelectStep
                {...zusatz.select}
                {...buchung.records('zusatzleistungen_buchung', zusatz.labelOf)}
                avatar="none"
                searchPlaceholder={tx('Leistung suchen …')}
                emptyText={tx('Keine aktiven Zusatzleistungen vorhanden.')}
                create={false}
              />
            </Field>
            <Bound form={buchung} name="bemerkung" rows={3} />
            <StepNav
              onBack={() => setStep(3)}
              onNext={() => buchung.validate(['zusatzleistungen_buchung'])}
              nextStepLabel={tx('Prüfen & buchen')}
            />
          </div>
        )}
      </WizardStep>

      {/* Prüfen & Anlegen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[buchung]}
            submit={submit}
            whatHappensNext={tx('Die Buchung wird sofort als „Bestätigt" angelegt und erscheint in der Belegungsübersicht.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchung]}
          next={[
            { label: tx('Weitere Buchung anlegen'), onClick: restart },
            { label: tx('Rechnung erstellen'), href: '#/intents/neue-rechnung' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Den Check-in über den Ablauf „Gast einchecken" oder direkt in der Buchungsansicht durchführen.')}
        />
      )}
    </IntentWizardShell>
  );
}
