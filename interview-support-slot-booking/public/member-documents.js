'use strict';
window.MemberDocuments=(()=>{
 const el=id=>document.getElementById(id);let current=null,info=null,intent=null,intentKey=null,pending=false,epoch=0;
 const message=(text,error=false)=>{el('memberDocumentStatus').textContent=text;el('memberDocumentStatus').classList.toggle('error',error);};
 const fields=()=>el('memberDocumentForm').querySelectorAll('input,select,textarea,button');
 function modes(){const mode=el('updateJdMode').value;el('updateJdTextLabel').classList.toggle('hidden',mode!=='text');el('updateJdFileLabel').classList.toggle('hidden',mode!=='file');el('updateJdFile').required=mode==='file';}
 function controls(){for(const field of fields())field.disabled=pending||!info?.canEdit;el('updateAdditionalFiles').disabled=pending||!info?.canEdit||(info?.additionalFiles.length||0)>=6;el('saveDocuments').textContent=pending?'Saving documents…':'Save documents';el('saveDocuments').setAttribute('aria-busy',String(pending));el('closeMemberDocuments').disabled=pending;}
 function clear(){current=null;info=null;intent=null;intentKey=null;pending=false;el('memberDocumentForm').reset();el('currentDocumentList').replaceChildren();for(const id of ['currentResume','currentJd','additionalDocumentHint'])el(id).textContent='';el('sharedDocumentHint').textContent='';el('memberDocumentTime').textContent='';message('');if(el('memberDocumentDialog').open)el('memberDocumentDialog').close();}
 async function open(appointment){
  if(pending)return;const stamp=++epoch;clear();current=appointment;el('memberDocumentTime').textContent=Schedule.localLabel(appointment.service_date,appointment.start_minute,30,appointment.timezone)+' · '+appointment.timezone;el('memberDocumentDialog').showModal();message('Loading documents…');controls();modes();
  try{const data=await api('member-documents?appointmentId='+encodeURIComponent(appointment.id));if(stamp!==epoch||!current)return;info=data;
   el('currentResume').textContent=data.resumeName?'Current resume: '+data.resumeName:'No resume attached.';el('currentJd').textContent=data.jdFileName?'Current JD file: '+data.jdFileName:data.jdText?'A pasted job description is attached.':'No job description attached.';el('updateJdText').value=data.jdText||'';
   el('currentDocumentList').replaceChildren(...data.additionalFiles.map(file=>{const li=document.createElement('li');li.textContent=file.name;return li;}));
   el('additionalDocumentHint').textContent=data.additionalFiles.length+' of 6 additional documents attached. '+(data.additionalFiles.length>=6?'The limit has been reached.':'You can add '+(6-data.additionalFiles.length)+' more.');
   el('sharedDocumentHint').textContent=data.sharedCount>1?'These documents are shared by your linked appointments. Changes apply to all of them.':'';message(data.canEdit?'': 'Documents cannot be changed for this booking. Contact the administrator if you need help.');controls();
  }catch(error){if(stamp===epoch&&current)message(error.message,true);}
 }
 function descriptor(file){return {name:file.name,size:file.size,type:file.type};}
 function validate(file,kind){if(!file)return;if(!file.size||file.size>2097152)throw Error(kind+' must be no larger than 2 MB.');const ext=file.name.split('.').pop().toLowerCase(),allowed=kind==='Resume'?['pdf','docx']:kind==='JD'?['pdf','docx','png','jpg','jpeg']:['pdf','docx','txt'];if(!allowed.includes(ext))throw Error('Choose a supported '+kind+' file.');}
 function upload(target,file){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('PUT',target.url);xhr.timeout=90000;xhr.upload.onprogress=e=>message('Uploading '+file.name+(e.lengthComputable?' · '+Math.round(e.loaded/e.total*100)+'%':'…'));xhr.onload=()=>xhr.status>=200&&xhr.status<300||xhr.status===409?resolve():reject(Error('Unable to upload '+file.name+'. Please retry.'));xhr.onerror=xhr.ontimeout=()=>reject(Error('Upload interrupted. Check your connection and retry.'));const form=new FormData();form.append('cacheControl','0');form.append('',new Blob([file],{type:target.type}),file.name);xhr.send(form);});}
 el('updateJdMode').onchange=modes;
 el('closeMemberDocuments').onclick=()=>{if(!pending){epoch++;clear();}};
 el('memberDocumentDialog').addEventListener('cancel',event=>{if(pending)event.preventDefault();else{epoch++;clear();}});
 el('memberDocumentForm').onsubmit=async event=>{
  event.preventDefault();if(pending||!current||!info?.canEdit)return;const stamp=epoch,appointment=current;
  const resume=el('updateResume').files[0],jdMode=el('updateJdMode').value,jdFile=jdMode==='file'?el('updateJdFile').files[0]:null,additional=Array.from(el('updateAdditionalFiles').files),jdText=jdMode==='text'?el('updateJdText').value.trim():'';
  try{
   if(additional.length+info.additionalFiles.length>6)throw Error('A booking can have up to six additional documents in total.');validate(resume,'Resume');validate(jdFile,'JD');for(const file of additional)validate(file,'Additional document');if(jdMode==='file'&&!jdFile)throw Error('Choose a JD file.');if(jdText.length>10000)throw Error('JD text must be no longer than 10000 characters.');if(!resume&&!jdFile&&!additional.length&&jdMode==='keep'){message('Choose a file or change the job description before saving.');return;}
   const payload={action:'prepare',appointmentId:appointment.id,revision:info.revision,documentRevision:info.documentRevision,resume:resume?descriptor(resume):null,jdMode,jdFile:jdFile?descriptor(jdFile):null,jdText,additionalFiles:additional.map(descriptor)};
   const key=JSON.stringify(payload)+':'+[resume,jdFile,...additional].filter(Boolean).map(file=>file.lastModified).join(',');pending=true;controls();message('Preparing secure uploads…');
   if(!intent||intentKey!==key||Date.now()-intent.createdAt>7100000){const created=await api('member-documents',{method:'POST',body:JSON.stringify(payload)});if(stamp!==epoch||!current)return;intent={...created,createdAt:Date.now()};intentKey=key;}
   for(const target of intent.uploads){if(target.complete)continue;const file=target.path.includes('/resume.')?resume:target.path.includes('/jd.')?jdFile:additional[Number(target.path.match(/additional-(\d+)/)?.[1])-1];await upload(target,file);if(stamp!==epoch||!current)return;target.complete=true;}
   message('Saving your documents…');await api('member-documents',{method:'POST',body:JSON.stringify({action:'save',appointmentId:appointment.id,updateId:intent.updateId})});if(stamp!==epoch||!current)return;clear();await load();note('Documents updated successfully.');
  }catch(error){if(stamp===epoch){if(current)message(error.message,true);else note(error.message,true);}}
  finally{if(stamp===epoch){pending=false;controls();}}
 };
 window.addEventListener('member-logged-out',()=>{epoch++;clear();});
 return {open};
})();
