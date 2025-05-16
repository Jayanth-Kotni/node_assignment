import http, { IncomingMessage, ServerResponse } from "http";
import { connectDB } from "./db";
import { userRouter } from "./routes/userRoutes";

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    const db = await connectDB();

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      userRouter(req, res, db);
    });

    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
  }
})();
