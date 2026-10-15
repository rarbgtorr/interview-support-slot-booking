begin;
-- Private, Testing-only admin devices and reminder delivery records.
create table public.testing_support_push_config (
 id integer primary key check(id=1), public_key text, private_secret_id uuid,
 token_hash text, last_checked_at timestamptz, last_worker_at timestamptz
);
insert into public.testing_support_push_config(id) values(1);
create table public.testing_support_push_devices (
 id uuid primary key default gen_random_uuid(), endpoint text not null unique,
 p256dh text not null, auth text not null, origin text not null, timezone text not null,
 label text not null, enabled boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 last_test_requested_at timestamptz, last_test_at timestamptz, last_reminder_at timestamptz,
 error_code text,
 check(endpoint ~ '^https://fcm[.]googleapis[.]com/(fcm/send|wp)/[A-Za-z0-9_:/=-]+$' and char_length(endpoint)<=4096),
 check(p256dh ~ '^[A-Za-z0-9_-]{87}$'), check(auth ~ '^[A-Za-z0-9_-]{22}$'),
 check(char_length(origin)<=200 and char_length(timezone)<=100 and char_length(label)<=50)
);
create table public.testing_support_push_deliveries (
 id uuid primary key default gen_random_uuid(), device_id uuid not null references public.testing_support_push_devices(id) on delete cascade,
 appointment_id uuid not null references public.testing_support_appointments(id) on delete cascade,
 starts_at timestamptz not null, state text not null default 'pending' check(state in ('pending','sending','delivered','failed','skipped')),
 attempts integer not null default 0, retry_at timestamptz not null default now(),
 claim_token uuid, claimed_at timestamptz, delivered_at timestamptz, error_code text,
 unique(device_id,appointment_id,starts_at)
);
create index testing_support_push_due_idx on public.testing_support_push_deliveries(state,retry_at,starts_at) where state in ('pending','sending','failed');
alter table public.testing_support_push_config enable row level security;
alter table public.testing_support_push_devices enable row level security;
alter table public.testing_support_push_deliveries enable row level security;
revoke all on public.testing_support_push_config,public.testing_support_push_devices,public.testing_support_push_deliveries from public,anon,authenticated;
grant select,insert,update,delete on public.testing_support_push_config,public.testing_support_push_devices,public.testing_support_push_deliveries to service_role;

create function public.testing_support_push_status(p_endpoint text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object('publicKey',c.public_key,'configured',c.public_key is not null,'lastCheckedAt',c.last_checked_at,
 'devices',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'current',d.endpoint=p_endpoint,'lastTestAt',d.last_test_at,'lastReminderAt',d.last_reminder_at,'errorCode',d.error_code) order by d.created_at) from public.testing_support_push_devices d where d.enabled),'[]'::jsonb))
 from public.testing_support_push_config c where c.id=1;
