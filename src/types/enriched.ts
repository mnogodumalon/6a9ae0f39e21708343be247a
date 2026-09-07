import type { Buchungen, Rechnungen } from './app';

export type EnrichedBuchungen = Buchungen & {
  gastName: string;
  zimmerName: string;
  begleitpersonName: string;
  zusatzleistungen_buchungName: string;
};

export type EnrichedRechnungen = Rechnungen & {
  buchungName: string;
};
