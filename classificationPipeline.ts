import { pipeline } from "@xenova/transformers";
import { Event, Filter, SimplePool } from "nostr-tools";
import { ClassifyOutcome } from "./types.js";
import { removeURL } from "./utils.js";
import { MINITE } from "./constants.js";
import { Redis } from "ioredis";

export const topic_labels = [
  "fashion",
  "beauty",
  "outdoors",
  "arts",
  "anime",
  "comics",
  "business",
  "finance",
  "food",
  "travel",
  "entertainment",
  "music",
  "gaming",
  "careers",
  "family",
  "relationships",
  "fitness",
  "sports",
  "technology",
  "science",
  "bitcoin",
  "porn",
  "programming",
  "politics",
  "meme",
  "press",
  "military",
];

export class ClassificationPipeline {
  static task = "zero-shot-classification";
  static model = "Xenova/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7";
  static instance = null;
  static thredshold = (1 / topic_labels.length) * 1.5;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      // NOTE: Uncomment this to change the cache directory
      // env.cacheDir = './.cache';

      this.instance = pipeline(this.task, this.model, { progress_callback });
    }

    return this.instance;
  }
}

export const classifyTopic = async (
  ev: Event,
  redis: Redis,
  cacheDuration: number,
) => {
  let outcome: ClassifyOutcome;
  const getRes: ClassifyOutcome = JSON.parse(await redis.get(ev.id));

  if (getRes) {
    outcome = getRes;
  } else {
    const cleanedEv = removeURL(ev);
    const classifier = await ClassificationPipeline.getInstance();
    const output = await classifier(cleanedEv.content, topic_labels);

    outcome = {
      sequence: output.sequence,
      label: output.scores[0] <= ClassificationPipeline.thredshold
        ? "others"
        : output.labels[0],
    };
    await redis.set(ev.id, JSON.stringify(outcome), "EX", cacheDuration);
  }
  return outcome;
};
