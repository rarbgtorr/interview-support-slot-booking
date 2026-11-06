begin;
alter table public.testing_support_document_sets drop constraint testing_support_document_sets_additional_files_check;
alter table public.testing_support_document_sets add constraint testing_support_document_sets_additional_files_check check(jsonb_typeof(additional_files)='array' and jsonb_array_length(additional_files)<=6);
alter table public.testing_support_document_sets drop constraint testing_support_document_sets_status_check;
alter table public.testing_support_document_sets add constraint testing_support_document_sets_status_check check(status in ('pending','attached','deleting','deleted','transferred'));
alter table public.testing_support_document_sets alter column resume drop not null;
alter table public.testing_support_document_sets add column purpose text not null default 'booking' check(purpose in ('booking','member_edit'));
alter table public.testing_support_document_sets add column target_document_id uuid references public.testing_support_document_sets(id);
alter table public.testing_support_document_sets add column target_appointment_id uuid references public.testing_support_appointments(id);
alter table public.testing_support_document_sets add column owner_email text;
alter table public.testing_support_document_sets add column target_revision integer;
alter table public.testing_support_document_sets add column target_document_revision integer;
alter table public.testing_support_document_sets add column document_revision integer not null default 0;
alter table public.testing_support_document_sets add column jd_mode text check(jd_mode in ('keep','text','file'));
alter table public.testing_support_document_sets add column retired_files jsonb not null default '[]'::jsonb check(jsonb_typeof(retired_files)='array');
alter table public.testing_support_document_sets add constraint testing_support_document_sets_resume_required check(purpose='member_edit' or resume is not null);
create index testing_support_document_sets_target_doc_idx on public.testing_support_document_sets(target_document_id) where target_document_id is not null;
create index testing_support_document_sets_target_appointment_idx on public.testing_support_document_sets(target_appointment_id) where target_appointment_id is not null;

