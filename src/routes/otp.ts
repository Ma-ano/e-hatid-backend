import { Router } from "express";
import { csrfProtect } from "../middlewares/auth.js";
import { requestOtp, verifyOtp } from "../controllers/otpController.js";

export const otpRouter = Router();

// OTP send/verify. Both are state-changing and rate-limited server-side, so
// CSRF protects them (send/verify shouldn't be triggerable cross-site).
otpRouter.post("/send", csrfProtect, requestOtp);
otpRouter.post("/verify", csrfProtect, verifyOtp);
