import { Elysia, t } from "elysia";
import { jwt as jwtPlugin } from "@elysiajs/jwt";
import { db } from "../index";
import { memes, users } from "../db/schema";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { mkdir, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const MEMES_DIR = "./public/memes";
const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

type MemeResponse = {
  id: string;
  title: string;
  imagePath: string;
  userId: string;
  createdAt: Date;
};

/**
 * Initialize memes directory if it doesn't exist
 */
async function initMemesDir(): Promise<void> {
  if (!existsSync(MEMES_DIR)) {
    await mkdir(MEMES_DIR, { recursive: true });
  }
}

/**
 * Compress and convert image to WebP
 */
async function processImage(
  buffer: Buffer,
  filename: string,
): Promise<{ path: string; size: number }> {
  await initMemesDir();

  const webpFilename = `${Date.now()}-${filename.split(".")[0]}.webp`;
  const filepath = join(MEMES_DIR, webpFilename);

  // Compress image and convert to WebP
  // If larger than 1MB, compress more aggressively
  const quality = buffer.length > MAX_FILE_SIZE ? 70 : 85;

  const webpBuffer = await sharp(buffer).webp({ quality }).toBuffer();

  await sharp(buffer).webp({ quality }).toFile(filepath);

  return {
    path: webpFilename,
    size: webpBuffer.length,
  };
}

/**
 * Validate file type from buffer
 */
function getImageType(buffer: Uint8Array): string | null {
  // PNG signature
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG signature
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return "image/jpeg";
  }
  // GIF signature
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  // WebP signature
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return "image/webp";
  }
  return null;
}

export const memeRoute = new Elysia({ prefix: "/meme" })
  .use(
    jwtPlugin({
      name: "jwt",
      secret: process.env.JWT_SECRET || "",
    }),
  )
  .post("/post", async ({ jwt, set, request }) => {
    try {
      // Get file from multipart form data
      const formData = await request.formData();
      const title = formData.get("title") as string;
      const file = formData.get("file") as File;

      // Validate title
      if (!title || title.trim().length === 0 || title.length > 255) {
        set.status = 400;
        return {
          error: "Title must be between 1 and 255 characters",
        };
      }

      if (!file) {
        set.status = 400;
        return {
          error: "Image file is required",
        };
      }

      // Validate file type
      const buffer = Buffer.from(await file.arrayBuffer());
      const imageType = getImageType(new Uint8Array(buffer));

      if (!imageType || !ALLOWED_TYPES.includes(imageType)) {
        set.status = 400;
        return {
          error: `Invalid image type. Allowed types: ${ALLOWED_TYPES.join(", ")}`,
        };
      }

      // Extract and verify authorization token
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        set.status = 401;
        return { error: "Authorization token required" };
      }

      const token = authHeader.substring(7);
      let payload;
      try {
        payload = await jwt.verify(token);
      } catch (error) {
        set.status = 401;
        return { error: "Invalid or expired token" };
      }

      if (!payload) {
        set.status = 401;
        return { error: "Invalid token" };
      }

      // Verify user exists
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.id as string));

      if (user.length === 0) {
        set.status = 404;
        return { error: "User not found" };
      }

      // Check if title already exists
      const existingMeme = await db
        .select()
        .from(memes)
        .where(eq(memes.title, title.trim()));

      if (existingMeme.length > 0) {
        set.status = 409;
        return { error: "Title already exists. Please use a different title." };
      }

      // Process image (compress and convert to WebP)
      const { path: imagePath } = await processImage(buffer, file.name);

      // Save to database
      const newMeme = await db
        .insert(memes)
        .values({
          title: title.trim(),
          imagePath,
          userId: payload.id as string,
        })
        .returning({
          id: memes.id,
          title: memes.title,
          imagePath: memes.imagePath,
          userId: memes.userId,
          createdAt: memes.createdAt,
        });

      set.status = 201;
      return {
        data: newMeme[0],
        message: "Meme posted successfully",
        imageUrl: `/meme/${newMeme[0].id}`,
      };
    } catch (error) {
      console.error("Error posting meme:", error);
      set.status = 500;
      return { error: "Failed to process meme" };
    }
  })
  .get("/", async ({ set }) => {
    try {
      const allMemes = await db
        .select({
          id: memes.id,
          title: memes.title,
          imagePath: memes.imagePath,
          userId: memes.userId,
          createdAt: memes.createdAt,
        })
        .from(memes);

      return {
        data: allMemes.map((meme) => ({
          ...meme,
          imageUrl: `/meme/${meme.id}`,
        })),
        count: allMemes.length,
      };
    } catch (error) {
      set.status = 500;
      return { error: "Failed to fetch memes" };
    }
  })
  .get("/:id", async ({ params, set }) => {
    try {
      const meme = await db.select().from(memes).where(eq(memes.id, params.id));

      if (meme.length === 0) {
        set.status = 404;
        return { error: "Meme not found" };
      }

      return {
        data: {
          id: meme[0].id,
          title: meme[0].title,
          imageUrl: `/memes/${meme[0].imagePath}`,
          userId: meme[0].userId,
          createdAt: meme[0].createdAt,
        },
      };
    } catch (error) {
      console.error("Error fetching meme:", error);
      set.status = 500;
      return { error: "Failed to fetch meme" };
    }
  })
  .delete("/:id", async ({ params, jwt, set, request }) => {
    // Extract and verify authorization token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      set.status = 401;
      return { error: "Authorization token required" };
    }

    const token = authHeader.substring(7);
    let payload;
    try {
      payload = await jwt.verify(token);
    } catch (error) {
      set.status = 401;
      return { error: "Invalid or expired token" };
    }

    if (!payload) {
      set.status = 401;
      return { error: "Invalid token" };
    }

    try {
      const meme = await db.select().from(memes).where(eq(memes.id, params.id));

      if (meme.length === 0) {
        set.status = 404;
        return { error: "Meme not found" };
      }

      if (meme[0].userId !== (payload.id as string)) {
        set.status = 403;
        return { error: "You can only delete your own memes" };
      }

      // Delete image file
      const filepath = join(MEMES_DIR, meme[0].imagePath);
      try {
        await unlink(filepath);
      } catch (err) {
        console.error("Error deleting file:", err);
      }

      // Delete from database
      const deleted = await db
        .delete(memes)
        .where(eq(memes.id, params.id))
        .returning();

      return {
        message: "Meme deleted successfully",
        data: deleted[0],
      };
    } catch (error) {
      set.status = 500;
      return { error: "Failed to delete meme" };
    }
  });
