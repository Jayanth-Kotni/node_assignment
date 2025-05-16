import { IncomingMessage, ServerResponse } from "http";
import { Db } from "mongodb";
import fetch from "node-fetch";
import { User } from "../types/user";
import { Post } from "../types/post";
import { Comment } from "../types/comment";

const cache: { [key: string]: { data: any; timestamp: number } } = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function setCache(key: string, data: any) {
  cache[key] = { data, timestamp: Date.now() };
}

function getCache(key: string) {
  const entry = cache[key];
  if (!entry || Date.now() - entry.timestamp > CACHE_TTL) return null;
  return entry.data;
}

function invalidateCacheByPrefix(prefix: string) {
  Object.keys(cache).forEach((key) => {
    if (key.startsWith(prefix)) delete cache[key];
  });
}

export async function userRouter(req: IncomingMessage, res: ServerResponse, db: Db) {
  const method = req.method;
  const url = req.url || "";

  // ====== LOAD API ======
  if (method === "GET" && url === "/load") {
    try {
      const userRes = await fetch("https://jsonplaceholder.typicode.com/users");
      const users = (await userRes.json()) as User[];

      for (const user of users) {
        const postRes = await fetch(`https://jsonplaceholder.typicode.com/posts?userId=${user.id}`);
        const posts = (await postRes.json()) as Post[];

        for (const post of posts) {
          const commentsRes = await fetch(`https://jsonplaceholder.typicode.com/comments?postId=${post.id}`);
          post.comments = (await commentsRes.json()) as Comment[];
        }

        posts.sort((a, b) => a.title.localeCompare(b.title));
        user.posts = posts;

        await db.collection("users").insertOne(user);
      }

      invalidateCacheByPrefix("/users");

      res.writeHead(200);
      res.end();
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to load data" }));
    }
    return;
  }

  // ====== DELETE /users/:userId ======
  if (method === "DELETE" && url.startsWith("/users/")) {
    const userIdStr = url.split("/")[2];
    const userId = parseInt(userIdStr);

    if (isNaN(userId)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid userId" }));
      return;
    }

    try {
      const result = await db.collection("users").deleteOne({ id: userId });
      if (result.deletedCount === 0) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "User not found" }));
      } else {
        invalidateCacheByPrefix("/users");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "User deleted successfully" }));
      }
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to delete user" }));
    }
    return;
  }

  // ====== GET /users/:userId with cache ======
  if (method === "GET" && /^\/users\/\d+$/.test(url)) {
    const userId = parseInt(url.split("/")[2]);
    const cacheKey = `/users/${userId}`;
    const cachedData = getCache(cacheKey);

    if (cachedData) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...cachedData, cached: true }));
      return;
    }

    try {
      const user = await db.collection("users").findOne({ id: userId });
      if (!user) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "User not found" }));
        return;
      }

      const responseData = { user, cached: false };
      setCache(cacheKey, responseData);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseData));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to fetch user" }));
    }
    return;
  }

  // ====== GET /users?page=1&limit=5 ======
  if (method === "GET" && url.startsWith("/users")) {
    const parsedUrl = new URL(req.url || "", `http://${req.headers.host}`);
    const page = parseInt(parsedUrl.searchParams.get("page") || "1", 10);
    const limit = parseInt(parsedUrl.searchParams.get("limit") || "5", 10);
    const search = parsedUrl.searchParams.get("search")?.toLowerCase() || "";
    const sortBy = parsedUrl.searchParams.get("sortBy") || "id";
    const order = parsedUrl.searchParams.get("order") === "desc" ? -1 : 1;

    if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid page or limit value" }));
      return;
    }

    const validSortFields = ["id", "name", "username", "email"];
    if (!validSortFields.includes(sortBy)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: `Invalid sortBy field. Must be one of: ${validSortFields.join(", ")}` })
      );
      return;
    }

    const skip = (page - 1) * limit;
    const query: any = search
      ? {
          $or: [
            { name: { $regex: search, $options: "i" } },
            { username: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
        }
      : {};

    const cacheKey = JSON.stringify({ page, limit, search, sortBy, order });
    const cachedData = getCache(cacheKey);

    if (cachedData) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...cachedData, cached: true }));
      return;
    }

    try {
      const users = await db
        .collection("users")
        .find(query)
        .sort({ [sortBy]: order })
        .skip(skip)
        .limit(limit)
        .toArray();

      const totalUsers = await db.collection("users").countDocuments(query);

      const responseData = {
        page,
        limit,
        totalUsers,
        totalPages: Math.ceil(totalUsers / limit),
        users,
        cached: false,
      };

      setCache(cacheKey, responseData);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(responseData));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to fetch users" }));
    }
    return;
  }

  // ====== PUT /users ======
  if (method === "PUT" && url === "/users") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const newUser: User = JSON.parse(body);

        if (!newUser || typeof newUser.id !== "number") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid user data" }));
          return;
        }

        const existingUser = await db.collection("users").findOne({ id: newUser.id });

        if (existingUser) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "User already exists." }));
          return;
        }

        await db.collection("users").insertOne(newUser);
        invalidateCacheByPrefix("/users");

        res.writeHead(201, {
          "Content-Type": "application/json",
          Location: `/users/${newUser.id}`,
        });
        res.end(JSON.stringify(newUser));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to add user" }));
      }
    });
    return;
  }
}
