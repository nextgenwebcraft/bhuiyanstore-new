"use client";

import { todayBusinessDate } from "@bsd/domain";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** Today's business date (Asia/Dhaka); a stable string for the whole render. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, todayBusinessDate, todayBusinessDate);
}
