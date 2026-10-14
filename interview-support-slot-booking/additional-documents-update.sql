begin;
alter table public.support_document_sets add column if not exists additional_files jsonb not null default '[]'::jsonb check(jsonb_typeof(additional_files)='array' and jsonb_array_length(additional_files)<=3);
create or replace function public.support_create_document_set_with_files(p_id uuid,p_token_hash text,p_resume jsonb,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; allocated bigint; extras jsonb:=coalesce(p_additional_files,'[]'::jsonb); i integer:=0;
begin
 perform pg_advisory_xact_lock(742902,1);
 if jsonb_typeof(extras) is distinct from 'array' then raise exception using errcode='22023',message='Choose up to three additional documents'; end if;
 if jsonb_array_length(extras)>3 or p_resume is null or (p_jd_file is null and char_length(trim(coalesce(p_jd_text,'')))=0) or char_length(coalesce(p_jd_text,''))>10000 then
  raise exception using errcode='22023',message='Upload a resume, provide a JD and choose up to three additional documents';
 end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(p_resume,p_jd_file)||extras) where value <> 'null'::jsonb loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce((item->>'size')::bigint,0) not between 1 and 2097152 or coalesce(char_length(item->>'name'),0) not between 1 and 180 or
   coalesce(item->>'path','') !~ ('^'||p_id::text||'/(resume|jd|additional-[1-3])\.(pdf|docx|png|jpg|txt)$') then raise exception using errcode='22023',message='Use supported documents up to 2 MB each'; end if;
 end loop;
 if p_resume->>'path' !~ ('^'||p_id::text||'/resume\.(pdf|docx)$') or (p_jd_file is not null and p_jd_file->>'path' !~ ('^'||p_id::text||'/jd\.(pdf|docx|png|jpg)$')) then
  raise exception using errcode='22023',message='Choose supported resume and JD files';
 end if;
 for item in select value from jsonb_array_elements(extras) loop
  i:=i+1;
  if item->>'path' !~ ('^'||p_id::text||'/additional-'||i::text||'\.(pdf|docx|txt)$') then raise exception using errcode='22023',message='Additional documents must be PDF, DOCX or TXT'; end if;
 end loop;
 select coalesce(sum(2097152*(1+case when jd_file is null then 0 else 1 end+jsonb_array_length(additional_files))),0) into allocated from public.support_document_sets where status<>'deleted';
 if allocated+2097152*(1+case when p_jd_file is null then 0 else 1 end+jsonb_array_length(extras))>67108864 then
  raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';
 end if;
 insert into public.support_document_sets(id,token_hash,resume,jd_file,jd_text,additional_files) values(p_id,p_token_hash,p_resume,p_jd_file,coalesce(p_jd_text,''),extras);
 return jsonb_build_object('id',p_id);
end;
$$;
-- Preserve old requests with zero additional files.
create or replace function public.support_create_document_set(p_id uuid,p_token_hash text,p_resume jsonb,p_jd_file jsonb,p_jd_text text)
returns jsonb language sql security invoker set search_path='' as $$
 select public.support_create_document_set_with_files(p_id,p_token_hash,p_resume,p_jd_file,p_jd_text,'[]'::jsonb);
$$;
create or replace function public.support_claim_expired_documents(p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(742902,1);
 with eligible as (
 select d.id from public.support_document_sets d where d.status='deleting' or (d.status in ('pending','attached') and public.support_document_expiry(d.id)<=now())
 order by d.created_at limit least(greatest(p_limit,1),100) for update
 ),claimed as (
 update public.support_document_sets d set status='deleting' from eligible e where d.id=e.id returning d.id,d.resume,d.jd_file,d.additional_files
 ) select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
 return result;
end;
$$;
revoke all on function public.support_create_document_set_with_files(uuid,text,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.support_create_document_set_with_files(uuid,text,jsonb,jsonb,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
