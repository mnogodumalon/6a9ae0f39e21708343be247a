/**
 * Neue Buchung — 5-Schritt-Wizard.
 * Steps: 1) Gast wählen → 2) Zeitraum wählen → 3) Zimmer wählen → 4) Zusatzleistungen & Details → 5) Prüfen & anlegen.
 * Reads: buchungen (Belegung), zusatzleistungen. Writes: buchungen (createBuchungenEntry).
 * Composes: IntentWizardShell, WizardStep, EntitySelectStep, AvailabilityRangePicker,
 *           ChoiceGroup, Field, Bound, StepNav, SummaryStep, SuccessStep.
 */
import { useState } from 'react';
import { IntentWizardShell, WizardStep } from '@/components/blocks/IntentWizardShell';
import { EntitySelectStep } from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker, rangeIsFree } from '@/components/blocks/AvailabilityRangePicker';
import { ChoiceGroup } from '@/components/blocks/ChoiceGroup';
import { Field } from '@/components/blocks/Field';
import { Bound } from '@/components/blocks/Bound';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  occupancyFor,
  fieldText,
  fieldLookup,
  fieldNumber,
} from '@/lib/journey';
import { servicePort } from '@/services/journeyPort';
import { useDashboardData } from '@/hooks/useDashboardData';
import { LOOKUP_OPTIONS } from '@/types/app';
import { formatCurrency } from '@/lib/formatters';
import { tx } from '@/i18n';

