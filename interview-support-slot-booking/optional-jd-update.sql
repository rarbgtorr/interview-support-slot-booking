begin;
alter table public.support_document_sets drop constraint if exists support_document_sets_check;
create or replace function public.support_create_document_set_with_files(p_id uuid,p_token_hash text,p_resume jsonb,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; allocated bigint; extras jsonb:=coalesce(p_additional_files,'[]'::jsonb); i integer:=0;
begin
 perform pg_advisory_xact_lock(742902,1);
 if jsonb_typeof(extras) is distinct from 'array' then raise exception using errcode='22023',message='Choose up to three additional documents'; end if;
 if jsonb_array_length(extras)>3 or p_resume is null or char_length(coalesce(p_jd_text,''))>10000 then
  raise exception using errcode='22023',message='Upload a resume and choose up to three additional documents';
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
notify pgrst,'reload schema';
commit;
