begin;
-- Vault access stays inside a private schema. Public wrappers are service-role-only.
create schema if not exists testing_push_private;
revoke all on schema testing_push_private from public,anon,authenticated;
grant usage on schema testing_push_private to service_role;
create function testing_push_private.gateway()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' and session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 return jsonb_build_object('url','https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-push-reminders','token',(select decrypted_secret from vault.decrypted_secrets where name='testing_push_reminder_token' limit 1));
end;
$$;
create function testing_push_private.runtime()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' and session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 return (select jsonb_build_object('publicKey',c.public_key,'privateKey',v.decrypted_secret,'subject','https://testing--interview-slot-booking.netlify.app') from public.testing_support_push_config c left join vault.decrypted_secrets v on v.id=c.private_secret_id where c.id=1);
end;
$$;
create function testing_push_private.install(p_public text,p_private text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
 if current_setting('role',true)<>'service_role' and session_user not in ('postgres','supabase_admin') then raise insufficient_privilege; end if;
 if p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private !~ '^[A-Za-z0-9_-]{43}$' then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(742905,2);
 if (select public_key from public.testing_support_push_config where id=1) is null then
  select vault.create_secret(p_private,'testing_push_vapid_private','Testing admin Web Push signing key') into secret_id;
  update public.testing_support_push_config set public_key=p_public,private_secret_id=secret_id where id=1;
 end if;
 return testing_push_private.runtime();
end;
$$;
revoke all on function testing_push_private.gateway(),testing_push_private.runtime(),testing_push_private.install(text,text) from public,anon,authenticated;
grant execute on function testing_push_private.gateway(),testing_push_private.runtime(),testing_push_private.install(text,text) to service_role;
create function public.testing_support_push_gateway_config() returns jsonb language sql security invoker set search_path='' as $$ select testing_push_private.gateway(); $$;
create function public.testing_support_push_runtime() returns jsonb language sql security invoker set search_path='' as $$ select testing_push_private.runtime(); $$;
create function public.testing_support_push_install(p_public text,p_private text) returns jsonb language sql security invoker set search_path='' as $$ select testing_push_private.install(p_public,p_private); $$;
revoke all on function public.testing_support_push_gateway_config(),public.testing_support_push_runtime(),public.testing_support_push_install(text,text) from public,anon,authenticated;
grant execute on function public.testing_support_push_gateway_config(),public.testing_support_push_runtime(),public.testing_support_push_install(text,text) to service_role;
do $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='testing_push_reminder_token' limit 1;
 if token is null then token:=encode(extensions.gen_random_bytes(32),'hex');perform vault.create_secret(token,'testing_push_reminder_token','Private Testing reminder scheduler credential');end if;
 update public.testing_support_push_config set token_hash=encode(extensions.digest(token,'sha256'),'hex') where id=1;
end;
$$;
select cron.schedule('testing-booking-push-reminders','* * * * *',$job$
 select public.testing_support_enqueue_push_reminders();
 select net.http_post(
  url:='https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-push-reminders',
  headers:=jsonb_build_object('Content-Type','application/json','x-reminder-token',(select decrypted_secret from vault.decrypted_secrets where name='testing_push_reminder_token' limit 1)),
  body:='{"action":"run"}'::jsonb,timeout_milliseconds:=60000
 ) where (select public_key is null from public.testing_support_push_config where id=1) or exists(select 1 from public.testing_support_push_deliveries where (state in ('pending','failed') and retry_at<=now() and attempts<12) or (state='sending' and claimed_at<now()-interval '2 minutes'));
$job$);
notify pgrst,'reload schema';
commit;
