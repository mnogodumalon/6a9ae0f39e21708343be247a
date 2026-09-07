import type { Rechnungen, Buchungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';

export interface RechnungenDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Rechnungen;
  /** N:1-Ziel „Buchungen": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  buchungenList: Buchungen[];
  /** Klick auf die Buchungen-Relation → overlay.push auf dessen Detail. */
  onOpenBuchungen?: (record: Buchungen) => void;
}

export function RechnungenDetails({
  record,
  buchungenList,
  onOpenBuchungen,
}: RechnungenDetailsProps) {
  const buchungTarget = buchungenList.find(r => r.record_id === extractRecordId(record.fields.buchung));
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('rechnungen', 'betrag')} value={record.fields.betrag} format="text" />
        <RecordField label={fieldLabel('rechnungen', 'rechnungsdatum')} value={record.fields.rechnungsdatum} format="date" />
        <RecordField label={fieldLabel('rechnungen', 'faellig_am')} value={record.fields.faellig_am} format="date" />
        <RecordField label={fieldLabel('rechnungen', 'zahlungsstatus')} value={record.fields.zahlungsstatus} format="pill" />
        <RecordField label={fieldLabel('rechnungen', 'zahlungseingang')} value={record.fields.zahlungseingang} format="datetime" />
      </RecordSection>

      {/* N:1 — verknüpfte Records: IMMER klickbar, nie eine Text-Sackgasse. */}
      <RecordSection title={t('relations')} cols={1}>
        <RecordRelation
          label={fieldLabel('rechnungen', 'buchung')}
          name={buchungTarget?.fields.bemerkung ?? '—'}
          meta={undefined}
          onClick={buchungTarget && onOpenBuchungen ? () => onOpenBuchungen!(buchungTarget!) : undefined}
        />
      </RecordSection>

      <RecordAttachments appId={APP_IDS.RECHNUNGEN} recordId={record.record_id} />
    </>
  );
}
