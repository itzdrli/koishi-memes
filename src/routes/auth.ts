import { Elysia, t } from "elysia";
import { jwt as jwtPlugin } from "@elysiajs/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import * as bcrypt from "bcrypt";
import { authMiddleware, jwtConfig } from "../middleware/auth";
import { clearFailures, isRateLimited, recordFailure } from "../middleware/rateLimit";

const BCRYPT_ROUNDS = 10;
// 用户不存在时也做一次 bcrypt 比较, 避免通过响应时间判断邮箱是否存在
const DUMMY_HASH = await bcrypt.hash("dummy-password", BCRYPT_ROUNDS);

type IpResolver = { requestIP(request: Request): { address: string } | null } | null;

function getClientIp(request: Request, server: IpResolver) {
  return request.headers.get("cf-connecting-ip") || server?.requestIP(request)?.address || "unknown";
}

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin(jwtConfig))
  // 公开路由: 必须注册在 authMiddleware 之前
  .post(
    "/sign-in",
    async ({ body, jwt, set, request, server }) => {
      const ip = getClientIp(request, server);
      if (isRateLimited(ip)) {
        set.status = 429;
        return { error: "Too many failed attempts, try again later" };
      }

      const [user] = await db.select().from(users).where(eq(users.email, body.email));
      const valid = await bcrypt.compare(body.password, user?.password ?? DUMMY_HASH);
      if (!user || !valid) {
        recordFailure(ip);
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      clearFailures(ip);
      const token = await jwt.sign({ id: user.id, email: user.email });
      return { token, user: { id: user.id, email: user.email, name: user.name } };
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  )
  // 以下路由需要登录
  .use(authMiddleware)
  .post(
    "/sign-up",
    async ({ body, jwt, userId, set, request, server }) => {
      const sourceIp = getClientIp(request, server);

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
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
        name: t.Optional(t.String()),
      }),
    },
  );
