import "dotenv/config";
import "websocket-polyfill";

import * as E from "fp-ts/lib/Either.js";
import * as TE from "fp-ts/lib/TaskEither.js";
import * as R from "rambda";

import { MeiliSearch } from "meilisearch";
import { Event, Filter, SimplePool } from "nostr-tools";
import { removeURL, unindexable } from "./utils.js";
import { Redis } from "ioredis";
import { match, P } from "ts-pattern";

import {
  ClassificationPipeline,
  classifyTopic,
  topic_labels,
} from "./classificationPipeline.js";

import stopwords from "./stopwords-all.json" assert { type: "json" };
import { ClassifyOutcome, IndexesResultsArr } from "./types.js";
import { MEILI_INDEX_USER_WEIGHTS, MINITE, MONTH } from "./constants.js";
import {
  buildWeightsFromDist,
  getEventsIDfromKind7,
  getLabelDistFromEvents,
  isTopLevelPost,
  nostrRelays,
} from "./nostr.js";
import { getIndexes } from "./meili.js";

console.log("indexing worker started");

const env = process.env;
const MEILI_HOST_URL = env["MEILI_HOST_URL"];
const MEILI_MASTER_KEY = env["MEILI_MASTER_KEY"];
const MEILI_ADMIN_API_KEY = env["MEILI_ADMIN_API_KEY"];

const client = new MeiliSearch({
  host: MEILI_HOST_URL,
  apiKey: MEILI_MASTER_KEY,
});

const redis = new Redis({
  enableAutoPipelining: true,
});

let stopwordsArr: string[] = [];
for (const [_, value] of Object.entries(stopwords)) {
  stopwordsArr = [...stopwordsArr, ...value];
}

let indexRes = await getIndexes(client);
match(indexRes)
  .with({ type: "error" }, (res) => {
    console.error(res.error);
    process.exit(-1);
  })
  .with({ type: "ok" }, async (res) => {
    const uid = R.find(
      (index) => index.uid === MEILI_INDEX_USER_WEIGHTS,
      res.data.results,
    );
    if (!uid) {
      await client.createIndex(MEILI_INDEX_USER_WEIGHTS, {
        primaryKey: "pubkey",
      });
    }
  });

const settings = {
  searchableAttributes: [
    "content",
  ],
  filterableAttributes: [
    "kind",
    "created_at",
    "pubkey",
  ],
  sortableAttributes: [
    "created_at",
  ],
  stopWords: stopwordsArr,
};

indexRes = await getIndexes(client);
match(indexRes)
  .with({ type: "error" }, (res) => {
    console.error(res.error);
    process.exit(-1);
  })
  .with({ type: "ok" }, async (res) => {
    res.data.results.forEach((idx) => {
      client.index(idx.uid).updateSettings(settings);
    });
  });

const filter: Filter = {
  // seems the onlyone making sense is kind 0 and 1?
  kinds: [0, 1],
  // memory usage keeps going larger if a limit is not set, but why??
  limit: 200,
};

while (true) {
  const pool = new SimplePool();
  const evs = await pool.list(nostrRelays, [filter]);
  const indexables = evs.filter((ev) => !unindexable(ev));

  const topLvlPostEvs = indexables
    .filter((ev) => ev.kind === 1)
    .filter((ev) => isTopLevelPost(ev));

  // sample users to index their weight
  const pks = topLvlPostEvs.map((evs) => evs.pubkey);
  const chunks = R.splitEvery(45, pks);
  const samplePks = R.map(
    (chunk: string[]) => chunk[Math.floor(Math.random() * chunk.length)],
    chunks,
  );

  for await (const ev of topLvlPostEvs) {
    // try to retrieve from cache
    let outcome: ClassifyOutcome;
    const getRes: ClassifyOutcome = JSON.parse(await redis.get(ev.id));

    if (getRes) {
      outcome = getRes;
    } else {
      // cache miss
      const cleanedEv = removeURL(ev);
      const classifier = await ClassificationPipeline.getInstance();
      const output = await classifier(cleanedEv.content, topic_labels);

      outcome = {
        sequence: output.sequence,
        label: output.scores[0] <= ClassificationPipeline.thredshold
          ? "others"
          : output.labels[0],
      };
      await redis.set(ev.id, JSON.stringify(outcome), "EX", 12 * MINITE);
    }

    const indexes = await TE.tryCatch(
      (): Promise<IndexesResultsArr> =>
        client.getIndexes({ limit: topic_labels.length * 2 }),
      E.toError,
    )();

    if (E.isLeft(indexes)) {
      continue;
    }

    const indexRes = indexes.right.results.filter((idx) =>
      idx.uid === outcome.label
    );

    if (indexRes.length === 0) {
      await TE.tryCatch(
        () => client.createIndex(outcome.label, { primaryKey: "id" }),
        E.toError,
      )();
    }

    await TE.tryCatch(
      () => client.index(outcome.label).addDocuments([ev]),
      E.toError,
    )();
  }

  for await (const pk of samplePks) {
    let evs = await pool.list(nostrRelays, [{
      kinds: [1, 7],
      authors: [pk],
      since: Math.floor((Date.now() - 3 * MONTH) / 1000),
    }]);

    const kind7s: Event<7>[] = evs.filter((ev) => ev.kind === 7) as Event<7>[];
    const IDsFromKind7 = R.compose(
      R.uniq,
      getEventsIDfromKind7,
    )(kind7s);

    const evsFromKind7 = await pool.list(nostrRelays, [{
      kinds: [1],
      ids: IDsFromKind7,
    }]);

    evs = R.compose(
      R.concat(evsFromKind7),
      R.filter((ev: Event<1 | 7>) => ev.kind === 1),
    )(evs);

    match(evs.length)
      .with(P.number.gte(50), async () => {
        const outcomes = R.map(
          async (ev) => await classifyTopic(ev, redis),
          evs,
        );

        const outcomesResolved = await Promise.all(outcomes);
        const outcomeDist = R.compose(
          Object.fromEntries,
          getLabelDistFromEvents,
        )(outcomesResolved) as Record<string, number>;

        await client.index(MEILI_INDEX_USER_WEIGHTS).addDocuments([
          {
            pubkey: pk,
            weight: buildWeightsFromDist(outcomeDist),
          },
        ]);
      });
  }

  pool.close(nostrRelays);
}
