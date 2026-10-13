begin;
-- Public visitors may reserve only empty boxes. Admin still uses support_book_direct.
create or replace function public.support_book_public_slots(p_data jsonb,p_slots jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare slot jsonb; canonical jsonb; rid uuid; child_id uuid; i integer:=0;
begin
 perform pg_advisory_xact_lock(742902,1);
 if p_slots is null or jsonb_typeof(p_slots) is distinct from 'array' then
  raise exception using errcode='22023',message='Select one or two slots';
 end if;
 if jsonb_array_length(p_slots) not between 1 and 2 or p_data is null or jsonb_typeof(p_data) is distinct from 'object' then
  raise exception using errcode='22023',message='Select one or two slots';
 end if;
 rid:=(p_data->>'requestId')::uuid;
 if rid is null then raise exception using errcode='22023',message='A booking request ID is required'; end if;
 select jsonb_agg(x order by x->>'date',(x->>'startMinute')::integer) into canonical from jsonb_array_elements(p_slots) x;
 for slot in select * from jsonb_array_elements(canonical) loop
  i:=i+1;child_id:=case when i=1 then rid else md5(rid::text||':slot:'||i::text)::uuid end;
  -- An exact retry is validated by support_book_slots/support_reserve and creates no second place.
  if not exists(select 1 from public.support_booking_requests where request_id=child_id)
   and exists(select 1 from public.support_slot_reservations where service_date=(slot->>'date')::date and start_minute=(slot->>'startMinute')::integer) then
   raise exception using errcode='23505',message='This slot is already booked or blocked';
  end if;
 end loop;
 return public.support_book_slots(p_data,p_slots);
end;
$$;
revoke all on function public.support_book_public_slots(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.support_book_public_slots(jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
