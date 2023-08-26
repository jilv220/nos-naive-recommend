import { Event } from "nostr-tools";
import * as R from "rambda";
import { ClassifyOutcome } from "./types.js";
import { topic_labels } from "./classificationPipeline.js";

export const nostrRelays = [
  "wss://nos.lol",
  "wss://nostr.mom",
  "wss://nostr.wine",
  "wss://relay.nostr.com.au",
  "wss://relay.shitforce.one/",
  "wss://nostr.inosta.cc",
  "wss://relay.primal.net",
  "wss://relay.damus.io",
  "wss://relay.nostr.band",
  "wss://eden.nostr.land",
  "wss://nostr.milou.lol",
  "wss://relay.mostr.pub",
  "wss://nostr-pub.wellorder.net",
  "wss://atlas.nostr.land",
  "wss://relay.snort.social",
];

export const isNostrHexKey = (secret: string) => {
  const hexRegex = /^[0-9a-fA-F]+$/;
  return hexRegex.test(secret) && secret.length === 64;
};

export const getEventIDfromKind7 = (ev: Event<7>) => {
  const tags = ev.tags;
  const e = tags.filter((tag) => tag[0] === "e").flat();
  return e[1];
};

export const isTopLevelPost = (ev: Event) => {
  const tags = ev.tags;
  const ep = tags.filter((tag) => tag[0] === "e" || tag[0] === "p");
  return ep.length === 0;
};

export const getEventsIDfromKind7 = (evs: Event<7>[]) => {
  let res: string[] = [];
  return R.compose(
    R.concat(res),
    R.map((ev: Event<7>) => getEventIDfromKind7(ev)),
  )(evs);
};

export const getLabelDistFromEvents = (outcomes: ClassifyOutcome[]) => {
  const map = new Map<string, number>();
  R.forEach((outcome) => {
    const count = map.get(outcome.label);
    if (count === undefined) {
      map.set(outcome.label, 1);
    } else {
      map.set(outcome.label, count + 1);
    }
  }, outcomes);
  return map;
};

export const buildDefaultWeights = () => {
  const weight = 1 / 50;
  const map = new Map<string, number>();

  R.compose(
    R.forEach((topic: string) => map.set(topic, weight)),
    R.filter((topic) => topic !== "nostr" && topic !== "others"),
  )(topic_labels);

  return map;
};

export const buildWeightsFromDist = (outcome: Record<string, number>) => {
  const sum = R.compose(
    R.sum,
    R.values,
  )(outcome);

  return R.map((x) => x / sum, outcome);
};
