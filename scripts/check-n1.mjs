import {readFileSync} from 'fs';
const src = readFileSync('src/kanji.js','utf8');
const marker = 'SENTENCE_OVERRIDE = {';
const start = src.indexOf(marker);
let depth=0, i=start+marker.length-1;
while(i<src.length){ if(src[i]==='{')depth++; else if(src[i]==='}'){depth--;if(depth===0)break;} i++; }
const obj = new Function('"use strict"; return ('+src.slice(start+marker.length-1,i+1)+')')();
const n1resp = await fetch('https://kanjiapi.dev/v1/kanji/jlpt-1');
const n1 = await n1resp.json();
let ok=0,warn=[];
for(const k of n1){ const c=(obj[k]?.length)||0; if(c>=2)ok++; else warn.push(k+'('+c+')'); }
console.log('N1: '+ok+'/'+n1.length+' covered');
if(warn.length){ console.log('Still missing: '+warn.length+' kanji'); if(warn.length<=50)console.log(warn.join(', ')); }
else console.log('100% ✅');
