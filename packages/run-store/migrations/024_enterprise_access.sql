CREATE TABLE account_sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX account_sessions_owner ON account_sessions(account_id);
CREATE TABLE login_windows (
  key text NOT NULL, window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0, PRIMARY KEY(key,window_start)
);
CREATE FUNCTION revoke_changed_account_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
     OR NEW.role IS DISTINCT FROM OLD.role THEN
    UPDATE account_sessions SET revoked_at=now() WHERE account_id=NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revoke_account_sessions AFTER UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION revoke_changed_account_sessions();

CREATE TABLE account_policies (
  scope text PRIMARY KEY,
  policy jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_policy_audit (
  id bigserial PRIMARY KEY, actor_id text NOT NULL, scope text NOT NULL,
  before_policy jsonb NOT NULL, after_policy jsonb NOT NULL,
  action text NOT NULL DEFAULT 'policy', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE account_operations (
  operation_id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  metric text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','completed','released')),
  admitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  lease_until timestamptz,
  worker_id text,
  admission_window jsonb,
  result_ref text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_operations_usage ON account_operations(owner_id,metric,status,admitted_at);
CREATE TABLE account_storage_reservations (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  bytes bigint NOT NULL CHECK(bytes>=0), expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE provider_attempts ADD COLUMN connection_id text;
ALTER TABLE provider_attempts ADD COLUMN connection_scope text CHECK(connection_scope IN ('personal','shared','server'));

-- Backfill activity, never policies. No account acquires a limit through migration.
INSERT INTO account_operations(operation_id,owner_id,metric,status,admitted_at,completed_at)
SELECT b.id::text,b.owner_id,'generation',CASE WHEN b.status='done' THEN 'completed' ELSE 'released' END,
  b.created_at,CASE WHEN b.status='done' THEN b.updated_at ELSE NULL END
FROM generation_builds b JOIN app_users u ON u.id=b.owner_id
WHERE b.status IN ('done','failed','stopped','interrupted');

CREATE FUNCTION complete_chat_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE account_operations o SET status=CASE WHEN message->>'status'='done' THEN 'completed' ELSE 'released' END,
    completed_at=CASE WHEN message->>'status'='done' THEN now() ELSE NULL END,
    worker_id=NULL,lease_until=NULL,updated_at=now()
  FROM jsonb_array_elements(NEW.messages) message
  WHERE o.owner_id=NEW.owner_id AND o.metric='assistant-response' AND o.result_ref=message->>'id'
    AND o.status='active' AND message->>'role'='assistant' AND message->>'status' IN ('done','failed','cancelled');
  RETURN NEW;
END;
$$;
CREATE TRIGGER complete_chat_operation AFTER UPDATE OF messages ON chats
FOR EACH ROW EXECUTE FUNCTION complete_chat_operation();
CREATE FUNCTION complete_editor_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE account_operations SET status=CASE WHEN NEW.outcome->>'kind'='saved' THEN 'completed' ELSE 'released' END,
    completed_at=CASE WHEN NEW.outcome->>'kind'='saved' THEN now() ELSE NULL END,
    worker_id=NULL,lease_until=NULL,updated_at=now()
  WHERE operation_id='edit:'||NEW.account_id||':'||NEW.deck_id||':'||NEW.idempotency_key::text AND status='active';
  RETURN NEW;
END;
$$;
CREATE TRIGGER complete_editor_operation AFTER INSERT ON editor_idempotency
FOR EACH ROW EXECUTE FUNCTION complete_editor_operation();
