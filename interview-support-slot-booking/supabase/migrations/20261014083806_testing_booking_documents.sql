begin;
create table if not exists public.testing_support_document_sets (
 id uuid primary key, token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 resume jsonb not null, jd_file jsonb, jd_text text not null default '' check(char_length(jd_text)<=10000),
 status text not null default 'pending' check(status in ('pending','attached','deleting','deleted')),
 attached_request uuid, created_at timestamptz not null default now(), deleted_at timestamptz,
 check(jd_file is not null or char_length(trim(jd_text))>0)
);
alter table public.testing_support_document_sets enable row level security;
revoke all on public.testing_support_document_sets from public,anon,authenticated;
grant select,insert,update,delete on public.testing_support_document_sets to service_role;
alter table public.testing_support_appointments add column if not exists document_set_id uuid references public.testing_support_document_sets(id);
alter table public.testing_support_appointments add column if not exists jd_text text not null default '' check(char_length(jd_text)<=10000);
create index if not exists testing_support_appointments_document_set_idx on public.testing_support_appointments(document_set_id) where document_set_id is not null;
create index if not exists testing_support_document_sets_cleanup_idx on public.testing_support_document_sets(status,created_at) where status <> 'deleted';

create or replace function public.testing_support_create_document_set(p_id uuid,p_token_hash text,p_resume jsonb,p_jd_file jsonb,p_jd_text text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; allocated bigint;
begin
 perform pg_advisory_xact_lock(742903,1);
 if p_resume is null or (p_jd_file is null and char_length(trim(coalesce(p_jd_text,'')))=0) or char_length(coalesce(p_jd_text,''))>10000 then
  raise exception using errcode='22023',message='Upload a resume and upload or paste a job description';
 end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(p_resume,p_jd_file)) where value <> 'null'::jsonb loop
  if jsonb_typeof(item)<>'object' or (item->>'size')::bigint not between 1 and 2097152 or char_length(item->>'name') not between 1 and 180 or
    item->>'path' !~ ('^'||p_id::text||'/(resume|jd)\.(pdf|docx|png|jpg)$') then
   raise exception using errcode='22023',message='Use supported documents up to 2 MB each';
  end if;
 end loop;
 -- Reserve a conservative budget for pending and retained uploads, including signed URLs not used yet.
 select coalesce(sum(2097152*(1+case when jd_file is null then 0 else 1 end)),0) into allocated from public.testing_support_document_sets where status <> 'deleted';
 if allocated+2097152*(1+case when p_jd_file is null then 0 else 1 end)>67108864 then
  raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';
 end if;
 insert into public.testing_support_document_sets(id,token_hash,resume,jd_file,jd_text) values(p_id,p_token_hash,p_resume,p_jd_file,coalesce(p_jd_text,''));
 return jsonb_build_object('id',p_id);
end;
$$;

create or replace function public.testing_support_book_with_documents(p_data jsonb,p_slots jsonb,p_document_id uuid,p_token_hash text,p_admin boolean default false,p_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare docs public.testing_support_document_sets; result jsonb; entry jsonb; document_id uuid;
begin
 perform pg_advisory_xact_lock(742903,1);
 if p_id is not null then
  if not p_admin then raise exception using errcode='42501',message='Administrator required'; end if;
  select document_set_id into document_id from public.testing_support_appointments where id=p_id;
  if document_id is not null then
   select * into docs from public.testing_support_document_sets where id=document_id for update;
   if docs.status in ('deleting','deleted') then raise exception using errcode='22023',message='These documents have expired. Contact the administrator'; end if;
  end if;
  return public.testing_support_book_direct(p_data,p_id);
 end if;
 select * into docs from public.testing_support_document_sets where id=p_document_id for update;
 if not found or docs.token_hash is distinct from p_token_hash then raise exception using errcode='22023',message='Upload your booking documents first'; end if;
 if docs.status not in ('pending','attached') or (docs.status='pending' and docs.created_at < now()-interval '24 hours') then
  raise exception using errcode='22023',message='Documents expired. Please upload them again';
 end if;
 if docs.attached_request is not null and docs.attached_request is distinct from (p_data->>'requestId')::uuid then
  raise exception using errcode='22023',message='These documents already belong to another booking';
 end if;
 if p_admin then result:=jsonb_build_array(public.testing_support_book_direct(p_data,null));
 else result:=public.testing_support_book_public_slots(p_data,p_slots); end if;
 for entry in select value from jsonb_array_elements(result) loop
  update public.testing_support_appointments set document_set_id=docs.id,jd_text=docs.jd_text where id=(entry->>'id')::uuid;
 end loop;
 update public.testing_support_document_sets set status='attached',attached_request=(p_data->>'requestId')::uuid where id=docs.id;
 return result;
end;
$$;

create or replace function public.testing_support_document_expiry(p_document_id uuid)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case when d.status='pending' then d.created_at+interval '24 hours'
 else coalesce((select max(a.ends_at) from public.testing_support_appointments a where a.document_set_id=d.id),d.created_at)+interval '24 hours' end
 from public.testing_support_document_sets d where d.id=p_document_id;
$$;

create or replace function public.testing_support_claim_expired_documents(p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 -- Same lock as booking and rescheduling: cleanup cannot remove files a concurrent move still needs.
 perform pg_advisory_xact_lock(742903,1);
 with eligible as (
  select d.id from public.testing_support_document_sets d where d.status='deleting' or
  (d.status in ('pending','attached') and public.testing_support_document_expiry(d.id)<=now())
  order by d.created_at limit least(greatest(p_limit,1),100) for update
 ), claimed as (
  update public.testing_support_document_sets d set status='deleting' from eligible e where d.id=e.id returning d.id,d.resume,d.jd_file
 ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
 return result;
end;
$$;
revoke all on function public.testing_support_create_document_set(uuid,text,jsonb,jsonb,text),public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid),public.testing_support_document_expiry(uuid),public.testing_support_claim_expired_documents(integer) from public,anon,authenticated;
grant execute on function public.testing_support_create_document_set(uuid,text,jsonb,jsonb,text),public.testing_support_book_with_documents(jsonb,jsonb,uuid,text,boolean,uuid),public.testing_support_document_expiry(uuid),public.testing_support_claim_expired_documents(integer) to service_role;
notify pgrst,'reload schema';
commit;

-- Hosted Storage configuration (not part of the local Postgres-only harness).
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('testing-booking-documents','testing-booking-documents',false,2097152,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
