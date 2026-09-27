-- RH-only canonical observations. No changes to legacy financial rows or ARC tables.
create table if not exists public.rh_lending_checkpoints (
 chain_id bigint not null check(chain_id=46630),
 pair_address text not null check(pair_address ~ '^0x[0-9a-f]{40}$'),
 start_block bigint not null check(start_block>=0),
 descriptor_hash text not null check(descriptor_hash ~ '^0x[0-9a-f]{64}$'),
 block_number bigint not null check(block_number>=start_block),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 reconciled boolean not null,
 updated_at timestamptz not null default now(),
 primary key(chain_id,pair_address)
);
create table if not exists public.rh_lending_batches (
 chain_id bigint not null check(chain_id=46630),
 pair_address text not null check(pair_address ~ '^0x[0-9a-f]{40}$'),
 from_block bigint not null check(from_block>=0),
 to_block bigint not null check(to_block>=from_block),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 primary key(chain_id,pair_address,to_block)
);
create table if not exists public.rh_lending_events (
 chain_id bigint not null check(chain_id=46630),
 pair_address text not null check(pair_address ~ '^0x[0-9a-f]{40}$'),
 tx_hash text not null check(tx_hash ~ '^0x[0-9a-f]{64}$'),
 log_index integer not null check(log_index>=0),
 block_number bigint not null check(block_number>=0),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 user_address text not null check(user_address ~ '^0x[0-9a-f]{40}$'),
 action text not null check(action in ('deposit','withdraw','borrow','repay','liquidation')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 primary key(chain_id,pair_address,tx_hash,log_index)
);
create index if not exists rh_lending_events_user_block on public.rh_lending_events(chain_id,pair_address,user_address,block_number desc,log_index desc);
create table if not exists public.rh_lending_accounts (
 chain_id bigint not null check(chain_id=46630),
 pair_address text not null check(pair_address ~ '^0x[0-9a-f]{40}$'),
 user_address text not null check(user_address ~ '^0x[0-9a-f]{40}$'),
 collateral_raw numeric(78,0) not null check(collateral_raw>=0 and collateral_raw<power(2::numeric,256)),
 debt_raw numeric(78,0) not null check(debt_raw>=0 and debt_raw<power(2::numeric,256)),
 block_number bigint not null check(block_number>=0),
 block_hash text not null check(block_hash ~ '^0x[0-9a-f]{64}$'),
 primary key(chain_id,pair_address,user_address)
);
alter table public.rh_lending_checkpoints enable row level security;
alter table public.rh_lending_batches enable row level security;
alter table public.rh_lending_events enable row level security;
alter table public.rh_lending_accounts enable row level security;
revoke all on public.rh_lending_checkpoints,public.rh_lending_batches,public.rh_lending_events,public.rh_lending_accounts from public,anon,authenticated;
-- No browser write or broad public-read policy. Read API integration is a separate step.
