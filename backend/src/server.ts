import { createApp } from "./app/createApp.js";
import { config } from "./config/env.js";

const app = await createApp();

await app.listen({ port: config.PORT, host: config.HOST });
