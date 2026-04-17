await import("dotenv/config");

const { createApp } = await import("./app/createApp.js");
const { config } = await import("./config/env.js");

const app = await createApp();

await app.listen({ port: config.PORT, host: config.HOST });
