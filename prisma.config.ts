import { config } from "dotenv"
// Load .env.local first (takes priority), then fall back to .env
config({ path: ".env.local", override: true })
config({ path: ".env", override: false })

import { defineConfig } from "prisma/config"

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
})
