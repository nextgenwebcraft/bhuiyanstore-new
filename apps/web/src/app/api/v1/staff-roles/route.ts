import { staffRoles } from "@bsd/application";
import { tenantListRoutes } from "@/server/api";

export const { GET, POST } = tenantListRoutes(staffRoles);
