begin;
-- Version matches the migration applied to the Testing database.
-- Kick the authenticated worker after a successful transaction creates new alerts.
-- pg_net sends after commit. If dispatch is unavailable, the minute scheduler retries.
create function testing_push_private.dispatch_booking_alerts()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' and session_user not in ('postgres','supabase_admin') then raise insufficient_privilege;end if;
 if exists(select 1 from new_booking_alerts) then
  perform net.http_post(url:='https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-push-reminders',
   headers:=jsonb_build_object('Content-Type','application/json','x-reminder-token',(select decrypted_secret from vault.decrypted_secrets where name='testing_push_reminder_token' limit 1)),
   body:='{"action":"bookings"}'::jsonb,timeout_milliseconds:=60000);
 end if;
 return null;
exception when others then
 -- Keep a valid booking saved; the durable queue is retried by Cron.
 return null;
end;
$$;
revoke all on function testing_push_private.dispatch_booking_alerts() from public,anon,authenticated;
create trigger testing_support_dispatch_new_booking_alerts after insert on public.testing_support_booking_alerts
referencing new table as new_booking_alerts for each statement execute function testing_push_private.dispatch_booking_alerts();
select cron.schedule('testing-booking-push-reminders','* * * * *',$job$
 select public.testing_support_enqueue_push_reminders();
 select net.http_post(
  url:='https://nmgjkexfgytjivxudsmo.supabase.co/functions/v1/testing-push-reminders',
  headers:=jsonb_build_object('Content-Type','application/json','x-reminder-token',(select decrypted_secret from vault.decrypted_secrets where name='testing_push_reminder_token' limit 1)),
  body:='{"action":"run"}'::jsonb,timeout_milliseconds:=60000
 ) where (select public_key is null from public.testing_support_push_config where id=1)
 or exists(select 1 from public.testing_support_push_deliveries where (state in ('pending','failed') and retry_at<=now() and attempts<12) or (state='sending' and claimed_at<now()-interval '2 minutes'))
 or exists(select 1 from public.testing_support_booking_alerts where (state in ('pending','failed') and retry_at<=now() and attempts<12) or (state='sending' and claimed_at<now()-interval '2 minutes'));
$job$);
commit;
