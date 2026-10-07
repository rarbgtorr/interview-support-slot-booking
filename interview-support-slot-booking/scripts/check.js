'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function walk(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);}
const files=[...walk(path.join(root,'public')),...walk(path.join(root,'netlify/functions'))];
for(const file of files.filter(file=>file.endsWith('.js'))){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}}
for(const html of files.filter(file=>file.endsWith('.html'))){const source=fs.readFileSync(html,'utf8');for(const match of source.matchAll(/(?:src|href)="([^"?#]+)"/g)){const value=match[1];if(value.startsWith('https:')||value.startsWith('/'))continue;if(!fs.existsSync(path.resolve(path.dirname(html),value)))throw new Error('Missing asset: '+value);}}
console.log('Build verified: JavaScript syntax and public page assets.');
