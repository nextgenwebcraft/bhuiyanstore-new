-- PLAN §9 Phase H: Excel month import jobs (raw sheet input, labels, comparison, mapping).

-- CreateTable
CREATE TABLE "import_job" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "version" INTEGER NOT NULL DEFAULT 1,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "sheet" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "labels" JSONB NOT NULL,
    "report" JSONB NOT NULL,
    "mapping" JSONB NOT NULL,
    "committed_mode" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "committed_by_id" TEXT,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_job_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "import_job_status" CHECK ("status" IN ('ready', 'committed', 'discarded')),
    CONSTRAINT "import_job_version_positive" CHECK ("version" > 0),
    CONSTRAINT "import_job_committed" CHECK (
        ("status" = 'committed') = ("committed_at" IS NOT NULL AND "committed_mode" IS NOT NULL)
    ),
    CONSTRAINT "import_job_mode" CHECK ("committed_mode" IS NULL OR "committed_mode" IN ('documents', 'opening'))
);

-- CreateIndex
CREATE INDEX "import_job_company_id_created_at_idx" ON "import_job"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
