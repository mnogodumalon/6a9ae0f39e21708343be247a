import { useEffect, useMemo, useState } from 'react';
import {
  loadPublicPagesConfig,
  prepareChallenge,
  PageUnavailableError,
  type PublicPagesConfig,
  type PublicPageConfig,
} from '@/lib/publicClient';
import { PublicShell } from '@/components/PublicShell';
import {
  useStepForm,
  useJourneySubmit,
  useRecordSearch,
  fieldText,
  fieldNumber,
  fieldRef,
  fieldDate,
  type JourneyRecord,
} from '@/lib/journey';
import { createPublicPort } from '@/lib/journey/publicPort';
import {
  IntentWizardShell,
  WizardStep,
} from '@/components/blocks/IntentWizardShell';
import { StepNav } from '@/components/blocks/StepNav';
import { SummaryStep } from '@/components/blocks/SummaryStep';
import { SuccessStep } from '@/components/blocks/SuccessStep';
import { Field } from '@/components/blocks/Field';
import {
  EntitySelectStep,
  type SelectItem,
} from '@/components/blocks/EntitySelectStep';
import { AvailabilityRangePicker } from '@/components/blocks/AvailabilityRangePicker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { tx } from '@/i18n';
import {
  IconBed,
  IconCalendar,
  IconCheck,
  IconStar,
  IconUser,
} from '@tabler/icons-react';
import { APP_IDS } from '@/types/app';

const SLUG = 'buchungsanfrage';

// Kategorie-Labels für die Zimmerauswahl
function zimmerToItem(r: JourneyRecord): SelectItem {
  const KATEGORIE_LABELS: Record<string, string> = {
  einzelzimmer: 'Einzelzimmer',
  doppelzimmer: 'Doppelzimmer',
  suite: 'Suite',
};

  const bezeichnung = fieldText(r, 'bezeichnung');
  const kategorie = fieldText(r, 'kategorie') || (KATEGORIE_LABELS[(r.fields.kategorie as string) ?? ''] ?? '');
  const preis = fieldNumber(r, 'preis_pro_nacht');
  const balkon = r.fields.balkon === true;
  const stats: SelectItem['stats'] = [];
  if (preis !== null) stats.push({ label: tx('Preis/Nacht'), value: `${preis.toLocaleString('de')} €` });
  if (balkon) stats.push({ label: tx('Balkon'), value: '✓' });
  return {
    id: r.id,
    title: bezeichnung,
    subtitle: kategorie,
    stats,
    icon: <IconBed size={20} className="text-muted-foreground" />,
  };
}

// Berechnung belegter Nächte aus buchungen-Records (status bestaetigt, eingecheckt, ausgecheckt)
const FREE_STATUS = new Set(['storniert', 'angefragt']);

function computeBlocked(
  buchungen: JourneyRecord[],
  zimmerId: string | null,
): Array<{ start: string; end?: string | null }> {
  return buchungen
    .filter(b => {
      // Nur für das gewählte Zimmer
      if (zimmerId) {
        const ref = fieldRef(b, 'zimmer');
        if (!ref || ref !== zimmerId) return false;
      }
      // Storniert und Angefragt zählen als frei
      const statusRaw = b.fields.status;
      const statusKey =
        statusRaw === null || statusRaw === undefined
          ? ''
          : typeof statusRaw === 'object' && 'key' in (statusRaw as object)
            ? String((statusRaw as { key: unknown }).key)
            : String(statusRaw);
      if (FREE_STATUS.has(statusKey)) return false;
      return true;
    })
    .map(b => ({
      start: fieldDate(b, 'anreise') ?? '',
      end: fieldDate(b, 'abreise'),
    }))
    .filter(b => b.start.length > 0);
}

