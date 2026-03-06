-- Supabase Migration: Increment agent_memory access counts
-- Creates an RPC function to increment access_count and update last_accessed_at for a list of memory IDs.

CREATE OR REPLACE FUNCTION increment_memory_access(memory_ids uuid[])
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE agent_memory
  SET
    access_count = COALESCE(access_count, 0) + 1,
    last_accessed_at = NOW()
  WHERE id = ANY(memory_ids);
END;
$$;
