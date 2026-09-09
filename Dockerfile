# The public demo of `examples/company`, built from this repository.
#
# It runs on the in-memory adapter — `DATABASE_URL` is deliberately never set — so a
# restart is a clean seed and nothing a visitor does outlives the process. That is the
# whole safety model rather than an economy: the demo publishes an administrator's
# password on purpose, and the reset is what makes publishing it reasonable.
#
# `docs/demo.md` is the deployment around this file, including the variables below.

FROM node:24-slim

WORKDIR /app

# pnpm at the version `package.json` pins, rather than whatever the registry calls
# latest today.
RUN corepack enable

# The workspace, because the build is turbo across the packages plus Studio's bundle
# and the example's own Vite bundle. Copying manifests first to cache the install would
# mean listing two dozen of them, and a list like that is wrong the day somebody adds
# a package.
COPY . .

# Only what this example depends on, which leaves out the Next.js starter, the docs
# app, the playground and the site. Installing all 35 projects is what a small machine
# cannot do — a build that tries is killed part-way through `pnpm install`, at exit
# 137, which is the kernel and not the tool.
RUN pnpm install --frozen-lockfile --filter "@assemora/example-company..."

# One project at a time. `tsc` across two dozen of them in parallel is the peak this
# image has to fit under, and on a small server time is the cheaper thing to spend.
RUN pnpm exec turbo run build --filter="@assemora/example-company..." --concurrency=1

# `PORT` and `HOST` are read by the umbrella and nowhere else (ADR-0022). Loopback is
# its default deliberately, so a container is the deployment that says otherwise.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

# Refuse to start without the seeded password rather than mint one at random: an
# unset variable makes `src/seed.ts` generate 144 bits and write them to `.env`, which
# for a demo means an administrator account nobody can sign in as, discovered by the
# first person who reads the post.
CMD ["sh", "-c", ": \"${ASSEMORA_SEED_PASSWORD:?is required — the demo publishes this password, and an unset one is generated at random and known to nobody}\"; exec pnpm --filter @assemora/example-company start"]
