import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { openapi } from "@elysiajs/openapi";
import { cors } from "@elysiajs/cors";
import { Logestic } from "logestic";
import { routes } from "./routes";
import "dotenv/config";

const app = new Elysia()
  .use(Logestic.preset("fancy"))
  .use(openapi())
  .use(cors())
  .use(staticPlugin({ prefix: "/memes", assets: "public/memes" }))
  .get("/", () => ({
    message: "Koishi Memes Backend",
    endpoints: { auth: "/auth", memes: "/meme" },
  }))
  .use(routes)
  .listen(3060, () => console.log("Running on port 3060"));
