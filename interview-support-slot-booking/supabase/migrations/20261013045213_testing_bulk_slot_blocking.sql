begin;
create or replace function public.testing_support_block_slots(p_slots jsonb,p_status text)
returns integer language plpgsql security invoker set search_path='' as $$
declare slot jsonb; changed integer:=0;
begin
 perform pg_advisory_xact_lock(742903,1);
 if p_slots is null or jsonb_typeof(p_slots) is distinct from 'array' or p_status is null or p_status not in ('blocked','available') then
  raise exception using errcode='22023',message='Select future slots to block or unblock';
 end if;
 if jsonb_array_length(p_slots) not between 1 and 200 then raise exception using errcode='22023',message='Select one to 200 slots'; end if;
 if (select count(distinct ((x->>'date')||':'||(x->>'startMinute'))) from jsonb_array_elements(p_slots) x)<>jsonb_array_length(p_slots) then
  raise exception using errcode='22023',message='Select different slots';
 end if;
 for slot in select x from jsonb_array_elements(p_slots) x order by x->>'date',(x->>'startMinute')::integer loop
  if slot->>'date' is null or slot->>'startMinute' is null then raise exception using errcode='22023',message='Invalid slot'; end if;
  changed:=changed+public.testing_support_block((slot->>'date')::date,(slot->>'startMinute')::integer,p_status);
 end loop;
 return changed;
end;
$$;
revoke all on function public.testing_support_block_slots(jsonb,text) from public,anon,authenticated;
grant execute on function public.testing_support_block_slots(jsonb,text) to service_role;
notify pgrst,'reload schema';
commit;
