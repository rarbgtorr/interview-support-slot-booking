begin;

alter table public.support_document_sets add column project_reference jsonb;

create or replace function public.support_document_allocation()
returns bigint language sql security invoker set search_path='' as $$
 select coalesce(sum(2097152::bigint*((case when resume is null then 0 else 1 end)+(case when invite_file is null then 0 else 1 end)+(case when jd_file is null then 0 else 1 end)+(case when project_reference is null then 0 else 1 end)+jsonb_array_length(additional_files)+jsonb_array_length(retired_files))),0)::bigint from public.support_document_sets where status not in ('deleted','transferred');
$$;

-- The caller's document-set RPC holds the same allocation lock until commit.
create function public.support_set_project_reference(p_id uuid,p_file jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_file) is distinct from 'object'
    or coalesce((p_file->>'size')::bigint,0) not between 1 and 2097152
    or coalesce(char_length(p_file->>'name'),0) not between 1 and 180
    or not coalesce(
      (p_file->>'path'=p_id::text||'/project_reference.txt' and p_file->>'type'='text/plain')
      or (p_file->>'path'=p_id::text||'/project_reference.docx' and p_file->>'type'='application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      false
    ) then
  raise exception using errcode='22023',message='Upload the project reference as TXT or DOCX, up to 2 MB';
 end if;
 if public.support_document_allocation()+2097152>67108864 then
  raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';
 end if;
 update public.support_document_sets set project_reference=p_file where id=p_id;
end;
$$;

create function public.support_create_document_set_with_reference(
 p_id uuid,p_token_hash text,p_resume jsonb,p_invite_file jsonb,p_project_reference jsonb,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.support_create_document_set_with_invite(p_id,p_token_hash,p_resume,p_invite_file,p_jd_file,p_jd_text,p_additional_files);
 perform public.support_set_project_reference(p_id,p_project_reference);
 return result;
end;
$$;

create function public.support_book_interview_with_reference(
 p_data jsonb,p_slots jsonb,p_document_id uuid,p_token_hash text,p_admin boolean,p_id uuid
)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(742902,1);
 if p_admin is distinct from false or p_id is not null or p_data->>'type' is distinct from 'interview' then
  raise exception using errcode='22023',message='Choose an interview booking';
 end if;
 if not exists(select 1 from public.support_document_sets where id=p_document_id and token_hash=p_token_hash and project_reference is not null) then
  raise exception using errcode='22023',message='Please upload the project reference document.';
 end if;
 return public.support_book_with_documents(p_data,p_slots,p_document_id,p_token_hash,false,null);
end;
$$;

create function public.support_prepare_member_reference_update(
 p_email text,p_id uuid,p_revision integer,p_document_revision integer,p_upload_id uuid,p_token_hash text,
 p_resume jsonb,p_project_reference jsonb,p_notes text,p_jd_mode text,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb,p_remove_kinds jsonb
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 result:=public.support_prepare_member_document_update(
  p_email,p_id,p_revision,p_document_revision,p_upload_id,p_token_hash,p_resume,p_notes,
  p_jd_mode,p_jd_file,p_jd_text,p_additional_files,p_remove_kinds
 );
 if not exists(
  select 1 from public.support_appointments a
  join public.support_document_sets d on d.id=a.document_set_id
  where a.id=p_id and (a.booking_type='interview' or d.project_reference is not null)
 ) then
  raise exception using errcode='22023',message='Project reference documents are for interview bookings';
 end if;
 perform public.support_set_project_reference(p_upload_id,p_project_reference);
 return result;
end;
$$;

create or replace function public.support_member_document_info(p_email text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.support_appointments; d public.support_document_sets; expiry timestamptz; files jsonb;
begin
 select * into a from public.support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into d from public.support_document_sets where id=a.document_set_id and purpose='booking';expiry:=public.support_document_expiry(d.id);
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',item->>'name') order by ordering),'[]'::jsonb) into files from (
  select * from (values(1,'resume',d.resume),(2,'invite',d.invite_file),(3,'jd',d.jd_file),(4,'project_reference',d.project_reference)) f(ordering,kind,item)
  union all select 4+ord::integer,'additional-'||ord::text,value from jsonb_array_elements(d.additional_files) with ordinality f(value,ord)
 ) q where item is not null and item<>'null'::jsonb;
 return jsonb_build_object('notes',coalesce(a.notes,''),'canEditNotes',a.status='booked' and a.starts_at>now(),'revision',a.revision,'documentRevision',d.document_revision,'jdText',coalesce(d.jd_text,a.jd_text,''),'resumeName',d.resume->>'name','inviteName',d.invite_file->>'name','inviteRequired',coalesce(d.invite_required,false),'jdFileName',d.jd_file->>'name','files',files,'available',coalesce(d.status='attached' and expiry>now(),false),'additionalFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f->>'name')) from jsonb_array_elements(d.additional_files) f),'[]'::jsonb),'date',a.service_date,'startMinute',a.start_minute,'timezone',a.timezone,'sharedCount',(select count(*) from public.support_appointments where document_set_id=d.id),'canEdit',coalesce(a.status='booked' and a.starts_at>now() and d.status='attached' and expiry>now() and not exists(select 1 from public.support_appointments where document_set_id=d.id and email is distinct from a.email),false));
end;
$$;

create or replace function public.support_commit_member_documents(p_email text,p_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.support_appointments; d public.support_document_sets; u public.support_document_sets; retired jsonb:='[]'::jsonb; new_text text; new_jd jsonb; new_invite jsonb; kept jsonb; removed jsonb;
begin
 perform pg_advisory_xact_lock(742902,1);
 select * into a from public.support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into u from public.support_document_sets where id=p_upload_id and purpose='member_edit' and owner_email=a.email and target_appointment_id=a.id and target_document_id=a.document_set_id for update;
 if not found then raise exception using errcode='P0002',message='Document update not found';end if;
 if u.status='transferred' then return jsonb_build_object('ok',true);end if;
 if u.invite_file is not null or u.remove_kinds ? 'invite' then raise exception using errcode='42501',message='Interview invite screenshots cannot be changed';end if;
 select * into d from public.support_document_sets where id=a.document_set_id for update;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() or d.status<>'attached' or public.support_document_expiry(d.id)<=now() or u.status<>'pending' or public.support_document_expiry(u.id)<=now() then raise exception using errcode='22023',message='This document update expired or the booking is no longer available';end if;
 if exists(select 1 from public.support_appointments where document_set_id=d.id and email is distinct from a.email) then raise exception using errcode='42501',message='You cannot change these documents';end if;
 if a.revision is distinct from u.target_revision or d.document_revision is distinct from u.target_document_revision then raise exception using errcode='40001',message='Booking documents changed. Reopen Documents before saving';end if;
 removed:=u.remove_kinds;kept:=public.support_kept_additional(d.additional_files,removed);
 if jsonb_array_length(kept)+jsonb_array_length(u.additional_files)>6 then raise exception using errcode='22023',message='A booking can have up to six additional documents in total';end if;
 if removed ? 'resume' and u.resume is null then raise exception using errcode='22023',message='A replacement resume is required';end if;
 if d.invite_required and removed ? 'invite' and u.invite_file is null then raise exception using errcode='22023',message='A replacement invite screenshot is required';end if;
 if u.project_reference is not null and d.project_reference is not null then retired:=retired||jsonb_build_array(d.project_reference);end if;
 if u.resume is not null and d.resume is not null then retired:=retired||jsonb_build_array(d.resume);end if;
 if (u.invite_file is not null or removed ? 'invite') and d.invite_file is not null then retired:=retired||jsonb_build_array(d.invite_file);end if;
 if (u.jd_mode<>'keep' or removed ? 'jd') and d.jd_file is not null then retired:=retired||jsonb_build_array(d.jd_file);end if;
 select retired||coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into retired from jsonb_array_elements(d.additional_files) with ordinality f(value,ord) where removed ? ('additional-'||ord::text);
 new_text:=case when u.jd_mode='text' then u.jd_text when u.jd_mode='keep' and not removed ? 'jd' then d.jd_text else '' end;
 new_jd:=case when u.jd_mode='file' then u.jd_file when u.jd_mode='keep' and not removed ? 'jd' then d.jd_file else null end;
 new_invite:=case when u.invite_file is not null then u.invite_file when removed ? 'invite' then null else d.invite_file end;
 update public.support_document_sets set resume=coalesce(u.resume,d.resume),invite_file=new_invite,project_reference=coalesce(u.project_reference,d.project_reference),jd_file=new_jd,jd_text=new_text,additional_files=kept||u.additional_files,retired_files=d.retired_files||retired,document_revision=document_revision+1 where id=d.id;
 update public.support_appointments set jd_text=new_text,notes=case when id=a.id and u.member_notes is not null then u.member_notes else notes end,revision=revision+1,updated_at=now() where document_set_id=d.id;
 update public.support_document_sets set status='transferred' where id=u.id;
 return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.support_claim_expired_documents(p_limit integer default 50)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 perform pg_advisory_xact_lock(742902,1);
 update public.support_document_sets u set status='deleting' where u.purpose='member_edit' and u.status='pending' and public.support_document_expiry(u.id)<=now();
 with eligible as (
  select d.id from public.support_document_sets d where d.status='deleting' or (d.status in ('pending','attached') and public.support_document_expiry(d.id)<=now()) order by d.created_at limit least(greatest(p_limit,1),100) for update
 ), claimed as (
  update public.support_document_sets d set status='deleting' from eligible e where d.id=e.id returning d.id,d.purpose,d.resume,d.invite_file,d.project_reference,d.jd_file,d.additional_files,d.retired_files
 ) select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('upload_ids',coalesce((select jsonb_agg(u.id) from public.support_document_sets u where u.target_document_id=c.id and u.status='transferred'),'[]'::jsonb))),'[]'::jsonb) into result from claimed c;return result;
end;
$$;

revoke all on function public.support_set_project_reference(uuid,jsonb),
 public.support_create_document_set_with_reference(uuid,text,jsonb,jsonb,jsonb,jsonb,text,jsonb),
 public.support_book_interview_with_reference(jsonb,jsonb,uuid,text,boolean,uuid),
 public.support_prepare_member_reference_update(text,uuid,integer,integer,uuid,text,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function public.support_set_project_reference(uuid,jsonb),
 public.support_create_document_set_with_reference(uuid,text,jsonb,jsonb,jsonb,jsonb,text,jsonb),
 public.support_book_interview_with_reference(jsonb,jsonb,uuid,text,boolean,uuid),
 public.support_prepare_member_reference_update(text,uuid,integer,integer,uuid,text,jsonb,jsonb,text,text,jsonb,text,jsonb,jsonb)
 to service_role;

notify pgrst,'reload schema';
commit;
