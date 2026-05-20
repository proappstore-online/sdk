import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { app } from '../index.js';

const originalFetch = globalThis.fetch;

function mockStmt(opts: { first?: unknown; all?: unknown; run?: unknown } = {}) {
  return {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(opts.first ?? null),
    all: vi.fn().mockResolvedValue(opts.all ?? { results: [] }),
    run: vi.fn().mockResolvedValue(opts.run ?? { meta: { changes: 0 } }),
  };
}

function mockD1(...stmts: ReturnType<typeof mockStmt>[]) {
  const prepare = vi.fn();
  for (const stmt of stmts) prepare.mockReturnValueOnce(stmt);
  prepare.mockReturnValue(mockStmt());
  return { prepare };
}

function makeEnv(db?: ReturnType<typeof mockD1>) {
  return {
    DB: (db ?? mockD1()) as unknown as D1Database,
    STORAGE: {} as R2Bucket,
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    SESSION_SIGNING_KEY: 'sign_key',
    FAS_API_BASE: 'https://api.freeappstore.online',
    CF_API_TOKEN: 'cf_tok',
    CF_ACCOUNT_ID: 'cf_acct',
    VAPID_PUBLIC_KEY: 'p',
    VAPID_PRIVATE_KEY: 'q',
  };
}

/** Mock /v1/auth/me to return a specific user. */
function mockAuthAs(userId = 'gh:1', login = 'testuser') {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: userId, login, avatarUrl: null }), { status: 200 }),
  );
}

