import { methodForwarder } from "@/wab/commons/methodForwarder";
import { Analytics } from "@/wab/shared/observability/Analytics";
import { PinoLogger } from "@/wab/server/observability/PinoLogger";

export function initAnalyticsFactory(opts: {
  production: boolean;
}): () => Analytics {
  return () => methodForwarder<Analytics>();
}

export const logger = () => new PinoLogger()
