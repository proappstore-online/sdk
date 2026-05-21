-- BYO custom domains for Pro apps. Owner can attach one or more hostnames
-- (apex or subdomain) to their Pro app; CF Pages handles cert provisioning
-- once the owner adds the DNS records CF requires. Storage is intentionally
-- thin — CF is the source of truth for verification + cert state; this
-- table caches the last known state and the DNS records to show the owner.
CREATE TABLE IF NOT EXISTS app_custom_domains (
  app_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  -- Our high-level status: 'pending' (DNS not yet matching) | 'active' | 'failed'.
  status TEXT NOT NULL DEFAULT 'pending',
  -- Raw CF verification_status, for debugging when our status disagrees.
  cf_status TEXT,
  -- JSON: { verification_data, validation_data, certificate_authority, ... }
  -- straight from CF's POST/GET response. Surfaced to the CLI so the owner
  -- knows which CNAME / A / TXT records to add at their registrar.
  cf_payload TEXT,
  added_at INTEGER NOT NULL,
  verified_at INTEGER,
  PRIMARY KEY (app_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_app_custom_domains_app ON app_custom_domains(app_id);
