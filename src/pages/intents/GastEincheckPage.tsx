/**
 * Gast einchecken — 2-Schritt-Wizard (Buchung wählen + Prüfen & einchecken).
 * Steps: 1) Buchung wählen (status='bestaetigt', anreise <= heute) → 2) Prüfen & einchecken.
 * Reads: buchungen (via useRecordSearch). Writes: buchungen (updateBuchungenEntry, status → 'eingecheckt').
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, StepNav, SummaryStep, SuccessStep.
 */
import { useState, useMemo } from 'react';
import { format, parseISO, isToday, isPast, differenceInCalendarDays } from 'date-fns';
import { IntentWizardShell, WizardStep, useWizard } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { useStepForm, useJourneySubmit, useRecordSearch, fieldLookup, fieldDate } from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { tx } from '@/i18n';
import { IconAlertTriangle } from '@tabler/icons-react';
import type { SummaryItem } from '@/lib/journey/useStepForm';

export default function GastEincheckPage() {
  const [step, setStep] = useState(1);

  const buchungen = useRecordSearch(servicePort, 'buchungen', {
    filter: `r.v_status == 'bestaetigt'`,
    where: r => fieldLookup(r, 'status')?.key === 'bestaetigt',
    searchFields: ['bemerkung'],
    toItem: (b, ctx) => {
      const anreise = fieldDate(b, 'anreise');
      const abreise = fieldDate(b, 'abreise');
      const gastLabel = ctx.ref('gast') ?? tx('Unbekannter Gast');
      const zimmerLabel = ctx.ref('zimmer') ?? tx('Kein Zimmer');
      const anreiseFormatted = anreise ? format(parseISO(anreise), 'dd.MM.yyyy') : '—';
      const abreiseFormatted = abreise ? format(parseISO(abreise), 'dd.MM.yyyy') : '—';
      const anreiseDate = anreise ? parseISO(anreise) : null;
      const overdue = anreiseDate && isPast(anreiseDate) && !isToday(anreiseDate);
      return {
        id: b.id,
        title: gastLabel,
        subtitle: `${zimmerLabel} · ${anreiseFormatted} – ${abreiseFormatted}`,
        status: overdue
          ? { key: 'ueberfaellig', label: tx('Überfällig') }
          : { key: 'heute', label: tx('Heute') },
      };
    },
  });

  const f = useStepForm('buchungen', {
    steps: { _buchungId: 1 },
    fields: ['_buchungId'],
  });

  const buchungId = f.get('_buchungId') as string | undefined;
  const buchungRecord = buchungId ? buchungen.recordOf(buchungId) : undefined;

  const summaryItems = useMemo((): SummaryItem[] => {
    if (!buchungRecord || !buchungId) return [];
    const anreise = fieldDate(buchungRecord, 'anreise');
    const abreise = fieldDate(buchungRecord, 'abreise');
    const anreiseDate = anreise ? parseISO(anreise) : null;
    const abreiseDate = abreise ? parseISO(abreise) : null;
    const overdueDays = anreiseDate && isPast(anreiseDate) && !isToday(anreiseDate)
      ? differenceInCalendarDays(new Date(), anreiseDate)
      : 0;
    const items: SummaryItem[] = [
      {
        key: 'gast',
        label: tx('Gast'),
        value: buchungen.labelOf(buchungId) || tx('—'),
        step: 1,
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      },
      {
        key: 'zimmer',
        label: tx('Zimmer'),
        value: buchungen.refLabel(buchungRecord, 'zimmer') ?? tx('—'),
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      },
      {
        key: 'anreise',
        label: tx('Anreise'),
        value: anreiseDate ? format(anreiseDate, 'dd.MM.yyyy') : '—',
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      },
      {
        key: 'abreise',
        label: tx('Abreise'),
        value: abreiseDate ? format(abreiseDate, 'dd.MM.yyyy') : '—',
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      },
      {
        key: 'personen',
        label: tx('Personen'),
        value: String(buchungRecord.fields['personen'] ?? '—'),
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      },
    ];
    if (overdueDays > 0) {
      items.push({
        key: 'hinweis',
        label: tx('Hinweis'),
        value: overdueDays === 1
          ? tx('Anreise war gestern — Check-in überfällig!')
          : `${overdueDays} ${tx('Tage überfällig')}`,
        keys: ['_buchungId'],
        fieldId: f.fieldId('_buchungId'),
      });
    }
    return items;
  }, [buchungRecord, buchungId, buchungen, f]);

  const submit = useJourneySubmit(servicePort, [
    {
      key: 'checkin',
      entity: 'buchungen',
      form: f,
      updates: buchungId ?? '',
      values: { status: 'eingecheckt' },
      primary: true,
    },
  ], { draftKey: 'gast-einchecken' });

  return (
    <IntentWizardShell
      title={tx('Gast einchecken')}
      currentStep={step}
      onStepChange={setStep}
      forms={[f]}
      draftKey="gast-einchecken"
      intro={{
        description: tx('Bestätigte Buchung auswählen und Gast als eingecheckt markieren.'),
        needs: [tx('Buchung mit Status „Bestätigt"'), tx('Anreise heute oder früher')],
      }}
    >
      <WizardStep
        label={tx('Buchung')}
        heading={tx('Buchung wählen')}
        description={tx('Nur bestätigte Buchungen mit Anreise heute oder früher werden angezeigt.')}
      >
        <BuchungSelectStep
          buchungen={buchungen}
          selectedId={buchungId}
          onSelect={(id) => {
            f.set('_buchungId', id, buchungen.labelOf(id));
            setStep(2);
          }}
        />
      </WizardStep>

      <WizardStep label={tx('Prüfen')} needs={['_buchungId']}>
        {!submit.done && (
          <>
            {buchungRecord && (() => {
              const anreise = fieldDate(buchungRecord, 'anreise');
              const anreiseDate = anreise ? parseISO(anreise) : null;
              const overdueDays = anreiseDate && isPast(anreiseDate) && !isToday(anreiseDate)
                ? differenceInCalendarDays(new Date(), anreiseDate)
                : 0;
              return overdueDays > 0 ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4 text-sm text-amber-800">
                  <IconAlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-600" />
                  <span>
                    {overdueDays === 1
                      ? tx('Die Anreise war gestern — der Check-in ist überfällig.')
                      : `${tx('Die Anreise war vor')} ${overdueDays} ${tx('Tagen — der Check-in ist überfällig.')}`}
                  </span>
                </div>
              ) : null;
            })()}
            <SummaryStep
              forms={[f]}
              submit={submit}
              items={summaryItems}
              confirmLabel={tx('Jetzt einchecken')}
              whatHappensNext={tx('Der Gast wird als eingecheckt markiert. Das Zimmer bleibt belegt.')}
            />
          </>
        )}
      </WizardStep>

      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          verb="updated"
          actions={{ copy: false, print: false }}
          next={[
            {
              label: tx('Weiteren Gast einchecken'),
              onClick: () => { submit.reset(); f.reset(); setStep(1); },
            },
            {
              label: tx('Rechnung stellen'),
              href: '#/intents/rechnung-erstellen',
            },
            {
              label: tx('Zum Dashboard'),
              href: '#/',
            },
          ]}
          whatHappensNext={tx('Beim Abreisen den Ablauf „Gast auschecken" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}

function BuchungSelectStep({
  buchungen,
  selectedId,
  onSelect,
}: {
  buchungen: ReturnType<typeof useRecordSearch>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const wizard = useWizard();
  return (
    <EntitySelectStep
      {...buchungen.select}
      selectedId={selectedId}
      onSelect={(id) => {
        onSelect(id);
        wizard?.next();
      }}
      create={false}
      emptyText={tx('Keine bestätigten Buchungen mit Anreise heute oder früher gefunden.')}
      searchPlaceholder={tx('Gast suchen …')}
    />
  );
}
