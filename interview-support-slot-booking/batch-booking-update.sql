begin;
-- One RPC statement is one transaction: if any slot fails, every insert is rolled back.
create or replace function public.support_book_slots(p_data jsonb,p_slots jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare slot jsonb; canonical jsonb; result jsonb:='[]'::jsonb; a jsonb; i integer:=0; rid uuid; child_id uuid;
begin
 perform pg_advisory_xact_lock(742902,1);
 if p_slots is null or jsonb_typeof(p_slots) is distinct from 'array' then
  raise exception using errcode='22023',message='Select one or two slots';
 end if;
 if jsonb_array_length(p_slots) not between 1 and 2 or p_data is null or jsonb_typeof(p_data) is distinct from 'object' or p_data ? 'id' or p_data ? 'revision' then
  raise exception using errcode='22023',message='Select one or two new booking slots';
 end if;
 rid:=(p_data->>'requestId')::uuid;
 if rid is null then raise exception using errcode='22023',message='A booking request ID is required'; end if;
 select jsonb_agg(x order by x->>'date',(x->>'startMinute')::integer) into canonical from jsonb_array_elements(p_slots) x;
 if (select count(distinct ((x->>'date')||':'||(x->>'startMinute'))) from jsonb_array_elements(canonical) x)<>jsonb_array_length(canonical) then
  raise exception using errcode='22023',message='Select different slots';
 end if;
 for slot in select * from jsonb_array_elements(canonical) loop
  i:=i+1;child_id:=case when i=1 then rid else md5(rid::text||':slot:'||i::text)::uuid end;
  a:=public.support_book_direct(p_data||jsonb_build_object('date',slot->>'date','startMinute',(slot->>'startMinute')::integer,'duration',30,'requestId',child_id,'batchSlots',canonical),null);
  result:=result||jsonb_build_array(a);
 end loop;
 return result;
end;
$$;
revoke all on function public.support_book_slots(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.support_book_slots(jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
