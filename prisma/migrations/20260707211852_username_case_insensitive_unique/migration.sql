-- Telegram-style usernames are unique case-insensitively ("John" == "john").
-- Prisma's @unique on username is case-sensitive; enforce the real rule with a
-- functional unique index. Violations surface as Postgres 23505, which Prisma
-- maps to P2002 — already handled in UsersService.updateProfile.
CREATE UNIQUE INDEX "User_username_lower_key" ON "User" (LOWER("username")) WHERE "username" IS NOT NULL;
