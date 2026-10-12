begin;
alter table public.support_appointments alter column customer_id drop not null;
create or replace function public.support_reserve(p_data jsonb,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v public.support_appointments; prev public.support_appointments; req public.support_booking_requests;
 d date:=(p_data->>'date')::date; m integer:=(p_data->>'startMinute')::integer; dur integer:=(p_data->>'duration')::integer;
 rid uuid:=(p_data->>'requestId')::uuid; typ text:=p_data->>'type';
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
 if d is null or m is null or dur is distinct from 30 or m<420 or m>1590 or m%30<>0 or rid is null or typ is null or typ not in ('demo','interview') or
  not exists(select 1 from pg_timezone_names where name=zone) or
  nm is null or char_length(nm) not between 1 and 100 or ph is null or ph !~ '^[+()0-9 -]{7,30}$' or char_length(regexp_replace(ph,'[^0-9]','','g')) not between 7 and 15 or
  exp is null or char_length(exp) not between 1 and 100 or char_length(trim(coalesce(p_data->>'company',''))) not between 1 and 150 or char_length(trim(coalesce(p_data->>'round',''))) not between 1 and 100 then
  raise exception using errcode='22023',message='Enter the member details and choose a future 30-minute slot';
 end if;
 stamp:=(d::timestamp at time zone 'Asia/Kolkata')+m*interval '1 minute';
 if stamp<=clock_timestamp() then raise exception using errcode='22023',message='Choose a future slot'; end if;
 if p_id is not null then
  select * into prev from public.support_appointments where id=p_id for update;
  if not found then raise exception using errcode='P0002',message='Booking not found'; end if;
  if prev.status<>'booked' or prev.starts_at<=clock_timestamp() then raise exception using errcode='22023',message='Only future bookings can be rescheduled'; end if;
  if (p_data->>'revision')::integer is distinct from prev.revision then raise exception using errcode='40001',message='Booking changed; refresh before saving'; end if;
  if prev.booking_type<>typ then raise exception using errcode='22023',message='Booking type cannot change during rescheduling'; end if;
 end if;
 if exists(select 1 from public.support_slot_reservations where service_date=d and start_minute=m and kind='blocked') then raise exception using errcode='23505',message='This slot is blocked'; end if;
 select seats.seat into chosen from generate_series(1,2) as seats(seat) where not exists(
  select 1 from public.support_slot_reservations where service_date=d and start_minute=m and public.support_slot_reservations.seat=seats.seat and appointment_id is distinct from p_id) order by seats.seat limit 1;
 if chosen is null then raise exception using errcode='23505',message='This slot already has two bookings'; end if;
 if p_id is null then
  insert into public.support_appointments(customer_id,booking_type,service_date,start_minute,duration_minutes,starts_at,ends_at,timezone,company,round,member_name,whatsapp,experience,notes)
  values(null,typ,d,m,30,stamp,stamp+interval '30 minutes',zone,trim(p_data->>'company'),trim(p_data->>'round'),nm,ph,exp,coalesce(p_data->>'notes','')) returning * into v;
 else
  update public.support_appointments set service_date=d,start_minute=m,duration_minutes=30,starts_at=stamp,ends_at=stamp+interval '30 minutes',timezone=zone,company=trim(p_data->>'company'),round=trim(p_data->>'round'),member_name=nm,whatsapp=ph,experience=exp,notes=coalesce(p_data->>'notes',prev.notes,''),revision=revision+1,updated_at=now() where id=p_id returning * into v;
  delete from public.support_slot_reservations where appointment_id=p_id;
 end if;
 insert into public.support_slot_reservations(service_date,start_minute,seat,kind,appointment_id) values(d,m,chosen,'booked',v.id);
 insert into public.support_booking_requests(request_id,appointment_id,request_data,target_id) values(rid,v.id,p_data,p_id);
 return to_jsonb(v)||jsonb_build_object('replayed',false);
end;
$$;

create or replace function public.support_book_direct(p_data jsonb,p_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
 select public.support_reserve(p_data,p_id);
$$;
revoke all on function public.support_reserve(jsonb,uuid),public.support_book_direct(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.support_reserve(jsonb,uuid),public.support_book_direct(jsonb,uuid) to service_role;
notify pgrst,'reload schema';

commit;
