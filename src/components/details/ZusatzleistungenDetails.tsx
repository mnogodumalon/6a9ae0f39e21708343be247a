import type { Zusatzleistungen, Buchungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface ZusatzleistungenDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Zusatzleistungen;
  /** 1:N „Buchungen" (zusatzleistungen_buchung): VOLLE Liste — der Block filtert auf diesen Record. */
  buchungenList: Buchungen[];
  /** Zeilen-Klick → overlay.push auf das Buchungen-Detail (nie der Edit-Dialog). */
  onOpenBuchungen: (record: Buchungen) => void;
  /** Kontextuelles „+": öffnet den Buchungen-Dialog mit diesem Record vorgesetzt. */
  onAddBuchungen: () => void;
}

export function ZusatzleistungenDetails({
  record,
  buchungenList,
  onOpenBuchungen,
  onAddBuchungen,
}: ZusatzleistungenDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('zusatzleistungen', 'name')} value={record.fields.name} format="text" />
        <RecordField label={fieldLabel('zusatzleistungen', 'preis')} value={record.fields.preis} format="text" />
        <RecordField label={fieldLabel('zusatzleistungen', 'aktiv')} value={record.fields.aktiv} format="bool" />
      </RecordSection>

      <SatelliteSection
        title={appLabel('buchungen')}
        items={buchungenList.filter(r => Array.isArray(r.fields.zusatzleistungen_buchung) && r.fields.zusatzleistungen_buchung.some((u: unknown) => extractRecordId(u) === record.record_id))}
        map={r => ({ name: appLabel('buchungen'), meta: r.fields.anreise })}
        onOpen={onOpenBuchungen}
        onAdd={onAddBuchungen}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.ZUSATZLEISTUNGEN} recordId={record.record_id} />
    </>
  );
}
