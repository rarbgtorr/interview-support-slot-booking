-- Testing-only scheduler: no production booking tables or buckets are touched.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create table if not exists public.testing_support_cleanup_config(id integer primary key check(id=1),token_hash text not null);
alter table public.testing_support_cleanup_config enable row level security;
revoke all on public.testing_support_cleanup_config from public,anon,authenticated;
grant select on public.testing_support_cleanup_config to service_role;
do $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='testing_document_cleanup_token' limit 1;
 if token is null then
  token:=encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(token,'testing_document_cleanup_token','Private Testing document cleanup credential');
 end if;
 insert into public.testing_support_cleanup_config(id,token_hash) values(1,encode(extensions.digest(token,'sha256'),'hex')) on conflict(id) do update set token_hash=excluded.token_hash;
end;
$$;
select cron.schedule('testing-booking-document-cleanup','*/5 * * * *',$job$
 select net.http_post(
  url:='https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-document-cleanup',
  headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='testing_document_cleanup_token' limit 1)),
  body:='{}'::jsonb,timeout_milliseconds:=10000
 ) where exists(select 1 from public.testing_support_document_sets d where d.status='deleting' or (d.status in ('pending','attached') and public.testing_support_document_expiry(d.id)<=now()));
$job$);
notify pgrst,'reload schema';
