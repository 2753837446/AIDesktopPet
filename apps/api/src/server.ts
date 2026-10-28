import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./database.js";

const config = loadConfig();
const opened = openDatabase(config.databasePath);
const app = await buildApp({
  database: opened.database,
  config,
});

const close = async (): Promise<void> => {
  await app.close();
  opened.database.close();
  process.exit(0);
};

process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());

try {
  await app.listen({ host: config.host, port: config.port });
  console.log(
    JSON.stringify({
      service: "personal-digital-companion",
      host: config.host,
      port: config.port,
      database: config.databasePath,
      schemaVersion: opened.schemaVersion,
    }),
  );
} catch (error) {
  console.error(error);
  opened.database.close();
  process.exit(1);
}
