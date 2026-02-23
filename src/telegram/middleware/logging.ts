import type { Handler } from "gramio";
import { logger } from "../../utils/logger.ts";

export const loggingMiddleware: Handler<any> = (context, next) => {
  logger.info("telegram:update", {
    updateId: context.updateId as number | undefined,
    from: context.senderId as number | undefined,
  });

  return next();
};
