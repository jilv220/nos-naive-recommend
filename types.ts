import { Index, IndexesResults, MeiliSearch } from "meilisearch";

export type IndexesResultsArr = IndexesResults<Index[]>;
export type ClassifyOutcome = {
  sequence: unknown;
  label: string;
};
export type RecommendationParams = {
  Params: {
    pubkey: string;
  };
};
export type WeightSearchQuery = {
  pubkey: string;
  indexUid: string;
  limit: number;
  offset: number;
};
