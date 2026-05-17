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
app.db            // Per-app SQL database (D1)
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
| `packages/data-worker` | private | Per-app D1 database worker (`data-{appId}.proappstore.online`) |

## Architecture

```
Browser App
  └─ @proappstore/sdk
       ├─ auth, kv, counters, rooms, proxy → api.freeappstore.online (FAS backend)
       ├─ subscription, license            → api.proappstore.online (PAS backend)
       └─ db                               → data-{appId}.proappstore.online (data-worker)
```

- **Backend** (`packages/backend`): Cloudflare Workers + D1 — Stripe webhooks, subscription CRUD, license key management
- **Data Worker** (`packages/data-worker`): Per-app Hono worker fronting a D1 database — query, execute, batch, tables. Auth validated against FAS.
- **Auth**: Delegates to FAS (`api.freeappstore.online/v1/auth/me`) — shared GitHub OAuth identity
- **Payments**: Stripe (checkout sessions, billing portal, webhook receiver)
- **Publishing**: OIDC trusted publishing (no stored tokens)

## Development

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run tests
```

## Deployment

- Push to main → auto-deploy backend + data-workers via GitHub Actions
- SDK/CLI auto-publish to npm via OIDC on version bump

## License

MIT.
