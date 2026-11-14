import { expenseCategories } from "@bsd/application";
import { tenantListItemRoutes } from "@/server/api";

export const { PUT } = tenantListItemRoutes(expenseCategories);
