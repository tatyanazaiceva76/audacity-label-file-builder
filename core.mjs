const MAX_INPUT_BYTES=256*1024;
const MAX_ROWS=1000;
const MAX_LABEL_UNITS=200;
const MAX_MICROS=604800000000n;
const OPTIONS=['decimalSeparator','delimiter','header','timeMode'];

export class LabelConversionError extends Error{
  constructor(code,message,row=null){
    super(message);this.name='LabelConversionError';this.code=code;this.row=row;
  }
  toJSON(){return{code:this.code,row:this.row,message:this.message};}
}

const fail=(code,message,row=null)=>{throw new LabelConversionError(code,message,row);};
const utf8Bytes=value=>new TextEncoder().encode(value).length;

function validateOptions(options){
  if(!options||typeof options!=='object'||Array.isArray(options))fail('OPTIONS_OBJECT','Options must be an object.');
  const keys=Object.keys(options).sort();
  if(keys.length!==OPTIONS.length||keys.some((key,index)=>key!==OPTIONS[index]))fail('OPTIONS_KEYS','Options must contain only delimiter, header, timeMode and decimalSeparator.');
  if(![',',';','\t'].includes(options.delimiter))fail('DELIMITER','Delimiter must be comma, semicolon or tab.');
  if(typeof options.header!=='boolean')fail('HEADER_FLAG','Header must be true or false.');
  if(!['seconds','clock'].includes(options.timeMode))fail('TIME_MODE','Time mode must be seconds or clock.');
  if(!['.',','].includes(options.decimalSeparator))fail('DECIMAL_SEPARATOR','Decimal separator must be dot or comma.');
  return options;
}

export function parseCsv(input,delimiter){
  if(typeof input!=='string')fail('INPUT_STRING','Input must be a string.');
  if(![',',';','\t'].includes(delimiter))fail('DELIMITER','Delimiter must be comma, semicolon or tab.');
  if(utf8Bytes(input)>MAX_INPUT_BYTES)fail('INPUT_BYTES','Input exceeds 256 KiB UTF-8.');
  if(input.length===0)fail('INPUT_EMPTY','Input is empty.');
  const rows=[];let row=[];let value='';let quoted=false;let inQuote=false;let afterQuote=false;let endedOnRecord=false;
  const pushField=()=>{row.push({value,quoted});value='';quoted=false;afterQuote=false;};
  const pushRow=()=>{pushField();rows.push(row);row=[];endedOnRecord=true;};
  for(let i=0;i<input.length;i++){
    const ch=input[i];endedOnRecord=false;
    if(inQuote){
      if(ch==='"'){
        if(input[i+1]==='"'){value+='"';i++;}
        else{inQuote=false;afterQuote=true;}
      }else value+=ch;
      continue;
    }
    if(afterQuote){
      if(ch===delimiter){pushField();continue;}
      if(ch==='\n'){pushRow();continue;}
      if(ch==='\r'){
        if(input[i+1]!=='\n')fail('CSV_CR','A carriage return must be followed by line feed.',rows.length+1);
        i++;pushRow();continue;
      }
      fail('CSV_AFTER_QUOTE','Only a separator or line ending may follow a closing quote.',rows.length+1);
    }
    if(ch==='"'){
      if(value.length!==0)fail('CSV_QUOTE_POSITION','A quote may only start an empty field.',rows.length+1);
      quoted=true;inQuote=true;continue;
    }
    if(ch===delimiter){pushField();continue;}
    if(ch==='\n'){pushRow();continue;}
    if(ch==='\r'){
      if(input[i+1]!=='\n')fail('CSV_CR','A carriage return must be followed by line feed.',rows.length+1);
      i++;pushRow();continue;
    }
    value+=ch;
  }
  if(inQuote)fail('CSV_UNCLOSED_QUOTE','Quoted field is not closed.',rows.length+1);
  if(!endedOnRecord||row.length||value.length||quoted||afterQuote){pushField();rows.push(row);}
  if(rows.length===0)fail('INPUT_EMPTY','Input is empty.');
  return rows;
}

function decimalMicros(value,separator,row,field){
  const escaped=separator==='.'?'\\.':',';
  const match=new RegExp('^(\\d+)(?:'+escaped+'(\\d{1,6}))?$').exec(value);
  if(!match)fail('TIME_FORMAT',`${field} must be a nonnegative decimal with at most 6 fractional digits.`,row);
  const whole=BigInt(match[1]),fraction=BigInt((match[2]??'').padEnd(6,'0'));
  const micros=whole*1000000n+fraction;
  if(micros>MAX_MICROS)fail('TIME_RANGE',`${field} exceeds 604800 seconds.`,row);
  return micros;
}

