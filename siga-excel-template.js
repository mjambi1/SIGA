/* SIGA visual Excel export - preserves the user's own .xlsx chart template.
   The template remains in this browser's IndexedDB and is never uploaded. */
(function(){
'use strict';
const STORAGE='siga_visual_excel_template_v1';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const C='http://schemas.openxmlformats.org/drawingml/2006/chart';
let templateInMemory=null, busy=false;

function child(el,name){return el?Array.from(el.children).find(x=>x.localName===name):null}
function children(el,name){return el?Array.from(el.children).filter(x=>x.localName===name):[]}
function elem(doc,ns,name){return doc.createElementNS(ns,name)}
function parse(s){const d=new DOMParser().parseFromString(s,'application/xml');if(d.getElementsByTagName('parsererror').length)throw Error('invalid_excel_xml');return d}
function serial(d){return new XMLSerializer().serializeToString(d)}
function columnNo(ref){const a=String(ref).match(/^[A-Z]+/);if(!a)return 0;return [...a[0]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)}
function excelCol(n){let s='';while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s}
function xmlValue(c,strings){
  if(!c)return '';
  if(c.getAttribute('t')==='s')return strings[Number(child(c,'v')?.textContent||0)]||'';
  if(c.getAttribute('t')==='inlineStr')return Array.from(c.getElementsByTagNameNS(NS,'t')).map(x=>x.textContent).join('');
  return child(c,'v')?.textContent||'';
}
function setContent(cell,value){
  const doc=cell.ownerDocument;
  for(const n of Array.from(cell.children)){if(['f','v','is'].includes(n.localName))cell.removeChild(n)}
  if(value===null||value===undefined||value===''){cell.removeAttribute('t');return}
  if(typeof value==='number'&&Number.isFinite(value)){
    cell.setAttribute('t','n');const v=elem(doc,NS,'v');v.textContent=String(value);cell.appendChild(v);
  }else{
    cell.setAttribute('t','inlineStr');const is=elem(doc,NS,'is'),t=elem(doc,NS,'t');
    t.textContent=String(value);is.appendChild(t);cell.appendChild(is);
  }
}
function getQuestionList(type){return typeof questionsFor==='function'?questionsFor(type):[]}
function selectedRecords(){return adminRecords.filter(r=>adminSelected.has(r.id))}
function dbOpen(){return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window)){reject(Error('unavailable'));return}
  const req=indexedDB.open('siga-excel-templates',1);
  req.onupgradeneeded=()=>req.result.createObjectStore('templates');
  req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);
})}
async function getTemplate(){
  if(templateInMemory)return templateInMemory;
  try{const db=await dbOpen();return await new Promise((resolve,reject)=>{
    const tx=db.transaction('templates','readonly'),req=tx.objectStore('templates').get(STORAGE);
    req.onsuccess=()=>{templateInMemory=req.result||null;db.close();resolve(templateInMemory)};
    req.onerror=()=>{db.close();reject(req.error)};
  })}catch{return null}
}
async function putTemplate(buffer){
  templateInMemory=buffer;
  try{const db=await dbOpen();await new Promise((resolve,reject)=>{
    const tx=db.transaction('templates','readwrite');tx.objectStore('templates').put(buffer,STORAGE);
    tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};
  })}catch{alert('تم تحميل القالب، لكنه قد يحتاج إلى اختياره من جديد في زيارة لاحقة لأن المتصفح لم يسمح بحفظه.')}
}
function notice(s){const el=document.getElementById('sigaExcelStatus');if(el)el.textContent=s}
function fileInput(){return document.getElementById('sigaExcelTemplateInput')}
async function uploadTemplate(file){
  if(!file)return;
  if(file.size>5*1024*1024){alert('الحد الأقصى للقالب 5 ميغابايت.');return}
  try{
    if(!window.JSZip)throw Error('تعذر تحميل أداة Excel. تأكد من اتصال الإنترنت.');
    const data=await file.arrayBuffer(),zip=await JSZip.loadAsync(data);
    const charts=Object.keys(zip.files).filter(x=>/^xl\/charts\/chart\d+\.xml$/.test(x)).length;
    if(!zip.file('xl/worksheets/sheet1.xml')||charts<19)throw Error('اختر ملف إجابات SIGA الأصلي الذي يحتوي على الرسومات البيانية التسعة عشر.');
    await putTemplate(data);
    notice('✓ القالب محفوظ على هذا الجهاز — 19 رسمًا بيانيًا بالألوان الأصلية');
  }catch(e){alert('تعذّر قراءة قالب Excel: '+(e?.message||e))}
}
function install(){
  const btn=document.getElementById('exportSelectedBtn');if(!btn||fileInput())return;
  btn.textContent='تنزيل Excel بنفس الألوان والرسومات';
  const wrap=document.createElement('div');wrap.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:10px 0;direction:rtl';
  const label=document.createElement('label');label.htmlFor='sigaExcelTemplateInput';label.textContent='اختيار قالب الرسومات (مرة واحدة)';
  label.style.cssText='padding:9px 12px;border:1px solid #b8c8d7;border-radius:8px;cursor:pointer;background:#f4f8fc;color:#23364b;font-size:13px';
  const input=document.createElement('input');input.id='sigaExcelTemplateInput';input.type='file';input.accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';input.style.cssText='position:absolute;width:1px;height:1px;opacity:0';
  input.addEventListener('change',()=>uploadTemplate(input.files?.[0]));
  const status=document.createElement('span');status.id='sigaExcelStatus';status.textContent='يُحفظ القالب في متصفحك فقط، ولا يُرفع إلى الخادم.';status.style.cssText='font-size:12px;color:#46556c';
  wrap.append(label,input,status);btn.insertAdjacentElement('afterend',wrap);
  getTemplate().then(b=>{if(b)notice('✓ قالب الرسومات محفوظ وجاهز للتصدير')});
}
function norm(s){return String(s||'').replace(/[()]/g,'').replace(/[\u064b-\u065f]/g,'').replace(/\s+/g,' ').trim()}
function dimensions(record,indicator){const groups=record.results||{};const match=Object.keys(groups).find(k=>norm(k)===norm(indicator));return groups[match]||{}}
function metric(record,indicator,label){
  const group=dimensions(record,indicator),query=norm(label);
  let item=Object.entries(group).find(([k])=>norm(k)===query)?.[1];
  if(!item)item=Object.entries(group).find(([k])=>norm(k).startsWith(query)||query.startsWith(norm(k)))?.[1];
  return item||null;
}
function score(record,indicator,label){
  const a=metric(record,indicator,label);
  if(!a)return 0;
  if(indicator==='هيرمان'||indicator==='ديسك')return Math.min(1,(Number(a.score)||0)/6);
  if(indicator==='الدوافع')return Math.min(1,(Number(a.score)||0)/4);
  if(indicator==='هولاند')return Math.min(1,(Number(a.score)||0)/16);
  if(indicator==='القيم')return Math.min(1,(Number(a.score)||0)/2);
  const maximum=Number(a.max)||0;
  return Math.max(0,Math.min(1,maximum>0?(Number(a.score)||0)/maximum:(Number(a.pct)||0)/100));
}
function valueCount(r,name){return Number(metric(r,'القيم',name)?.score)||0}
const valueGroups={
 'التغيير':['الاستقلالية','الاستمتاع بالحياة','التجديد والتطوير','المرونة والتكيف'],
 'الذاتية':['المادية','الطموح والمكانة','التأثير والنفوذ','الإنجاز والإتقان'],
 'المحافظة':['الأصالة والنظام','الانضباط والالتزام','الاستقرار والأمان','الالتزام بالمنهج'],
 'الإنسانية':['العطاء','التواضع والخدمة','التسامح وتقبّل الآخرين','الرعاية والرحمة']
};
const compGroups={
 'قيادة الذات':['المبادرة','تحمل المسؤولية','التخطيط والتنظيم','النزاهة والموثوقية'],
 'قيادة الآخرين':['التواصل الفعّال','التأثير والإقناع','تطوير الآخرين','العمل الجماعي'],
 'قيادة العمل':['اتخاذ القرار','حل المشكلات','التفكير الاستراتيجي','إدارة التغيير']
};
function summary(record,set){
  const table=(row,col,indicator,labels,rawMax)=>{
    labels.forEach((label,i)=>{const pct=score(record,indicator,label);set(excelCol(col)+(row+i),label);set(excelCol(col+1)+(row+i),pct);if(rawMax)set(excelCol(col-1)+(row+i),Math.round(pct*rawMax*10000)/10000)});
  };
  table(3,14,'هيرمان',['A التحليلي','B التنفيذي','C العاطفي','D الإبداعي'],6);
  table(14,14,'ديسك',['D الهيمنة','I التأثير','S الثبات','C الدقة'],6);
  const motives=['المقاتل المنفرد','القناص','قائد التشجيع','الأستاذ'];
  table(25,14,'الدوافع',motives,4);
  const mo=motives.map(x=>score(record,'الدوافع',x));
  set('R25','العمل من خلال الآخرين');set('R26','الاعتماد على النفس في العمل');
  set('S25',(mo[2]+mo[3])/2);set('S26',(mo[0]+mo[1])/2);
  set('R28','الانتشار والانطلاق');set('R29','الكفاءة الفنية (الخلو من الأخطاء)');
  set('S28',(mo[0]+mo[2])/2);set('S29',(mo[1]+mo[3])/2);
  const valueNames=['التغيير','الذاتية','المحافظة','الإنسانية'],quad={};
  for(const label of valueNames){quad[label]=valueGroups[label].reduce((s,x)=>s+valueCount(record,x),0)/8}
  valueNames.forEach((n,i)=>{set('N'+(45+i),n);set('M'+(45+i),quad[n]*8);set('O'+(45+i),quad[n])});
  const combine=[
    ['التطور والنمو',(quad['التغيير']+quad['الإنسانية'])/2],
    ['حماية الذات',(quad['الذاتية']+quad['المحافظة'])/2],
    ['تحقيق الذات',(quad['التغيير']+quad['الذاتية'])/2],
    ['المسؤولية المجتمعية',(quad['المحافظة']+quad['الإنسانية'])/2]
  ];
  combine.forEach(([label,v],i)=>{set('W'+(56+i),label);set('X'+(56+i),v);set('Y'+(56+i),v*16)});
  const pieSets=[
    ['التغيير','T','U',45],['المحافظة','W','Y',45],
    ['الإنسانية','W','Y',51],['الذاتية','T','U',51]
  ];
  pieSets.forEach(([group,colLabel,colScore,start])=>valueGroups[group].forEach((label,i)=>{
    set(colLabel+(start+i),label);set(colScore+(start+i),valueCount(record,label)/2)
  }));
  const intelligence=['الذكاء الاجتماعي','الذكاء البصري','الذكاء الحركي','الذكاء الذاتي','الذكاء السمعي','الذكاء اللغوي','الذكاء المنطقي'];
  intelligence.forEach((label,i)=>{const v=score(record,'الذكاءات',label),row=85+i;set('M'+row,label);set('N'+row,v);set('O'+row,v*8)});
  const holland=['R الواقعي','I البحثي','A الفني','S الاجتماعي','E الريادي','C التنظيمي'];
  holland.forEach((label,i)=>{const v=score(record,'هولاند',label),row=96+i;set('M'+row,label);set('N'+row,v);set('O'+row,v*16)});
  let r=108;for(const [group,labels] of Object.entries(compGroups)){
    labels.forEach(label=>{const v=score(record,'الجدارات',label);set('O'+r,label);set('Q'+r,v);set('P'+r,v*8);r++});
  }
  Object.entries(compGroups).forEach(([group,labels],i)=>{
    const v=labels.reduce((sum,label)=>sum+score(record,'الجدارات',label),0)/labels.length,row=114+i;
    set('R'+row,group);set('S'+row,v);set('T'+row,v*32)
  });
}
function buildRows(record,set){
  const type=assessmentTypeOf(record),qs=getQuestionList(type);
  qs.forEach((q,index)=>{
    const r=index+2,base=record.answers?.[q.id],ref=col=>col+r;
    set(ref('A'),record.id||'');set(ref('B'),record.profile?.name||'');
    set(ref('C'),typeLabel(type));set(ref('D'),q.id);set(ref('J'),q.meta?.indicator||'');
    if(q.mode==='binary'){
      const chosen=Number.isInteger(base?.choice)?base.choice:-1;
      set(ref('E'),typeof answerLabel==='function'?answerLabel(q,base):'');
      set(ref('F'),chosen===0?1:0);set(ref('G'),q.options?.[0]?.code||'');
      set(ref('H'),q.options?.[1]?.code||'');set(ref('I'),chosen===1?1:0);
    }else if(q.mode==='rank'){
      const ranking=Array.isArray(base?.ranking)?base.ranking:[],excluded=Array.isArray(base?.excluded)?base.excluded:[];
      set(ref('E'),ranking.map(i=>q.options?.[i]?.code||'').join(' ← '));
      for(let j=0;j<4;j++){const pos=ranking.indexOf(j);set(ref(excelCol(6+j)),pos>=0?Math.max(1,4-pos):(excluded.includes(j)?0:0))}
      set(ref('K'),q.options?.map(o=>o.code).join(' | ')||'');
    }else{
      const n=Number(base?.score);
      set(ref('E'),typeof answerLabel==='function'?answerLabel(q,base):'');
      set(ref('F'),Number.isFinite(n)?n+1:0);set(ref('K'),q.meta?.dimension||'');
    }
  });
}
function rangeValues(formula,cellValues){
  const part=String(formula||'').split('!').pop(),m=part.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/);
  if(!m)return [];
  const c1=columnNo(m[1]),r1=Number(m[2]),c2=columnNo(m[3]||m[1]),r2=Number(m[4]||m[2]),out=[];
  for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++)out.push(cellValues.get(excelCol(c)+r)??'');
  return out;
}
function chartCache(doc,parent,cacheName,values,numeric){
  let cache=child(parent,cacheName);
  if(!cache){cache=elem(doc,C,cacheName);parent.appendChild(cache)}
  while(cache.firstChild)cache.removeChild(cache.firstChild);
  if(numeric){const f=elem(doc,C,'formatCode');f.textContent='0.0%';cache.appendChild(f)}
  const count=elem(doc,C,'ptCount');count.setAttribute('val',String(values.length));cache.appendChild(count);
  values.forEach((v,i)=>{const pt=elem(doc,C,'pt'),node=elem(doc,C,'v');pt.setAttribute('idx',String(i));node.textContent=String(numeric?(Number(v)||0):v);pt.appendChild(node);cache.appendChild(pt)});
}
async function createReport(buffer,record){
  const zip=await JSZip.loadAsync(buffer),sheet=zip.file('xl/worksheets/sheet1.xml');
  if(!sheet)throw Error('لم يتم العثور على ورقة الإجابات في القالب.');
  const doc=parse(await sheet.async('string')),root=doc.documentElement,sd=root.getElementsByTagNameNS(NS,'sheetData')[0];
  if(!sd)throw Error('صيغة الورقة غير مدعومة.');
  let strings=[];
  if(zip.file('xl/sharedStrings.xml')){
    const ss=parse(await zip.file('xl/sharedStrings.xml').async('string'));
    strings=Array.from(ss.getElementsByTagNameNS(NS,'si')).map(e=>Array.from(e.getElementsByTagNameNS(NS,'t')).map(x=>x.textContent).join(''));
  }
  const map=new Map(),rows=new Map();
  for(const row of Array.from(sd.getElementsByTagNameNS(NS,'row')))rows.set(Number(row.getAttribute('r')),row);
  const sampleName=strings.includes('')?null:null;
  for(const row of rows.values())for(const cell of children(row,'c')){
    const ref=cell.getAttribute('r'),rn=Number(ref.match(/\d+$/)?.[0]||0),cn=columnNo(ref),old=xmlValue(cell,strings);
    if(rn>1&&(cn<=11 || child(cell,'f') || (!isNaN(Number(old))&&old!==''))){
      setContent(cell,null);map.set(ref,'');
    }else if(cell.getAttribute('t')==='s'){
      const safe=/^SIGA-\d+$/i.test(old)?'':old;
      setContent(cell,safe);map.set(ref,safe);
    }else if(rn>1&&cn<=11){setContent(cell,null);map.set(ref,'')}
    else map.set(ref,old);
  }
  const ensureRow=n=>{
    if(rows.has(n))return rows.get(n);
    const row=elem(doc,NS,'row');row.setAttribute('r',n);
    const next=Array.from(sd.children).find(x=>x.localName==='row'&&Number(x.getAttribute('r'))>n);
    sd.insertBefore(row,next||null);rows.set(n,row);return row;
  };
  const set=(ref,value)=>{
    let row=ensureRow(Number(ref.match(/\d+$/)[0])),cell=children(row,'c').find(c=>c.getAttribute('r')===ref);
    if(!cell){cell=elem(doc,NS,'c');cell.setAttribute('r',ref);
      const nc=columnNo(ref),next=children(row,'c').find(x=>columnNo(x.getAttribute('r'))>nc);
      row.insertBefore(cell,next||null);
    }
    setContent(cell,value);map.set(ref,value==null?'':value);
  };
  buildRows(record,set);summary(record,set);
  zip.file('xl/worksheets/sheet1.xml',serial(doc));
  if(zip.file('xl/sharedStrings.xml'))zip.file('xl/sharedStrings.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="'+NS+'" count="0" uniqueCount="0"/>');
  const parts=Object.keys(zip.files).filter(n=>/^xl\/charts\/chart\d+\.xml$/.test(n));
  await Promise.all(parts.map(async path=>{
    const cd=parse(await zip.file(path).async('string'));
    for(const name of ['numRef','strRef']){
      const refs=Array.from(cd.getElementsByTagNameNS(C,name));
      for(const ref of refs){
        const f=child(ref,'f');if(!f)continue;
        const values=rangeValues(f.textContent,map);
        chartCache(cd,ref,name==='numRef'?'numCache':'strCache',values,name==='numRef');
      }
    }
    zip.file(path,serial(cd));
  }));
  const shared=zip.file('docProps/core.xml');
  if(shared){const core=await shared.async('string');zip.file('docProps/core.xml',core.replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g,'<dc:creator>SIGA</dc:creator>').replace(/<cp:lastModifiedBy>[\s\S]*?<\/cp:lastModifiedBy>/g,'<cp:lastModifiedBy>SIGA</cp:lastModifiedBy>'))}
  if(zip.file('xl/calcChain.xml')){
    zip.remove('xl/calcChain.xml');
    const rels=zip.file('xl/_rels/workbook.xml.rels');
    if(rels){const rd=parse(await rels.async('string'));Array.from(rd.documentElement.children).filter(x=>(x.getAttribute('Type')||'').endsWith('/calcChain')).forEach(x=>x.remove());zip.file('xl/_rels/workbook.xml.rels',serial(rd))}
    const ct=zip.file('[Content_Types].xml');
    if(ct){const d=parse(await ct.async('string'));Array.from(d.documentElement.children).filter(x=>x.getAttribute('PartName')==='/xl/calcChain.xml').forEach(x=>x.remove());zip.file('[Content_Types].xml',serial(d))}
  }
  return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),10000)}
