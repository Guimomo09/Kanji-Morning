import {readFileSync} from 'fs';
const src=readFileSync('src/kanji.js','utf8');
const marker='EXAMPLE_OVERRIDE = {';
const start=src.indexOf(marker);
let depth=0,i=start+marker.length-1;
while(i<src.length){if(src[i]==='{')depth++;else if(src[i]==='}'){depth--;if(depth===0)break;}i++;}
const obj=new Function('"use strict";return('+src.slice(start+marker.length-1,i+1)+')')();
const marker2='SENTENCE_OVERRIDE = {';
const start2=src.indexOf(marker2);
let depth2=0,j=start2+marker2.length-1;
while(j<src.length){if(src[j]==='{')depth2++;else if(src[j]==='}'){depth2--;if(depth2===0)break;}j++;}
const obj2=new Function('"use strict";return('+src.slice(start2+marker2.length-1,j+1)+')')();
for(const k of ['不','地','早','理','空','立']){
  console.log(k+' EX:', obj[k]?obj[k].length+' entries':'ABSENT','  SENT:', obj2[k]?obj2[k].length+' entries':'ABSENT');
}
