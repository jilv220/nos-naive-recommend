import * as R from "rambda";

import { MeiliSearch, MultiSearchQuery } from "meilisearch";
import { topic_labels } from "./classificationPipeline.js";
import { IndexesResultsArr, WeightSearchQuery } from "./types.js";
import { MEILI_INDEX_USER_WEIGHTS } from "./constants.js";

type MeiliIndexResultArr =
  | { type: "ok"; data: IndexesResultsArr }
  | { type: "error"; error: Error };

export const getIndexes = async (client: MeiliSearch) => {
  let indexes: MeiliIndexResultArr;
  try {
    indexes = {
      type: "ok",
      data: await client.getIndexes({ limit: topic_labels.length * 2 }),
    };
  } catch (e) {
    indexes = {
      type: "error",
      error: e,
    };
  }
  return indexes;
};

export const buildRecommendQuery = (
  weights: Record<string, any>,
  offset: number,
) => {
  let queryParams: MultiSearchQuery[] = [];
  topic_labels.forEach((l) => {
    if (R.has(l, weights)) {
      queryParams.push({
        indexUid: l,
        limit: Math.floor(weights[l] * 100),
        offset: offset,
        sort: ["created_at:desc"],
      });
    }
  });
  return queryParams;
};
