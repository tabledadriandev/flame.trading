# Decisions

Notable choices made while building Flame, newest last. Each has the reason, so a later session can disagree with the reason rather than guess at it.

## 17 November 2026

**Vercel project is named `flame`, created from the CLI.** The roadmap offered the dashboard or the CLI. The CLI was already logged in on Adrian's Mac, so no browser step was needed. `vercel link` connected the GitHub repo in the same step.

**`www.flame.trading` redirects with a 308.** A permanent redirect that keeps the method; Vercel's default for a redirect domain.