create function public.testing_support_validate_document_files(p_id uuid,p_resume jsonb,p_jd_file jsonb,p_extras jsonb,p_require_resume boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; i integer:=0;
begin
 if jsonb_typeof(p_extras) is distinct from 'array' or jsonb_array_length(p_extras)>6 or (p_require_resume and p_resume is null) then raise exception using errcode='22023',message='Upload a resume and choose up to six additional documents';end if;
 for item in select value from jsonb_array_elements(jsonb_build_array(p_resume,p_jd_file)||p_extras) where value<>'null'::jsonb loop
  if jsonb_typeof(item) is distinct from 'object' or coalesce((item->>'size')::bigint,0) not between 1 and 2097152 or coalesce(char_length(item->>'name'),0) not between 1 and 180 or coalesce(item->>'path','') !~ ('^'||p_id::text||'/(resume|jd|additional-[1-6])\.(pdf|docx|png|jpg|txt)$') then raise exception using errcode='22023',message='Use supported documents up to 2 MB each';end if;
 end loop;
 if (p_resume is not null and coalesce(p_resume->>'path','') !~ ('^'||p_id::text||'/resume\.(pdf|docx)$')) or (p_jd_file is not null and coalesce(p_jd_file->>'path','') !~ ('^'||p_id::text||'/jd\.(pdf|docx|png|jpg)$')) then raise exception using errcode='22023',message='Choose supported resume and JD files';end if;
 for item in select value from jsonb_array_elements(p_extras) loop
  i:=i+1;if coalesce(item->>'path','') !~ ('^'||p_id::text||'/additional-'||i::text||'\.(pdf|docx|txt)$') then raise exception using errcode='22023',message='Additional documents must be PDF, DOCX or TXT';end if;
 end loop;
end;
$$;
create function public.testing_support_document_allocation()
returns bigint language sql security invoker set search_path='' as $$
 select coalesce(sum(2097152::bigint*((case when resume is null then 0 else 1 end)+(case when jd_file is null then 0 else 1 end)+jsonb_array_length(additional_files)+jsonb_array_length(retired_files))),0)::bigint from public.testing_support_document_sets where status not in ('deleted','transferred');
$$;
create or replace function public.testing_support_create_document_set_with_files(p_id uuid,p_token_hash text,p_resume jsonb,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare extras jsonb:=coalesce(p_additional_files,'[]'::jsonb);
begin
 perform pg_advisory_xact_lock(742903,1);
 perform public.testing_support_validate_document_files(p_id,p_resume,p_jd_file,extras,true);
 if char_length(coalesce(p_jd_text,''))>10000 or (p_jd_file is not null and char_length(trim(coalesce(p_jd_text,'')))>0) then raise exception using errcode='22023',message='Choose a JD file or pasted JD text up to 10000 characters';end if;
 if public.testing_support_document_allocation()+2097152::bigint*(1+(case when p_jd_file is null then 0 else 1 end)+jsonb_array_length(extras))>67108864 then raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';end if;
 insert into public.testing_support_document_sets(id,token_hash,resume,jd_file,jd_text,additional_files) values(p_id,p_token_hash,p_resume,p_jd_file,coalesce(p_jd_text,''),extras);
 return jsonb_build_object('id',p_id);
end;
$$;
create or replace function public.testing_support_document_expiry(p_document_id uuid)
returns timestamptz language sql stable security invoker set search_path='' as $$
 select case when d.purpose='member_edit' then least(d.created_at+interval '24 hours',public.testing_support_document_expiry(d.target_document_id)) when d.status='pending' then d.created_at+interval '24 hours'
 else coalesce((select max(a.ends_at) from public.testing_support_appointments a where a.document_set_id=d.id),d.created_at)+interval '24 hours' end from public.testing_support_document_sets d where d.id=p_document_id;
$$;
create function public.testing_support_member_document_info(p_email text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; expiry timestamptz;
begin
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id and purpose='booking';
 expiry:=public.testing_support_document_expiry(d.id);
 return jsonb_build_object('revision',a.revision,'documentRevision',d.document_revision,'jdText',coalesce(d.jd_text,a.jd_text,''),'resumeName',d.resume->>'name','jdFileName',d.jd_file->>'name','additionalFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f->>'name')) from jsonb_array_elements(d.additional_files) f),'[]'::jsonb),'sharedCount',(select count(*) from public.testing_support_appointments where document_set_id=d.id),'canEdit',coalesce(a.status='booked' and a.starts_at>now() and d.status='attached' and expiry>now() and not exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email),false));
end;
$$;
create function public.testing_support_prepare_member_documents(p_email text,p_id uuid,p_revision integer,p_document_revision integer,p_upload_id uuid,p_token_hash text,p_resume jsonb,p_jd_mode text,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; extras jsonb:=coalesce(p_additional_files,'[]'::jsonb);
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id for update;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() or d.id is null or d.purpose<>'booking' or d.status<>'attached' or public.testing_support_document_expiry(d.id)<=now() then raise exception using errcode='22023',message='Documents can only be updated for an upcoming booking with available files';end if;
 if exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email) then raise exception using errcode='42501',message='You cannot change these documents';end if;
 if a.revision is distinct from p_revision or d.document_revision is distinct from p_document_revision then raise exception using errcode='40001',message='Booking documents changed. Reopen Documents before saving';end if;
 perform public.testing_support_validate_document_files(p_upload_id,p_resume,p_jd_file,extras,false);
 if jsonb_array_length(d.additional_files)+jsonb_array_length(extras)>6 then raise exception using errcode='22023',message='A booking can have up to six additional documents in total';end if;
 if p_jd_mode is null or p_jd_mode not in ('keep','text','file') or char_length(coalesce(p_jd_text,''))>10000 or (p_jd_mode='file' and p_jd_file is null) or (p_jd_mode<>'file' and p_jd_file is not null) or (p_jd_mode<>'text' and coalesce(p_jd_text,'')<>'') then raise exception using errcode='22023',message='Choose a JD file or pasted JD text';end if;
 if public.testing_support_document_allocation()+2097152::bigint*((case when p_resume is null then 0 else 1 end)+(case when p_jd_file is null then 0 else 1 end)+jsonb_array_length(extras))>67108864 then raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';end if;
 insert into public.testing_support_document_sets(id,token_hash,resume,jd_file,jd_text,additional_files,purpose,target_document_id,target_appointment_id,owner_email,target_revision,target_document_revision,jd_mode)
 values(p_upload_id,p_token_hash,p_resume,p_jd_file,coalesce(p_jd_text,''),extras,'member_edit',d.id,a.id,a.email,a.revision,d.document_revision,p_jd_mode);
 return jsonb_build_object('id',p_upload_id);
end;
$$;
create function public.testing_support_commit_member_documents(p_email text,p_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; u public.testing_support_document_sets; retired jsonb:='[]'::jsonb; new_text text; new_jd jsonb;
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into u from public.testing_support_document_sets where id=p_upload_id and purpose='member_edit' and owner_email=a.email and target_appointment_id=a.id and target_document_id=a.document_set_id for update;
 if not found then raise exception using errcode='P0002',message='Document update not found';end if;
 if u.status='transferred' then return jsonb_build_object('ok',true);end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id for update;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() or d.status<>'attached' or public.testing_support_document_expiry(d.id)<=now() or u.status<>'pending' or public.testing_support_document_expiry(u.id)<=now() then raise exception using errcode='22023',message='This document update expired or the booking is no longer available';end if;
 if exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email) then raise exception using errcode='42501',message='You cannot change these documents';end if;
 if a.revision is distinct from u.target_revision or d.document_revision is distinct from u.target_document_revision then raise exception using errcode='40001',message='Booking documents changed. Reopen Documents before saving';end if;
 if jsonb_array_length(d.additional_files)+jsonb_array_length(u.additional_files)>6 then raise exception using errcode='22023',message='A booking can have up to six additional documents in total';end if;
 if u.resume is not null then retired:=retired||jsonb_build_array(d.resume);end if;
 if u.jd_mode<>'keep' and d.jd_file is not null then retired:=retired||jsonb_build_array(d.jd_file);end if;
 new_text:=case when u.jd_mode='keep' then d.jd_text when u.jd_mode='text' then u.jd_text else '' end;
 new_jd:=case when u.jd_mode='keep' then d.jd_file when u.jd_mode='file' then u.jd_file else null end;
 update public.testing_support_document_sets set resume=coalesce(u.resume,d.resume),jd_file=new_jd,jd_text=new_text,additional_files=d.additional_files||u.additional_files,retired_files=d.retired_files||retired,document_revision=document_revision+1 where id=d.id;
 update public.testing_support_appointments set jd_text=new_text,revision=revision+1,updated_at=now() where document_set_id=d.id;
 update public.testing_support_document_sets set status='transferred' where id=u.id;
 return jsonb_build_object('ok',true);
end;
$$;
create or replace function public.testing_support_claim_expired_documents(p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(742903,1);
 -- Invalidate unfinished updates before claiming their original document set.
 update public.testing_support_document_sets u set status='deleting' where u.purpose='member_edit' and u.status='pending' and public.testing_support_document_expiry(u.id)<=now();
 with eligible as (
  select d.id from public.testing_support_document_sets d where d.status='deleting' or (d.status in ('pending','attached') and public.testing_support_document_expiry(d.id)<=now())
  order by d.created_at limit least(greatest(p_limit,1),100) for update
 ), claimed as (
  update public.testing_support_document_sets d set status='deleting' from eligible e where d.id=e.id returning d.id,d.purpose,d.resume,d.jd_file,d.additional_files,d.retired_files
 ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('upload_ids',coalesce((select jsonb_agg(u.id) from public.testing_support_document_sets u where u.target_document_id=c.id and u.status='transferred'),'[]'::jsonb))),'[]'::jsonb) into result from claimed c;
 return result;
end;
$$;
revoke all on function public.testing_support_validate_document_files(uuid,jsonb,jsonb,jsonb,boolean),public.testing_support_document_allocation(),public.testing_support_member_document_info(text,uuid),public.testing_support_prepare_member_documents(text,uuid,integer,integer,uuid,text,jsonb,text,jsonb,text,jsonb),public.testing_support_commit_member_documents(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.testing_support_validate_document_files(uuid,jsonb,jsonb,jsonb,boolean),public.testing_support_document_allocation(),public.testing_support_member_document_info(text,uuid),public.testing_support_prepare_member_documents(text,uuid,integer,integer,uuid,text,jsonb,text,jsonb,text,jsonb),public.testing_support_commit_member_documents(text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
