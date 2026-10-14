-- Standard expense categories (D51) for every existing tenant, inserted only when the name is
-- missing. Prisma generates category ids in the client (cuid), so ids here are cuid-shaped text
-- ('c' + 24 hex characters) built from the tenant, the name and a random value; they only need
-- to be unique and are never parsed. Rerunning is a no-op (unique tenant_id + name).
INSERT INTO "expense_category" ("id", "tenant_id", "name", "active", "created_at")
SELECT
    'c' || substr(md5(t."id" || v."name" || clock_timestamp()::text || random()::text), 1, 24),
    t."id",
    v."name",
    true,
    CURRENT_TIMESTAMP
FROM "tenant" t
CROSS JOIN (
    VALUES ('লোড আনলোড'), ('বিদ্যুৎ বিল'), ('গ্যারেজ ভাড়া'), ('গোডাউন ভাড়া')
) AS v("name")
ON CONFLICT ("tenant_id", "name") DO NOTHING;
