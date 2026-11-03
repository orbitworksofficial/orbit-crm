-- ============================================================================
-- Orbit Works CRM — Resend credentials
-- ============================================================================
-- The lead-alert sender needs an API key stored the same way as every other
-- secret: encrypted, editable in Settings, never in the environment. It reuses
-- ad_credentials for the same reason the Email Engine does — the columns
-- already mean the right things, and a separate table would duplicate the
-- encryption, the hint, the active flag and four policies to hold two values.
--
-- account_id holds the From address; config holds the CRM's own base URL, used
-- for the "open in the CRM" link.
-- ============================================================================

alter type ad_platform add value if not exists 'resend';
