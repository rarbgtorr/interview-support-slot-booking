-- Admin-only customer manager. These support_* tables leave older interview_* data untouched.
-- Run the entire script in the SQL Editor of the new app's Supabase project.
begin;
create table if not exists public.support_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  phone text not null check (char_length(phone) between 7 and 30),
  phone_key text generated always as (regexp_replace(phone,'[^0-9]','','g')) stored unique,
  service_interest text not null default '' check (char_length(service_interest)<=150),
  timezone text not null default 'Asia/Kolkata',
  stage text not null default 'new' check (stage in ('new','demo_booked','demo_completed','interested','follow_up','not_interested','interview_booked','closed')),
  notes text not null default '' check (char_length(notes)<=3000),
  follow_up_date date,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(phone_key) between 7 and 15)
);
create table if not exists public.support_appointments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.support_customers(id),
  booking_type text not null check (booking_type in ('demo','interview')),
  service_date date not null,
  start_minute integer not null check (start_minute between 420 and 1590 and start_minute%30=0),
  duration_minutes integer not null check (duration_minutes in (30,60)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  company text not null default '' check (char_length(company)<=150),
  role text not null default '' check (char_length(role)<=150),
  round text not null default '' check (char_length(round)<=100),
  notes text not null default '' check (char_length(notes)<=2000),
  status text not null default 'booked' check (status in ('booked','completed','cancelled','no_show')),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_minute+duration_minutes<=1620),
  check (booking_type<>'demo' or duration_minutes=60),
  check (ends_at=starts_at+duration_minutes*interval '1 minute')
);
create index if not exists support_appointments_customer on public.support_appointments(customer_id,starts_at desc);
create index if not exists support_appointments_date on public.support_appointments(service_date,start_minute);
create index if not exists support_customers_follow_up on public.support_customers(follow_up_date) where follow_up_date is not null;
create table if not exists public.support_slot_reservations (
  service_date date not null,
  start_minute integer not null check (start_minute between 420 and 1590 and start_minute%30=0),
  kind text not null check (kind in ('booked','blocked')),
  appointment_id uuid references public.support_appointments(id),
  primary key(service_date,start_minute),
  check ((kind='booked' and appointment_id is not null) or (kind='blocked' and appointment_id is null))
);
create table if not exists public.support_booking_requests (
  request_id uuid primary key,
  appointment_id uuid not null references public.support_appointments(id),
  request_data jsonb not null,
  target_id uuid,
  created_at timestamptz not null default now()
);
alter table public.support_customers enable row level security;
alter table public.support_appointments enable row level security;
alter table public.support_slot_reservations enable row level security;
alter table public.support_booking_requests enable row level security;
revoke all on public.support_customers,public.support_appointments,public.support_slot_reservations,public.support_booking_requests from public,anon,authenticated;
grant select,insert,update,delete on public.support_customers,public.support_appointments,public.support_slot_reservations,public.support_booking_requests to service_role;

