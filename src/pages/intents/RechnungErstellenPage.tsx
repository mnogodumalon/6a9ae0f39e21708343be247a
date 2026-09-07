/**
 * Rechnung erstellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (nur eingecheckt/ausgecheckt) → 2) Rechnungsdetails erfassen
 *        → 3) Prüfen & anlegen.
 * Reads: buchungen (via useRecordSearch, gefiltert nach status eingecheckt/ausgecheckt).
 * Writes: rechnungen (createRechnungenEntry); updates buchungen auf 'ausgecheckt' wenn
 *         status noch 'eingecheckt' (updateBuchungenEntry via run-Schritt).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, ChoiceGroup, StepNav,
 *           SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { Field } from '@/components/blocks/Field';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Bound } from '@/components/blocks/Bound';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  fieldText,
  fieldDate,
  fieldLookup,
  fieldNumber,
  todayIso,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { LivingAppsService } from '@/services/livingAppsService';
import { tx } from '@/i18n';
import { formatCurrency, formatDate } from '@/lib/formatters';

const DRAFT_KEY = 'rechnung-erstellen';

export default function RechnungErstellenPage() {
  const [step, setStep] = useState(1);

  // Buchungen: nur eingecheckt oder ausgecheckt qualifizieren
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status in ['eingecheckt', 'ausgecheckt']",
    where: r => {
      const key = fieldLookup(r, 'status')?.key;
      return key === 'eingecheckt' || key === 'ausgecheckt';
    },
    searchFields: [],
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerName = ctx.ref('zimmer') ?? tx('Unbekanntes Zimmer');
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      let zeitraum = '';
      if (anreise && abreise) {
        const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
        zeitraum = `${formatDate(anreise)} – ${formatDate(abreise)} · ${naechte} ${naechte === 1 ? tx('Nacht') : tx('Nächte')}`;
      } else if (anreise) {
        zeitraum = formatDate(anreise);
      }
      const status = fieldLookup(b, 'status');
      return {
        id: b.id,
        title: gastName,
        subtitle: `${zimmerName}${zeitraum ? ' · ' + zeitraum : ''}`,
        status: status ?? undefined,
      };
    },
  });

  // Formular für Rechnungsdaten
  const rechnung = useStepForm('rechnungen', {
    steps: {
      buchung: 1,
      betrag: 2,
      rechnungsdatum: 2,
      faellig_am: 2,
      zahlungsstatus: 2,
    },
    initial: {
      rechnungsdatum: todayIso(),
      zahlungsstatus: 'offen',
    },
    required: {
      zahlungseingang: false,
    },
  });

  // Plan: erst Rechnung anlegen, dann Buchungsstatus auf 'ausgecheckt' setzen falls nötig
  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'rechnung',
        entity: 'rechnungen',
        form: rechnung,
        primary: true,
        values: (_ctx) => {
          // buchung-Feld aus dem Formular: die gewählte Buchungs-ID
          const buchungId = rechnung.get('buchung') as string | undefined;
          return buchungId ? { buchung: buchungId } : {};
        },
      },
      {
        key: 'buchungUpdate',
        label: tx('Buchungsstatus aktualisieren'),
        needs: ['rechnung'],
        run: async () => {
          const buchungId = rechnung.get('buchung') as string | undefined;
          if (!buchungId) return;
          const buchungRecord = buchungen.recordOf(buchungId);
          const statusKey = buchungRecord ? fieldLookup(buchungRecord, 'status')?.key : undefined;
          if (statusKey === 'eingecheckt') {
            await LivingAppsService.updateBuchungenEntry(buchungId, { status: 'ausgecheckt' });
          }
        },
      },
    ],
    { draftKey: DRAFT_KEY },
  );

  // Betragsvorschlag berechnen: Nächte × Zimmerpreis
  function berechneBetrag(buchungId: string): number | undefined {
    const b = buchungen.recordOf(buchungId);
    if (!b) return undefined;
    const anreise = fieldDate(b, 'anreise');
    const abreise = fieldDate(b, 'abreise');
    if (!anreise || !abreise) return undefined;
    const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
    if (naechte <= 0) return undefined;
    // Zimmerpreis aus dem verlinkten Zimmer-Record nicht verfügbar ohne zweiten Request —
    // wir geben nur die Nächteanzahl zurück, der Nutzer trägt den Preis selbst ein.
    // Wenn die Buchung einen Betrag im Zimmer hat, wird er unten via stats angezeigt.
    return undefined;
  }

  const handleBuchungSelect = (id: string) => {
    rechnung.set('buchung', id, buchungen.labelOf(id));
    // Vorschlag für Rechnungsdatum: heute (bereits als Initial gesetzt)
    // Betrag: kein automatischer Wert ohne Zimmerpreis verfügbar
    setStep(2);
  };

  const restart = () => {
    submit.reset();
    rechnung.reset({
      rechnungsdatum: todayIso(),
      zahlungsstatus: 'offen',
    });
    setStep(1);
  };

  const selectedBuchungId = rechnung.get('buchung') as string | undefined;
  const selectedBuchung = selectedBuchungId ? buchungen.recordOf(selectedBuchungId) : undefined;

  return (
    <IntentWizardShell
      title={tx('Rechnung erstellen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[rechnung]}
      draftKey={DRAFT_KEY}
      intro={{
        description: tx('Eine Rechnung zu einer bestehenden Buchung ausstellen.'),
        needs: [tx('Eine eingecheckte oder ausgecheckte Buchung'), tx('Betrag und Fälligkeitsdatum')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Nur eingecheckte und ausgecheckte Buchungen können berechnet werden.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={selectedBuchungId}
          onSelect={handleBuchungSelect}
          emptyText={tx('Keine Buchungen mit Status „Eingecheckt" oder „Ausgecheckt" gefunden.')}
          create={false}
          searchPlaceholder={tx('Gast oder Zimmer suchen …')}
        />
      </WizardStep>

      {/* Schritt 2: Rechnungsdetails */}
      <WizardStep
        label={tx('Rechnungsdetails')}
        description={tx('Betrag, Datum und Zahlungsstatus der Rechnung festlegen.')}
        needs={['buchung']}
      >
        <div className="space-y-5">
          {selectedBuchung && (
            <div className="rounded-xl bg-secondary px-4 py-3 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">
                {buchungen.labelOf(selectedBuchungId!) ?? tx('Buchung')}
              </p>
              {(() => {
                const anreise = fieldDate(selectedBuchung, 'anreise');
                const abreise = fieldDate(selectedBuchung, 'abreise');
                if (anreise && abreise) {
                  const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
                  return (
                    <p>
                      {formatDate(anreise)} – {formatDate(abreise)}
                      {' · '}
                      {naechte} {naechte === 1 ? tx('Nacht') : tx('Nächte')}
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}

          <Bound
            form={rechnung}
            name="betrag"
            hint={tx('Gesamtbetrag in Euro (z. B. Nächte × Zimmerpreis)')}
            placeholder="0,00"
          />

          <Bound form={rechnung} name="rechnungsdatum" />

          <Bound form={rechnung} name="faellig_am" />

          <Field form={rechnung} name="zahlungsstatus">
            <ChoiceGroup {...rechnung.choice('zahlungsstatus')} />
          </Field>

          <StepNav
            onNext={() => rechnung.validate(['betrag', 'rechnungsdatum', 'faellig_am', 'zahlungsstatus'])}
            nextStepLabel={tx('Prüfen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3: Prüfen & bestätigen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done && (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung wird angelegt. Falls die Buchung noch eingecheckt ist, wird der Status automatisch auf „Ausgecheckt" gesetzt.')}
            items={
              selectedBuchung && (() => {
                const anreise = fieldDate(selectedBuchung, 'anreise');
                const abreise = fieldDate(selectedBuchung, 'abreise');
                const betrag = rechnung.get('betrag');
                const rows = [];
                if (anreise && abreise) {
                  const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
                  rows.push({
                    key: '_naechte',
                    keys: ['_naechte'],
                    label: tx('Aufenthalt'),
                    value: `${formatDate(anreise)} – ${formatDate(abreise)} · ${naechte} ${naechte === 1 ? tx('Nacht') : tx('Nächte')}`,
                  });
                }
                if (betrag && typeof betrag === 'number' && betrag > 0) {
                  rows.push({
                    key: '_betrag_anzeige',
                    keys: ['_betrag_anzeige'],
                    label: tx('Rechnungsbetrag'),
                    value: formatCurrency(betrag),
                  });
                }
                return rows;
              })()
            }
          />
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          whatHappensNext={tx('Die Buchung ist als ausgecheckt markiert. Die Rechnung ist im System hinterlegt.')}
          next={[
            {
              label: tx('Weitere Rechnung erstellen'),
              onClick: restart,
            },
            {
              label: tx('Neue Buchung anlegen'),
              href: '#/intents/neue-buchung',
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
