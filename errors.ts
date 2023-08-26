import { FastifyReply } from "fastify"

export const unprocessableHandler = (e: Error, reply: FastifyReply) => {
  reply.send({
    status: 422,
    detail: {
      error: e.message,
    }
  })
  return reply
}