/** UTC day key for "today", same way the route computes it. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

beforeEach(() => {
  mockAuthAs('gh:1');
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /v1/usage/ping', () => {
  it('clamps deltaSeconds to 90 and returns the upserted totals', async () => {
    // app exists -> upsert -> read-back row
    const appLookup = mockStmt({ first: { id: 'meetup' } });
    const upsert = mockStmt();
    const readback = mockStmt({ first: { session_seconds: 90, api_calls: 0 } });
    const db = mockD1(appLookup, upsert, readback);

    const res = await app.request(
      '/v1/usage/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'meetup', deltaSeconds: 999 }),
      },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      day: string;
      sessionSeconds: number;
      apiCalls: number;
    };
    expect(body.ok).toBe(true);
    expect(body.sessionSeconds).toBeLessThanOrEqual(90);
    expect(body.day).toBe(todayKey());

    // The upsert call must have bound the clamped value (90), not 999.
    const upsertBindCalls = (upsert.bind as ReturnType<typeof vi.fn>).mock.calls;
    expect(upsertBindCalls.length).toBeGreaterThan(0);
    const boundArgs = upsertBindCalls[0] as unknown[];
    // bind(appId, userId, day, deltaSeconds, deltaApiCalls, now)
    expect(boundArgs[3]).toBe(90);
    expect(boundArgs[4]).toBe(0);
  });

  it('rejects an unknown app with 400 "unknown app"', async () => {
    const appLookup = mockStmt({ first: null });
    const db = mockD1(appLookup);

    const res = await app.request(
      '/v1/usage/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'does-not-exist', deltaSeconds: 30 }),
      },
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/unknown app/i);
  });

  it('rejects an invalid appId format with 400', async () => {
    const db = mockD1();
    const res = await app.request(
      '/v1/usage/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'INVALID_App!', deltaSeconds: 30 }),
      },
      makeEnv(db),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid appId/i);
  });

  it('clamps deltaApiCalls to 1000', async () => {
    const appLookup = mockStmt({ first: { id: 'meetup' } });
    const upsert = mockStmt();
    const readback = mockStmt({ first: { session_seconds: 0, api_calls: 1000 } });
    const db = mockD1(appLookup, upsert, readback);

    const res = await app.request(
      '/v1/usage/ping',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: 'meetup', deltaApiCalls: 99999 }),
      },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const boundArgs = (upsert.bind as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    expect(boundArgs[4]).toBe(1000);
  });
});

describe('GET /v1/apps/:id/usage', () => {
  it('404s when the user is not the app owner', async () => {
    // requireAppOwner: SELECT creator_id FROM apps -> null
    const owner = mockStmt({ first: null });
    const db = mockD1(owner);
    const res = await app.request(
      '/v1/apps/somebody-elses/usage',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(404);
  });

  it('clamps days to 1..365', async () => {
    // days=9999 should clamp to 365. We can verify by inspecting the response
    // and the SQL binds for the aggregation query.
    const owner = mockStmt({ first: { creator_id: 'gh:1' } });
    const series = mockStmt({ all: { results: [] } });
    const totals = mockStmt({ first: { session_seconds: 0, api_calls: 0, users: 0 } });
    const db = mockD1(owner, series, totals);

    const res = await app.request(
      '/v1/apps/meetup/usage?days=9999',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: number; series: unknown[] };
    expect(body.days).toBe(365);
    expect(body.series).toHaveLength(365);
  });

  it('clamps days to a minimum of 1', async () => {
    const owner = mockStmt({ first: { creator_id: 'gh:1' } });
    const series = mockStmt({ all: { results: [] } });
    const totals = mockStmt({ first: { session_seconds: 0, api_calls: 0, users: 0 } });
    const db = mockD1(owner, series, totals);

    const res = await app.request(
      '/v1/apps/meetup/usage?days=0',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: number; series: unknown[] };
    expect(body.days).toBe(1);
    expect(body.series).toHaveLength(1);
  });

  it('with no data returns a fully-filled zero series and zero totals', async () => {
    const owner = mockStmt({ first: { creator_id: 'gh:1' } });
    const series = mockStmt({ all: { results: [] } });
    const totals = mockStmt({ first: { session_seconds: 0, api_calls: 0, users: 0 } });
    const db = mockD1(owner, series, totals);

    const res = await app.request(
      '/v1/apps/meetup/usage',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      appId: string;
      days: number;
      series: { day: string; sessionSeconds: number; apiCalls: number; users: number }[];
      totals: { sessionSeconds: number; apiCalls: number; users: number };
    };
    expect(body.appId).toBe('meetup');
    expect(body.days).toBe(30);
    expect(body.series).toHaveLength(30);
    for (const row of body.series) {
      expect(row.sessionSeconds).toBe(0);
      expect(row.apiCalls).toBe(0);
      expect(row.users).toBe(0);
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(body.totals).toEqual({ sessionSeconds: 0, apiCalls: 0, users: 0 });

    // Last entry should be today.
    expect(body.series[body.series.length - 1]!.day).toBe(todayKey());
  });

  it('merges real per-day rows over the zero-filled window and reports totals', async () => {
    const owner = mockStmt({ first: { creator_id: 'gh:1' } });
    const today = todayKey();
    const dailyRow = {
      day: today,
      session_seconds: 1234,
      api_calls: 56,
      users: 12,
    };
    const series = mockStmt({ all: { results: [dailyRow] } });
    const totals = mockStmt({ first: { session_seconds: 1234, api_calls: 56, users: 12 } });
    const db = mockD1(owner, series, totals);

    const res = await app.request(
      '/v1/apps/meetup/usage?days=7',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: number;
      series: { day: string; sessionSeconds: number; apiCalls: number; users: number }[];
      totals: { sessionSeconds: number; apiCalls: number; users: number };
    };
    expect(body.days).toBe(7);
    expect(body.series).toHaveLength(7);
    const todayEntry = body.series[body.series.length - 1]!;
    expect(todayEntry.day).toBe(today);
    expect(todayEntry.sessionSeconds).toBe(1234);
    expect(todayEntry.apiCalls).toBe(56);
    expect(todayEntry.users).toBe(12);
    expect(body.totals).toEqual({ sessionSeconds: 1234, apiCalls: 56, users: 12 });
  });
});

describe('GET /v1/usage/me', () => {
  it('returns per-app aggregates for the signed-in user only', async () => {
    const rows = [
      { app_id: 'kanban', session_seconds: 300, api_calls: 10 },
      { app_id: 'meetup', session_seconds: 600, api_calls: 5 },
    ];
    const me = mockStmt({ all: { results: rows } });
    const db = mockD1(me);

    const res = await app.request(
      '/v1/usage/me',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      days: number;
      perApp: { appId: string; sessionSeconds: number; apiCalls: number }[];
      totals: { sessionSeconds: number; apiCalls: number };
    };
    expect(body.userId).toBe('gh:1');
    expect(body.days).toBe(30);
    expect(body.perApp).toEqual([
      { appId: 'kanban', sessionSeconds: 300, apiCalls: 10 },
      { appId: 'meetup', sessionSeconds: 600, apiCalls: 5 },
    ]);
    expect(body.totals).toEqual({ sessionSeconds: 900, apiCalls: 15 });

    // Scoping check: the query must be bound with the authed user's id.
    const bindCalls = (me.bind as ReturnType<typeof vi.fn>).mock.calls;
    expect(bindCalls.length).toBeGreaterThan(0);
    const boundArgs = bindCalls[0] as unknown[];
    expect(boundArgs[0]).toBe('gh:1');
  });

  it('returns empty perApp and zero totals when the user has no rows', async () => {
    const me = mockStmt({ all: { results: [] } });
    const db = mockD1(me);
    const res = await app.request(
      '/v1/usage/me?days=14',
      { headers: { Authorization: 'Bearer t' } },
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: number;
      perApp: unknown[];
      totals: { sessionSeconds: number; apiCalls: number };
    };
    expect(body.days).toBe(14);
    expect(body.perApp).toEqual([]);
    expect(body.totals).toEqual({ sessionSeconds: 0, apiCalls: 0 });
  });
});
