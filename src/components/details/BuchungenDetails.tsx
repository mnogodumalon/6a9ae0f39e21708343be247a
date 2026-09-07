import type { Buchungen, Gaeste, Zimmer, Zusatzleistungen, Rechnungen } from '@/types/app';
import { APP_IDS } from '@/types/app';
import { extractRecordId } from '@/services/livingAppsService';
import {
  RecordSection, RecordField, RecordRelation, RecordAttachments,
} from '@/components/widgets/RecordView';
import { t, appLabel, fieldLabel } from '@/i18n';
import { MediaThumbnail } from '@/components/widgets/MediaViewer';
import { SatelliteSection } from '@/components/SatelliteSection';

export interface BuchungenDetailsProps {
  /** Der Record — enriched oder roh; alle Felder werden hier gerendert. */
  record: Buchungen;
  /** N:1-Ziel „Gaeste": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  gaesteList: Gaeste[];
  /** Klick auf die Gaeste-Relation → overlay.push auf dessen Detail. */
  onOpenGaeste?: (record: Gaeste) => void;
  /** N:1-Ziel „Zimmer": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  zimmerList: Zimmer[];
  /** Klick auf die Zimmer-Relation → overlay.push auf dessen Detail. */
  onOpenZimmer?: (record: Zimmer) => void;
  /** N:1-Ziel „Zusatzleistungen": volle Liste (Hook-Array) — der Block löst Name + Schlüsselfelder selbst auf. */
  zusatzleistungenList: Zusatzleistungen[];
  /** Reserviert — Zusatzleistungen ist hier nur über ein Mehrfach-Feld verknüpft (Text-Join, keine Einzel-Relation); Übergabe erlaubt, aber ohne Wirkung. */
  onOpenZusatzleistungen?: (record: Zusatzleistungen) => void;
  /** 1:N „Rechnungen" (buchung): VOLLE Liste — der Block filtert auf diesen Record. */
  rechnungenList: Rechnungen[];
  /** Zeilen-Klick → overlay.push auf das Rechnungen-Detail (nie der Edit-Dialog). */
  onOpenRechnungen: (record: Rechnungen) => void;
  /** Kontextuelles „+": öffnet den Rechnungen-Dialog mit diesem Record vorgesetzt. */
  onAddRechnungen: () => void;
}

export function BuchungenDetails({
  record,
  gaesteList,
  onOpenGaeste,
  zimmerList,
  onOpenZimmer,
  zusatzleistungenList,
  rechnungenList,
  onOpenRechnungen,
  onAddRechnungen,
}: BuchungenDetailsProps) {
  const gastTarget = gaesteList.find(r => r.record_id === extractRecordId(record.fields.gast));
  const zimmerTarget = zimmerList.find(r => r.record_id === extractRecordId(record.fields.zimmer));
  const begleitpersonTarget = gaesteList.find(r => r.record_id === extractRecordId(record.fields.begleitperson));
  return (
    <>
      <RecordSection title={t('details')} cols={2}>
        <RecordField label={fieldLabel('buchungen', 'anreise')} value={record.fields.anreise} format="date" />
        <RecordField label={fieldLabel('buchungen', 'abreise')} value={record.fields.abreise} format="date" />
        <RecordField label={fieldLabel('buchungen', 'status')} value={record.fields.status} format="pill" />
        <RecordField label={fieldLabel('buchungen', 'personen')} value={record.fields.personen} format="text" />
        <RecordField label={fieldLabel('buchungen', 'zusatzleistungen_buchung')} value={Array.isArray(record.fields.zusatzleistungen_buchung) ? record.fields.zusatzleistungen_buchung.map((u: unknown) => zusatzleistungenList.find(t => t.record_id === extractRecordId(u))?.fields.name ?? '—').join(', ') : null} format="text" />
        <RecordField label={fieldLabel('buchungen', 'bemerkung')} value={record.fields.bemerkung} format="longtext" className="md:col-span-2" />
        <RecordField label={fieldLabel('buchungen', 'beleg')} className="md:col-span-2">
          {record.fields.beleg ? (
            <MediaThumbnail src={record.fields.beleg as string} fit="contain" className="max-h-64 w-full rounded-lg" />
          ) : '—'}
        </RecordField>
      </RecordSection>

      {/* N:1 — verknüpfte Records: IMMER klickbar, nie eine Text-Sackgasse. */}
      <RecordSection title={t('relations')} cols={2}>
        <RecordRelation
          label={fieldLabel('buchungen', 'gast')}
          name={gastTarget?.fields.vorname ?? '—'}
          meta={[gastTarget?.fields.email, gastTarget?.fields.telefon].filter(Boolean).join(' · ') || undefined}
          onClick={gastTarget && onOpenGaeste ? () => onOpenGaeste!(gastTarget!) : undefined}
        />
        <RecordRelation
          label={fieldLabel('buchungen', 'zimmer')}
          name={zimmerTarget?.fields.bezeichnung ?? '—'}
          meta={undefined}
          onClick={zimmerTarget && onOpenZimmer ? () => onOpenZimmer!(zimmerTarget!) : undefined}
        />
        <RecordRelation
          label={fieldLabel('buchungen', 'begleitperson')}
          name={begleitpersonTarget?.fields.vorname ?? '—'}
          meta={[begleitpersonTarget?.fields.email, begleitpersonTarget?.fields.telefon].filter(Boolean).join(' · ') || undefined}
          onClick={begleitpersonTarget && onOpenGaeste ? () => onOpenGaeste!(begleitpersonTarget!) : undefined}
        />
      </RecordSection>

      <SatelliteSection
        title={appLabel('rechnungen')}
        items={rechnungenList.filter(r => extractRecordId(r.fields.buchung) === record.record_id)}
        map={r => ({ name: appLabel('rechnungen'), meta: r.fields.rechnungsdatum })}
        onOpen={onOpenRechnungen}
        onAdd={onAddRechnungen}
        getKey={r => r.record_id}
      />

      <RecordAttachments appId={APP_IDS.BUCHUNGEN} recordId={record.record_id} />
    </>
  );
}
