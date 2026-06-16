import { Elysia, t } from "elysia";
import { db } from "../db";
import { memes } from "../db/schema";
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

if (!existsSync(MEMES_DIR)) {
  await mkdir(MEMES_DIR, { recursive: true });
}

function getImageType(buffer: Uint8Array): string | null {
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return "image/webp";
  return null;
}

async function processImage(buffer: Buffer): Promise<{ filename: string; size: number }> {
  const quality = buffer.length > MAX_FILE_SIZE ? 70 : 85;
  const filename = `${randomUUID()}.webp`;
  const webpBuffer = await sharp(buffer).webp({ quality }).toBuffer();
  await writeFile(join(MEMES_DIR, filename), webpBuffer);
  return { filename, size: webpBuffer.length };
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
      const buffer = Buffer.from(await body.file.arrayBuffer());
      const imageType = getImageType(new Uint8Array(buffer));
      if (!imageType || !ALLOWED_TYPES.includes(imageType)) {
        set.status = 400;
        return { error: `Invalid image type. Allowed: ${ALLOWED_TYPES.join(", ")}` };
      }

      const [existing] = await db.select({ id: memes.id }).from(memes).where(eq(memes.title, body.title.trim()));
      if (existing) {
        set.status = 409;
        return { error: "Title already exists. Please use a different title." };
      }

      const { filename } = await processImage(buffer);
      const [newMeme] = await db
        .insert(memes)
        .values({ title: body.title.trim(), imagePath: filename, userId })
        .returning();

      set.status = 201;
      return { data: memeView(newMeme), message: "Meme posted successfully" };
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 255 }),
        file: t.File(),
      }),
    },
  )
  .delete("/:id", async ({ params, userId, set }) => {
    const [meme] = await db.select().from(memes).where(eq(memes.id, params.id));
    if (!meme) {
      set.status = 404;
      return { error: "Meme not found" };
    }
    if (meme.userId !== userId) {
      set.status = 403;
      return { error: "You can only delete your own memes" };
    }

    try {
      await unlink(join(MEMES_DIR, meme.imagePath));
    } catch {
      // file may already be gone
    }

    const [deleted] = await db.delete(memes).where(eq(memes.id, params.id)).returning();
    return { message: "Meme deleted successfully", data: memeView(deleted) };
  });

// Public routes (GET)
export const memeRoute = new Elysia({ prefix: "/meme" })
  .get("/", async () => {
    const allMemes = await db.select().from(memes);
    return { data: allMemes.map(memeView), count: allMemes.length };
  })
  .get("/rand", async ({ set }) => {
    const [randomMeme] = await db.select().from(memes).orderBy(sql`RANDOM()`).limit(1);
    if (!randomMeme) {
      set.status = 404;
      return { error: "No memes available" };
    }
    return { data: memeView(randomMeme) };
  })
  .get("/:id", async ({ params, set }) => {
    const [meme] = await db.select().from(memes).where(eq(memes.id, params.id));
    if (!meme) {
      set.status = 404;
      return { error: "Meme not found" };
    }
    return { data: memeView(meme) };
  })
  .use(protectedMemeRoute);