export default function Buchungsanfrage() {
  const [cfg, setCfg] = useState<PublicPagesConfig | null>(null);
  const [page, setPage] = useState<PublicPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(1);

  useEffect(() => {
    loadPublicPagesConfig(SLUG)
      .then(c => {
        setCfg(c);
        setPage(c?.pages[SLUG] ?? null);
        setLoading(false);
      })
      .catch(err => {
        if (err instanceof PageUnavailableError) {
          setLoading(false);
        } else {
          setLoading(false);
        }
      });
  }, []);

  const port = useMemo(
    () => (cfg && page ? createPublicPort(cfg, page) : null),
    [cfg, page],
  );

  // Schritt 1: Gast-Kontaktdaten
  const gast = useStepForm('gaeste', {
    fields: ['vorname', 'nachname', 'email', 'telefon'],
    required: { vorname: true, nachname: true, email: false, telefon: false },
    steps: { vorname: 1, nachname: 1, email: 1, telefon: 1 },
    autoComplete: true,
  });

  // Schritt 2: Zimmer wählen + Schritt 3: Zeitraum + Schritt 4: Bestätigung
  const buchung = useStepForm('buchungen', {
    fields: ['zimmer', 'anreise', 'abreise', 'personen', 'bemerkung'],
    required: { zimmer: true, anreise: true, abreise: true, personen: false, bemerkung: false },
    steps: { zimmer: 2, anreise: 3, abreise: 3, personen: 3, bemerkung: 3 },
    autoComplete: true,
  });

  // Zimmer laden
  const zimmerSearch = useRecordSearch(
    port ?? ({
      door: 'public',
      async list() { return []; },
      async count() { return null; },
      async get() { return null; },
      async create() { throw new Error(tx('no port')); },
      ref() { return ''; },
    }),
    'zimmer',
    {
      searchFields: ['bezeichnung'],
      toItem: zimmerToItem,
    },
  );

  // Buchungen laden für Verfügbarkeit
  const [buchungenRecords, setBuchungenRecords] = useState<JourneyRecord[]>([]);
  useEffect(() => {
    if (!port) return;
    port.list('buchungen').then(rows => setBuchungenRecords(rows)).catch(() => {});
  }, [port]);

  const selectedZimmerId = buchung.get('zimmer') as string | null;

  const blocked = useMemo(
    () => computeBlocked(buchungenRecords, selectedZimmerId ?? null),
    [buchungenRecords, selectedZimmerId],
  );

  const submit = useJourneySubmit(
    port ?? ({
      door: 'public',
      async list() { return []; },
      async count() { return null; },
      async get() { return null; },
      async create() { throw new Error(tx('no port')); },
      ref() { return ''; },
    }),
    [
      { key: 'gast', entity: 'gaeste', form: gast },
      {
        key: 'buchung',
        entity: 'buchungen',
        form: buchung,
        primary: true,
        needs: ['gast'],
        link: { gast: 'gast' },
      },
    ],
    { draftKey: 'buchungsanfrage' },
  );

  const restart = () => {
    gast.reset();
    buchung.reset();
    submit.reset();
    setStep(1);
  };

  if (loading || !cfg) {
    return <PublicShell loading={loading} unavailable={!loading && !cfg} />;
  }
  if (!page) {
    return <PublicShell unavailable />;
  }

  const onFirstInteraction = () => {
    const ep = page.endpoints?.find(e => e.op === 'create');
    if (ep) prepareChallenge(cfg, page, 'POST', `/apps/${ep.app_id}/records`);
  };

  return (
    <PublicShell
      title={tx('Zimmer anfragen')}
      description={tx('Wähle dein Wunschzimmer und gib deinen Reisezeitraum an.')}
    >
      <IntentWizardShell
        currentStep={step}
        onStepChange={setStep}
        back={false}
        forms={[gast, buchung]}
        draftKey="buchungsanfrage"
      >
        {/* Schritt 1: Kontaktdaten */}
        <WizardStep
          label={tx('Kontaktdaten')}
          description={tx('Wie können wir dich erreichen?')}
        >
          <div className="space-y-4" onFocus={onFirstInteraction}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field form={gast} name="vorname">
                <Input {...gast.field('vorname')} />
              </Field>
              <Field form={gast} name="nachname">
                <Input {...gast.field('nachname')} />
              </Field>
            </div>
            <Field form={gast} name="email">
              <Input {...gast.field('email')} />
            </Field>
            <Field form={gast} name="telefon">
              <Input {...gast.field('telefon')} />
            </Field>
          </div>
          <StepNav
            onNext={() => gast.validate(['vorname', 'nachname'])}
            nextStepLabel={tx('Zimmer wählen')}
            hideBack
          />
        </WizardStep>

        {/* Schritt 2: Zimmer wählen */}
        <WizardStep
          label={tx('Zimmer wählen')}
          description={tx('Wähle dein gewünschtes Zimmer.')}
        >
          <Field form={buchung} name="zimmer">
            <EntitySelectStep
              {...zimmerSearch.select}
              avatar="none"
              selectedId={selectedZimmerId}
              onSelect={id => {
                buchung.set('zimmer', id, zimmerSearch.labelOf(id));
                // Zeitraum zurücksetzen wenn Zimmer wechselt
                buchung.set('anreise', null);
                buchung.set('abreise', null);
              }}
              id={buchung.fieldId('zimmer')}
              invalid={!!buchung.error('zimmer')}
              emptyText={tx('Keine Zimmer verfügbar.')}
              create={false}
              columns={1}
            />
          </Field>
          <StepNav
            onNext={() => buchung.validate(['zimmer'])}
            nextStepLabel={tx('Zeitraum wählen')}
          />
        </WizardStep>

        {/* Schritt 3: Zeitraum wählen */}
        <WizardStep
          label={tx('Zeitraum')}
          description={tx('An- und Abreise wählen — belegte Nächte sind ausgegraut.')}
        >
          <div className="space-y-5">
            <Field form={buchung} name="anreise">
              <AvailabilityRangePicker
                {...buchung.range('anreise', 'abreise', { blocked, minNights: 1 })}
                legend={tx('Ausgegraut = belegt.')}
                months={1}
              />
            </Field>
            <Field form={buchung} name="personen" hint={tx('Wie viele Personen übernachten?')}>
              <Input {...buchung.number('personen')} min={1} />
            </Field>
            <Field form={buchung} name="bemerkung" hint={tx('Besondere Wünsche, Anmerkungen …')}>
              <Textarea {...buchung.field('bemerkung')} rows={3} />
            </Field>
          </div>
          <StepNav
            onNext={() => buchung.validate(['anreise', 'abreise'])}
            nextStepLabel={tx('Prüfen')}
          />
        </WizardStep>

        {/* Schritt 4: Bestätigung */}
        <WizardStep label={tx('Bestätigung')}>
          {!submit.result && (
            <SummaryStep
              forms={[gast, buchung]}
              submit={submit}
              whatHappensNext={tx(
                'Wir prüfen deine Anfrage und melden uns so schnell wie möglich per E-Mail.',
              )}
              confirmLabel={tx('Anfrage absenden')}
            />
          )}
        </WizardStep>

        {submit.result && (
          <SuccessStep
            result={submit.result}
            forms={[gast, buchung]}
            referencePrefix="B"
            whatHappensNext={tx(
              'Deine Buchungsanfrage ist bei uns eingegangen. Wir bestätigen sie in Kürze per E-Mail.',
            )}
            next={[
              {
                label: tx('Weitere Anfrage stellen'),
                onClick: restart,
                icon: <IconCalendar size={16} />,
              },
            ]}
          />
        )}
      </IntentWizardShell>
    </PublicShell>
  );
}
