-- D117: one-time password gate removed; users sign in and work with the password they were given.
ALTER TABLE "user" DROP COLUMN IF EXISTS "must_change_password";
