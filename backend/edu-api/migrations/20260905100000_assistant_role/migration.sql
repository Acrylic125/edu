UPDATE topic_message SET role = 'assistant' WHERE role = 'agent';
ALTER TABLE model_usage ADD COLUMN cost_source text NOT NULL DEFAULT 'unavailable';
