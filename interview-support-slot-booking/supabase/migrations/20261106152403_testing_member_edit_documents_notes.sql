begin;
alter table public.testing_support_document_sets add column member_notes text check(char_length(member_notes)<=2000);
create or replace function public.testing_support_member_document_info(p_email text,p_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; expiry timestamptz; files jsonb;
begin
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id and purpose='booking';expiry:=public.testing_support_document_expiry(d.id);
 select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'name',item->>'name') order by ordering),'[]'::jsonb) into files from (
  select * from (values(1,'resume',d.resume),(2,'invite',d.invite_file),(3,'jd',d.jd_file)) f(ordering,kind,item)
  union all select 3+ord::integer,'additional-'||ord::text,value from jsonb_array_elements(d.additional_files) with ordinality f(value,ord)
 ) q where item is not null and item<>'null'::jsonb;
 return jsonb_build_object('notes',coalesce(a.notes,''),'canEditNotes',a.status='booked' and a.starts_at>now(),'revision',a.revision,'documentRevision',d.document_revision,'jdText',coalesce(d.jd_text,a.jd_text,''),'resumeName',d.resume->>'name','inviteName',d.invite_file->>'name','inviteRequired',coalesce(d.invite_required,false),'jdFileName',d.jd_file->>'name','files',files,'available',coalesce(d.status='attached' and expiry>now(),false),'additionalFiles',coalesce((select jsonb_agg(jsonb_build_object('name',f->>'name')) from jsonb_array_elements(d.additional_files) f),'[]'::jsonb),'date',a.service_date,'startMinute',a.start_minute,'timezone',a.timezone,'sharedCount',(select count(*) from public.testing_support_appointments where document_set_id=d.id),'canEdit',coalesce(a.status='booked' and a.starts_at>now() and d.status='attached' and expiry>now() and not exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email),false));
end;
$$;
create or replace function public.testing_support_prepare_member_document_changes(p_email text,p_id uuid,p_revision integer,p_document_revision integer,p_upload_id uuid,p_token_hash text,p_resume jsonb,p_invite_file jsonb,p_jd_mode text,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb,p_remove_kinds jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; extras jsonb:=coalesce(p_additional_files,'[]'::jsonb); removed jsonb:=coalesce(p_remove_kinds,'[]'::jsonb); kept jsonb; kind text;
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id for update;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() or d.id is null or d.purpose<>'booking' or d.status<>'attached' or public.testing_support_document_expiry(d.id)<=now() then raise exception using errcode='22023',message='Documents can only be updated for an upcoming booking with available files';end if;
 if exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email) then raise exception using errcode='42501',message='You cannot change these documents';end if;
 if a.revision is distinct from p_revision or d.document_revision is distinct from p_document_revision then raise exception using errcode='40001',message='Booking documents changed. Reopen Documents before saving';end if;
 if p_invite_file is not null or removed ? 'invite' then raise exception using errcode='42501',message='Interview invite screenshots cannot be changed';end if;
 if jsonb_typeof(removed) is distinct from 'array' or jsonb_array_length(removed)>9 then raise exception using errcode='22023',message='Choose valid documents to remove';end if;
 if exists(select 1 from jsonb_array_elements_text(removed) f where f is null or f !~ '^(resume|invite|jd|additional-[1-6])$') or (select count(*)<>count(distinct f) from jsonb_array_elements_text(removed) f) then raise exception using errcode='22023',message='Choose valid documents to remove';end if;
 for kind in select value from jsonb_array_elements_text(removed) loop
  if (kind='resume' and d.resume is null) or (kind='invite' and d.invite_file is null) or (kind='jd' and d.jd_file is null) or (kind like 'additional-%' and substring(kind from 12)::integer>jsonb_array_length(d.additional_files)) then raise exception using errcode='22023',message='A selected document is no longer attached';end if;
 end loop;
 if removed ? 'resume' and p_resume is null then raise exception using errcode='22023',message='Choose a replacement resume before saving';end if;
 if d.invite_required and removed ? 'invite' and p_invite_file is null then raise exception using errcode='22023',message='Choose a replacement interview invite screenshot before saving';end if;
 perform public.testing_support_validate_document_files(p_upload_id,p_resume,p_jd_file,extras,false);
 if p_invite_file is not null then perform public.testing_support_validate_invite(p_upload_id,p_invite_file);end if;
 kept:=public.testing_support_kept_additional(d.additional_files,removed);
 if jsonb_array_length(kept)+jsonb_array_length(extras)>6 then raise exception using errcode='22023',message='A booking can have up to six additional documents in total';end if;
 if p_jd_mode is null or p_jd_mode not in ('keep','text','file') or char_length(coalesce(p_jd_text,''))>10000 or (p_jd_mode='file' and p_jd_file is null) or (p_jd_mode<>'file' and p_jd_file is not null) or (p_jd_mode<>'text' and coalesce(p_jd_text,'')<>'') then raise exception using errcode='22023',message='Choose a JD file or pasted JD text';end if;
 if public.testing_support_document_allocation()+2097152::bigint*((case when p_resume is null then 0 else 1 end)+(case when p_invite_file is null then 0 else 1 end)+(case when p_jd_file is null then 0 else 1 end)+jsonb_array_length(extras))>67108864 then raise exception using errcode='22023',message='Document storage is temporarily full. Please contact the administrator';end if;
 insert into public.testing_support_document_sets(id,token_hash,resume,invite_file,jd_file,jd_text,additional_files,purpose,target_document_id,target_appointment_id,owner_email,target_revision,target_document_revision,jd_mode,remove_kinds)
 values(p_upload_id,p_token_hash,p_resume,p_invite_file,p_jd_file,coalesce(p_jd_text,''),extras,'member_edit',d.id,a.id,a.email,a.revision,d.document_revision,p_jd_mode,removed);
 return jsonb_build_object('id',p_upload_id);
