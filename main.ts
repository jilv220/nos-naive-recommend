import "dotenv/config";
import "websocket-polyfill";

import * as R from "rambda";

import Fastify, { FastifyRequest } from "fastify";

import { spawn } from "child_process";
import { MeiliSearch, MultiSearchResult } from "meilisearch";
import { Event, nip19, SimplePool } from "nostr-tools";
import { RecommendationParams } from "./types.js";
import { buildDefaultWeights, isNostrHexKey, isTopLevelPost } from "./nostr.js";
import { unprocessableHandler } from "./errors.js";
import { MEILI_INDEX_USER_WEIGHTS } from "./constants.js";
import { match } from "ts-pattern";
import { buildRecommendQuery } from "./meili.js";

const indexingWorker = spawn("ts-node-esm", ["indexing.ts"]);

indexingWorker.stdout.on("data", (data) => {
  console.log(`${data}`);
});

indexingWorker.stderr.on("data", (data) => {
  console.error(`${data}`);
});

/**
 *  MeiliSearch
 */

const env = process.env;
const MEILI_HOST_URL = env["MEILI_HOST_URL"];
const MEILI_MASTER_KEY = env["MEILI_MASTER_KEY"];
const MEILI_ADMIN_API_KEY = env["MEILI_ADMIN_API_KEY"];

const client = new MeiliSearch({
  host: MEILI_HOST_URL,
  apiKey: MEILI_MASTER_KEY,
});

/**
 *  Nostr
 */
const pool = new SimplePool();

/**
 *  Fastify start
 */

const fastify = Fastify({
  logger: true,
});

fastify.route({
  method: "GET",
  url: "/",
  handler: async (_, reply) => {
    reply
      .type("text/html")
      .send(
        "This is a naive classifier based recommendation system for Nostr.",
      );
  },
});

fastify.route({
  method: "GET",
  url: "/recommend/:pubkey",
  schema: {
    querystring: {
      limit: { type: "integer", default: 20 },
      offset: { type: "integer", default: 0 },
    },
  },
  handler: async (request: FastifyRequest<RecommendationParams>, reply) => {
    const { pubkey } = request.params;
    const { limit, offset } = request.query as any;

    if (!isNostrHexKey(pubkey) && !pubkey.startsWith("npub1")) {
      return unprocessableHandler(
        new Error("not a valid hex or npub nostr key"),
        reply,
      );
    }

    let hexPubKey: string;
    if (!isNostrHexKey(pubkey)) {
      try {
        hexPubKey = nip19.decode(pubkey).data as string;
      } catch (e) {
        return unprocessableHandler(e, reply);
      }
    }

    hexPubKey = pubkey;
    const res = await client.index(MEILI_INDEX_USER_WEIGHTS).search("", {
      filter: `pubkey=${hexPubKey}`,
    });

    let weights;
    match(res.hits.length)
      .with(0, () => {
        weights = Object.fromEntries(buildDefaultWeights());
      })
      .otherwise(() => {
        weights = res.hits[0].weight;
      });

    const multiQuery = buildRecommendQuery(weights, offset);
    const searchRes = await client.multiSearch({ queries: multiQuery });

    return R.compose(
      R.slice(0, limit),
      R.filter((ev: Event) => isTopLevelPost(ev)),
      R.sort((x: any, y: any) => x.created_at > y.created_at ? -1 : 1),
      R.flatten,
      R.map((r: MultiSearchResult<Record<string, any>>) => r.hits),
    )(searchRes.results);
  },
});

// Run the server!
try {
  await fastify.listen({ port: 3000 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
