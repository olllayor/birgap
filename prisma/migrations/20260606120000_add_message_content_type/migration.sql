CREATE TYPE "MessageContentType" AS ENUM ('TEXT', 'LOCATION', 'VENUE');

ALTER TABLE "Message" ADD COLUMN "contentType" "MessageContentType" NOT NULL DEFAULT 'TEXT';
