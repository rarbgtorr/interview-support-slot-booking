-- Separate tables: this script does not alter the reference app's bookings.
-- Run in a new Supabase project (or a project deliberately configured for this app).
begin;
create table if not exists public.interview_bookings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  service_date date not null,
  start_minute integer not null check (start_minute between 420 and 1530 and start_minute % 30 = 0),
  duration_minutes integer not null check (duration_minutes in (30,60)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  name text not null check (char_length(name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254 and email=lower(email)),
  phone text not null check (char_length(phone) between 7 and 30),
  interview_role text not null check (char_length(interview_role) between 1 and 150),
  company text not null default '' check (char_length(company)<=150),
  interview_round text not null default '' check (char_length(interview_round)<=100),
  notes text not null default '' check (char_length(notes)<=1000),
  customer_timezone text not null,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  reminder_member_at timestamptz,
  reminder_owner_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_minute+duration_minutes<=1560),
  check (ends_at=starts_at+duration_minutes*interval '1 minute')
);
create table if not exists public.interview_slot_reservations (
  service_date date not null,
  start_minute integer not null check (start_minute between 420 and 1530 and start_minute % 30 = 0),
  kind text not null check (kind in ('booked','blocked')),
  booking_id uuid references public.interview_bookings(id),
  primary key (service_date,start_minute),
  check ((kind='booked' and booking_id is not null) or (kind='blocked' and booking_id is null))
);
create index if not exists interview_reservation_booking_idx on public.interview_slot_reservations(booking_id) where booking_id is not null;
create index if not exists interview_bookings_email_idx on public.interview_bookings(email,starts_at desc);
create index if not exists interview_bookings_reminders_idx on public.interview_bookings(starts_at) where status='booked';
create table if not exists public.interview_visitor_stats (
  visit_date date primary key,
  visit_count bigint not null default 0 check (visit_count>=0)
);
alter table public.interview_bookings enable row level security;
alter table public.interview_slot_reservations enable row level security;
alter table public.interview_visitor_stats enable row level security;
revoke all on public.interview_bookings,public.interview_slot_reservations,public.interview_visitor_stats from public,anon,authenticated;
grant all on public.interview_bookings,public.interview_slot_reservations,public.interview_visitor_stats to service_role;

