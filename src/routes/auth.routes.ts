import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import * as authController from "../controllers/auth.controller";
import { requireAuth, requireCsrf } from "../middlewares/auth";

const authRoutes = Router();
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({
    error: { code: "RATE_LIMITED", message: "Terlalu banyak percobaan. Coba lagi nanti." }
  })
});

authRoutes.post("/register", authRateLimit, authController.register);
authRoutes.post("/login", authRateLimit, authController.login);
authRoutes.post("/google", authRateLimit, authController.loginGoogle);
authRoutes.post("/logout", requireAuth, requireCsrf, authController.logout);
authRoutes.get("/me", requireAuth, authController.me);

export default authRoutes;
