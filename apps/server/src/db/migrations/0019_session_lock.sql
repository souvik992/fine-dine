-- 0019_session_lock.sql — the Lock button (as in Tiffin POS): a locked sign-in stays signed in but answers
-- UNAUTHENTICATED { sessionLocked } until the same person types their PIN (POST /v1/session/unlock). NULL = not locked.
ALTER TABLE user_session ADD COLUMN locked_at TEXT;