$$;
create function public.testing_support_push_subscribe(p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare device public.testing_support_push_devices; n integer;
begin
 perform pg_advisory_xact_lock(742905,1);
 select * into device from public.testing_support_push_devices where endpoint=p_data->>'endpoint' for update;
 if not coalesce(device.enabled,false) and (select count(*) from public.testing_support_push_devices where enabled)>=2 then
  raise exception using errcode='22023',message='Two devices are already enabled. Disable one under Manage devices first';
 end if;
 select count(*)+1 into n from public.testing_support_push_devices;
 insert into public.testing_support_push_devices(endpoint,p256dh,auth,origin,timezone,label)
 values(p_data->>'endpoint',p_data->>'p256dh',p_data->>'auth',p_data->>'origin',p_data->>'timezone',coalesce(device.label,'Android phone '||n))
 on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,origin=excluded.origin,timezone=excluded.timezone,enabled=true,error_code=null,updated_at=now();
 return public.testing_support_push_status(p_data->>'endpoint');
end;
$$;
create function public.testing_support_push_disable(p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 update public.testing_support_push_devices set enabled=false,updated_at=now() where id=p_id;
 update public.testing_support_push_deliveries set state='skipped',claim_token=null where device_id=p_id and state<>'delivered';
 return jsonb_build_object('ok',true);
end;
$$;
create function public.testing_support_push_test_claim(p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.testing_support_push_devices;
begin
 select * into d from public.testing_support_push_devices where id=p_id and enabled for update;
 if not found then raise exception using errcode='P0002',message='Enable reminders on this device first'; end if;
 if d.last_test_requested_at>now()-interval '1 minute' then raise exception using errcode='22023',message='Wait one minute before sending another test notification'; end if;
 update public.testing_support_push_devices set last_test_requested_at=now() where id=p_id;
 return to_jsonb(d);
end;
$$;

create function public.testing_support_enqueue_push_reminders(p_now timestamptz default now())
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 update public.testing_support_push_config set last_checked_at=p_now where id=1;
 delete from public.testing_support_push_deliveries where starts_at<p_now-interval '7 days';
 update public.testing_support_push_deliveries d set state='skipped',claim_token=null
 where d.state in ('pending','sending','failed') and (d.starts_at<=p_now or
  not exists(select 1 from public.testing_support_push_devices v where v.id=d.device_id and v.enabled) or
  not exists(select 1 from public.testing_support_appointments a where a.id=d.appointment_id and a.status='booked' and a.starts_at=d.starts_at));
 insert into public.testing_support_push_deliveries(device_id,appointment_id,starts_at,retry_at)
 select v.id,a.id,a.starts_at,p_now from public.testing_support_push_devices v cross join public.testing_support_appointments a
 where v.enabled and a.status='booked' and a.starts_at>p_now and a.starts_at<=p_now+interval '45 minutes'
 and not exists(select 1 from public.testing_support_appointments prev where a.document_set_id is not null and prev.document_set_id=a.document_set_id and prev.booking_type=a.booking_type and prev.status='booked' and prev.ends_at=a.starts_at)
 on conflict(device_id,appointment_id,starts_at) do nothing;
 get diagnostics n=row_count;return n;
end;
$$;
create function public.testing_support_claim_push_reminders(p_limit integer default 20,p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.testing_support_push_deliveries; token uuid; result jsonb:='[]'::jsonb;
begin
 perform public.testing_support_enqueue_push_reminders(p_now);
 for d in select q.* from public.testing_support_push_deliveries q join public.testing_support_push_devices v on v.id=q.device_id
  where v.enabled and q.starts_at>p_now and q.attempts<12 and ((q.state in ('pending','failed') and q.retry_at<=p_now) or (q.state='sending' and q.claimed_at<p_now-interval '2 minutes'))
  order by q.starts_at,q.id for update of q skip locked limit least(greatest(p_limit,1),40)
 loop
  token:=gen_random_uuid();
  update public.testing_support_push_deliveries set state='sending',claim_token=token,claimed_at=p_now,attempts=attempts+1 where id=d.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',d.id,'claimToken',token));
 end loop;return result;
end;
$$;
create function public.testing_support_prepare_push_reminder(p_id uuid,p_claim_token uuid,p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.testing_support_push_deliveries; v public.testing_support_push_devices; a public.testing_support_appointments; finish timestamptz; slots integer;
begin
 select * into q from public.testing_support_push_deliveries where id=p_id and state='sending' and claim_token=p_claim_token for update;
 if not found then return null; end if;
 select * into v from public.testing_support_push_devices where id=q.device_id and enabled;
 select * into a from public.testing_support_appointments where id=q.appointment_id and status='booked' and starts_at=q.starts_at and starts_at>p_now;
 if v.id is null or a.id is null or exists(select 1 from public.testing_support_appointments prev where a.document_set_id is not null and prev.document_set_id=a.document_set_id and prev.booking_type=a.booking_type and prev.status='booked' and prev.ends_at=a.starts_at) then
  update public.testing_support_push_deliveries set state='skipped',claim_token=null where id=q.id;return null;
 end if;
 select greatest(a.ends_at,coalesce(max(next.ends_at),a.ends_at)),1+count(next.id) into finish,slots from public.testing_support_appointments next
 where a.document_set_id is not null and next.document_set_id=a.document_set_id and next.booking_type=a.booking_type and next.status='booked' and next.starts_at=a.ends_at;
 return jsonb_build_object('deviceId',v.id,'endpoint',v.endpoint,'keys',jsonb_build_object('p256dh',v.p256dh,'auth',v.auth),'origin',v.origin,'timezone',v.timezone,
  'appointmentId',a.id,'startsAt',a.starts_at,'endsAt',finish,'slotCount',slots,'type',a.booking_type,'name',a.member_name,'date',a.service_date,'startMinute',a.start_minute);
end;
$$;
create function public.testing_support_finish_push_reminder(p_id uuid,p_claim_token uuid,p_result text,p_status integer default null,p_now timestamptz default now())
returns void language plpgsql security invoker set search_path='' as $$
declare q public.testing_support_push_deliveries;
begin
 select * into q from public.testing_support_push_deliveries where id=p_id and state='sending' and claim_token=p_claim_token for update;
 if not found then return; end if;
 if p_result='sent' then
  update public.testing_support_push_deliveries set state='delivered',delivered_at=p_now,claim_token=null,error_code=null where id=q.id;
  update public.testing_support_push_devices set last_reminder_at=p_now,error_code=null where id=q.device_id;
 elsif p_result='gone' then
  perform public.testing_support_push_disable(q.device_id);
  update public.testing_support_push_devices set error_code='subscription_expired' where id=q.device_id;
 else
  update public.testing_support_push_deliveries set state='failed',claim_token=null,error_code=coalesce(p_status::text,'network'),retry_at=p_now+make_interval(secs=>least(900,60*(2^least(q.attempts-1,4))::integer)) where id=q.id;
  update public.testing_support_push_devices set error_code='delivery_retrying' where id=q.device_id;
 end if;
end;
$$;
revoke all on function public.testing_support_push_status(text),public.testing_support_push_subscribe(jsonb),public.testing_support_push_disable(uuid),public.testing_support_push_test_claim(uuid),public.testing_support_enqueue_push_reminders(timestamptz),public.testing_support_claim_push_reminders(integer,timestamptz),public.testing_support_prepare_push_reminder(uuid,uuid,timestamptz),public.testing_support_finish_push_reminder(uuid,uuid,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.testing_support_push_status(text),public.testing_support_push_subscribe(jsonb),public.testing_support_push_disable(uuid),public.testing_support_push_test_claim(uuid),public.testing_support_enqueue_push_reminders(timestamptz),public.testing_support_claim_push_reminders(integer,timestamptz),public.testing_support_prepare_push_reminder(uuid,uuid,timestamptz),public.testing_support_finish_push_reminder(uuid,uuid,text,integer,timestamptz) to service_role;
commit;
