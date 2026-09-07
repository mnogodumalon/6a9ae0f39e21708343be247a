import type { Zimmer, Buchungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';
import { MediaThumbnail } from '@/components/widgets/MediaViewer';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface ZimmerDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Zimmer;
  /** 1:N „Buchungen" (zimmer): VOLLE Liste — der Block filtert auf diesen Record. */
  buchungenList: Buchungen[];
  /** Zeilen-Klick → overlay.push auf das Buchungen-Detail (nie der Edit-Dialog). */
  onOpenBuchungen: (record: Buchungen) => void;
  /** Kontextuelles „+": öffnet den Buchungen-Dialog mit diesem Record vorgesetzt. */
  onAddBuchungen: () => void;
}

export function ZimmerDetails({
  record,
  buchungenList,
  onOpenBuchungen,
  onAddBuchungen,
}: ZimmerDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('zimmer', 'bezeichnung')} value={record.fields.bezeichnung} format="text" />
        <RecordField label={fieldLabel('zimmer', 'kategorie')} value={record.fields.kategorie} format="pill" />
        <RecordField label={fieldLabel('zimmer', 'preis_pro_nacht')} value={record.fields.preis_pro_nacht} format="text" />
        <RecordField label={fieldLabel('zimmer', 'etage')} value={record.fields.etage} format="text" />
        <RecordField label={fieldLabel('zimmer', 'balkon')} value={record.fields.balkon} format="bool" />
        <RecordField label={fieldLabel('zimmer', 'foto')} className="md:col-span-2">
          {record.fields.foto ? (
            <MediaThumbnail src={record.fields.foto as string} fit="contain" className="max-h-64 w-full rounded-lg" />
          ) : '—'}
        </RecordField>
      </RecordSection>

      <SatelliteSection
        title={appLabel('buchungen')}
        items={buchungenList.filter(r => extractRecordId(r.fields.zimmer) === record.record_id)}
        map={r => ({ name: appLabel('buchungen'), meta: r.fields.anreise })}
        onOpen={onOpenBuchungen}
        onAdd={onAddBuchungen}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.ZIMMER} recordId={record.record_id} />
    </>
  );
}