-- Every reservation-changing RPC uses the same transaction lock. Together with
-- the primary key this serializes booking/block/release races. At the expected
-- small booking volume this is simpler than per-slot locks and avoids deadlocks.
create or replace function public.interview_reserve(p_data jsonb,p_email text default null,p_booking_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_date date; v_minute integer; v_duration integer; v_start timestamptz;
  v_request uuid; v_email text; v_booking public.interview_bookings; v_previous public.interview_bookings;
begin
  perform pg_advisory_xact_lock(742901,1);
  v_date := (p_data->>'date')::date;
  v_minute := (p_data->>'startMinute')::integer;
  v_duration := (p_data->>'duration')::integer;
  v_request := (p_data->>'requestId')::uuid;
  v_email := lower(btrim(p_data->>'email'));
  if v_date is null or v_minute is null or v_duration is null or v_request is null or
     v_minute<420 or v_minute>1530 or v_minute%30<>0 or v_duration not in (30,60) or v_minute+v_duration>1560 then
    raise exception using errcode='22023',message='Invalid slot selection';
  end if;
  if not exists(select 1 from pg_timezone_names where name=p_data->>'timezone') then
    raise exception using errcode='22023',message='Invalid time zone';
  end if;
  select * into v_booking from public.interview_bookings where request_id=v_request;
  if found then
    if v_booking.email=v_email and ((p_booking_id is null and p_email is null) or
       (v_booking.id=p_booking_id and v_booking.email=p_email)) then
      return to_jsonb(v_booking)||jsonb_build_object('replayed',true);
    end if;
    raise exception using errcode='23505',message='Request already used';
  end if;
  v_start := (v_date::timestamp at time zone 'Asia/Kolkata')+v_minute*interval '1 minute';
  if v_start<=clock_timestamp() then
    raise exception using errcode='22023',message='That slot is in the past';
  end if;
  if p_booking_id is not null then
    select * into v_previous from public.interview_bookings
      where id=p_booking_id and email=p_email and status='booked' for update;
    if not found then raise exception using errcode='P0002',message='Booking not found'; end if;
    if v_previous.starts_at<=clock_timestamp() then
      raise exception using errcode='22023',message='Started bookings cannot be rescheduled';
    end if;
    if v_email<>p_email then raise exception using errcode='42501',message='Email cannot be changed'; end if;
  end if;
  if exists(select 1 from public.interview_slot_reservations r
    where r.service_date=v_date and r.start_minute>=v_minute and r.start_minute<v_minute+v_duration
    and (p_booking_id is null or r.booking_id is distinct from p_booking_id)) then
    raise exception using errcode='23505',message='That time is no longer available';
  end if;
  if p_booking_id is null then
    insert into public.interview_bookings(request_id,service_date,start_minute,duration_minutes,starts_at,ends_at,name,email,phone,interview_role,company,interview_round,notes,customer_timezone)
    values(v_request,v_date,v_minute,v_duration,v_start,v_start+v_duration*interval '1 minute',btrim(p_data->>'name'),v_email,btrim(p_data->>'phone'),btrim(p_data->>'interviewRole'),coalesce(p_data->>'company',''),coalesce(p_data->>'interviewRound',''),coalesce(p_data->>'notes',''),p_data->>'timezone') returning * into v_booking;
  else
    update public.interview_bookings set request_id=v_request,service_date=v_date,start_minute=v_minute,duration_minutes=v_duration,
      starts_at=v_start,ends_at=v_start+v_duration*interval '1 minute',name=btrim(p_data->>'name'),phone=btrim(p_data->>'phone'),interview_role=btrim(p_data->>'interviewRole'),
      company=coalesce(p_data->>'company',''),interview_round=coalesce(p_data->>'interviewRound',''),notes=coalesce(p_data->>'notes',''),customer_timezone=p_data->>'timezone',
      reminder_member_at=null,reminder_owner_at=null,revision=revision+1,updated_at=now()
      where id=p_booking_id returning * into v_booking;
    delete from public.interview_slot_reservations where booking_id=p_booking_id;
  end if;
  insert into public.interview_slot_reservations(service_date,start_minute,kind,booking_id)
    select v_date,m,'booked',v_booking.id from generate_series(v_minute,v_minute+v_duration-30,30) m;
  return to_jsonb(v_booking)||jsonb_build_object('replayed',false);
end;
$$;

create or replace function public.interview_cancel(p_id uuid,p_email text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_booking public.interview_bookings;
begin
  perform pg_advisory_xact_lock(742901,1);
  select * into v_booking from public.interview_bookings where id=p_id and status='booked'
    and (p_email is null or email=p_email) for update;
  if not found then raise exception using errcode='P0002',message='Booking not found or already cancelled'; end if;
  if v_booking.starts_at<=clock_timestamp() then raise exception using errcode='22023',message='Started bookings cannot be cancelled'; end if;
  update public.interview_bookings set status='cancelled',updated_at=now() where id=p_id;
  delete from public.interview_slot_reservations where booking_id=p_id;
  return to_jsonb(v_booking)||jsonb_build_object('status','cancelled');
end;
$$;

create or replace function public.interview_block(p_date date,p_minute integer default null,p_status text default 'blocked')
returns integer language plpgsql security invoker set search_path='' as $$
declare m integer; changed integer:=0;
begin
  perform pg_advisory_xact_lock(742901,1);
  if p_date is null or p_status not in ('blocked','available') or p_status is null or
    (p_minute is not null and (p_minute<420 or p_minute>1530 or p_minute%30<>0)) then
    raise exception using errcode='22023',message='Invalid block request';
  end if;
  for m in select generate_series(coalesce(p_minute,420),coalesce(p_minute,1530),30) loop
    if (p_date::timestamp at time zone 'Asia/Kolkata')+m*interval '1 minute'<=clock_timestamp() then
      if p_minute is not null then raise exception using errcode='22023',message='That slot is in the past'; end if;
      continue;
    end if;
    if exists(select 1 from public.interview_slot_reservations where service_date=p_date and start_minute=m and kind='booked') then
      if p_minute is not null then raise exception using errcode='23505',message='This slot has a booking'; end if;
      continue;
    end if;
    if p_status='blocked' then
      insert into public.interview_slot_reservations(service_date,start_minute,kind) values(p_date,m,'blocked') on conflict do nothing;
    else
      delete from public.interview_slot_reservations where service_date=p_date and start_minute=m and kind='blocked';
    end if;
    if found then changed:=changed+1; end if;
  end loop;
  return changed;
end;
$$;
create or replace function public.interview_record_visit(p_date date)
returns void language sql security invoker set search_path='' as $$
  insert into public.interview_visitor_stats(visit_date,visit_count) values(p_date,1)
  on conflict(visit_date) do update set visit_count=public.interview_visitor_stats.visit_count+1;
$$;
revoke all on function public.interview_reserve(jsonb,text,uuid),public.interview_cancel(uuid,text),public.interview_block(date,integer,text),public.interview_record_visit(date) from public,anon,authenticated;
grant execute on function public.interview_reserve(jsonb,text,uuid),public.interview_cancel(uuid,text),public.interview_block(date,integer,text),public.interview_record_visit(date) to service_role;
notify pgrst,'reload schema';
commit;
