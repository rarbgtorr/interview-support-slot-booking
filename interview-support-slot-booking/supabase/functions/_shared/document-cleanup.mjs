export async function cleanupDocuments({claim,remove,finish}) {
 const sets=await claim();let deleted=0,failed=0;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 for(const set of sets){try{
  const owners=[set.id,...(set.upload_ids||[])];if(owners.some(id=>!uuid.test(id)))throw Error('Invalid document owners');
  const paths=[...new Set([set.resume,set.invite_file,set.jd_file,...(set.additional_files||[]),...(set.retired_files||[])].filter(Boolean).map(file=>file.path))];
  if(!paths.length&&set.purpose!=='member_edit')throw Error('Missing documents');
  if(paths.some(path=>{if(typeof path!=='string')return true;const [owner,name,...extra]=path.split('/');return extra.length||!owners.includes(owner)||!/^(resume|invite|jd|additional-[1-6])\.(pdf|docx|png|jpg|txt)$/.test(name);}))throw Error('Invalid document paths');
  if(paths.length)await remove(paths);await finish(set.id);deleted++;
 }catch{failed++;}}
 return {deleted,failed};
}
