import type { Gaeste, Buchungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface GaesteDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Gaeste;
  /** 1:N „Buchungen" (gast): VOLLE Liste — der Block filtert auf diesen Record. */
  buchungenGastList: Buchungen[];
  /** Zeilen-Klick → overlay.push auf das Buchungen-Detail (nie der Edit-Dialog). */
  onOpenBuchungenGast: (record: Buchungen) => void;
  /** Kontextuelles „+": öffnet den Buchungen-Dialog mit diesem Record vorgesetzt. */
  onAddBuchungenGast: () => void;
  /** 1:N „Buchungen" (begleitperson): VOLLE Liste — der Block filtert auf diesen Record. */
  buchungenBegleitpersonList: Buchungen[];
  /** Zeilen-Klick → overlay.push auf das Buchungen-Detail (nie der Edit-Dialog). */
  onOpenBuchungenBegleitperson: (record: Buchungen) => void;
  /** Kontextuelles „+": öffnet den Buchungen-Dialog mit diesem Record vorgesetzt. */
  onAddBuchungenBegleitperson: () => void;
}

export function GaesteDetails({
  record,
  buchungenGastList,
  onOpenBuchungenGast,
  onAddBuchungenGast,
  buchungenBegleitpersonList,
  onOpenBuchungenBegleitperson,
  onAddBuchungenBegleitperson,
}: GaesteDetailsProps) {
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('gaeste', 'vorname')} value={record.fields.vorname} format="text" />
        <RecordField label={fieldLabel('gaeste', 'nachname')} value={record.fields.nachname} format="text" />
        <RecordField label={fieldLabel('gaeste', 'email')} value={record.fields.email} format="email" />
        <RecordField label={fieldLabel('gaeste', 'telefon')} value={record.fields.telefon} format="text" />
        <RecordField label={fieldLabel('gaeste', 'website')} value={record.fields.website} format="url" />
        <RecordField label={fieldLabel('gaeste', 'plz')} value={record.fields.plz} format="text" />
        <RecordField label={fieldLabel('gaeste', 'ort')} value={record.fields.ort} format="text" />
        <RecordField label={fieldLabel('gaeste', 'newsletter')} value={record.fields.newsletter} format="bool" />
        <RecordField label={fieldLabel('gaeste', 'anmerkungen')} value={record.fields.anmerkungen} format="longtext" className="md:col-span-2" />
      </RecordSection>

      <SatelliteSection
        title={`${appLabel('buchungen')} · ${fieldLabel('buchungen', 'gast')}`}
        items={buchungenGastList.filter(r => extractRecordId(r.fields.gast) === record.record_id)}
        map={r => ({ name: appLabel('buchungen'), meta: r.fields.anreise })}
        onOpen={onOpenBuchungenGast}
        onAdd={onAddBuchungenGast}
        getKey={r => r.record_id}
      />

      <SatelliteSection
        title={`${appLabel('buchungen')} · ${fieldLabel('buchungen', 'begleitperson')}`}
        items={buchungenBegleitpersonList.filter(r => extractRecordId(r.fields.begleitperson) === record.record_id)}
        map={r => ({ name: appLabel('buchungen'), meta: r.fields.anreise })}
        onOpen={onOpenBuchungenBegleitperson}
        onAdd={onAddBuchungenBegleitperson}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.GAESTE} recordId={record.record_id} />
    </>
  );
}
