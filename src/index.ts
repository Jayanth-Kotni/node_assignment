import http, { IncomingMessage, ServerResponse } from "http";
import { connectDB } from "./db.js";
import { userRouter } from "./routes/userRoutes.js";

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    const db = await connectDB();

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      userRouter(req, res, db);
    });

server.listen({
  port: PORT as number,
  host: '0.0.0.0'
}, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
  } catch (error) {
    console.error("Failed to start server:", error);
  }
})();
