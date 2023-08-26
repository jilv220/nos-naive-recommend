import { Event } from 'nostr-tools';

const URL_REGX =
  /(?:https?):\/\/(\w+:?\w*)?(\S+)(:\d+)?(\/|\/([\w#!:.?+=&%!\-\/]))?/g;

const NOSTR_URI_REGX = /^nostr:.+/g;
const MASTADON_PY_REGX = /^mastadon:py.+/g;
const PHOTO_REGX = /^photo_.+/g;

export function unindexable(ev: Event) {
  const contentSplitByLine = ev.content.split("\n");
  const contentSplited = contentSplitByLine.map((content) =>
    content.split(" ")
  );
  const contentSplitedFlat = contentSplited.flat();

  const resArr = contentSplitedFlat.map((entry) => {
    const res = entry.match(URL_REGX);
    return res !== null;
  });
  return resArr.every((e) => e === true);
}

export function removeURL(ev: Event): Event {
  const contentSplitByLine = ev.content.split("\n");
  const contentSplited = contentSplitByLine.map((content) =>
    content.split(" ")
  );
  for (let i = 0; i < contentSplited.length; i++) {
    for (let j = 0; j < contentSplited[i].length; j++) {
      if (
        contentSplited[i][j].match(URL_REGX) ||
        contentSplited[i][j].match(NOSTR_URI_REGX) ||
        contentSplited[i][j].match(MASTADON_PY_REGX) ||
        contentSplited[i][j].match(PHOTO_REGX)
      ) {
        contentSplited[i][j] = "";
      }
    }
  }
  const contentMergedBySpace = contentSplited.map((contentByLine) =>
    concatStringArr(contentByLine, " ")
  );
  const contentMerged = concatStringArr(contentMergedBySpace, "\n");
  ev.content = contentMerged;
  return ev;
}

export function concatStringArr(strArr: string[], delimiter: string): string {
  let res = "";
  for (let i = 0; i < strArr.length; i++) {
    if (i !== strArr.length - 1) {
      res = res.concat(strArr[i], delimiter);
    } else {
      res = res.concat(strArr[i]);
    }
  }
  return res;
}

export function removeDup<T extends Object, V>(elems: T[], key: keyof T): T[] {
  const map = new Map<keyof T, T>();
  for (const elem of elems) {
    map.set(key, elem);
  }
  const iteratorValues = map.values();
  return [...iteratorValues];
}