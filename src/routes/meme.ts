import { Elysia, t } from "elysia";
import { db } from "../db";
import { memes, users } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { randomUUID } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { authMiddleware } from "../middleware/auth";

const MEMES_DIR = "./public/memes";
const MAX_FILE_SIZE = 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const PG_UNIQUE_VIOLATION = "23505";

if (!existsSync(MEMES_DIR)) {
  await mkdir(MEMES_DIR, { recursive: true });
}

const idParams = t.Object({ id: t.String({ format: "uuid" }) });

function getImageType(buffer: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...buffer.subarray(start, end));
  if (buffer[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (ascii(0, 3) === "GIF") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

async function processImage(buffer: Buffer): Promise<{ filename: string; size: number }> {
  const quality = buffer.length > MAX_FILE_SIZE ? 70 : 85;
  const filename = `${randomUUID()}.webp`;
  // animated: 保留 GIF / 动态 WebP 的所有帧
  const webpBuffer = await sharp(buffer, { animated: true }).webp({ quality }).toBuffer();
  await writeFile(join(MEMES_DIR, filename), webpBuffer);
  return { filename, size: webpBuffer.length };
}

function isUniqueViolation(error: unknown): boolean {
  const pgError = (error as { cause?: { code?: string }; code?: string }) ?? {};
  return pgError.code === PG_UNIQUE_VIOLATION || pgError.cause?.code === PG_UNIQUE_VIOLATION;
}

function memeView(meme: { id: string; title: string; imagePath: string; userId: string; createdAt: Date }) {
  return { id: meme.id, title: meme.title, imageUrl: `/memes/${meme.imagePath}`, userId: meme.userId, createdAt: meme.createdAt };
}

// Protected routes (POST, DELETE)
const protectedMemeRoute = new Elysia()
  .use(authMiddleware)
  .post(
    "/post",
    async ({ body, userId, set }) => {
      const title = body.title.trim();
      const buffer = Buffer.from(await body.file.arrayBuffer());
      const imageType = getImageType(new Uint8Array(buffer));
      if (!imageType || !ALLOWED_TYPES.includes(imageType)) {
        set.status = 400;
        return { error: `Invalid image type. Allowed: ${ALLOWED_TYPES.join(", ")}` };
      }

      const [existing] = await db.select({ id: memes.id }).from(memes).where(eq(memes.title, title));
      if (existing) {
        set.status = 409;
        return { error: "Title already exists. Please use a different title." };
      }

      const { filename } = await processImage(buffer);
      try {
        const [newMeme] = await db.insert(memes).values({ title, imagePath: filename, userId }).returning();
        set.status = 201;
        return { data: memeView(newMeme), message: "Meme posted successfully" };
      } catch (error) {
        // 插入失败时清理已写入的图片
        await unlink(join(MEMES_DIR, filename)).catch(() => {});
        // 并发提交同名标题时由唯一约束兜底
        if (isUniqueViolation(error)) {
          set.status = 409;
          return { error: "Title already exists. Please use a different title." };
        }
        throw error;
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        file: t.File({ maxSize: "20m" }),
      }),
    },
  )
  .delete(
    "/:id",
    async ({ params, userId, set }) => {
      const [meme] = await db.select().from(memes).where(eq(memes.id, params.id));
      if (!meme) {
        set.status = 404;
        return { error: "Meme not found" };
      }
      if (meme.userId !== userId) {
        const [requester] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
        if (!requester?.isAdmin) {
          set.status = 403;
          return { error: "You can only delete your own memes" };
        }
      }

      // 先删记录再删文件: 删文件失败只会留下孤儿文件, 不会留下指向空文件的记录
      const [deleted] = await db.delete(memes).where(eq(memes.id, params.id)).returning();
      await unlink(join(MEMES_DIR, meme.imagePath)).catch(() => {});
      return { message: "Meme deleted successfully", data: memeView(deleted) };
    },
    { params: idParams },
  );

// Public routes (GET)
export const memeRoute = new Elysia({ prefix: "/meme" })
  .get(
    "/",
    async ({ query }) => {
      // 不传 limit 时返回全部, 兼容旧客户端
      const base = db.select().from(memes).orderBy(memes.createdAt);
      const allMemes = query.limit !== undefined ? await base.limit(query.limit).offset(query.offset ?? 0) : await base;
      return { data: allMemes.map(memeView), count: allMemes.length };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
    },
  )
  .get("/rand", async ({ set }) => {
    const [randomMeme] = await db.select().from(memes).orderBy(sql`RANDOM()`).limit(1);
    if (!randomMeme) {
      set.status = 404;
      return { error: "No memes available" };
    }
    return { data: memeView(randomMeme) };
  })
  .get(
    "/:id",
    async ({ params, set }) => {
      const [meme] = await db.select().from(memes).where(eq(memes.id, params.id));
      if (!meme) {
        set.status = 404;
        return { error: "Meme not found" };
      }
      return { data: memeView(meme) };
    },
    { params: idParams },
  )
  .use(protectedMemeRoute);
