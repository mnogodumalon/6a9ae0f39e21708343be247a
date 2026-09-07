/**
 * Rechnung stellen — 3-Schritt-Wizard.
 * Steps: 1) Buchung wählen (abgeschlossene/laufende Aufenthalte ohne Rechnung) →
 *         2) Rechnungsdaten (Betrag, Datum, Fälligkeit, Zahlungsstatus) →
 *         3) Prüfen & anlegen.
 * Reads: buchungen (gefiltert: ausgecheckt|eingecheckt, noch keine Rechnung), rechnungen (für Duplikat-Check).
 * Writes: rechnungen (createRechnungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, Bound, ChoiceGroup, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  useRecordCount,
  fieldLookup,
  fieldDate,
  fieldNumber,
  fieldRef,
  combineFilters,
  refFilter,
  todayIso,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { differenceInCalendarDays, parseISO } from 'date-fns';

export default function RechnungStellenPage() {
  const [step, setStep] = useState(1);

  // Buchungen: nur ausgecheckt oder eingecheckt
  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: "r.v_status in ['ausgecheckt', 'eingecheckt']",
    where: r => {
      const s = fieldLookup(r, 'status')?.key;
      return s === 'ausgecheckt' || s === 'eingecheckt';
    },
    searchFields: ['bemerkung'],
    toItem: (b, ctx) => {
      const gastName = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerName = ctx.ref('zimmer') ?? tx('Unbekanntes Zimmer');
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const zeitraum =
        anreise && abreise
          ? `${anreise} – ${abreise}`
          : anreise ?? tx('Kein Datum');
      return {
        id: b.id,
        title: gastName,
        subtitle: `${zimmerName} · ${zeitraum}`,
        status: fieldLookup(b, 'status') ?? undefined,
      };
    },
  });

  // Form für Rechnungsdaten
  const rechnung = useStepForm('rechnungen', {
    steps: {
      buchung: 1,
      betrag: 2,
      rechnungsdatum: 2,
      faellig_am: 2,
      zahlungsstatus: 2,
    },
    required: {
      rechnungsdatum: false,
      faellig_am: false,
      zahlungsstatus: false,
    },
    initial: {
      rechnungsdatum: todayIso(),
      zahlungsstatus: 'offen',
    },
  });

  // Preis vorbelegen wenn Buchung gewählt
  const selectedBuchungId = rechnung.get('buchung') as string | null;
  const selectedBuchung = selectedBuchungId
    ? buchungen.recordOf(selectedBuchungId)
    : undefined;

  // Bereits existierende Rechnung für die gewählte Buchung zählen
  const rechnungCount = useRecordCount(servicePort, 'rechnungen', {
    filter: selectedBuchungId
      ? refFilter('buchung', selectedBuchungId)
      : undefined,
    where: r => fieldRef(r, 'buchung') === selectedBuchungId,
    enabled: Boolean(selectedBuchungId),
  });

  const hatBereitsRechnung = (rechnungCount.count ?? 0) > 0;

  // Betrag aus Zimmerpreis × Nächte vorbelegen
  const preisPlan = (bId: string) => {
    const b = buchungen.recordOf(bId);
    if (!b) return;
    const anreise = fieldDate(b, 'anreise');
    const abreise = fieldDate(b, 'abreise');
    if (anreise && abreise) {
      const naechte = differenceInCalendarDays(parseISO(abreise), parseISO(anreise));
      if (naechte > 0) {
        const zimmerRef = fieldRef(b, 'zimmer');
        if (zimmerRef) {
          servicePort.get('zimmer', zimmerRef).then(z => {
            if (!z) return;
            const ppn = fieldNumber(z, 'preis_pro_nacht');
            if (ppn && ppn > 0) {
              const betrag = ppn * naechte;
              rechnung.set('betrag', String(betrag));
            }
          });
        }
      }
    }
  };

  const submit = useJourneySubmit(
    servicePort,
    [
      {
        key: 'rechnung',
        entity: 'rechnungen',
        form: rechnung,
        primary: true,
      },
    ],
    { draftKey: 'rechnung-stellen' }
  );

  return (
    <IntentWizardShell
      title={tx('Rechnung stellen')}
      subtitle={tx('Rechnung für eine Buchung anlegen')}
      currentStep={step}
      onStepChange={setStep}
      forms={[rechnung]}
      draftKey="rechnung-stellen"
      intro={{
        description: tx('Eine neue Rechnung für einen abgeschlossenen oder laufenden Aufenthalt erstellen.'),
        needs: [tx('Abgeschlossene oder laufende Buchung'), tx('Rechnungsbetrag in EUR')],
      }}
    >
      {/* Schritt 1: Buchung wählen */}
      <WizardStep
        label={tx('Buchung')}
        description={tx('Abgeschlossene oder laufende Buchung auswählen, für die noch keine Rechnung existiert.')}
      >
        <EntitySelectStep
          {...buchungen.select}
          selectedId={rechnung.get('buchung') as string | null}
          onSelect={id => {
            rechnung.set('buchung', id, buchungen.labelOf(id) ?? id);
            preisPlan(id);
            setStep(2);
          }}
          avatar="initials"
          searchPlaceholder={tx('Nach Gast oder Zimmer suchen …')}
          emptyText={tx('Keine abgeschlossenen oder laufenden Buchungen ohne Rechnung gefunden.')}
          create={false}
        />
      </WizardStep>

      {/* Schritt 2: Rechnungsdaten */}
      <WizardStep
        label={tx('Rechnungsdaten')}
        description={tx('Betrag, Datum und Zahlungsstatus der Rechnung festlegen.')}
        needs={['buchung']}
      >
        {rechnung.get('buchung') ? (
          <div className="space-y-5">
            {hatBereitsRechnung && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                {tx('Für diese Buchung existiert bereits eine Rechnung. Du kannst trotzdem eine weitere anlegen.')}
              </div>
            )}
            {selectedBuchung && (
              <div className="rounded-lg bg-secondary p-3 text-sm text-muted-foreground">
                <span className="font-medium">{buchungen.labelOf(selectedBuchungId!) ?? tx('Gast')}</span>
                {' · '}
                {(() => {
                  const anreise = fieldDate(selectedBuchung, 'anreise');
                  const abreise = fieldDate(selectedBuchung, 'abreise');
                  return anreise && abreise
                    ? `${anreise} – ${abreise}`
                    : anreise ?? '';
                })()}
              </div>
            )}
            <Bound
              form={rechnung}
              name="betrag"
              hint={tx('Gesamtbetrag inkl. aller Leistungen in EUR')}
            />
            <Bound form={rechnung} name="rechnungsdatum" />
            <Bound form={rechnung} name="faellig_am" />
            <Bound form={rechnung} name="zahlungsstatus" />
            <StepNav
              onNext={() => rechnung.validate(['betrag'])}
              nextStepLabel={tx('Prüfen')}
              onBack={() => setStep(1)}
            />
          </div>
        ) : (
          <StepNav onBack={() => setStep(1)} nextDisabled>
            {tx('Bitte zuerst eine Buchung auswählen.')}
          </StepNav>
        )}
      </WizardStep>

      {/* Schritt 3: Prüfen & anlegen */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.done ? (
          <SummaryStep
            forms={[rechnung]}
            submit={submit}
            whatHappensNext={tx('Die Rechnung wird sofort angelegt und ist in der Rechnungsübersicht sichtbar.')}
          />
        ) : null}
      </WizardStep>

      {/* Erfolgsanzeige */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[rechnung]}
          submit={submit}
          restartLabel={tx('Weitere Rechnung stellen')}
          next={[
            { label: tx('Neue Buchung anlegen'), href: '#/intents/neue-buchung' },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Die Rechnung ist jetzt in der Rechnungsübersicht verfügbar. Beim Zahlungseingang den Zahlungsstatus aktualisieren.')}
        />
      )}
    </IntentWizardShell>
  );
}
