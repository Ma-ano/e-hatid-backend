import { Router } from "express";
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  register,
  resetPassword,
} from "../controllers/authController.js";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";

// Brute-force protection on auth endpoints: tighten by IP.
const authLimiter = rateLimit({ windowMs: 60_000, max: 20, message: "Too many authentication attempts, please try again later." });

export const authRouter = Router();

// Public: register/login must not require CSRF (they bootstrap the CSRF cookie).
authRouter.post("/register", authLimiter, register);
authRouter.post("/login", authLimiter, login);
authRouter.get("/me", me);
authRouter.post("/forgot-password", authLimiter, forgotPassword);
authRouter.post("/reset-password", authLimiter, resetPassword);

// Authed + CSRF-protected
authRouter.post("/logout", requireAuth, csrfProtect, logout);
authRouter.put("/change-password", requireAuth, csrfProtect, changePassword);