export default function NeueBuchungPage() {
  // Gaeste and Zimmer are searched via the layer — do NOT pull them through useDashboardData.
  // Buchungen are needed for availability blocking. Zusatzleistungen for the multi-select step.
  const data = useDashboardData({ omit: ['gaeste', 'zimmer', 'rechnungen'] });
  const { buchungen, zusatzleistungen, loading, error, fetchAll } = data;

  const [step, setStep] = useState(1);

  // --- Record search hooks (all before any early return) ---
  const gaeste = useRecordSearch(servicePort, 'gaeste', {
    searchFields: ['vorname', 'nachname', 'email'],
    toItem: g => ({
      id: g.id,
      title: `${fieldText(g, 'vorname')} ${fieldText(g, 'nachname')}`.trim() || g.id,
      subtitle: fieldText(g, 'email'),
    }),
    orderby: ['r.v_nachname asc'],
  });

  const zimmer = useRecordSearch(servicePort, 'zimmer', {
    searchFields: ['bezeichnung'],
    toItem: z => ({
      id: z.id,
      title: fieldText(z, 'bezeichnung') || z.id,
      subtitle: fieldLookup(z, 'kategorie')?.label,
      stats: fieldNumber(z, 'preis_pro_nacht') !== null
        ? [{ label: tx('pro Nacht'), value: formatCurrency(fieldNumber(z, 'preis_pro_nacht')!) }]
        : undefined,
    }),
  });

  // --- Form (ONE for the whole booking) ---
  const f = useStepForm('buchungen', {
    steps: {
      gast: 1,
      anreise: 2,
      abreise: 2,
      zimmer: 3,
      zusatzleistungen_buchung: 4,
      personen: 4,
      status: 4,
      bemerkung: 4,
    },
    initial: {
      status: LOOKUP_OPTIONS['buchungen']?.['status']?.find(o => o.key === 'bestaetigt')?.key ?? 'bestaetigt',
    },
  });

  // Blocked nights: per zimmer, frei wenn storniert — driven by the occupancy config.
  const zimmerId = f.get('zimmer') as string | undefined;
  const blocked = occupancyFor('buchungen', buchungen, { resource: zimmerId ?? null });

  // Filtered zimmer: only those free in the selected range.
  const anreise = f.get('anreise') as string | undefined;
  const abreise = f.get('abreise') as string | undefined;

  // --- Plan ---
  const submit = useJourneySubmit(servicePort, [
    {
      key: 'buchung',
      entity: 'buchungen',
      form: f,
      primary: true,
    },
  ], { draftKey: 'neue-buchung' });

  const restart = () => {
    submit.reset();
    f.reset();
    setStep(1);
  };

  // Zusatzleistungen options for multi-select (aktiv=true bevorzugen)
  const zusatzOptions = [...zusatzleistungen]
    .sort((a, b) => {
      const aA = a.fields.aktiv ? 0 : 1;
      const bA = b.fields.aktiv ? 0 : 1;
      return aA - bA;
    });

  // Zimmer-Filter: nur Zimmer die im gewählten Zeitraum frei sind
  const hasRange = Boolean(anreise && abreise);
  const zimmerFiltered = hasRange
    ? {
        ...zimmer,
        select: {
          ...zimmer.select,
          items: zimmer.select.items.filter(item =>
            rangeIsFree(anreise!, abreise!, occupancyFor('buchungen', buchungen, { resource: item.id }))
          ),
        },
      }
    : zimmer;

  return (
    <IntentWizardShell
      title={tx('Neue Buchung')}
      currentStep={step}
      onStepChange={setStep}
      loading={loading}
      error={error}
      onRetry={fetchAll}
      forms={[f]}
      draftKey="neue-buchung"
      intro={{
        description: tx('Gast suchen oder anlegen, freies Zimmer wählen und Buchung bestätigen.'),
        needs: [tx('Name des Gastes'), tx('Reisezeitraum'), tx('Zimmerwahl')],
      }}
    >
      {/* Schritt 1 — Gast */}
      <WizardStep
        label={tx('Gast')}
        heading={tx('Wer reist an?')}
        description={tx('Gast suchen oder neu anlegen.')}
      >
        <EntitySelectStep
          {...gaeste.select}
          selectedId={f.get('gast') as string | undefined}
          onSelect={id => {
            f.set('gast', id, gaeste.labelOf(id));
            setStep(2);
          }}
          create={{ fields: ['vorname', 'nachname', 'email', 'telefon'] }}
          searchPlaceholder={tx('Name oder E-Mail …')}
        />
      </WizardStep>

      {/* Schritt 2 — Zeitraum */}
      <WizardStep
        label={tx('Zeitraum')}
        heading={tx('Wann und wie lange?')}
        description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut.')}
      >
        <div className="space-y-4">
          <AvailabilityRangePicker
            {...f.range('anreise', 'abreise', { blocked })}
            legend={tx('Belegte Nächte sind nicht buchbar.')}
          />
          <StepNav
            onNext={() => f.validate(['anreise', 'abreise'])}
            nextStepLabel={tx('Zimmer wählen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 3 — Zimmer */}
      <WizardStep
        label={tx('Zimmer')}
        heading={tx('Welches Zimmer?')}
        description={
          hasRange
            ? tx('Nur verfügbare Zimmer werden angezeigt.')
            : tx('Zuerst einen Zeitraum wählen — dann werden nur freie Zimmer angezeigt.')
        }
      >
        {!hasRange ? (
          <StepNav onBack={() => setStep(2)} nextDisabled>
            <p className="text-sm text-muted-foreground">
              {tx('Bitte zuerst den Reisezeitraum in Schritt 2 festlegen.')}
            </p>
          </StepNav>
        ) : (
          <EntitySelectStep
            {...zimmerFiltered.select}
            selectedId={f.get('zimmer') as string | undefined}
            onSelect={id => {
              f.set('zimmer', id, zimmer.labelOf(id));
              setStep(4);
            }}
            emptyText={tx('Im gewählten Zeitraum ist kein Zimmer verfügbar.')}
            create={false}
            searchPlaceholder={tx('Zimmer suchen …')}
          />
        )}
      </WizardStep>

      {/* Schritt 4 — Zusatzleistungen & Details */}
      <WizardStep
        label={tx('Details')}
        heading={tx('Was soll dazu?')}
        description={tx('Zusatzleistungen, Personenzahl und Status festlegen.')}
      >
        <div className="space-y-5">
          {/* Zusatzleistungen — multipleapplookup */}
          <Field form={f} name="zusatzleistungen_buchung" label={tx('Zusatzleistungen')}>
            <div className="flex flex-wrap gap-2 mt-1">
              {zusatzOptions.map(z => {
                const selectedIds = (f.get('zusatzleistungen_buchung') as string[] | undefined) ?? [];
                const isSelected = selectedIds.includes(z.record_id);
                return (
                  <button
                    key={z.record_id}
                    type="button"
                    onClick={() => {
                      const next = isSelected
                        ? selectedIds.filter(id => id !== z.record_id)
                        : [...selectedIds, z.record_id];
                      f.set('zusatzleistungen_buchung', next);
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                      isSelected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:bg-accent'
                    }${!z.fields.aktiv ? ' opacity-60' : ''}`}
                  >
                    {z.fields.name ?? z.record_id}
                    {z.fields.preis !== undefined && (
                      <span className="ml-1 text-xs opacity-80">
                        +{formatCurrency(z.fields.preis)}
                      </span>
                    )}
                  </button>
                );
              })}
              {zusatzOptions.length === 0 && (
                <p className="text-sm text-muted-foreground">{tx('Keine Zusatzleistungen vorhanden.')}</p>
              )}
            </div>
          </Field>

          {/* Personenzahl */}
          <Bound form={f} name="personen" />

          {/* Status */}
          <Field form={f} name="status">
            <ChoiceGroup {...f.choice('status')} />
          </Field>

          {/* Bemerkung */}
          <Bound form={f} name="bemerkung" rows={3} />

          <StepNav
            onNext={() => f.validate(['personen', 'status'])}
            nextStepLabel={tx('Prüfen & anlegen')}
          />
        </div>
      </WizardStep>

      {/* Schritt 5 — Zusammenfassung */}
      <WizardStep label={tx('Prüfen')}>
        {!submit.result && (
          <SummaryStep
            forms={[f]}
            submit={submit}
            whatHappensNext={tx('Die Buchung erscheint sofort im Belegungsplan.')}
            confirmLabel={tx('Buchung anlegen')}
          />
        )}
      </WizardStep>

      {/* Erfolgsmeldung */}
      {submit.result && (
        <SuccessStep
          result={submit.result}
          forms={[f]}
          next={[
            { label: tx('Weitere Buchung anlegen'), onClick: restart },
            { label: tx('Zum Dashboard'), href: '#/' },
          ]}
          whatHappensNext={tx('Zur Abrechnung den Ablauf „Rechnung erstellen" nutzen.')}
        />
      )}
    </IntentWizardShell>
  );
}
