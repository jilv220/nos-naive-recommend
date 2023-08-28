import { FastifyReply } from "fastify";

export const unprocessableHandler = (e: Error, reply: FastifyReply) => {
  reply.send({
    status: 422,
    detail: {
      error: e.message,
    },
  });
  return reply;
};

type JSONParseResult =
  | { type: "ok"; data: any }
  | { type: "error"; error: Error };

export const safeJsonParse = (input: any): JSONParseResult => {
  let res: any;
  try {
    res = {
      type: "ok",
      data: JSON.parse(input),
    };
  } catch (e) {
    res = {
      type: "error",
      error: e,
    };
  }
  return res;
};
