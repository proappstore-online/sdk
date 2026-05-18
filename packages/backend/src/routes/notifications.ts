import { Hono } from 'hono';
import webpush from 'web-push';
import type { Env, PushSubscriptionRow } from '../types.js';
import { requireUser, HttpError } from '../lib/auth.js';

export const notificationRoutes = new Hono<{ Bindings: Env }>();

/** Public VAPID key — no auth needed. Apps fetch this to register push. */
notificationRoutes.get('/notifications/vapid-key', (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

/** Subscribe to push notifications. Upserts the browser subscription in D1. */
notificationRoutes.post('/notifications/subscribe', async (c) => {
  try {
    const user = await requireUser(c);
    const { appId, endpoint, p256dh, auth } = await c.req.json<{
      appId: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>();

    if (!appId || !endpoint || !p256dh || !auth) {
      return c.text('missing required fields: appId, endpoint, p256dh, auth', 400);
    }

    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO push_subscriptions (id, user_id, app_id, endpoint, p256dh, auth_secret, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = ?2, app_id = ?3, p256dh = ?5, auth_secret = ?6`,
    )
      .bind(id, user.id, appId, endpoint, p256dh, auth, Date.now())
      .run();

    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return c.text(err.message, err.status as 401);
    throw err;
  }
});

/** Unsubscribe from push notifications. Deletes the subscription by endpoint. */
notificationRoutes.post('/notifications/unsubscribe', async (c) => {
  try {
    const user = await requireUser(c);
    const { endpoint } = await c.req.json<{ endpoint: string }>();

    if (!endpoint) return c.text('missing endpoint', 400);

    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2',
    )
      .bind(endpoint, user.id)
      .run();

    return c.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return c.text(err.message, err.status as 401);
    throw err;
  }
});

/** Send push notification. Caller must be app creator. */
notificationRoutes.post('/notifications/send', async (c) => {
  try {
    const user = await requireUser(c);
    const { appId, userId, title, body, url, icon, tag } = await c.req.json<{
      appId: string;
      userId?: string;
      title: string;
      body: string;
      url?: string;
      icon?: string;
      tag?: string;
    }>();

    if (!appId || !title || !body) {
      return c.text('missing required fields: appId, title, body', 400);
    }

    // Verify sender is app creator
    const app = await c.env.DB.prepare('SELECT creator_id FROM apps WHERE id = ?1').bind(appId).first<{ creator_id: string }>();
    if (!app || app.creator_id !== user.id) {
      return c.text('only the app creator can send notifications', 403);
    }

    // Fetch target subscriptions
    let subs: PushSubscriptionRow[];
    if (userId) {
      const result = await c.env.DB.prepare(
        'SELECT * FROM push_subscriptions WHERE app_id = ?1 AND user_id = ?2',
      ).bind(appId, userId).all<PushSubscriptionRow>();
      subs = result.results;
    } else {
      const result = await c.env.DB.prepare(
        'SELECT * FROM push_subscriptions WHERE app_id = ?1',
      ).bind(appId).all<PushSubscriptionRow>();
      subs = result.results;
    }

    webpush.setVapidDetails(
      'mailto:push@proappstore.online',
      c.env.VAPID_PUBLIC_KEY,
      c.env.VAPID_PRIVATE_KEY,
    );

    const payload = JSON.stringify({ title, body, url, icon, tag });
    let sent = 0;
    let failed = 0;
    const deadEndpoints: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
            },
            payload,
          );
          sent++;
        } catch (err: any) {
          failed++;
          // Clean up dead subscriptions (browser unsubscribed or endpoint expired)
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            deadEndpoints.push(sub.endpoint);
          }
        }
      }),
    );

    // Batch-delete dead endpoints
    if (deadEndpoints.length > 0) {
      const placeholders = deadEndpoints.map((_, i) => `?${i + 1}`).join(',');
      await c.env.DB.prepare(
        `DELETE FROM push_subscriptions WHERE endpoint IN (${placeholders})`,
      )
        .bind(...deadEndpoints)
        .run();
    }

    return c.json({ sent, failed });
  } catch (err) {
    if (err instanceof HttpError) return c.text(err.message, err.status as 401);
    throw err;
  }
});
