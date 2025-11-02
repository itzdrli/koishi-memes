import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { openapi } from "@elysiajs/openapi";
import { info, initializeLogger, logger } from "@rasla/logify";
import { Pool } from "pg";

import { routes } from "./routes";

import { drizzle } from "drizzle-orm/node-postgres";
import "dotenv/config";

initializeLogger({
  level: "debug",
  file: true,
  console: true,
  filePath: "./logs/app.log",
  includeIp: true,
  format:
    "🚀 {timestamp} | {level} | {method} {path} | {statusCode} | {message}",
});

const app = new Elysia()
  .use(logger())
  .use(openapi())
  .use(staticPlugin({
    prefix: "/memes",
    assets: "public/memes",
  }))
  .post("/openapi", () => 'OpenAPI')
  .get("/", () => ({
    message: "Koishi Memes Backend - Powered by FSD",
    version: "0.0.1",
    endpoints: {
      auth: "/auth",
      users: "/users",
      memes: "/meme",
    },
  }))
  .use(routes)
  .listen(3000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // e.g. postgres://user:pw@localhost/db
});
export const db = drizzle(pool);

info({
  message: `Koishi Memes is running at http://${app.server?.hostname}:${app.server?.port}`,
  method: `INIT`,
  statusCode: 200,
  path: `/`,
});
