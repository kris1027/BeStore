# The one tools image for `docker compose up`: Node, pnpm, the Docker CLI (to drive the Supabase
# CLI's containers and the Stripe CLI through the mounted socket) and socat. Nothing but Docker
# is needed on the host. Every version is pinned so the local stack doesn't change under you.
FROM node:24.21.0-bookworm-slim

COPY --from=docker:29.9.0-cli /usr/local/bin/docker /usr/local/bin/docker

RUN apt-get update \
  && apt-get install --yes --no-install-recommends socat ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Matches `packageManager` in package.json.
RUN corepack enable && corepack prepare pnpm@11.15.1 --activate
