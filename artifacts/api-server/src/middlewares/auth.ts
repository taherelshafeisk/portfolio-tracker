import type { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase";
import { DEMO_USER_ID, DEMO_TOKEN } from "../lib/constants";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (token === DEMO_TOKEN) {
    req.userId = DEMO_USER_ID;
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.userId = data.user.id;
  next();
}
