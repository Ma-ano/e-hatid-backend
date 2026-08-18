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

export const authRouter = Router();

// Public: register/login must not require CSRF (they bootstrap the CSRF cookie).
authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.get("/me", me);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/reset-password", resetPassword);

// Authed + CSRF-protected
authRouter.post("/logout", csrfProtect, logout);
authRouter.put("/change-password", requireAuth, csrfProtect, changePassword);
