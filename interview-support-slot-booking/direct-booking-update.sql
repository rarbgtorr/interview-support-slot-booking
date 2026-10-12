begin;

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

notify pgrst,'reload schema';
commit;
