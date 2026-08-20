-- =============================================================================
-- Test-only. Not part of the application schema, and must never be run against
-- a Supabase project.
--
-- supabase/schema.sql is written for Supabase, which supplies three roles and
-- an auth.jwt() function before any migration runs. This file recreates that
-- much of Supabase on a plain PostgreSQL server so tests/sql.test.js can apply
-- the real schema file and check what it actually does.
--
-- The default privileges below matter: Supabase grants ALL on every new table
-- in the public schema to anon and authenticated. Granting the same here is
-- what makes the REVOKEs in schema.sql meaningful — without it the tests would
-- pass against a database that was never open in the first place.
-- =============================================================================

drop schema if exists public cascade;
create schema public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- Supabase's auth.jwt(): the verified JWT payload, put on the connection by
-- PostgREST as a GUC before it runs the request.
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim',  true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
