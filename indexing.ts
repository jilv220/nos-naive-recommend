import "dotenv/config";
import "websocket-polyfill";

import * as R from "rambda";

import { MeiliSearch } from "meilisearch";
import { Event, Filter, SimplePool } from "nostr-tools";
import { buildPostNamespace, removeURL, unindexable } from "./utils.js";
import { Redis } from "ioredis";
import { match, P } from "ts-pattern";

import {
  ClassificationPipeline,
  classifyTopic,
  topic_labels,
} from "./classificationPipeline.js";

import stopwords from "./stopwords-all.json" assert { type: "json" };
import { ClassifyOutcome, IndexesResultsArr } from "./types.js";
import { HOUR, MEILI_INDEX_USER_WEIGHTS, MINITE, MONTH } from "./constants.js";
import {
  buildWeightsFromDist,
  getEventIDsFromReplies,
  getEventsIDfromKind7,
  getFollowingsFromKind3s,
  getLabelDistFromEvents,
  isTopLevelPost,
  nostrRelays,
  unwrapKind6Events,
} from "./nostr.js";
import { getIndexes } from "./meili.js";
import { safeJsonParse } from "./errors.js";
import { spawn } from "node:child_process";

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
  kinds: [1, 6],
  // memory usage keeps going larger if a limit is not set, but why??
  limit: 200,
};

while (true) {
  const pool = new SimplePool();
  const evs = await pool.list(nostrRelays, [filter]);
  const kind6sUnwrapped = R.compose(
    unwrapKind6Events,
    R.filter((ev) => ev.kind === 6),
  )(evs);

  const kind1s = R.compose(
    R.filter((ev: Event) => isTopLevelPost(ev)),
    R.filter((ev) => !unindexable(ev)),
    R.filter((ev: Event) => ev.kind === 1),
  )(evs);

  const indexables = R.concat(kind6sUnwrapped, kind1s);

  // sample users to index their weight
  const pks = indexables.map((evs) => evs.pubkey);
  const chunks = R.splitEvery(15, pks);
  const samplePks = R.map(
    (chunk: string[]) => chunk[Math.floor(Math.random() * chunk.length)],
    chunks,
  );

  // for await (const ev of indexables) {
  //   let outcome: ClassifyOutcome;
  //   outcome = await classifyTopic(ev, redis, 12 * HOUR);

  //   if (ev.content === "\n\n") {
  //     console.log(ev);
  //   }

  //   let indexRes = await getIndexes(client);
  //   match(indexRes)
  //     .with({ type: "error" }, (res) => {
  //       console.error(res.error);
  //     })
  //     .with({ type: "ok" }, async (res) => {
  //       const uid = R.find(
  //         (index) => index.uid === outcome.label,
  //         res.data.results,
  //       );
  //       if (!uid) {
  //         await client.createIndex(outcome.label, {
  //           primaryKey: "id",
  //         });
  //       }
  //     });

  //   if (outcome.label !== "others") {
  //     await client.index(outcome.label).addDocuments([ev]);
  //   }
  // }

  for await (const pk of samplePks) {
    let evs = await pool.list(nostrRelays, [{
      kinds: [1, 6, 7],
      authors: [pk],
      since: Math.floor((Date.now() - 3 * MONTH) / 1000),
    }]) as Event[];

    const userPosts = JSON.parse(await redis.get(buildPostNamespace(pk)));
    if (!userPosts) {
      const topLevelKind1s = R.compose(
        R.filter((ev: Event) => isTopLevelPost(ev)),
        R.filter((ev: Event) => ev.kind === 1),
      )(evs);
      await redis.set(
        buildPostNamespace(pk),
        JSON.stringify(topLevelKind1s),
        "EX",
        4 * HOUR,
      );
    }

    const IDsFromReplies = getEventIDsFromReplies(evs);
    const IDsFromKind7 = R.compose(
      R.uniq,
      getEventsIDfromKind7,
      R.filter((ev: Event) => ev.kind === 7),
    )(evs);

    const kind6sUnwrapped = R.compose(
      unwrapKind6Events,
      R.filter((ev) => ev.kind === 6),
    )(evs);
    const evsFromKind7AndReplies = await pool.list(nostrRelays, [{
      kinds: [1],
      ids: R.concat(IDsFromKind7, IDsFromReplies),
    }]);

    evs = R.compose(
      R.concat(kind6sUnwrapped),
      R.concat(evsFromKind7AndReplies),
      R.filter((ev: Event) => ev.kind === 1),
    )(evs);

    match(evs.length)
      .with(P.number.gte(40), async () => {
        console.log(`Active user found: ${pk}`);
        const outcomes = R.map(
          async (ev) => await classifyTopic(ev, redis, 12 * HOUR),
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
