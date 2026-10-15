begin;
-- Version matches the migration applied to the Testing database.
-- New-booking alerts have their own durable queue, independent of 45-minute reminders.
create table public.testing_support_booking_alerts (
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.testing_support_push_devices(id) on delete cascade,
 document_set_id uuid not null references public.testing_support_document_sets(id) on delete cascade,
 created_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '24 hours',
 state text not null default 'pending' check(state in ('pending','sending','delivered','failed','skipped')),
 attempts integer not null default 0,retry_at timestamptz not null default now(),claim_token uuid,claimed_at timestamptz,delivered_at timestamptz,error_code text,
 unique(device_id,document_set_id)
);
alter table public.testing_support_booking_alerts enable row level security;
revoke all on public.testing_support_booking_alerts from public,anon,authenticated;
grant select,insert,update,delete on public.testing_support_booking_alerts to service_role;
create index testing_support_booking_alerts_due_idx on public.testing_support_booking_alerts(state,retry_at) where state in ('pending','sending','failed');
create index testing_support_booking_alerts_document_idx on public.testing_support_booking_alerts(document_set_id);

alter function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid) rename to testing_support_book_with_documents_email;
create function public.testing_support_book_with_documents(p_data jsonb,p_slots jsonb,p_document_id uuid,p_token_hash text,p_admin boolean default false,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; fresh boolean;
begin
 perform pg_advisory_xact_lock(742903,1);
 fresh:=p_id is null and not p_admin and exists(select 1 from public.testing_support_document_sets where id=p_document_id and attached_request is null);
 result:=public.testing_support_book_with_documents_email(p_data,p_slots,p_document_id,p_token_hash,p_admin,p_id);
 if fresh then
  insert into public.testing_support_booking_alerts(device_id,document_set_id)
  select id,p_document_id from public.testing_support_push_devices where enabled on conflict(device_id,document_set_id) do nothing;
 end if;
 return result;
end;
$$;

create function public.testing_support_claim_booking_alerts(p_limit integer default 20,p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.testing_support_booking_alerts; token uuid; result jsonb:='[]'::jsonb;
begin
 delete from public.testing_support_booking_alerts where created_at<p_now-interval '7 days';
 update public.testing_support_booking_alerts b set state='skipped',claim_token=null
 where state in ('pending','sending','failed') and (expires_at<=p_now or
  not exists(select 1 from public.testing_support_push_devices v where v.id=b.device_id and v.enabled) or
  not exists(select 1 from public.testing_support_appointments a where a.document_set_id=b.document_set_id and a.status='booked' and a.starts_at>p_now));
 for q in select b.* from public.testing_support_booking_alerts b
  where b.attempts<12 and ((b.state in ('pending','failed') and b.retry_at<=p_now) or (b.state='sending' and b.claimed_at<p_now-interval '2 minutes'))
  order by b.created_at,b.id for update skip locked limit least(greatest(p_limit,1),40)
 loop
  token:=gen_random_uuid();update public.testing_support_booking_alerts set state='sending',claim_token=token,claimed_at=p_now,attempts=attempts+1 where id=q.id;
  result:=result||jsonb_build_array(jsonb_build_object('id',q.id,'claimToken',token));
 end loop;return result;
end;
$$;
create function public.testing_support_prepare_booking_alert(p_id uuid,p_claim_token uuid,p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.testing_support_booking_alerts; v public.testing_support_push_devices; a public.testing_support_appointments; times jsonb;
begin
 select * into q from public.testing_support_booking_alerts where id=p_id and state='sending' and claim_token=p_claim_token for update;
 if not found then return null; end if;
 select * into v from public.testing_support_push_devices where id=q.device_id and enabled;
 select * into a from public.testing_support_appointments where document_set_id=q.document_set_id and status='booked' and starts_at>p_now order by starts_at,id limit 1;
 if v.id is null or a.id is null or q.expires_at<=p_now then update public.testing_support_booking_alerts set state='skipped',claim_token=null where id=q.id;return null;end if;
 select jsonb_agg(jsonb_build_object('startsAt',starts_at,'endsAt',ends_at) order by starts_at,id) into times from public.testing_support_appointments where document_set_id=q.document_set_id and status='booked' and starts_at>p_now;
 return jsonb_build_object('endpoint',v.endpoint,'keys',jsonb_build_object('p256dh',v.p256dh,'auth',v.auth),'origin',v.origin,'timezone',v.timezone,
  'appointmentId',a.id,'documentSetId',q.document_set_id,'type',a.booking_type,'name',a.member_name,'date',a.service_date,'times',times,'expiresAt',q.expires_at);
end;
$$;
create function public.testing_support_finish_booking_alert(p_id uuid,p_claim_token uuid,p_result text,p_status integer default null,p_now timestamptz default now())
returns void language plpgsql security invoker set search_path='' as $$
declare q public.testing_support_booking_alerts;
begin
 select * into q from public.testing_support_booking_alerts where id=p_id and state='sending' and claim_token=p_claim_token for update;
 if not found then return;end if;
 if p_result='sent' then
  update public.testing_support_booking_alerts set state='delivered',delivered_at=p_now,claim_token=null,error_code=null where id=q.id;
 elsif p_result='gone' then
  perform public.testing_support_push_disable(q.device_id);
  update public.testing_support_booking_alerts set state='skipped',claim_token=null,error_code='subscription_expired' where device_id=q.device_id and state<>'delivered';
 else
  update public.testing_support_booking_alerts set state='failed',claim_token=null,error_code=coalesce(p_status::text,'network'),retry_at=p_now+make_interval(secs=>least(900,60*(2^least(q.attempts-1,4))::integer)) where id=q.id;
 end if;
end;
$$;

create function public.testing_support_member_edit(p_email text,p_id uuid,p_revision integer,p_phone text,p_notes text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; phone text:=trim(p_phone); member_notes text:=coalesce(trim(p_notes),'');
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() then raise exception using errcode='22023',message='Only upcoming bookings can be changed';end if;
 if a.revision is distinct from p_revision then raise exception using errcode='40001',message='Booking changed. Refresh before saving';end if;
 if phone is null or char_length(phone)>30 or phone !~ '^[+()0-9[:space:]-]{7,30}$' or regexp_replace(phone,'[^0-9]','','g') !~ '^[0-9]{7,15}$' or char_length(member_notes)>2000 then raise exception using errcode='22023',message='Enter a valid WhatsApp number and notes up to 2000 characters';end if;
 update public.testing_support_appointments set whatsapp=phone,notes=member_notes,revision=revision+1,updated_at=now() where id=a.id returning * into a;
 return to_jsonb(a);
end;
$$;
revoke all on function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid),public.testing_support_claim_booking_alerts(integer,timestamptz),public.testing_support_prepare_booking_alert(uuid,uuid,timestamptz),public.testing_support_finish_booking_alert(uuid,uuid,text,integer,timestamptz),public.testing_support_member_edit(text,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid),public.testing_support_claim_booking_alerts(integer,timestamptz),public.testing_support_prepare_booking_alert(uuid,uuid,timestamptz),public.testing_support_finish_booking_alert(uuid,uuid,text,integer,timestamptz),public.testing_support_member_edit(text,uuid,integer,text,text) to service_role;
notify pgrst,'reload schema';
commit;
