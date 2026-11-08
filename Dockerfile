# The web app, for running on your own machine instead of Vercel.
# docs/self-hosting.md walks through it; docker/selfhost/compose.yml runs it.
#
# The database stays where it is (Neon): the app reaches it over HTTPS and
# WebSockets exactly as it does on Vercel, so nothing about the data moves.

# The full image, not -slim: it already carries openssl (Prisma's schema
# engine), curl (the health check) and a compiler for any native module
# without a prebuilt binary, so nothing needs installing on top.
FROM node:24-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
# NEXT_PUBLIC_* values are baked into the browser bundle at build time, so
# they are build arguments, not runtime environment.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_ENABLED_FEATURES
ARG NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_ENABLED_FEATURES=$NEXT_PUBLIC_ENABLED_FEATURES \
    NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA=$NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA \
    NEXT_TELEMETRY_DISABLED=1
# No database needed here: every page that reads data renders on request.
RUN npx next build

FROM node:24-bookworm
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s \
  CMD curl -fsS -o /dev/null http://127.0.0.1:3000/robots.txt || exit 1
# `npm run build` on Vercel ran `prisma db push` before every deploy. Here it
# runs on every start instead, for the same reason: the schema follows the
# code. It refuses a change that would drop data, and the container then stops
# rather than serving against a schema it does not match.
CMD ["sh", "-c", "npx prisma db push && exec npx next start"]
