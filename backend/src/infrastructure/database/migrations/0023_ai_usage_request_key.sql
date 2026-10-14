-- v4: the same photo parsed again (the app was closed and reopened while it was being read) gets the saved answer
-- instead of a new model call. request_key identifies what was asked: the photo and the settings that shape the answer.
ALTER TABLE ai_usage ADD COLUMN request_key text;
CREATE INDEX ai_usage_request_key_idx ON ai_usage (group_id, request_key) WHERE request_key IS NOT NULL;
