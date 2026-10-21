import { config } from "dotenv";
import pg from "pg";

config({ path: "../../.env", quiet: true });
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
const res = await client.query(
  `SELECT c.name AS company, d.status, l.batch_key, p.name AS product, count(*)::int AS n
   FROM dsr_line l JOIN dsr_day d ON d.id = l.dsr_day_id JOIN company c ON c.id = d.company_id
   JOIN product p ON p.id = l.product_id
   WHERE l.batch_key LIKE 'auto:%' GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`,
);
console.log(res.rows);
await client.end();
