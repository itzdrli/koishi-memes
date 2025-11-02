import { Elysia, t } from "elysia";
import { jwt as jwtPlugin } from "@elysiajs/jwt";
import { db } from "../index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

type SignUpRequest = {
  email: string;
  password: string;
  name?: string;
};

type SignInRequest = {
  email: string;
  password: string;
};

type AuthResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

type UserResponse = {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
};

async function hashPassword(password: string): Promise<string> {
  // In production, use bcrypt: import bcrypt from 'bcrypt';
  // For now, using a basic hash
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const hashedInput = await hashPassword(password);
  return hashedInput === hash;
}

export const authRoute = new Elysia({ prefix: "/auth" })
  .use(
    jwtPlugin({
      name: "jwt",
      secret: process.env.JWT_SECRET || "",
    }),
  )
  .post(
    "/sign-up",
    async ({ body, jwt, set, request }) => {
      const signUpData = body as SignUpRequest;

      if (!signUpData.email || !signUpData.password) {
        set.status = 400;
        return { error: "Email and password are required" };
      }

      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        set.status = 401;
        return { error: "Authorization token required for sign-up" };
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

      const requester = await db
        .select()
        .from(users)
        .where(eq(users.id, payload.id as string));

      if (requester.length === 0 || !requester[0].isAdmin) {
        set.status = 403;
        return { error: "Only admin users can create new users" };
      }

      const existingUser = await db
        .select()
        .from(users)
        .where(eq(users.email, signUpData.email));

      if (existingUser.length > 0) {
        set.status = 409;
        return {
          error: "User with this email already exists",
        };
      }

      const hashedPassword = await hashPassword(signUpData.password);

      const newUser = await db
        .insert(users)
        .values({
          email: signUpData.email,
          password: hashedPassword,
          name: signUpData.name || null,
          isAdmin: false,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
        });

      const newToken = await jwt.sign({
        id: newUser[0].id,
        email: newUser[0].email,
      });

      set.status = 201;
      return {
        token: newToken,
        user: newUser[0],
      } as AuthResponse;
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
      const signInData = body as SignInRequest;

      if (!signInData.email || !signInData.password) {
        set.status = 400;
        return { error: "Email and password are required" };
      }

      const user = await db
        .select()
        .from(users)
        .where(eq(users.email, signInData.email));

      if (user.length === 0) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      // Verify password
      const isPasswordValid = await verifyPassword(
        signInData.password,
        user[0].password,
      );

      if (!isPasswordValid) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      // Generate JWT token
      const token = await jwt.sign({
        id: user[0].id,
        email: user[0].email,
      });

      return {
        token,
        user: {
          id: user[0].id,
          email: user[0].email,
          name: user[0].name,
        },
      } as AuthResponse;
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
    },
  );