create or replace function public.support_save_customer(p_data jsonb,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.support_customers; v_name text:=trim(p_data->>'name'); v_phone text:=trim(p_data->>'phone');
begin
  perform pg_advisory_xact_lock(742902,1);
  if v_name is null or v_phone is null or v_phone !~ '^[+()0-9 -]{7,30}$' or
     not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then
    raise exception using errcode='22023',message='Invalid customer';
  end if;
  if p_id is not null then
    select * into v from public.support_customers where id=p_id for update;
    if not found then raise exception using errcode='P0002',message='Customer not found'; end if;
    if (p_data->>'revision')::integer is distinct from v.revision then
      raise exception using errcode='40001',message='Customer changed; refresh before saving';
    end if;
    update public.support_customers set name=v_name,phone=v_phone,service_interest=coalesce(p_data->>'serviceInterest',''),
      timezone=p_data->>'timezone',stage=p_data->>'stage',notes=coalesce(p_data->>'notes',''),
      follow_up_date=nullif(p_data->>'followUpDate','')::date,revision=revision+1,updated_at=now() where id=p_id returning * into v;
  else
    insert into public.support_customers(name,phone,service_interest,timezone,stage,notes,follow_up_date)
      values(v_name,v_phone,coalesce(p_data->>'serviceInterest',''),p_data->>'timezone',p_data->>'stage',coalesce(p_data->>'notes',''),nullif(p_data->>'followUpDate','')::date) returning * into v;
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function public.support_reserve(p_data jsonb,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v public.support_appointments; c public.support_customers; prev public.support_appointments; req public.support_booking_requests;
  v_date date:=(p_data->>'date')::date; v_min integer:=(p_data->>'startMinute')::integer;
  v_duration integer:=(p_data->>'duration')::integer; v_type text:=p_data->>'type';
  v_customer uuid:=(p_data->>'customerId')::uuid; v_request uuid:=(p_data->>'requestId')::uuid;
  v_start timestamptz; v_zone text:=p_data->>'timezone'; m integer;
begin
  perform pg_advisory_xact_lock(742902,1);
  select * into req from public.support_booking_requests where request_id=v_request;
  if found then
    if req.request_data is distinct from p_data or req.target_id is distinct from p_id then
      raise exception using errcode='22023',message='Request ID reused with different details';
    end if;
    select * into v from public.support_appointments where id=req.appointment_id;
    return to_jsonb(v)||jsonb_build_object('replayed',true);
  end if;
  if v_date is null or v_min is null or v_duration is null or v_request is null or v_customer is null or v_type is null or
     v_min<420 or v_min>1590 or v_min%30<>0 or v_duration not in (30,60) or v_min+v_duration>1620 or
     v_type not in ('demo','interview') or (v_type='demo' and v_duration<>60) or
     not exists(select 1 from pg_timezone_names where name=v_zone) then
    raise exception using errcode='22023',message='Invalid appointment';
  end if;
  v_start:=(v_date::timestamp at time zone 'Asia/Kolkata')+v_min*interval '1 minute';
  if v_start<=clock_timestamp() then raise exception using errcode='22023',message='Select a future slot'; end if;
  select * into c from public.support_customers where id=v_customer for update;
  if not found then raise exception using errcode='P0002',message='Customer not found'; end if;
  if p_id is null and v_type='interview' and c.stage not in ('interested','interview_booked') then
    raise exception using errcode='22023',message='Mark customer interested before booking an interview';
  end if;
  if p_id is not null then
    select * into prev from public.support_appointments where id=p_id for update;
    if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
    if prev.status<>'booked' or prev.starts_at<=clock_timestamp() then
      raise exception using errcode='22023',message='Only future active appointments can be rescheduled';
    end if;
    if (p_data->>'revision')::integer is distinct from prev.revision then
      raise exception using errcode='40001',message='Appointment changed; refresh before saving';
    end if;
    if prev.customer_id<>v_customer or prev.booking_type<>v_type then
      raise exception using errcode='22023',message='Cannot change appointment customer or type';
    end if;
  end if;
  for m in select generate_series(v_min,v_min+v_duration-30,30) loop
    if exists(select 1 from public.support_slot_reservations where service_date=v_date and start_minute=m and (appointment_id is null or appointment_id is distinct from p_id)) then
      raise exception using errcode='23505',message='Slot unavailable';
    end if;
  end loop;
  if p_id is null then
    insert into public.support_appointments(customer_id,booking_type,service_date,start_minute,duration_minutes,starts_at,ends_at,timezone,company,role,round,notes)
      values(v_customer,v_type,v_date,v_min,v_duration,v_start,v_start+v_duration*interval '1 minute',v_zone,coalesce(p_data->>'company',''),coalesce(p_data->>'role',''),coalesce(p_data->>'round',''),coalesce(p_data->>'notes','')) returning * into v;
    update public.support_customers set stage=case when v_type='interview' then 'interview_booked' when stage in ('new','follow_up','demo_completed') then 'demo_booked' else stage end,
      revision=revision+1,updated_at=now() where id=v_customer;
  else
    update public.support_appointments set service_date=v_date,start_minute=v_min,duration_minutes=v_duration,starts_at=v_start,ends_at=v_start+v_duration*interval '1 minute',timezone=v_zone,
      company=coalesce(p_data->>'company',''),role=coalesce(p_data->>'role',''),round=coalesce(p_data->>'round',''),notes=coalesce(p_data->>'notes',''),revision=revision+1,updated_at=now() where id=p_id returning * into v;
    delete from public.support_slot_reservations where appointment_id=p_id;
  end if;
  insert into public.support_slot_reservations(service_date,start_minute,kind,appointment_id)
    select v_date,generate_series(v_min,v_min+v_duration-30,30),'booked',v.id;
  insert into public.support_booking_requests(request_id,appointment_id,request_data,target_id) values(v_request,v.id,p_data,p_id);
  return to_jsonb(v)||jsonb_build_object('replayed',false);
end;
$$;

create or replace function public.support_set_appointment_status(p_id uuid,p_status text,p_revision integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.support_appointments;
begin
  perform pg_advisory_xact_lock(742902,1);
  select * into v from public.support_appointments where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
  if v.revision is distinct from p_revision then raise exception using errcode='40001',message='Appointment changed; refresh before saving'; end if;
  if v.status<>'booked' or p_status is null or p_status not in ('completed','cancelled','no_show') then
    raise exception using errcode='22023',message='Invalid status change';
  end if;
  if (p_status='completed' and v.ends_at>clock_timestamp()) or (p_status='no_show' and v.starts_at>clock_timestamp()) then
    raise exception using errcode='22023',message='Appointment has not finished or started yet';
  end if;
  update public.support_appointments set status=p_status,revision=revision+1,updated_at=now() where id=p_id returning * into v;
  delete from public.support_slot_reservations where appointment_id=p_id;
  if v.booking_type='demo' and p_status='completed' then
    update public.support_customers set stage='demo_completed',revision=revision+1,updated_at=now() where id=v.customer_id and stage='demo_booked';
  end if;
  if p_status in ('cancelled','no_show') and not exists(select 1 from public.support_appointments where customer_id=v.customer_id and status='booked' and booking_type=v.booking_type) then
    update public.support_customers set stage=case when stage='interview_booked' then 'interested' else 'follow_up' end,
      revision=revision+1,updated_at=now() where id=v.customer_id and ((v.booking_type='demo' and stage='demo_booked') or (v.booking_type='interview' and stage='interview_booked'));
  end if;
  return to_jsonb(v);
end;
$$;

create or replace function public.support_block(p_date date,p_minute integer default null,p_status text default 'blocked')
returns integer language plpgsql security invoker set search_path='' as $$
declare m integer; changed integer:=0;
begin
  perform pg_advisory_xact_lock(742902,1);
  if p_date is null or p_status is null or p_status not in ('blocked','available') or
    (p_minute is not null and (p_minute<420 or p_minute>1590 or p_minute%30<>0)) then
    raise exception using errcode='22023',message='Invalid block request';
  end if;
  for m in select generate_series(coalesce(p_minute,420),coalesce(p_minute,1590),30) loop
    if (p_date::timestamp at time zone 'Asia/Kolkata')+m*interval '1 minute'<=clock_timestamp() then
      if p_minute is not null then raise exception using errcode='22023',message='That slot is in the past'; end if;
      continue;
    end if;
    if exists(select 1 from public.support_slot_reservations where service_date=p_date and start_minute=m and kind='booked') then
      if p_minute is not null then raise exception using errcode='23505',message='This slot has a booking'; end if;
      continue;
    end if;
    if p_status='blocked' then
      insert into public.support_slot_reservations(service_date,start_minute,kind) values(p_date,m,'blocked') on conflict do nothing;
    else
      delete from public.support_slot_reservations where service_date=p_date and start_minute=m and kind='blocked';
    end if;
    if found then changed:=changed+1; end if;
  end loop;
  return changed;
end;
$$;
revoke all on function public.support_save_customer(jsonb,uuid),public.support_reserve(jsonb,uuid),public.support_set_appointment_status(uuid,text,integer),public.support_block(date,integer,text) from public,anon,authenticated;
grant execute on function public.support_save_customer(jsonb,uuid),public.support_reserve(jsonb,uuid),public.support_set_appointment_status(uuid,text,integer),public.support_block(date,integer,text) to service_role;

-- Direct admin booking creates/reuses a customer and reserves the slot in one transaction.
create or replace function public.support_book_direct(p_data jsonb,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.support_customers; req public.support_booking_requests; data jsonb:=p_data; profile jsonb:=p_data->'customer';
begin
  perform pg_advisory_xact_lock(742902,1);
  select * into req from public.support_booking_requests where request_id=(p_data->>'requestId')::uuid;
  if found then
    if nullif(p_data->>'customerId','') is not null and p_data->>'customerId' is distinct from req.request_data->>'customerId' then raise exception using errcode='22023',message='Request ID reused with another customer'; end if;
    return public.support_reserve(p_data||jsonb_build_object('customerId',req.request_data->>'customerId'),p_id);
  end if;
  if nullif(p_data->>'customerId','') is not null then
    select * into c from public.support_customers where id=(p_data->>'customerId')::uuid for update;
    if not found then raise exception using errcode='P0002',message='Customer not found'; end if;
  else
    if profile is null then raise exception using errcode='22023',message='Enter customer details'; end if;
    select * into c from public.support_customers where phone_key=regexp_replace(profile->>'phone','[^0-9]','','g') for update;
    if not found then
      select * into c from jsonb_populate_record(null::public.support_customers,public.support_save_customer(profile||jsonb_build_object('stage',case when p_data->>'type'='interview' then 'interested' else 'new' end),null));
    end if;
  end if;
  if p_id is null and p_data->>'type'='interview' and c.stage not in ('interested','interview_booked') then
    update public.support_customers set stage='interested',revision=revision+1,updated_at=now() where id=c.id;
  end if;
  data:=p_data||jsonb_build_object('customerId',c.id);
  return public.support_reserve(data,p_id);
end;
$$;
revoke all on function public.support_book_direct(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.support_book_direct(jsonb,uuid) to service_role;

-- Preserve existing reservations, including older one-hour bookings, at their actual start times.
alter table public.support_slot_reservations add column if not exists seat integer not null default 1 check(seat in (1,2));
alter table public.support_slot_reservations drop constraint if exists support_slot_reservations_pkey;
alter table public.support_slot_reservations add primary key(service_date,start_minute,seat);
alter table public.support_appointments add column if not exists member_name text not null default '' check(char_length(member_name)<=100);
alter table public.support_appointments add column if not exists whatsapp text not null default '' check(char_length(whatsapp)<=30);
alter table public.support_appointments add column if not exists experience text not null default '' check(char_length(experience)<=100);
update public.support_appointments a set member_name=c.name,whatsapp=c.phone from public.support_customers c where c.id=a.customer_id and a.member_name='';
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.support_appointments'::regclass and contype='c' and pg_get_constraintdef(oid) like '%booking_type%60%' loop
  execute format('alter table public.support_appointments drop constraint %I',c.conname);
 end loop;
end $$;
create or replace function public.support_reserve(p_data jsonb,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v public.support_appointments; prev public.support_appointments; req public.support_booking_requests;
 d date:=(p_data->>'date')::date; m integer:=(p_data->>'startMinute')::integer; dur integer:=(p_data->>'duration')::integer;
 cid uuid:=(p_data->>'customerId')::uuid; rid uuid:=(p_data->>'requestId')::uuid; typ text:=p_data->>'type';
 zone text:=p_data->>'timezone'; stamp timestamptz; chosen integer;
 nm text:=trim(p_data->>'memberName'); ph text:=trim(p_data->>'phone'); exp text:=trim(p_data->>'experience');
begin
 perform pg_advisory_xact_lock(742902,1);
 select * into req from public.support_booking_requests where request_id=rid;
 if found then
  if req.request_data is distinct from p_data or req.target_id is distinct from p_id then raise exception using errcode='22023',message='Request ID reused with different details'; end if;
  select * into v from public.support_appointments where id=req.appointment_id;
  return to_jsonb(v)||jsonb_build_object('replayed',true);
 end if;
 if d is null or m is null or dur is distinct from 30 or m<420 or m>1590 or m%30<>0 or rid is null or cid is null or typ is null or typ not in ('demo','interview') or
  not exists(select 1 from pg_timezone_names where name=zone) or
  nm is null or char_length(nm) not between 1 and 100 or ph is null or ph !~ '^[+()0-9 -]{7,30}$' or char_length(regexp_replace(ph,'[^0-9]','','g')) not between 7 and 15 or
  exp is null or char_length(exp) not between 1 and 100 or char_length(trim(coalesce(p_data->>'company',''))) not between 1 and 150 or char_length(trim(coalesce(p_data->>'round',''))) not between 1 and 100 then
  raise exception using errcode='22023',message='Enter the member details and choose a future 30-minute slot';
 end if;
 stamp:=(d::timestamp at time zone 'Asia/Kolkata')+m*interval '1 minute';
 if stamp<=clock_timestamp() then raise exception using errcode='22023',message='Choose a future slot'; end if;
 if not exists(select 1 from public.support_customers where id=cid) then raise exception using errcode='P0002',message='Customer not found'; end if;
 if p_id is not null then
  select * into prev from public.support_appointments where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Booking not found'; end if;
  if prev.status<>'booked' or prev.starts_at<=clock_timestamp() then raise exception using errcode='22023',message='Only future bookings can be rescheduled'; end if;
  if (p_data->>'revision')::integer is distinct from prev.revision then raise exception using errcode='40001',message='Booking changed; refresh before saving'; end if;
  if prev.customer_id<>cid or prev.booking_type<>typ then raise exception using errcode='22023',message='Booking member or type cannot change during rescheduling'; end if;
 end if;
 if exists(select 1 from public.support_slot_reservations where service_date=d and start_minute=m and kind='blocked') then raise exception using errcode='23505',message='This slot is blocked'; end if;
 select seats.seat into chosen from generate_series(1,2) as seats(seat) where not exists(
  select 1 from public.support_slot_reservations where service_date=d and start_minute=m and public.support_slot_reservations.seat=seats.seat and appointment_id is distinct from p_id) order by seats.seat limit 1;
 if chosen is null then raise exception using errcode='23505',message='This slot already has two bookings'; end if;
 if p_id is null then
  insert into public.support_appointments(customer_id,booking_type,service_date,start_minute,duration_minutes,starts_at,ends_at,timezone,company,round,member_name,whatsapp,experience)
  values(cid,typ,d,m,30,stamp,stamp+interval '30 minutes',zone,trim(p_data->>'company'),trim(p_data->>'round'),nm,ph,exp) returning * into v;
 else
  update public.support_appointments set service_date=d,start_minute=m,duration_minutes=30,starts_at=stamp,ends_at=stamp+interval '30 minutes',timezone=zone,company=trim(p_data->>'company'),round=trim(p_data->>'round'),member_name=nm,whatsapp=ph,experience=exp,revision=revision+1,updated_at=now() where id=p_id returning * into v;
  delete from public.support_slot_reservations where appointment_id=p_id;
 end if;
 insert into public.support_slot_reservations(service_date,start_minute,seat,kind,appointment_id) values(d,m,chosen,'booked',v.id);
 insert into public.support_booking_requests(request_id,appointment_id,request_data,target_id) values(rid,v.id,p_data,p_id);
 return to_jsonb(v)||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.support_reserve(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.support_reserve(jsonb,uuid) to service_role;
notify pgrst,'reload schema';

commit;
