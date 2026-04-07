import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  (req as any).userId = userId;
  next();
};
