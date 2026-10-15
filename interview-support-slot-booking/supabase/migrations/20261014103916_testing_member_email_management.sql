begin;
alter table public.testing_support_appointments add column if not exists email text;
alter table public.testing_support_appointments add constraint testing_support_appointments_email_check check(email is null or (email=lower(trim(email)) and char_length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
create index if not exists testing_support_appointments_email_idx on public.testing_support_appointments(email,starts_at desc) where email is not null;
-- Keep the existing document/capacity transaction and add email ownership in the same statement.
alter function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid) rename to testing_support_book_with_documents_core;
create function public.testing_support_book_with_documents(p_data jsonb,p_slots jsonb,p_document_id uuid,p_token_hash text,p_admin boolean default false,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; entry jsonb; owner_email text; new_email text:=lower(trim(p_data->>'email'));
begin
 perform pg_advisory_xact_lock(742903,1);
 if p_id is null then
  if new_email is null or char_length(new_email)>254 or new_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='22023',message='Enter a valid email address'; end if;
 else
  select email into owner_email from public.testing_support_appointments where id=p_id for update;
  if new_email is not null and new_email is distinct from owner_email then raise exception using errcode='22023',message='Booking email cannot change while rescheduling'; end if;
 end if;
 result:=public.testing_support_book_with_documents_core(p_data,p_slots,p_document_id,p_token_hash,p_admin,p_id);
 if p_id is null then
  for entry in select value from jsonb_array_elements(result) loop
   update public.testing_support_appointments set email=new_email where id=(entry->>'id')::uuid and email is null;
  end loop;
  select jsonb_agg(to_jsonb(a) order by a.service_date,a.start_minute) into result from public.testing_support_appointments a where a.id in (select (value->>'id')::uuid from jsonb_array_elements(result));
 end if;
 return result;
end;
$$;
revoke all on function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid) to service_role;

create function public.testing_support_member_manage(p_email text,p_id uuid,p_revision integer,p_action text,p_date date default null,p_minute integer default null,p_request_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; data jsonb;
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found'; end if;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() then raise exception using errcode='22023',message='Only upcoming bookings can be changed'; end if;
 if a.revision is distinct from p_revision then raise exception using errcode='40001',message='Booking changed. Refresh before saving'; end if;
 if p_action='cancel' then return public.testing_support_set_appointment_status(a.id,'cancelled',p_revision); end if;
 if p_action is distinct from 'reschedule' or p_date is null or p_minute is null or p_request_id is null then raise exception using errcode='22023',message='Choose a new slot'; end if;
 if (p_date is distinct from a.service_date or p_minute is distinct from a.start_minute) and exists(select 1 from public.testing_support_slot_reservations where service_date=p_date and start_minute=p_minute) then
  raise exception using errcode='23505',message='This slot is already booked or blocked';
 end if;
 data:=jsonb_build_object('date',p_date,'startMinute',p_minute,'duration',30,'type',a.booking_type,'requestId',p_request_id,'revision',p_revision,'timezone',a.timezone,'memberName',a.member_name,'phone',a.whatsapp,'email',a.email,'company',a.company,'experience',a.experience,'round',a.round,'notes',a.notes);
 return public.testing_support_book_with_documents(data,null,null,null,true,a.id);
end;
$$;
revoke all on function public.testing_support_member_manage(text,uuid,integer,text,date,integer,uuid) from public,anon,authenticated;
grant execute on function public.testing_support_member_manage(text,uuid,integer,text,date,integer,uuid) to service_role;
notify pgrst,'reload schema';
commit;
