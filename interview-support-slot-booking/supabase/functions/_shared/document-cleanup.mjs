export async function cleanupDocuments({claim,remove,finish}) {
 const sets=await claim();let deleted=0,failed=0;
 for(const set of sets){try{const paths=[set.resume,set.jd_file,...(set.additional_files||[])].filter(Boolean).map(file=>file.path);if(!paths.length||paths.some(path=>!new RegExp('^'+set.id+'/(resume|jd|additional-[1-3])\\.(pdf|docx|png|jpg|txt)$').test(path)))throw Error('Invalid document paths');await remove(paths);await finish(set.id);deleted++;}catch{failed++;}}
 return {deleted,failed};
}
