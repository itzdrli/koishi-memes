import { Elysia } from "elysia";
import { jwt as jwtPlugin } from "@elysiajs/jwt";

export const jwtConfig = {
  name: "jwt" as const,
  secret: process.env.JWT_SECRET || "",
};

export const authMiddleware = new Elysia({ name: "auth-middleware" })
  .use(jwtPlugin(jwtConfig))
  .derive({ as: "scoped" }, async ({ jwt, request, set }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Authorization token required");
    }

    const payload = await jwt.verify(authHeader.substring(7));
    if (!payload || !payload.id) {
      set.status = 401;
      throw new Error("Invalid or expired token");
    }

    return { userId: payload.id as string };
  });
