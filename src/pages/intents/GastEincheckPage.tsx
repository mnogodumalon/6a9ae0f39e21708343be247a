/**
 * Gast einchecken — 2-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur Status 'bestaetigt') → 2) Prüfen & Status auf 'eingecheckt' setzen.
 * Reads: buchungen (EnrichedBuchungen, refs: gast, zimmer). Writes: buchungen (updateBuchungenEntry via plan).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, SummaryStep, SuccessStep, StepNav.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldText, fieldLookup, fieldDate } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { formatDate } from '@/lib/formatters';

export default function GastEincheckPage() {
  const [step, setStep] = useState(1);

  // Buchungen-Suche: nur bestätigte Buchungen qualifizieren
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status == 'bestaetigt'",
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: ['bemerkung'],
    toItem: (b, ctx) => {
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      return {
        id: b.id,
        title: ctx.ref('gast') ?? tx('Unbekannter Gast'),
        subtitle: ctx.ref('zimmer') ?? tx('Kein Zimmer'),
        stats: [
          { label: tx('Anreise'), value: anreise ? formatDate(anreise) : '—' },
          { label: tx('Abreise'), value: abreise ? formatDate(abreise) : '—' },
        ],
      };
    },
  });

  // Formular für die Buchungs-ID (kein eigentliches Eingabefeld — nur die Auswahl)
  const f = useStepForm('buchungen', {
    steps: { _buchungId: 1 },
    required: {
      gast: false,
      zimmer: false,
      anreise: false,
      abreise: false,
      status: false,
      personen: false,
      begleitperson: false,
      zusatzleistungen_buchung: false,
      bemerkung: false,
      beleg: false,
    },
  });

  // Der gewählte Datensatz — für die Zusammenfassung
  const selectedId = f.get('_buchungId') as string | undefined;
  const selectedRecord = selectedId ? buchungen.recordOf(selectedId) : undefined;

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'checkin',
      entity: 'buchungen',
      form: f,
      updates: selectedId ?? '',
      values: { status: 'eingecheckt' },
      primary: true,
    },
  ], { draftKey: 'gast-einchecken' });

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      subtitle={tx('Bestätigte Buchung suchen und Gast als eingecheckt markieren.')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Einen anreisenden Gast einchecken — Buchung suchen und Status aktualisieren.'),
        needs: [tx('Name des Gastes oder Zimmernummer')],
      }}
    >
      <WizardStep
        label={tx('Buchung wählen')}
        description={tx('Bestätigte Buchung des anreisenden Gastes auswählen.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={selectedId}
          onSelect={id => {
            f.set('_buchungId', id, buchungen.labelOf(id));
            setStep(2);
          }}
          emptyText={tx('Keine bestätigten Buchungen gefunden. Nur Buchungen mit Status „Bestätigt" können eingecheckt werden.')}
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
          create={false}
        />
      </WizardStep>

      <WizardStep label={tx('Prüfen & einchecken')} needs={['_buchungId']}>
        {!submit.done ? (
          <SummaryStep
            forms={[f]}
            submit={submit}
            confirmLabel={tx('Jetzt einchecken')}
            whatHappensNext={tx('Der Status der Buchung wird auf „Eingecheckt" gesetzt. Der Gast ist damit im System als anwesend vermerkt.')}
            items={[
              {
                key: 'gast',
                label: tx('Gast'),
                value: selectedRecord ? [fieldText(selectedRecord, 'vorname'), fieldText(selectedRecord, 'nachname')].filter(Boolean).join(' ') || '—' : '—',
                keys: ['_buchungId'],
              },
              {
                key: 'zimmer',
                label: tx('Zimmer'),
                value: (() => {
                  if (!selectedRecord) return '—';
                  const rec = buchungen.recordOf(selectedId!);
                  return rec ? (buchungen.refLabel(rec, 'zimmer') ?? '—') : '—';
                })(),
                keys: ['_buchungId'],
              },
              {
                key: 'anreise',
                label: tx('Anreise'),
                value: selectedRecord ? (fieldDate(selectedRecord, 'anreise') ? formatDate(fieldDate(selectedRecord, 'anreise')!) : '—') : '—',
                keys: ['_buchungId'],
              },
              {
                key: 'abreise',
                label: tx('Abreise'),
                value: selectedRecord ? (fieldDate(selectedRecord, 'abreise') ? formatDate(fieldDate(selectedRecord, 'abreise')!) : '—') : '—',
                keys: ['_buchungId'],
              },
              {
                key: 'neuer_status',
                label: tx('Neuer Status'),
                value: tx('Eingecheckt'),
                keys: [],
              },
            ]}
          />
        ) : null}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          actions={{ copy: false, print: false }}
          next={[
            { label: tx('Weiteren Gast einchecken'), onClick: () => { submit.reset(); f.reset(); setStep(1); } },
            { label: tx('Rechnung stellen'), href: '#/intents/rechnung-erstellen' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Der Gast ist jetzt als eingecheckt markiert. Du kannst direkt zur Rechnungsstellung weitergehen.')}
        />
      )}
    </IntentWizardShell>
  );
}
