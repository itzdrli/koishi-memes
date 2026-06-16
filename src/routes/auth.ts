import { Elysia, t } from "elysia";
import { jwt as jwtPlugin } from "@elysiajs/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcrypt";
import { authMiddleware, jwtConfig } from "../middleware/auth";

const BCRYPT_ROUNDS = 10;

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin(jwtConfig))
  .use(authMiddleware)
  .post(
    "/sign-up",
    async ({ body, jwt, userId, set, request }) => {
      const sourceIp = request.headers.get("cf-connecting-ip") || "unknown";

      const [requester] = await db.select().from(users).where(eq(users.id, userId));
      if (!requester?.isAdmin) {
        set.status = 403;
        console.warn(`sign-up: not admin from ${sourceIp}`);
        return { error: "Only admin users can create new users" };
      }

      const [existing] = await db.select().from(users).where(eq(users.email, body.email));
      if (existing) {
        set.status = 409;
        return { error: "User with this email already exists" };
      }

      const hashedPassword = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
      const [newUser] = await db
        .insert(users)
        .values({ email: body.email, password: hashedPassword, name: body.name ?? null, isAdmin: false })
        .returning({ id: users.id, email: users.email, name: users.name });

      const token = await jwt.sign({ id: newUser.id, email: newUser.email });
      console.log(`sign-up: created ${newUser.email} from ${sourceIp}`);
      set.status = 201;
      return { token, user: newUser };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        name: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/sign-in",
    async ({ body, jwt, set }) => {
      const [user] = await db.select().from(users).where(eq(users.email, body.email));

      if (!user || !(await bcrypt.compare(body.password, user.password))) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      const token = await jwt.sign({ id: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email, name: user.name } };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  );
