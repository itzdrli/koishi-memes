import { Elysia } from "elysia";
import { authRoute } from "./auth";
import { memeRoute } from "./meme";

export const routes = new Elysia()
  .use(authRoute)
  .use(memeRoute)

export { authRoute, memeRoute };
