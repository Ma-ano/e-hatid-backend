import { Router } from "express";
import { csrfProtect, requireAuth, requireRole } from "../middlewares/auth.js";
import {
  applyForRole,
  getMe,
  getUser,
  listUsers,
  setAvailability,
  setRoleStatus,
  updateMe,
} from "../controllers/userController.js";
import {
  createAddress,
  deleteAddress,
  listAddresses,
  setDefaultAddress,
  updateAddress,
} from "../controllers/addressController.js";

export const usersRouter = Router();

// Own profile (any authenticated user)
usersRouter.get("/me", requireAuth, getMe);
usersRouter.put("/me", requireAuth, csrfProtect, updateMe);
usersRouter.post("/me/apply-role", requireAuth, csrfProtect, applyForRole);
usersRouter.put("/me/availability", requireAuth, csrfProtect, setAvailability);

// Own address book (spec §25)
usersRouter.get("/me/addresses", requireAuth, listAddresses);
usersRouter.post("/me/addresses", requireAuth, csrfProtect, createAddress);
usersRouter.put("/me/addresses/default", requireAuth, csrfProtect, setDefaultAddress);
usersRouter.put("/me/addresses/:addrId", requireAuth, csrfProtect, updateAddress);
usersRouter.delete("/me/addresses/:addrId", requireAuth, csrfProtect, deleteAddress);

// Admin-only user management
usersRouter.get("/", requireAuth, requireRole("admin"), listUsers);
usersRouter.get("/:id", requireAuth, requireRole("admin"), getUser);
usersRouter.put("/:id/role-status", requireAuth, requireRole("admin"), csrfProtect, setRoleStatus);
