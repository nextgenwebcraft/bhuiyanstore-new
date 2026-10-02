import { cashAccounts } from "@bsd/application";
import { tenantListItemRoutes } from "@/server/api";

export const { PUT } = tenantListItemRoutes(cashAccounts);
