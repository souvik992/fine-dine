import { buildSaasApp } from "./app.js";
import { config } from "./config.js";

const app = buildSaasApp();
try {
  await app.listen({ host: config.HOST, port: config.PORT });
  app.log.info({ host: config.HOST, port: config.PORT }, "Fine Dine SaaS API listening");
} catch (error) {
  app.log.error({ err: error }, "Could not start Fine Dine SaaS API");
  process.exitCode = 1;
  await app.close();
}