window.exportAdminExcel=async function(){
  if(busy)return;
  const records=selectedRecords();
  if(!records.length){alert('حدد نتيجة واحدة أو أكثر أولًا.');return}
  if(!window.JSZip){alert('تعذر تحميل أداة Excel. تحقق من اتصال الإنترنت ثم حدّث الصفحة.');return}
  const buffer=await getTemplate();
  if(!buffer){alert('اختر ملف «إجابات سيجا.xlsx» الأصلي مرة واحدة لتفعيل نفس الألوان والرسومات. سيبقى القالب محفوظًا على هذا الجهاز فقط.');fileInput()?.click();return}
  busy=true;const button=document.getElementById('exportSelectedBtn');if(button)button.disabled=true;
  try{
    if(records.length===1){
      const b=await createReport(buffer,records[0]);
      download(b,String(records[0].id||'SIGA')+'-تحليل-بالرسومات.xlsx');
    }else{
      const archive=new JSZip();
      for(let i=0;i<records.length;i++){
        const rec=records[i],file=await createReport(buffer,rec);
        archive.file(String(rec.id||'SIGA-'+(i+1))+'-تحليل.xlsx',file);
      }
      download(await archive.generateAsync({type:'blob',compression:'DEFLATE'}),'SIGA-التقارير-بالرسومات.zip');
    }
  }catch(e){console.error('SIGA visual Excel export',e);alert('تعذر إعداد ملف Excel المرسوم: '+(e?.message||'خطأ غير معروف'))}
  finally{busy=false;if(button)button.disabled=false}
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
