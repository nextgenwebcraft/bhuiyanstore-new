import { auth } from "@bsd/auth";

// Better Auth endpoints (sign-in, sign-out, session). Created lazily so builds need no secrets.
export function GET(request: Request) {
  return auth().handler(request);
}

export function POST(request: Request) {
  return auth().handler(request);
}
