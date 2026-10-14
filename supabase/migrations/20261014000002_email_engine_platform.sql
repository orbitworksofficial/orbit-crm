-- ============================================================================
-- Orbit Works CRM — Email Engine connection storage
-- ============================================================================
-- The Email Engine's URL and shared secret need the same treatment as the ad
-- platform credentials: encrypted at rest, editable in Settings, never in the
-- environment. Rather than a second table with its own encryption and its own
-- RLS to keep in step, it reuses ad_credentials — the columns already mean the
-- right things (account_id holds the base URL, access_token the secret).
--
-- The cost is a slightly loose table name. The alternative is duplicating the
-- encryption, the hint, the active flag, the error field and four policies to
-- store two values.
-- ============================================================================

alter type ad_platform add value if not exists 'email_engine';

comment on type ad_platform is
  'Connected external services. Named for its original use; also carries the Email Engine, which stores a base URL and a shared secret in the same shape.';
