import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireAuth } from "./middlewares/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"].split(",").map(o => o.trim())
  : ["http://localhost:8081", "http://localhost:5173"]; // Expo + Vite dev defaults

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server / mobile app requests (no Origin header)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin not allowed — ${origin}`));
  },
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
// Serve uploaded conviction attachments as static files
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Paths (relative to /api) that do not require a JWT / demo token
const PUBLIC_PATHS = new Set([
  "/healthz",
  "/auth/signup",
  "/auth/signin",
  "/auth/refresh",
  "/auth/google",
  "/auth/verify",
]);

app.use("/api", (req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_PATHS.has(req.path)) return next();
  return requireAuth(req, res, next);
});

app.use("/api", router);

export default app;
