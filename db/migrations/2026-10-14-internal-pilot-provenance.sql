-- Explicit guarded runner only. Historical public invitation values are preserved.
ALTER TABLE trial_invitations
  MODIFY COLUMN trial_request_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN last_sent_at DATETIME(6) NULL,
  ADD COLUMN provenance VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PUBLIC_TRIAL_REQUEST',
  ADD COLUMN internal_key_hash BINARY(32) NULL,
  ADD COLUMN internal_reason VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD UNIQUE KEY uq_trial_invitation_internal_key (internal_key_hash),
  ADD CONSTRAINT chk_trial_invitation_provenance CHECK (
    (provenance = 'PUBLIC_TRIAL_REQUEST' AND trial_request_id IS NOT NULL AND internal_key_hash IS NULL AND internal_reason IS NULL AND last_sent_at IS NOT NULL)
    OR
    (provenance = 'INTERNAL_PILOT' AND trial_request_id IS NULL AND internal_key_hash IS NOT NULL AND internal_reason IS NOT NULL AND CHAR_LENGTH(TRIM(internal_reason)) > 0 AND last_sent_at IS NULL)
  );
-- @statement
CREATE TRIGGER trg_trial_invitation_provenance_immutable BEFORE UPDATE ON trial_invitations FOR EACH ROW
BEGIN
  IF NOT (OLD.provenance <=> NEW.provenance) OR NOT (OLD.internal_key_hash <=> NEW.internal_key_hash)
    OR NOT (CAST(OLD.internal_reason AS BINARY) <=> CAST(NEW.internal_reason AS BINARY)) OR NOT (OLD.trial_request_id <=> NEW.trial_request_id)
    OR NOT (OLD.approved_by_platform_admin_id <=> NEW.approved_by_platform_admin_id)
    OR NOT (OLD.company_id <=> NEW.company_id) OR NOT (OLD.owner_user_id <=> NEW.owner_user_id)
    OR NOT (OLD.approval_idempotency_key <=> NEW.approval_idempotency_key) OR NOT (OLD.approval_intent_hash <=> NEW.approval_intent_hash) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVITATION_PROVENANCE_IMMUTABLE';
  END IF;
END;
-- @statement
CREATE TRIGGER trg_trial_invitation_internal_delete BEFORE DELETE ON trial_invitations FOR EACH ROW
BEGIN
  IF OLD.provenance = 'INTERNAL_PILOT' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVITATION_PROVENANCE_IMMUTABLE';
  END IF;
END;
-- @statement
CREATE TRIGGER trg_trial_internal_no_delivery_insert BEFORE INSERT ON trial_invitation_operations FOR EACH ROW
BEGIN
  IF NEW.operation_type IN ('approve','resend') AND EXISTS (SELECT 1 FROM trial_invitations WHERE id = NEW.trial_invitation_id AND provenance = 'INTERNAL_PILOT') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INTERNAL_PILOT_NO_DELIVERY';
  END IF;
END;
-- @statement
CREATE TRIGGER trg_trial_internal_no_delivery_update BEFORE UPDATE ON trial_invitation_operations FOR EACH ROW
BEGIN
  IF NEW.operation_type IN ('approve','resend') AND EXISTS (SELECT 1 FROM trial_invitations WHERE id = NEW.trial_invitation_id AND provenance = 'INTERNAL_PILOT') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INTERNAL_PILOT_NO_DELIVERY';
  END IF;
END;
