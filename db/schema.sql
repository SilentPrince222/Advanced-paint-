-- SPEC §3 Aurora PostgreSQL schema (DDL)
-- Run: psql "$DATABASE_URL" -f db/schema.sql

-- decision #4: single demo workspace — NO users/orgs.

create table flow (
  id                text primary key,
  default_branch_id text,        -- set after branch exists (see POST /flows insert sequence, §2.4)
  name              text not null,
  created_at        timestamptz not null default now()
);

create table branch (
  id             text primary key,
  flow_id        text not null references flow(id),
  name           text not null,
  head_commit_id text,        -- soft pointer; commit↔branch is circular, resolved by app-level write
  base_commit_id text         --   ordering (a DEFERRABLE FK is the production hardening)
);

create table commit (
  id             text primary key,                 -- nanoid (not a content hash)
  flow_id        text not null references flow(id),
  branch_id      text not null references branch(id),
  parent_id      text references commit(id),       -- DAG
  author_note    text not null default '',
  created_at     timestamptz not null default now(),
  graph_snapshot jsonb not null                    -- FULL snapshot ("photos")
);
-- GIN supports containment queries, e.g. "commits containing a stripe.charge node":
--   where graph_snapshot @> '{"nodes":[{"type":"action.stripe.charge"}]}'
-- Unused by the demo's PK-only reads; kept for the "and here's where it goes" story.
create index commit_snapshot_gin on commit using gin (graph_snapshot);
create index commit_branch_idx  on commit (branch_id, created_at desc);

-- LIVE working copy of each branch head (normalized → FK integrity, joins, the relational story)
create table node (
  id             text not null,
  branch_id      text not null references branch(id),
  type           text not null,
  params         jsonb not null default '{}',
  credential_ref text,                              -- opaque vault id, never a secret
  is_draft_safe  boolean not null default true,
  primary key (branch_id, id)
);

create table edge (
  id            text not null,
  branch_id     text not null references branch(id),
  from_node_id  text not null,
  to_node_id    text not null,
  condition     text,
  primary key (branch_id, id),
  foreign key (branch_id, from_node_id) references node(branch_id, id) on delete cascade,
  foreign key (branch_id, to_node_id)   references node(branch_id, id) on delete cascade
);

create table node_view (
  branch_id text not null references branch(id),
  node_id   text not null,            -- logical id (NOT a FK — view & logic are deliberately decoupled)
  x         double precision not null,
  y         double precision not null,
  width     double precision not null default 160,
  height    double precision not null default 80,
  color     text,
  primary key (branch_id, node_id)
);

-- decision #5: append-only, enforced by the DB itself
create table exec_log (
  id          text primary key,
  flow_id     text not null references flow(id),
  commit_id   text not null references commit(id),  -- which version was live
  node_id     text not null,
  action_type text not null,
  request     jsonb not null,
  response    jsonb not null,
  status      text not null check (status in ('success','failure')),
  created_at  timestamptz not null default now()
);

-- least-privilege app role (the Vercel connection assumes this; granted rds_iam for IAM auth)
create role app_role login;
grant rds_iam to app_role;
grant connect on database postgres to app_role;
grant select, insert, update, delete on flow, branch, commit, node, edge, node_view to app_role;
grant select, insert on exec_log to app_role;                 -- append-only: no update/delete/truncate
revoke update, delete, truncate on exec_log from app_role;

create or replace function block_exec_log_mutation() returns trigger as $$
begin
  raise exception 'exec_log is append-only';
end; $$ language plpgsql;
create trigger exec_log_no_update    before update or delete on exec_log
  for each row       execute function block_exec_log_mutation();
create trigger exec_log_no_truncate  before truncate         on exec_log
  for each statement execute function block_exec_log_mutation();   -- TRUNCATE is a separate trigger event
