/**
 * Gast einchecken — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur bestätigte) → 2) Bestätigung (Readonly-Zusammenfassung) → 3) Prüfen & aktualisieren.
 * Reads: buchungen (gefiltert auf status='bestaetigt'), gaeste, zimmer (via ctx.ref).
 * Writes: buchungen (status → 'eingecheckt') — Update-only, kein Create.
 * Composes: IntentWizardShell, EntitySelectStep, StepNav, SummaryStep, SuccessStep, StatusBadge.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import {
  useRecordSearch,
  useJourneySubmit,
  fieldDate,
  fieldRef,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { formatDate } from '@/lib/formatters';

export default function GastEincheckenPage() {
  const [step, setStep] = useState(1);

  // Buchungen-Suche: nur bestätigte Buchungen anzeigen.
  // buchungen hat kein searchbares Textfeld (nur bemerkung) — wir laden alle bestätigten
  // und zeigen sie als Karten mit Gast- und Zimmernamen via ctx.ref.
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    searchFields: ['bemerkung'],
    filter: "r.v_status == 'bestaetigt'",
    where: r => {
      const s = r.fields.status as { key?: string } | null | undefined;
      return s?.key === 'bestaetigt';
    },
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Ohne Gastname');
      const zimmerName = ctx.ref('zimmer') ?? tx('Kein Zimmer');
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const anreiseFormatted = anreise ? formatDate(anreise) : '—';
      const abreiseFormatted = abreise ? formatDate(abreise) : '—';
      return {
        id: b.id,
        title: gastName,
        subtitle: `${zimmerName} · ${anreiseFormatted}–${abreiseFormatted}`,
        status: { key: 'bestaetigt', label: tx('Bestätigt') },
      };
    },
  });

  // Gewählte Buchungs-ID und Anzeigename für den späteren Plan
  const [buchungId, setBuchungId] = useState<string | null>(null);
  const [buchungLabel, setBuchungLabel] = useState<string>('');

  // Der Plan aktualisiert die gewählte Buchung — kein useStepForm nötig (rein values-basiert).
  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'checkin',
        entity: 'buchungen',
        updates: buchungId ?? '',
        values: { status: 'eingecheckt' },
        primary: true,
        verb: 'update',
      },
    ],
    { draftKey: 'gast-einchecken' },
  );

  // Zusammenfassung aus dem gewählten Datensatz aufbauen
  const gewaehlteRecord = buchungId ? buchungen.recordOf(buchungId) : undefined;
  const gastName = gewaehlteRecord
    ? buchungen.refLabel(gewaehlteRecord, 'gast') ?? buchungLabel
    : buchungLabel;
  const zimmerName = gewaehlteRecord
    ? buchungen.refLabel(gewaehlteRecord, 'zimmer') ?? '—'
    : '—';
  const anreise = gewaehlteRecord ? fieldDate(gewaehlteRecord, 'anreise') : null;
  const abreise = gewaehlteRecord ? fieldDate(gewaehlteRecord, 'abreise') : null;

  const restart = () => {
    submit.reset();
    setBuchungId(null);
    setBuchungLabel('');
    setStep(1);
  };

  // Summary-Items für SummaryStep (manuell, da kein StepForm)
  const summaryItems = [
    { key: 'gast', label: tx('Gast'), value: gastName || '—', step: 1 },
    { key: 'zimmer', label: tx('Zimmer'), value: zimmerName, step: 1 },
    {
      key: 'anreise',
      label: tx('Anreise'),
      value: anreise ? formatDate(anreise) : '—',
      step: 1,
    },
    {
      key: 'abreise',
      label: tx('Abreise'),
      value: abreise ? formatDate(abreise) : '—',
      step: 1,
    },
    { key: 'status_neu', label: tx('Neuer Status'), value: tx('Eingecheckt') },
  ];

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      subtitle={tx('Bestätigte Buchung auswählen und Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung auswählen und den Gast einchecken.'),
        needs: [tx('Name des Gastes oder Zimmernummer')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Bestätigte Buchung auswählen — nur buchungen mit Status „Bestätigt" werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungId}
          onSelect={id => {
            setBuchungId(id);
            setBuchungLabel(buchungen.labelOf(id) ?? id);
            setStep(2);
          }}
          avatar="none"
          emptyText={tx('Keine bestätigten Buchungen vorhanden. Bitte zuerst eine Buchung bestätigen.')}
          create={false}
          searchPlaceholder={tx('Nach Bemerkung suchen …')}
        />
      </WizardStep>

      {/* Schritt 2: Bestätigung (Readonly-Zusammenfassung) */}
      <WizardStep
        label={tx('Bestätigung')}
        description={tx('Buchungsdetails prüfen bevor der Gast eingecheckt wird.')}
        needs={['buchung']}
      >
        {buchungId ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-card shadow-lg p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Gast')}</span>
                <span className="font-medium">{gastName || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Zimmer')}</span>
                <span className="font-medium">{zimmerName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Anreise')}</span>
                <span className="font-medium">{anreise ? formatDate(anreise) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Abreise')}</span>
                <span className="font-medium">{abreise ? formatDate(abreise) : '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Aktueller Status')}</span>
                <StatusBadge statusKey="bestaetigt" label={tx('Bestätigt')} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{tx('Neuer Status')}</span>
                <StatusBadge statusKey="eingecheckt" label={tx('Eingecheckt')} />
              </div>
            </div>
            <StepNav
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
              nextStepLabel={tx('Prüfen')}
            />
          </div>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        )}
      </WizardStep>

      {/* Schritt 3: Prüfen & Bestätigen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && buchungId ? (
          <SummaryStep
            forms={[]}
            submit={submit}
            items={summaryItems}
            whatHappensNext={tx('Der Gast wird sofort als eingecheckt markiert. Die Buchung erscheint in der Übersicht unter „Eingecheckt".')}
            confirmLabel={tx('Jetzt einchecken')}
          />
        ) : !buchungId ? (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Dieser Schritt braucht die Auswahl aus Schritt 1.')}
          </StepNav>
        ) : null}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          title={tx('Gast eingecheckt')}
          verb="updated"
          actions={{ copy: false, print: false }}
          facts={[
            { label: tx('Gast'), value: gastName || '—' },
            { label: tx('Zimmer'), value: zimmerName },
            { label: tx('Anreise'), value: anreise ? formatDate(anreise) : '—' },
            { label: tx('Abreise'), value: abreise ? formatDate(abreise) : '—' },
          ]}
          whatHappensNext={tx('Der Gast ist nun eingecheckt. Bei Abreise den Ablauf „Rechnung stellen" nutzen.')}
          next={[
            {
              label: tx('Rechnung stellen'),
              href: '#/intents/rechnung-stellen',
            },
            {
              label: tx('Nächste Buchung einchecken'),
              onClick: restart,
            },
            {
              label: tx('Zum Dashboard'),
              href: '#/',
            },
          ]}
        />
      )}
    </IntentWizardShell>
  );
}
