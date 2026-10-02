"use client";

import { useCallback, useState } from "react";

/**
 * Idempotency key for one posting attempt (guide 5.4, 13.2). It survives retries after an
 * unknown outcome, so a resubmission can never post twice; call `renew` only when starting a
 * genuinely new document.
 */
export function useRequestKey(): [string, () => void] {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const renew = useCallback(() => setKey(crypto.randomUUID()), []);
  return [key, renew];
}
