import seedJson from "./seed.json";
import { demoSeedSchema } from "./seed-schema";

/** The validated demo fixture. An invalid seed fails fast at startup, not on a screen. */
export const demoSeed = demoSeedSchema.parse(seedJson);
