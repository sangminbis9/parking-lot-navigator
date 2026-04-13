import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { logger } from "../logging/logger.js";

export async function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  logger.error({ err: error, requestId: request.id }, "요청 처리 실패");
  const statusCode = error.statusCode ?? 500;
  return reply.status(statusCode).send({
    error: {
      code: statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST",
      message: statusCode >= 500 ? "서버에서 요청을 처리하지 못했습니다." : error.message,
      requestId: request.id
    }
  });
}
