-- Per-(app, user, day) usage rollup. The grain that the payout math needs:
-- monthly cron sums these to compute each creator's share of the subscriber pool.
CREATE TABLE usage_daily (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,                -- gh:<id>
  day TEXT NOT NULL,                    -- YYYY-MM-DD in UTC
  session_seconds INTEGER NOT NULL DEFAULT 0,
  api_calls INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,           -- epoch ms (most recent ping)
  PRIMARY KEY (app_id, user_id, day)
);
CREATE INDEX idx_usage_daily_app_day ON usage_daily(app_id, day);
CREATE INDEX idx_usage_daily_user_day ON usage_daily(user_id, day);
