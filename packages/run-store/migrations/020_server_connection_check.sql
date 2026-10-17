-- The last check of the connection from the server environment, by its address. It used to live
-- only in the API's memory, so a restart forgot the models and what the provider said about them.
ALTER TABLE model_server_connection ADD COLUMN IF NOT EXISTS last_check jsonb;
