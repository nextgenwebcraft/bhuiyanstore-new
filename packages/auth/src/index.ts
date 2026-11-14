export { APIError } from "better-auth/api";
export { hashPassword } from "better-auth/crypto";
export {
  auth,
  createAuth,
  MIN_PASSWORD_LENGTH,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  type Auth,
} from "./auth";
export { actorFromHeaders, type Actor } from "./session";
export { bootstrapSuperAdmin, type BootstrapInput, type BootstrapResult } from "./bootstrap";
