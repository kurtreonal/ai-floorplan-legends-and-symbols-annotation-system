(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 const host=$('legend-import-host');
 if(!host)return;
 window.CUSTOM_LEGEND_ENTRIES=window.CUSTOM_LEGEND_ENTRIES||[];
 const PDFJS_CDN='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
 const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 let pdfjsReady=null;
 function loadPdfJs(){
  if(window.pdfjsLib)return Promise.resolve(window.pdfjsLib);
  if(pdfjsReady)return pdfjsReady;
  pdfjsReady=new Promise((resolve,reject)=>{
   const script=document.createElement('script');script.src=PDFJS_CDN;
   script.onload=()=>{try{window.pdfjsLib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;resolve(window.pdfjsLib);}catch(e){reject(e);}};
   script.onerror=()=>reject(new Error('Could not load the PDF reader library. An internet connection is needed the first time you add a PDF legend (image uploads always work offline).'));
   document.head.appendChild(script);
  });
  return pdfjsReady;
 }
 const el=(tag,attrs,text)=>{const e=document.createElement(tag);if(attrs)for(const [k,v] of Object.entries(attrs)){if(k==='class')e.className=v;else e.setAttribute(k,v);}if(text!==undefined)e.textContent=text;return e;};

 const root=el('div',{class:'legend-import'});
 const drop=el('div',{class:'drop',tabindex:'0',role:'button'},'Click to choose, or drag & drop, a legend PDF or image (PNG/JPG). You will crop out each symbol you want to add.');
 const fileInput=el('input',{type:'file',accept:'application/pdf,image/png,image/jpeg,image/webp',hidden:'hidden'});
 const pageNav=el('div',{class:'page-nav'});
 const cropWrap=el('div',{class:'crop-wrap'});
 const controls=el('div',{class:'crop-controls'});
 const pendingList=el('div',{class:'pending-list'});
 const status=el('p',{class:'hint'},'');
 root.append(drop,fileInput,pageNav,cropWrap,controls,pendingList,status);
 host.append(root);

 let sourceName=null, pages=[], pageIndex=0, cropBox=null, dragState=null;
 let pending=[]; // {dataUrl, label, sourceName, pageIndex}

 drop.addEventListener('click',()=>fileInput.click());
 drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')fileInput.click();});
 drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
 drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');const f=e.dataTransfer.files[0];if(f)handleFile(f);});
 fileInput.addEventListener('change',()=>{const f=fileInput.files[0];if(f)handleFile(f);fileInput.value='';});

 async function handleFile(file){
  status.textContent='Loading '+file.name+'…';
  sourceName=file.name;pages=[];pageIndex=0;
  try{
   if(file.type==='application/pdf'){
    const pdfjsLib=await loadPdfJs();
    const buf=await file.arrayBuffer();
    const doc=await pdfjsLib.getDocument({data:buf}).promise;
    for(let i=1;i<=doc.numPages;i++){
     const page=await doc.getPage(i);
     const viewport=page.getViewport({scale:2});
     const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;
     await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
     pages.push({dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height});
    }
   }else if(file.type.startsWith('image/')){
    const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    const dims=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=reject;img.src=dataUrl;});
    pages.push({dataUrl,width:dims.width,height:dims.height});
   }else{throw new Error('Unsupported file type. Use a PDF or a PNG/JPG image.');}
   status.textContent=pages.length+' page(s) loaded from '+sourceName+'. Drag a box over a symbol, then add it below.';
   renderPageNav();renderPage();
  }catch(err){status.textContent='Could not read this file: '+err.message;}
 }

 function renderPageNav(){
  pageNav.replaceChildren();
  if(pages.length<=1)return;
  const prev=el('button',{class:'ghost small'},'‹ Prev page');
  const label=el('span',null,'Page '+(pageIndex+1)+' of '+pages.length);
  const next=el('button',{class:'ghost small'},'Next page ›');
  prev.addEventListener('click',()=>{if(pageIndex>0){pageIndex--;renderPageNav();renderPage();}});
  next.addEventListener('click',()=>{if(pageIndex<pages.length-1){pageIndex++;renderPageNav();renderPage();}});
  pageNav.append(prev,label,next);
 }

 function renderPage(){
  cropWrap.replaceChildren();cropBox=null;controls.replaceChildren();
  const page=pages[pageIndex];if(!page)return;
  const img=el('img',{src:page.dataUrl,alt:'Uploaded legend page '+(pageIndex+1),draggable:'false'});
  cropWrap.append(img);
  img.addEventListener('pointerdown',e=>{
   const rect=cropWrap.getBoundingClientRect();
   const startX=e.clientX-rect.left+cropWrap.scrollLeft,startY=e.clientY-rect.top+cropWrap.scrollTop;
   if(cropBox)cropBox.remove();
   cropBox=el('div',{class:'crop-box'});cropWrap.append(cropBox);
   dragState={startX,startY};
   updateCropBox(startX,startY,startX,startY);
   img.setPointerCapture(e.pointerId);
   const move=ev=>{const r=cropWrap.getBoundingClientRect();const x=ev.clientX-r.left+cropWrap.scrollLeft,y=ev.clientY-r.top+cropWrap.scrollTop;updateCropBox(dragState.startX,dragState.startY,x,y);};
   const up=()=>{img.removeEventListener('pointermove',move);img.removeEventListener('pointerup',up);showCropControls(img,page);};
   img.addEventListener('pointermove',move);img.addEventListener('pointerup',up,{once:true});
  });
 }

 function updateCropBox(x1,y1,x2,y2){
  const left=Math.min(x1,x2),top=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  cropBox.style.left=left+'px';cropBox.style.top=top+'px';cropBox.style.width=w+'px';cropBox.style.height=h+'px';
  cropBox._rect={left,top,w,h};
 }

 function showCropControls(img,page){
  controls.replaceChildren();
  if(!cropBox?._rect||cropBox._rect.w<6||cropBox._rect.h<6){status.textContent='Drag a larger box around the symbol you want to capture.';return;}
  const labelField=el('label',null,'Legend label / class name');
  const labelInput=el('input',{placeholder:'e.g. 3-way switch, glass wall boundary marker'});
  labelField.append(labelInput);
  const addBtn=el('button',{class:'primary small'},'Add crop as new legend entry');
  const cancelBtn=el('button',{class:'ghost small'},'Discard crop');
  controls.append(labelField,addBtn,cancelBtn);
  addBtn.addEventListener('click',()=>{
   const label=labelInput.value.trim();
   if(!label){status.textContent='Give this legend entry a short label first.';return;}
   const scaleX=page.width/img.clientWidth, scaleY=page.height/img.clientHeight;
   const r=cropBox._rect;
   const cropCanvas=document.createElement('canvas');
   cropCanvas.width=Math.round(r.w*scaleX);cropCanvas.height=Math.round(r.h*scaleY);
   const ctx=cropCanvas.getContext('2d');
   const full=new Image();
   full.onload=()=>{
    ctx.drawImage(full,r.left*scaleX,r.top*scaleY,r.w*scaleX,r.h*scaleY,0,0,cropCanvas.width,cropCanvas.height);
    const cropDataUrl=cropCanvas.toDataURL('image/png');
    addPendingEntry({dataUrl:cropDataUrl,label,sourceName,pageIndex});
   };
   full.src=page.dataUrl;
  });
  cancelBtn.addEventListener('click',()=>{cropBox.remove();cropBox=null;controls.replaceChildren();});
 }

 function addPendingEntry(entry){
  pending.push(entry);
  status.textContent='Added "'+entry.label+'". It is queued below — attach it to the current drawing to make it usable as a legend class.';
  renderPending();
  cropBox?.remove();cropBox=null;controls.replaceChildren();
 }

 function renderPending(){
  pendingList.replaceChildren();
  if(!pending.length)return;
  pendingList.append(el('p',{class:'hint'},'Queued legend entries — click "Attach to this drawing" to save each one into the review (it becomes a searchable legend class).'));
  for(const [i,entry] of pending.entries()){
   const row=el('div',{class:'pending-item'});
   const img=el('img',{src:entry.dataUrl,alt:entry.label});
   const meta=el('div',{class:'meta'});
   meta.append(el('strong',null,entry.label),el('span',null,'From '+entry.sourceName+(pages.length>1?' · page '+(entry.pageIndex+1):'')));
   const attach=el('button',{class:'primary small'},'Attach to this drawing');
   const remove=el('button',{class:'ghost small'},'Remove');
   attach.addEventListener('click',()=>{window.legendImport?.attach(entry);pending.splice(i,1);renderPending();});
   remove.addEventListener('click',()=>{pending.splice(i,1);renderPending();});
   row.append(img,meta,attach,remove);
   pendingList.append(row);
  }
 }

 window.legendImport={
  attach(entry){
   const current=window.reviewWorkspace?.getCurrent?.();
   if(!current){status.textContent='Open a drawing first, then attach this legend entry.';return;}
   const registry=window.LegendRegistry;

   // Universal behaviour: if this label already exists as a symbol anywhere in
   // the catalogue, reuse that symbol's key instead of minting a duplicate.
   const existing=registry?registry.get(entry.label):null;
   const merged=!!existing;
   const legendEntryId=existing?existing.key:(registry?registry.keyFor(entry.label):('user-legend-'+Date.now().toString(36)));
   if(!legendEntryId){status.textContent='Give this legend entry a usable label first.';return;}

   const id=current.id+'-userlegend-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);
   const w=current.width,h=current.height;
   const bw=Math.min(w*0.12,220),bh=Math.min(h*0.08,160);
   const annotation={
    id,layer:'legend',label:entry.label,
    geometry:{type:'bbox',coordinates:[8,8,8+bw,8+bh]},
    legend_entry:legendEntryId,
    legendKey:legendEntryId,
    legend_scope:'universal',
    review_state:'manually_added',
    method:'human_manual_annotation',
    class_state:'user_defined_legend_source',
    production_class_id:null,
    note:(merged
      ? 'User-uploaded example added to the existing universal symbol "'+(existing.label)+'". Verify before relying on it.'
      : 'User-uploaded legend entry from '+entry.sourceName+'. Not an original drawing legend; verify before relying on it.'),
    created_at:new Date().toISOString(),
    uploaded_crop:entry.dataUrl
   };
   current.annotations.push(annotation);

   const customEntry={legend_entry:legendEntryId,legendKey:legendEntryId,label:existing?existing.label:entry.label,source_name:entry.sourceName,crop:entry.dataUrl,source_sheet_id:current.id,group:current.group,universal:true};
   window.CUSTOM_LEGEND_ENTRIES=window.CUSTOM_LEGEND_ENTRIES||[];
   window.CUSTOM_LEGEND_ENTRIES.push(customEntry);
   registry?.add(customEntry);

   window.reviewWorkspace?.persist?.();
   window.reviewWorkspace?.populateLegendDropdowns?.();
   const classSelect=document.getElementById('edit-class');
   if(classSelect){classSelect.value=legendEntryId;classSelect.dispatchEvent(new Event('change'));}
   const labelInput=document.getElementById('edit-label');
   if(labelInput)labelInput.value=customEntry.label;
   window.reviewWorkspace?.refreshList?.();
   window.workspaceUI?.show?.(current);
   const status2=document.getElementById('editor-status');
   if(status2)status2.textContent=merged
    ? '"'+entry.label+'" matched the existing universal symbol "'+existing.label+'". The crop was added to that symbol instead of creating a duplicate class.'
    : '"'+entry.label+'" added as a new universal legend symbol. It is available on every drawing, not just this one. Export to keep it.';
   status.textContent=merged
    ? 'Merged into the existing universal symbol "'+existing.label+'" — no duplicate class was created.'
    : 'Added "'+entry.label+'" to the universal legend catalogue.';
   document.dispatchEvent(new CustomEvent('legend-entries-changed'));
  }
 };

 document.addEventListener('legend-entries-changed',()=>{});
})();
