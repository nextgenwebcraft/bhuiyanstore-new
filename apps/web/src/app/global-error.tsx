"use client";

import { t } from "@bsd/i18n";
import { PageError, type ErrorBoundaryProps } from "@/components/page-error";
import "./globals.css";

/** Replaces the root layout when it crashes, so it brings its own document and styles. */
export default function GlobalError(props: ErrorBoundaryProps) {
  return (
    <html lang="bn">
      <body className="min-h-dvh font-sans antialiased">
        <title>{t("app.name")}</title>
        <main className="mx-auto max-w-2xl p-4 sm:p-8">
          <PageError {...props} />
        </main>
      </body>
    </html>
  );
}