end;
$$;
create function public.testing_support_prepare_member_document_update(p_email text,p_id uuid,p_revision integer,p_document_revision integer,p_upload_id uuid,p_token_hash text,p_resume jsonb,p_notes text,p_jd_mode text,p_jd_file jsonb,p_jd_text text,p_additional_files jsonb,p_remove_kinds jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if char_length(p_notes)>2000 then raise exception using errcode='22023',message='Notes must be no longer than 2000 characters';end if;
 perform public.testing_support_prepare_member_document_changes(p_email,p_id,p_revision,p_document_revision,p_upload_id,p_token_hash,p_resume,null,p_jd_mode,p_jd_file,p_jd_text,p_additional_files,p_remove_kinds);
 update public.testing_support_document_sets set member_notes=p_notes where id=p_upload_id;
 return jsonb_build_object('id',p_upload_id);
end;
$$;
revoke all on function public.testing_support_prepare_member_document_update(text,uuid,integer,integer,uuid,text,jsonb,text,text,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.testing_support_prepare_member_document_update(text,uuid,integer,integer,uuid,text,jsonb,text,text,jsonb,text,jsonb,jsonb) to service_role;
create or replace function public.testing_support_commit_member_documents(p_email text,p_id uuid,p_upload_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.testing_support_appointments; d public.testing_support_document_sets; u public.testing_support_document_sets; retired jsonb:='[]'::jsonb; new_text text; new_jd jsonb; new_invite jsonb; kept jsonb; removed jsonb;
begin
 perform pg_advisory_xact_lock(742903,1);
 select * into a from public.testing_support_appointments where id=p_id and email=lower(trim(p_email)) and email is not null for update;
 if not found then raise exception using errcode='P0002',message='Booking not found';end if;
 select * into u from public.testing_support_document_sets where id=p_upload_id and purpose='member_edit' and owner_email=a.email and target_appointment_id=a.id and target_document_id=a.document_set_id for update;
 if not found then raise exception using errcode='P0002',message='Document update not found';end if;
 if u.status='transferred' then return jsonb_build_object('ok',true);end if;
 if u.invite_file is not null or u.remove_kinds ? 'invite' then raise exception using errcode='42501',message='Interview invite screenshots cannot be changed';end if;
 select * into d from public.testing_support_document_sets where id=a.document_set_id for update;
 if a.status<>'booked' or a.starts_at<=clock_timestamp() or d.status<>'attached' or public.testing_support_document_expiry(d.id)<=now() or u.status<>'pending' or public.testing_support_document_expiry(u.id)<=now() then raise exception using errcode='22023',message='This document update expired or the booking is no longer available';end if;
 if exists(select 1 from public.testing_support_appointments where document_set_id=d.id and email is distinct from a.email) then raise exception using errcode='42501',message='You cannot change these documents';end if;
 if a.revision is distinct from u.target_revision or d.document_revision is distinct from u.target_document_revision then raise exception using errcode='40001',message='Booking documents changed. Reopen Documents before saving';end if;
 removed:=u.remove_kinds;kept:=public.testing_support_kept_additional(d.additional_files,removed);
 if jsonb_array_length(kept)+jsonb_array_length(u.additional_files)>6 then raise exception using errcode='22023',message='A booking can have up to six additional documents in total';end if;
 if removed ? 'resume' and u.resume is null then raise exception using errcode='22023',message='A replacement resume is required';end if;
 if d.invite_required and removed ? 'invite' and u.invite_file is null then raise exception using errcode='22023',message='A replacement invite screenshot is required';end if;
 if u.resume is not null and d.resume is not null then retired:=retired||jsonb_build_array(d.resume);end if;
 if (u.invite_file is not null or removed ? 'invite') and d.invite_file is not null then retired:=retired||jsonb_build_array(d.invite_file);end if;
 if (u.jd_mode<>'keep' or removed ? 'jd') and d.jd_file is not null then retired:=retired||jsonb_build_array(d.jd_file);end if;
 select retired||coalesce(jsonb_agg(value order by ord),'[]'::jsonb) into retired from jsonb_array_elements(d.additional_files) with ordinality f(value,ord) where removed ? ('additional-'||ord::text);
 new_text:=case when u.jd_mode='text' then u.jd_text when u.jd_mode='keep' and not removed ? 'jd' then d.jd_text else '' end;
 new_jd:=case when u.jd_mode='file' then u.jd_file when u.jd_mode='keep' and not removed ? 'jd' then d.jd_file else null end;
 new_invite:=case when u.invite_file is not null then u.invite_file when removed ? 'invite' then null else d.invite_file end;
 update public.testing_support_document_sets set resume=coalesce(u.resume,d.resume),invite_file=new_invite,jd_file=new_jd,jd_text=new_text,additional_files=kept||u.additional_files,retired_files=d.retired_files||retired,document_revision=document_revision+1 where id=d.id;
 update public.testing_support_appointments set jd_text=new_text,notes=case when id=a.id and u.member_notes is not null then u.member_notes else notes end,revision=revision+1,updated_at=now() where document_set_id=d.id;
 update public.testing_support_document_sets set status='transferred' where id=u.id;
 return jsonb_build_object('ok',true);
end;
$$;
notify pgrst,'reload schema';
commit;
