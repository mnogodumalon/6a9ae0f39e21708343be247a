/**
 * Gast einchecken — 2-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur bestätigte Buchungen) → 2) Einchecken bestätigen (SummaryStep).
 * Reads: buchungen (enriched, via useRecordSearch over enriched array).
 * Writes: buchungen (updateBuchungenEntry — setzt status auf 'eingecheckt').
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, StepNav, SummaryStep, SuccessStep, StatusBadge.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { StatusBadge } from '@/components/blocks/StatusBadge';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldDate, fieldLookup, fieldRef, fieldNumber } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LivingAppsService } from '@/services/livingAppsService';
import { formatDate } from '@/lib/formatters';
import { tx } from '@/i18n';

export default function GastEincheckPage() {
  const data = useDashboardData({ omit: ['buchungen'] });
  const [step, setStep] = useState(1);

  // Enriched buchungen array für die Suche — searchFields sind enriched-Felder (gastName, zimmerName)
  // Da useRecordSearch server-seitig sucht, aber enriched-Felder nur client-seitig existieren,
  // nutzen wir where für die Status-Einschränkung und searchFields für enriched-Felder im client mode.
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: [],
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? '';
      const zimmerName = ctx.ref('zimmer') ?? '';
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const datumText = anreise && abreise
        ? `${formatDate(anreise)} – ${formatDate(abreise)}`
        : anreise
        ? formatDate(anreise)
        : '';
      return {
        id: b.id,
        title: gastName || tx('Unbekannter Gast'),
        subtitle: zimmerName ? `${zimmerName}${datumText ? ', ' + datumText : ''}` : datumText,
        status: fieldLookup(b, 'status') ?? undefined,
      };
    },
  });

  // Das Form hält nur die Buchungs-ID und den Label — wir aktualisieren nur den Status
  const buchungForm = useStepForm('buchungen', {
    fields: [],
    steps: {},
  });

  // Fakten der ausgewählten Buchung für die Zusammenfassung (aus useRecordSearch-Rohdaten + Maps)
  const [selectedFacts, setSelectedFacts] = useState<{
    gastName: string;
    zimmerName: string;
    anreise: string | null;
    abreise: string | null;
    personen: number | null;
    statusKey: string | undefined;
    statusLabel: string | undefined;
  } | null>(null);

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'eincheck',
      entity: 'buchungen',
      primary: true,
      verb: 'update',
      run: async () => {
        const buchungId = buchungForm.get('buchung') as string;
        return LivingAppsService.updateBuchungenEntry(buchungId, { status: 'eingecheckt' });
      },
    },
  ], { draftKey: 'gast-einchecken' });

  const restart = () => {
    submit.reset();
    buchungForm.reset();
    setSelectedFacts(null);
    setStep(1);
  };

  // Fakten für den SummaryStep als extra items (alle mit denselben keys — eine gemeinsame "Ändern"-Aktion)
  const summaryItems = selectedFacts
    ? [
        {
          key: 'gast',
          label: tx('Gast'),
          value: selectedFacts.gastName || tx('—'),
          step: 1,
          keys: ['buchung'],
          fieldId: 'buchungen-buchung',
        },
        {
          key: 'zimmer',
          label: tx('Zimmer'),
          value: selectedFacts.zimmerName || tx('—'),
          step: 1,
          keys: ['buchung'],
          fieldId: 'buchungen-buchung',
        },
        {
          key: 'anreise',
          label: tx('Anreise'),
          value: selectedFacts.anreise ? formatDate(selectedFacts.anreise) : tx('—'),
          step: 1,
          keys: ['buchung'],
          fieldId: 'buchungen-buchung',
        },
        {
          key: 'abreise',
          label: tx('Abreise'),
          value: selectedFacts.abreise ? formatDate(selectedFacts.abreise) : tx('—'),
          step: 1,
          keys: ['buchung'],
          fieldId: 'buchungen-buchung',
        },
        {
          key: 'personen',
          label: tx('Personen'),
          value: selectedFacts.personen != null ? String(selectedFacts.personen) : tx('—'),
          step: 1,
          keys: ['buchung'],
          fieldId: 'buchungen-buchung',
        },
      ]
    : [];

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      loading={data.loading}
      error={data.error}
      onRetry={data.fetchAll}
      forms={[buchungForm]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Eine bestätigte Buchung auswählen und den Gast einchecken.'),
        needs: [tx('Bestätigte Buchung')],
      }}
    >
      <WizardStep
        label={tx('Buchung wählen')}
        description={tx('Nur bestätigte Buchungen werden angezeigt.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={buchungForm.get('buchung') as string | undefined}
          onSelect={id => {
            buchungForm.set('buchung', id, buchungen.labelOf(id));
            // Lese die Buchungs-Rohdaten für die Zusammenfassung
            const raw = buchungen.recordOf(id);
            if (raw) {
              const gastId = fieldRef(raw, 'gast');
              const zimmerId = fieldRef(raw, 'zimmer');
              const gast = gastId ? data.gaesteMap.get(gastId) : undefined;
              const zimmer = zimmerId ? data.zimmerMap.get(zimmerId) : undefined;
              const gastName = gast
                ? `${gast.fields.vorname ?? ''} ${gast.fields.nachname ?? ''}`.trim()
                : (buchungen.labelOf(id) ?? '');
              const zimmerName = zimmer?.fields.bezeichnung ?? '';
              const statusLv = fieldLookup(raw, 'status');
              setSelectedFacts({
                gastName,
                zimmerName,
                anreise: fieldDate(raw, 'anreise'),
                abreise: fieldDate(raw, 'abreise'),
                personen: fieldNumber(raw, 'personen'),
                statusKey: statusLv?.key,
                statusLabel: statusLv?.label,
              });
            }
            setStep(2);
          }}
          emptyText={tx('Keine bestätigten Buchungen gefunden.')}
          create={false}
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
        />
        <StepNav hideBack onNext={() => {
          if (!buchungForm.get('buchung')) return tx('Bitte eine Buchung auswählen.');
        }} nextStepLabel={tx('Bestätigen')} />
      </WizardStep>

      <WizardStep label={tx('Einchecken bestätigen')}>
        {!submit.done && (
          <>
            {selectedFacts && (
              <div className="mb-4 rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{selectedFacts.gastName || tx('Unbekannter Gast')}</span>
                  <StatusBadge
                    statusKey={selectedFacts.statusKey}
                    label={selectedFacts.statusLabel}
                  />
                </div>
                <div className="text-sm text-muted-foreground">{selectedFacts.zimmerName}</div>
                {selectedFacts.anreise && selectedFacts.abreise && (
                  <div className="text-sm text-muted-foreground">
                    {formatDate(selectedFacts.anreise)} – {formatDate(selectedFacts.abreise)}
                  </div>
                )}
                {selectedFacts.personen != null && (
                  <div className="text-sm text-muted-foreground">
                    {selectedFacts.personen} {tx('Personen')}
                  </div>
                )}
              </div>
            )}
            <SummaryStep
              forms={[buchungForm]}
              submit={submit}
              items={summaryItems}
              confirmLabel={tx('Jetzt einchecken')}
              whatHappensNext={tx('Die Buchung wird sofort auf "Eingecheckt" gesetzt.')}
            />
          </>
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[buchungForm]}
          actions={{ copy: false, print: false }}
          next={[
            { label: tx('Weiteren Gast einchecken'), onClick: restart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Der Gast ist nun als eingecheckt markiert. Bei der Abreise den Ablauf „Gast auschecken" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
