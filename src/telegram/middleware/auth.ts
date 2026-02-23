import type { Handler } from "gramio";
import { config } from "../../config.ts";
import { logger } from "../../utils/logger.ts";

export const authMiddleware: Handler<any> = (context, next) => {
  const fromId = context.senderId as number | undefined;

  if (fromId !== config.OWNER_TELEGRAM_ID) {
    logger.debug("auth:rejected", { fromId });
    return;
  }

  return next();
};