export function parseTimeToMicros(raw,{timeMode,decimalSeparator,delimiter,wasQuoted=false,row=null,field='time'}={}){
  if(typeof raw!=='string')fail('TIME_STRING',`${field} must be text.`,row);
  const value=raw.trim();if(!value)fail('TIME_REQUIRED',`${field} is required.`,row);
  if(delimiter===','&&decimalSeparator===','&&value.includes(',')&&!wasQuoted)fail('DECIMAL_COMMA_QUOTING',`${field} with a decimal comma must be quoted when comma is the CSV separator.`,row);
  if(timeMode==='seconds')return decimalMicros(value,decimalSeparator,row,field);
  if(timeMode!=='clock')fail('TIME_MODE','Time mode must be seconds or clock.',row);
  const parts=value.split(':');if(parts.length!==2&&parts.length!==3)fail('CLOCK_FORMAT',`${field} must be MM:SS or H:MM:SS.`,row);
  const last=parts.pop();const secondMicros=decimalMicros(last,decimalSeparator,row,field);
  const secondsWhole=secondMicros/1000000n;
  if(secondsWhole>=60n)fail('CLOCK_SECOND_RANGE',`${field} seconds must be below 60.`,row);
  let hours=0n,minutes;
  if(parts.length===1){minutes=/^\d+$/.test(parts[0])?BigInt(parts[0]):fail('CLOCK_MINUTE',`${field} minutes must be digits.`,row);}
  else{
    if(!/^\d+$/.test(parts[0])||!/^\d+$/.test(parts[1]))fail('CLOCK_FIELDS',`${field} hour and minute fields must be digits.`,row);
    hours=BigInt(parts[0]);minutes=BigInt(parts[1]);if(minutes>=60n)fail('CLOCK_MINUTE_RANGE',`${field} minute subfield must be below 60.`,row);
  }
  const total=(hours*3600n+minutes*60n)*1000000n+secondMicros;
  if(total>MAX_MICROS)fail('TIME_RANGE',`${field} exceeds 604800 seconds.`,row);
  return total;
}

export function formatMicros(micros){
  if(typeof micros!=='bigint'||micros<0n||micros>MAX_MICROS)fail('MICROS_RANGE','Microseconds are outside the supported range.');
  return `${micros/1000000n}.${String(micros%1000000n).padStart(6,'0')}`;
}

function validateLabel(label,row){
  if(typeof label!=='string')fail('LABEL_STRING','Label must be text.',row);
  if(!label.trim())fail('LABEL_EMPTY','Label must not be empty or whitespace.',row);
  if(label.length>MAX_LABEL_UNITS)fail('LABEL_LENGTH','Label exceeds 200 UTF-16 code units.',row);
  if(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(label))fail('LABEL_CONTROL','Label contains a forbidden control or line-separator character.',row);
  return label;
}

export function convertCsvToAudacity(input,options){
  const opts=validateOptions(options),rows=parseCsv(input,opts.delimiter);
  let offset=0;
  if(opts.header){
    const header=rows[0];if(header.length!==3)fail('HEADER_COLUMNS','Header must contain exactly 3 columns.',1);
    const names=header.map(field=>field.value.trim().toLowerCase());
    if(names.join('\u0000')!=='start\u0000end\u0000label')fail('HEADER_NAMES','Header must be start,end,label.',1);
    offset=1;
  }
  const data=rows.slice(offset);if(data.length===0)fail('NO_DATA_ROWS','No data rows were provided.');
  if(data.length>MAX_ROWS)fail('ROW_LIMIT','Input exceeds 1000 data rows.');
  const converted=[];
  for(let index=0;index<data.length;index++){
    const sourceRow=offset+index+1,row=data[index];
    if(row.length!==3)fail('ROW_COLUMNS','Each data row must contain exactly 3 columns.',sourceRow);
    const start=parseTimeToMicros(row[0].value,{...opts,wasQuoted:row[0].quoted,row:sourceRow,field:'start'});
    const endBlank=row[1].value.trim()==='';
    const end=endBlank?start:parseTimeToMicros(row[1].value,{...opts,wasQuoted:row[1].quoted,row:sourceRow,field:'end'});
    if(end<start)fail('END_BEFORE_START','End must be greater than or equal to start.',sourceRow);
    converted.push({start,end,label:validateLabel(row[2].value,sourceRow)});
  }
  const text=converted.map(row=>`${formatMicros(row.start)}\t${formatMicros(row.end)}\t${row.label}\n`).join('');
  const bytes=utf8Bytes(text);if(text.charCodeAt(0)===0xfeff)fail('OUTPUT_BOM','Output must not contain a BOM.');
  return Object.freeze({text,bytes,rowCount:converted.length,encoding:'UTF-8',bom:false,lineEnding:'LF',format:'AUDACITY_STANDARD_LABEL_TEXT'});
}

export const LIMITS=Object.freeze({inputBytes:MAX_INPUT_BYTES,dataRows:MAX_ROWS,labelUtf16CodeUnits:MAX_LABEL_UNITS,maxSeconds:604800,fractionalDigits:6});
