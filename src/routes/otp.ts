import { Router } from "express";
import { csrfProtect, requireAuth } from "../middlewares/auth.js";
import { rateLimit } from "../middlewares/rateLimit.js";
import { requestOtp, verifyOtp } from "../controllers/otpController.js";

// OTP send/verify are already rate-limited inside the issuer; add an IP-level
// guard on the transport so a single host can't hammer the SMTP relay.
const otpLimiter = rateLimit({ windowMs: 60_000, max: 10, message: "Too many OTP requests, please try again later." });

export const otpRouter = Router();

otpRouter.post("/send", csrfProtect, otpLimiter, requestOtp);
// Verification must be authenticated and can only verify the signed-in
// account's own email — otherwise anyone could flip emailVerified on any
// account by knowing (or brute-forcing) its code.
otpRouter.post("/verify", requireAuth, csrfProtect, otpLimiter, verifyOtp);
