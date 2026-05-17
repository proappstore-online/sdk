# ProAppStore Platform

Unified SDK + CLI + backend for premium apps on **proappstore.online**.

## SDK

```bash
npm i @proappstore/sdk
```

```ts
import { initPro } from '@proappstore/sdk'

const app = initPro({ appId: 'my-app' })

app.auth          // GitHub OAuth (shared identity with FreeAppStore)
app.kv            // Per-user key-value storage
app.counters      // Shared atomic counters
app.rooms         // Real-time WebSocket rooms
app.proxy         // Secret-injecting API proxy
app.subscription  // Stripe subscriptions (pro)
app.license       // License key validation (pro)
```

One import. All free + pro features in one SDK instance.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `packages/sdk` | `@proappstore/sdk` | Unified browser SDK |
| `packages/cli` | `@proappstore/cli` | CLI for publishing pro apps |
| `packages/backend` | private | CF Worker — Stripe webhooks, subscriptions, licenses |

## Architecture

- Backend: Cloudflare Workers + D1 (subscriptions, licenses)
- Auth: Delegates to FAS (`api.freeappstore.online/v1/auth/me`) — shared identity
- Payments: Stripe (checkout sessions, billing portal, webhook receiver)
- Publishing: OIDC trusted publishing (no stored tokens)

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run tests
```

## Deployment

- Push to main → auto-deploy backend via GitHub Actions
- SDK/CLI auto-publish to npm via OIDC on version bump

## License

MIT.
