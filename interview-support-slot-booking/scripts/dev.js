'use strict';
// Serves the real UI and Netlify handlers; this is not a simulated booking backend.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),publicRoot=path.join(root,'public');
const env=path.join(root,'.env');if(fs.existsSync(env)){for(const line of fs.readFileSync(env,'utf8').split('\n')){const match=line.match(/^([A-Z_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,'');}}
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/.netlify/functions/')){
    const name=url.pathname.split('/').pop();if(!/^[a-z-]+$/.test(name)||!fs.existsSync(path.join(root,'netlify/functions',name+'.js'))){res.writeHead(404);res.end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>12000){res.writeHead(413);res.end();return;}}
    try{const result=await require(path.join(root,'netlify/functions',name+'.js')).handler({httpMethod:req.method,headers:req.headers,body,queryStringParameters:Object.fromEntries(url.searchParams)});res.writeHead(result.statusCode,result.headers);res.end(result.body);}catch{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Unable to complete request.'}));}return;
  }
  const routes={'/booking':'booking.html','/booking/':'booking.html','/':'index.html','/admin':'index.html','/admin/':'index.html'};
  const file=path.resolve(publicRoot,routes[url.pathname]||'.'+url.pathname);
  if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Interview booking app running at http://localhost:'+(process.env.PORT||3000)));
