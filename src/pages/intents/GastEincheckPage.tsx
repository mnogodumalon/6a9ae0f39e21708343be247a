/**
 * Gast Einchecken — 2-Schritt-Wizard + Prüfen.
 * Steps: 1) Buchung wählen (nur bestätigte) → 2) Prüfen & Bestätigen → Einchecken.
 * Reads: buchungen (gefiltert: status === 'bestaetigt'), referenziert gaeste + zimmer.
 * Writes: buchungen (update status → 'eingecheckt').
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState, useRef } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useRecordSearch,
  useJourneySubmit,
  fieldText,
  fieldLookup,
  fieldDate,
  fieldNumber,
  formatRange,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { IconStar } from '@tabler/icons-react';

export default function GastEincheckPage() {
  const [step, setStep] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string>('');
  // Ref so the plan closure always sees the latest id without stale closure
  const selectedIdRef = useRef<string | null>(null);

  // Nur bestätigte Buchungen anzeigen
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => {
      const s = fieldLookup(r, 'status');
      return s?.key === 'bestaetigt';
    },
    searchFields: ['bemerkung'],
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerName = ctx.ref('zimmer') ?? tx('Unbekanntes Zimmer');
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const zeitraum = formatRange(anreise, abreise);
      const status = fieldLookup(b, 'status');
      return {
        id: b.id,
        title: gastName,
        subtitle: `${zimmerName} · ${zeitraum}`,
        status: status ?? undefined,
      };
    },
  });

  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'checkin',
        entity: 'buchungen',
        updates: () => selectedIdRef.current ?? '',
        values: { status: 'eingecheckt' },
        primary: true,
        verb: 'update',
      },
    ],
    { draftKey: 'gast-einchecken' }
  );

  // Ausgewählte Buchung für die Prüfungsanzeige
  const buchungRecord = selectedId ? buchungen.recordOf(selectedId) : undefined;
  const gastName = selectedLabel || tx('Unbekannter Gast');

  const zimmerName = buchungRecord ? buchungen.refLabel(buchungRecord, 'zimmer') ?? tx('Unbekanntes Zimmer') : '';
  const anreise = buchungRecord ? fieldDate(buchungRecord, 'anreise') : null;
  const abreise = buchungRecord ? fieldDate(buchungRecord, 'abreise') : null;
  const personen = buchungRecord ? fieldNumber(buchungRecord, 'personen') : null;
  const bemerkung = buchungRecord ? fieldText(buchungRecord, 'bemerkung') : '';
  const zeitraum = formatRange(anreise, abreise);

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      subtitle={tx('Bestätigte Buchung auf eingecheckt setzen')}
      currentStep={step}
      onStepChange={setStep}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung suchen, Daten prüfen und den Gast einchecken.'),
        needs: [tx('Name des Gastes oder Zimmernummer')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Bestätigte Buchung auswählen — nur Buchungen mit Status „Bestätigt" erscheinen hier.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={selectedId}
          onSelect={id => {
            setSelectedId(id);
            selectedIdRef.current = id;
            setSelectedLabel(buchungen.labelOf(id) ?? '');
            setStep(2);
          }}
          avatar="initials"
          searchPlaceholder={tx('Nach Gast oder Zimmer suchen …')}
          emptyText={tx('Keine bestätigten Buchungen gefunden. Buchungen müssen zuerst bestätigt werden.')}
          create={false}
        />
      </WizardStep>

      {/* Schritt 2: Prüfen */}
      <WizardStep
        label={tx('Prüfen')}
        description={tx('Buchungsdetails prüfen und Eincheck bestätigen.')}
      >
        {!submit.done && selectedId && buchungRecord ? (
          <SummaryStep
            forms={[]}
            submit={submit}
            confirmLabel={tx('Jetzt einchecken')}
            whatHappensNext={tx('Der Status der Buchung wird auf „Eingecheckt" gesetzt.')}
            items={[
              {
                key: 'gast',
                label: tx('Gast'),
                value: gastName,
                step: 1,
              },
              {
                key: 'zimmer',
                label: tx('Zimmer'),
                value: zimmerName,
                step: 1,
              },
              {
                key: 'zeitraum',
                label: tx('Zeitraum'),
                value: zeitraum,
                step: 1,
              },
              ...(personen !== null
                ? [
                    {
                      key: 'personen',
                      label: tx('Personen'),
                      value: String(personen),
                      step: 1,
                    },
                  ]
                : []),
              ...(bemerkung
                ? [
                    {
                      key: 'bemerkung',
                      label: tx('Bemerkung'),
                      value: bemerkung,
                      step: 1,
                    },
                  ]
                : []),
              {
                key: 'neuer_status',
                label: tx('Neuer Status'),
                value: tx('Eingecheckt'),
              },
            ]}
          />
        ) : !selectedId ? (
          <StepNav
            onBack={() => setStep(1)}
            nextDisabled
          >
            <p className="text-sm text-muted-foreground">
              {tx('Bitte zuerst eine Buchung auswählen.')}
            </p>
          </StepNav>
        ) : null}
      </WizardStep>

      {/* Erfolgsanzeige */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          verb="updated"
          title={tx('Gast eingecheckt')}
          facts={[
            { label: tx('Gast'), value: gastName },
            { label: tx('Zimmer'), value: zimmerName },
            { label: tx('Zeitraum'), value: zeitraum },
          ]}
          whatHappensNext={tx('Der Gast ist jetzt eingecheckt. Die Rechnung kann nach dem Aufenthalt gestellt werden.')}
          next={[
            {
              label: tx('Rechnung stellen'),
              href: '#/intents/rechnung-stellen',
              icon: <IconStar size={16} />,
            },
            {
              label: tx('Weiteren Gast einchecken'),
              onClick: () => {
                submit.reset();
                setSelectedId(null);
                selectedIdRef.current = null;
                setSelectedLabel('');
                setStep(1);
              },
            },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          actions={{ copy: false, print: false }}
        />
      )}
    </IntentWizardShell>
  );
}
