import {convertCsvToAudacity,LabelConversionError,LIMITS} from './core.mjs';

const byId=id=>document.getElementById(id);
const form=byId('convert-form'),csv=byId('csv'),delimiter=byId('delimiter'),timeMode=byId('time-mode'),decimal=byId('decimal'),header=byId('header');
const result=byId('result'),empty=byId('empty-output'),status=byId('status'),error=byId('error'),preview=byId('preview'),summary=byId('result-summary'),note=byId('preview-note'),download=byId('download');
let current=null;
const SAMPLE='start,end,label\n1.25,,Intro\n2.5,6.125,"Scene, one"\n8,9.25,Метка\n';

function invalidate(message='Inputs changed. Build the file again.'){
  current=null;result.hidden=true;empty.hidden=false;download.disabled=true;
  preview.textContent='';summary.textContent='';note.textContent='';
  error.hidden=true;error.textContent='';status.textContent=message;
}

function checkUnicodeAndSize(text){
  // Reject oversized data before encoding/iteration; never truncate a paste.
  if(text.length>LIMITS.inputBytes)throw new LabelConversionError('INPUT_BYTES','Input exceeds 256 KiB UTF-8.');
  for(const char of text){const code=char.codePointAt(0);if(code>=0xd800&&code<=0xdfff)throw new LabelConversionError('INPUT_UNICODE','Input contains an unpaired Unicode surrogate.');}
}

form.addEventListener('input',()=>invalidate());
form.addEventListener('change',()=>invalidate());
form.addEventListener('submit',event=>{
  event.preventDefault();invalidate('Checking CSV records…');
  try{
    checkUnicodeAndSize(csv.value);
    const output=convertCsvToAudacity(csv.value,{delimiter:delimiter.value==='tab'?'\t':delimiter.value,header:header.checked,timeMode:timeMode.value,decimalSeparator:decimal.value});
    if(output.format!=='AUDACITY_STANDARD_LABEL_TEXT'||typeof output.text!=='string'||!Number.isInteger(output.rowCount)||output.rowCount<1||output.rowCount>LIMITS.dataRows)throw new Error('Unexpected converter result');
    current=output;
    const lines=output.text.split('\n');lines.pop();
    preview.textContent=lines.slice(0,20).join('\n');
    note.textContent=output.rowCount>20?`Showing the first 20 of ${output.rowCount} records. The download contains all ${output.rowCount}.`:'All records are shown. Gaps between fields are real tab characters.';
    summary.textContent=`${output.rowCount} ${output.rowCount===1?'label':'labels'} · ${output.bytes.toLocaleString('en-US')} UTF‑8 bytes`;
    status.textContent='All records passed. Review the preview, then download.';
    empty.hidden=true;result.hidden=false;download.disabled=false;
  }catch(problem){
    current=null;error.hidden=false;
    if(problem instanceof LabelConversionError){const record=problem.row===null?'':`CSV record ${problem.row}: `;error.textContent=`${record}${problem.message} [${problem.code}]`;}
    else error.textContent='The file could not be built. Check your input and options.';
    status.textContent='No file is available; nothing was silently skipped or repaired.';
  }
});

byId('example').addEventListener('click',()=>{
  csv.value=SAMPLE;delimiter.value=',';timeMode.value='seconds';decimal.value='.';header.checked=true;
  invalidate('Example loaded with comma-separated seconds. It is sample data; click Build label file to try it.');
});
byId('clear').addEventListener('click',()=>{csv.value='';invalidate('Input cleared. No file is available.');});
download.addEventListener('click',()=>{
  if(!current||download.disabled)return;
  const url=URL.createObjectURL(new Blob([current.text],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');
  link.href=url;link.download='audacity-labels.txt';link.hidden=true;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
