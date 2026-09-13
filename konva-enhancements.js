(() => {
 'use strict';
 const canvas=document.getElementById('canvas'),slider=document.getElementById('zoom-slider');
 if(!canvas||!slider)return;
 const style=document.createElement('style');style.textContent=`
  .pagebar{flex-wrap:wrap;align-items:flex-end;gap:10px;min-width:0}
  .pagebar>label{flex:0 1 auto;min-width:120px}
  .pagebar .page-picker{flex:1 1 260px;min-width:180px}
  .pagebar .attach-image{flex:0 1 240px;min-width:190px}
  .pagebar .priority{flex:1 1 180px;min-width:160px}
  .inline-canvas-tools{display:flex;align-items:flex-end;gap:10px;flex:1 1 560px;min-width:0;margin:0;padding:0;border:0;background:transparent}
  .inline-canvas-tools .tool-group{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;min-width:0}
  .inline-canvas-tools .tool-label{min-width:185px;flex:1 1 185px}
  .inline-canvas-tools .tool-group[aria-label="History"]{margin-left:auto}
  .dataset-import{color:var(--header-bg);background:var(--surface);border:1px solid var(--border-strong);border-radius:6px;padding:8px;cursor:pointer;white-space:nowrap}
  .dataset-import input{display:none}
    :root{--bg:#eef2f6;--surface:#ffffff;--surface-2:#f5f7fa;--surface-3:#e8eef5;--text:#10233e;--text-dim:#52657b;--text-faint:#718197;--border:#d4dde8;--border-soft:#e7edf3;--border-strong:#aebdce;--accent:#1e3a5f;--accent-strong:#152d4a;--accent-soft:#e2ecf7;--on-accent:#ffffff;--header-bg:#102a48;--header-text:#f8fbff;--header-dim:#c8d8e8;--focus:#2563eb;--danger:#b42318;--danger-strong:#8f1d16;--warn-bg:#fff6df;--warn-border:#e6bf61;--warn-text:#684d08;--multi:#b7791f;--multi-bg:#fff5db;--canvas-bg:#dce5ee;--canvas-frame:#c3cfdb;--shadow:0 8px 24px #10233e14;font-family:"Outfit","Segoe UI",sans-serif}
    html[data-theme="dark"]{--bg:#0b1522;--surface:#111f30;--surface-2:#17283b;--surface-3:#20364d;--text:#eaf2fb;--text-dim:#b6c6d8;--text-faint:#8fa4ba;--border:#2b425a;--border-soft:#21364b;--border-strong:#49647d;--accent:#4d9bea;--accent-strong:#77b5f2;--accent-soft:#1b3855;--on-accent:#071321;--header-bg:#081a2f;--header-text:#f5f9ff;--header-dim:#b7cade;--danger:#ffaaa1;--danger-strong:#ff8c80;--canvas-bg:#081321;--canvas-frame:#29425b;--shadow:0 8px 28px #0008}
    body{letter-spacing:.01em;background:var(--bg)}
    :root{--bg:#f4f7f2;--surface:#ffffff;--surface-2:#f1f7ed;--surface-3:#e5f1dc;--text:#12251d;--text-dim:#486158;--text-faint:#71837a;--border:#d3e1d5;--border-soft:#e5eee6;--border-strong:#a9c0ad;--accent:#b8f23d;--accent-strong:#8fc92b;--accent-soft:#edf9d5;--on-accent:#13210f;--header-bg:#0b1712;--header-text:#f7fff5;--header-dim:#bfd3c1;--focus:#29b6f6;--danger:#ff5c7a;--danger-strong:#d93859;--warn-bg:#fff1db;--warn-border:#ffb14e;--warn-text:#6a3d08;--canvas-bg:#dce8df;--canvas-frame:#bdd0c2;--shadow:0 8px 24px #102b1a1a}
    html[data-theme="dark"]{--bg:#07110c;--surface:#0f1d15;--surface-2:#14271b;--surface-3:#1d3825;--text:#f0f8ee;--text-dim:#b4c9b8;--text-faint:#8da694;--border:#294534;--border-soft:#1d3526;--border-strong:#456b4d;--accent:#b8f23d;--accent-strong:#d0ff69;--accent-soft:#294a1e;--on-accent:#101b0b;--header-bg:#050c08;--header-text:#f7fff5;--header-dim:#bbcfbd;--focus:#29b6f6;--danger:#ff8ca2;--danger-strong:#ff6e8c;--warn-bg:#3a2b13;--warn-border:#b6782a;--warn-text:#ffdb9b;--canvas-bg:#08130d;--canvas-frame:#31543b;--shadow:0 8px 28px #0009}
    header{padding:16px 24px;border-bottom:1px solid #ffffff1c;box-shadow:0 2px 12px #071b301f}
    header h1{font-weight:650;letter-spacing:.01em}header span{display:block;margin-top:3px}
    .pagebar{padding:12px 24px;background:var(--surface);border-bottom:1px solid var(--border);box-shadow:0 2px 8px #10233e0a}
    .pagebar label{font-weight:600;color:var(--text-dim)}
    .pagebar select{min-height:38px;background:var(--surface-2);border-color:var(--border)}
    .canvas-tools{border:0;background:transparent}
    .inline-canvas-tools button,.inline-canvas-tools select{min-height:38px}
    .dataset-import{font-weight:700;background:var(--accent);color:var(--on-accent);border-color:var(--accent);min-height:38px;box-shadow:0 3px 0 #6f9e20}
    .dataset-import:hover{background:var(--accent-strong)}
    .dataset-remove{min-height:38px;color:var(--danger);background:var(--surface);border:1px solid var(--border);font-weight:600}
    .dataset-remove:hover{background:var(--warn-bg);border-color:var(--danger)}
    .grid{gap:18px;padding:18px 24px}
    .canvaswrap,.sidebar{border:1px solid var(--border);border-radius:10px;background:var(--surface);box-shadow:var(--shadow)}
    .canvaswrap{overflow:hidden}.sidebar{padding:18px}
    .view-tools,.canvas-tools{background:var(--surface-2);border-color:var(--border-soft)}
    .view-tools{padding:10px 14px}.tool-hint{color:var(--text-dim);font-size:12px;padding:0 14px}
    .sidebar h2{font-size:19px;color:var(--accent);letter-spacing:-.01em}.sidebar h3{color:var(--accent)}
    .tabs{border-bottom:1px solid var(--border);gap:4px;margin:0 -18px 16px;padding:0 18px}
    .tabs button{border:0;border-bottom:2px solid transparent;border-radius:0;background:transparent;color:var(--text-dim);font-weight:600}
    .tabs button[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--focus);background:transparent}
    .edit-fields{display:grid;gap:12px}.edit-fields label{font-weight:600;color:var(--text-dim)}
    .edit-fields input,.edit-fields select,.edit-fields textarea{margin-top:2px;background:var(--surface-2);border-color:var(--border);min-height:40px}
    .actions{gap:8px}.actions button{font-weight:600}.list{display:grid;gap:6px;max-height:36vh;overflow:auto;padding-right:2px}
    .list .item{text-align:left;border-color:var(--border-soft);background:var(--surface-2);padding:10px 12px;min-height:44px}
    .list .item:hover,.list .item.active{border-color:var(--focus);background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--focus)}
    .list .item small{display:block;color:var(--text-faint);margin-top:3px}
    .associated-legend{display:grid;gap:6px;margin:8px 0;padding:10px;border:1px solid var(--border-soft);background:var(--surface-2);border-radius:8px}
    .associated-legend img{display:block;width:100%;max-height:240px;object-fit:contain;background:#fff;border-radius:5px}
    #canvas{min-height:clamp(420px,65vh,820px);background:var(--canvas-bg)}
    button,input,select,textarea{border-radius:7px}button{transition:background-color .18s ease,border-color .18s ease,box-shadow .18s ease,transform .18s ease}button:hover{box-shadow:0 2px 8px #10233e18}button:active{transform:translateY(1px)}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important;animation-duration:.01ms!important}}
  .sidebar{min-width:0;overflow:hidden}
  .sidebar input:not(.legend-color-swatch),.sidebar select,.sidebar textarea{max-width:100%;width:100%}
  .edit-fields{min-width:0}
  @media(max-width:980px){.grid{grid-template-columns:minmax(0,1fr)}.canvaswrap{position:relative}.sidebar{width:100%}.inline-canvas-tools{flex-basis:100%}}
  @media(max-width:640px){.pagebar{padding:10px}.pagebar>label,.pagebar .page-picker,.pagebar .attach-image{flex:1 1 100%;min-width:0}.inline-canvas-tools{align-items:stretch;flex-direction:column}.inline-canvas-tools .tool-group[aria-label="History"]{margin-left:0}.inline-canvas-tools .tool-label{width:100%}}
 `;document.head.append(style);
 const importLabel=document.createElement('label');importLabel.className='dataset-import';importLabel.textContent='Import floor plan';const importInput=document.createElement('input');importInput.type='file';importInput.accept='image/png,image/jpeg,image/webp,application/pdf,.pdf';importLabel.append(importInput);const removeButton=document.createElement('button');removeButton.type='button';removeButton.className='dataset-remove';removeButton.textContent='Remove imported plan';removeButton.title='Delete the selected imported floor plan';removeButton.addEventListener('click',()=>window.reviewWorkspace?.removeSheet?.(window.reviewWorkspace.getCurrent?.()?.id));document.querySelector('.pagebar')?.append(importLabel,removeButton);
 window.loadPdfJs=function(){if(window.pdfjsLib){if(!window.pdfjsLib.GlobalWorkerOptions.workerSrc)window.pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';return Promise.resolve(window.pdfjsLib);}if(window._pdfjsLoading)return window._pdfjsLoading;window._pdfjsLoading=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='pdf.min.js';s.onload=()=>{try{window.pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';}catch(e){}resolve(window.pdfjsLib);};s.onerror=()=>reject(new Error('Failed to load local pdf.min.js'));document.head.appendChild(s);});return window._pdfjsLoading;};
 async function importFloorPlan(file){if(!file)return;const statusEl=document.getElementById('editor-status');const setStatus=(msg,isErr)=>{if(!statusEl)return;statusEl.textContent=msg;statusEl.style.color=isErr?'var(--danger)':'';statusEl.style.fontWeight=isErr?'600':'';};window.reviewWorkspace?.clearAttachedImage?.();setStatus('Loading '+(file.name||'file')+'...');try{const isPdf=file.type==='application/pdf'||(file.name&&file.name.toLowerCase().endsWith('.pdf'));const renderedPages=[];if(isPdf){setStatus('Processing PDF blueprint '+(file.name||'drawing')+'...');const pdfjs=window.pdfjsLib||(await window.loadPdfJs());if(!pdfjs)throw new Error('PDF reader engine is not available.');if(pdfjs.GlobalWorkerOptions&&!pdfjs.GlobalWorkerOptions.workerSrc){pdfjs.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';}const buf=await file.arrayBuffer(),doc=await pdfjs.getDocument({data:buf}).promise,numPages=doc.numPages;if(numPages===0)throw new Error('PDF contains no pages.');for(let i=1;i<=numPages;i++){setStatus('Rendering PDF page '+i+' of '+numPages+' ('+file.name+')...');const page=await doc.getPage(i),unscaled=page.getViewport({scale:1.0}),maxDim=Math.max(unscaled.width,unscaled.height);let scale=2.0;if(maxDim>0)scale=Math.min(3.5,Math.max(1.5,2800/maxDim));const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport}).promise;renderedPages.push({dataUrl:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,pageNum:i,total:numPages});}}else{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=dataUrl;});renderedPages.push({dataUrl,width:image.naturalWidth,height:image.naturalHeight,pageNum:1,total:1});}const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');const data=window.ANNOTATION_DATA;const nextGroup=Math.max(0,...data.sheets.map(s=>Number(s.group)||0))+1;const groupName='Group '+nextGroup+' · '+file.name;let firstSheetId=null;for(let idx=0;idx<renderedPages.length;idx++){const p=renderedPages[idx],pageLabel=p.total>1?(file.name+' (Page '+p.pageNum+'/'+p.total+')'):file.name,sheetId='imported-'+Date.now().toString(36)+(p.total>1?('_p'+p.pageNum):'');if(!firstSheetId)firstSheetId=sheetId;window.reviewWorkspace.addSheet({id:sheetId,group:nextGroup,group_name:groupName,title:pageLabel,filename:pageLabel,image:p.dataUrl,width:p.width,height:p.height,sha256:hash,coordinate_system:'original_image_pixels',associated_legend_ids:[],issues:['Newly imported floor plan ready for review and auto-annotation.'],annotations:[]});}const groupSel=document.getElementById('group');if(groupSel){groupSel.value=String(nextGroup);groupSel.dispatchEvent(new Event('change'));}if(firstSheetId){const sheetSel=document.getElementById('sheet');if(sheetSel){sheetSel.value=firstSheetId;sheetSel.dispatchEvent(new Event('change'));}}window.reviewWorkspace?.renderCoverage?.();setStatus('Imported '+renderedPages.length+' drawing sheet'+(renderedPages.length===1?'':'s')+' in new Group '+nextGroup+' ('+file.name+'). Ready for review or Auto annotate.');}catch(error){console.error('Import error:',error);setStatus('Could not import floor plan: '+error.message,true);}finally{if(importInput)importInput.value='';const attachInput=document.getElementById('attach-image');if(attachInput)attachInput.value='';}}
 window.reviewWorkspace.importFloorPlan=importFloorPlan;
 importInput.addEventListener('change',()=>importFloorPlan(importInput.files[0]));
 const canvasEl=document.getElementById('canvas');if(canvasEl){['dragenter','dragover'].forEach(name=>canvasEl.addEventListener(name,e=>{e.preventDefault();e.stopPropagation();canvasEl.style.outline='3px dashed var(--focus,#1683ff)';canvasEl.style.outlineOffset='-6px';}));['dragleave','drop'].forEach(name=>canvasEl.addEventListener(name,e=>{e.preventDefault();e.stopPropagation();canvasEl.style.outline='';canvasEl.style.outlineOffset='';}));canvasEl.addEventListener('drop',e=>{const file=e.dataTransfer?.files?.[0];if(file)importFloorPlan(file);});}
 const stage=Konva.stages.find(item=>item.container()===canvas);
 const wheelZoom=event=>{const delta=event.deltaMode===1?event.deltaY*16:event.deltaY;const pinch=event.ctrlKey||event.metaKey;const factor=Math.max(.82,Math.min(1.22,Math.exp(delta*(pinch?.0025:.0012))));window.reviewWorkspace?.zoomAt?.(factor,event.clientX,event.clientY);};
 // A physical mouse wheel almost always reports deltaMode!==0 (line steps) or large, purely-vertical,
 // integer-ish deltaY jumps. A trackpad's plain two-finger scroll reports many small deltas and often
 // a nonzero deltaX. There is no fully reliable native way to tell them apart, but this heuristic covers
 // the common cases; holding Ctrl/Cmd (a real pinch gesture) always zooms regardless.
 const isLikelyTrackpadScroll=event=>event.deltaMode===0&&(event.deltaX!==0||Math.abs(event.deltaY)<40);
 if(stage){stage.size({width:canvas.clientWidth,height:canvas.clientHeight});stage.off('wheel');}
 const handleWheel=event=>{
  event.preventDefault();event.stopPropagation();
  const pinch=event.ctrlKey||event.metaKey;
  if(!pinch&&isLikelyTrackpadScroll(event)){window.reviewWorkspace?.panBy?.(event.deltaX,event.deltaY);return;}
  wheelZoom(event);
 };
 canvas.addEventListener('wheel',handleWheel,{capture:true,passive:false});
 let pinchStart=0;
 // The zoom slider now reflects and drives the real zoom level (current stage scale
 // relative to this sheet's "fit" scale), instead of an isolated counter that used to
 // go stale as soon as you zoomed with the wheel, pinch, +/-, or Fit page.
 function fitScale(){const current=window.reviewWorkspace?.getCurrent?.();if(!current)return 0;const r=canvas.getBoundingClientRect();const rot=window.reviewWorkspace?.getRotation?.()||0;const swap=rot%180!==0;const w=swap?current.height:current.width,h=swap?current.width:current.height;return Math.min(r.width/w,r.height/h)||0;}
 function currentZoomLevel(){if(!stage)return 1;const f=fitScale();return f?stage.scaleX()/f:1;}
 let sliderDragging=false;
 slider.addEventListener('pointerdown',()=>{sliderDragging=true;});
 slider.addEventListener('pointerup',()=>{sliderDragging=false;});
 slider.addEventListener('pointercancel',()=>{sliderDragging=false;});
 function setZoom(value){const current=window.reviewWorkspace?.getCurrent?.();if(!current||!stage)return;const target=Math.max(.25,Math.min(3,Number(value)));const level=currentZoomLevel();if(!target||!level)return;window.reviewWorkspace?.zoomAt?.(level/target);}
 slider.addEventListener('input',()=>setZoom(slider.value));
 (function syncSlider(){
  if(!sliderDragging){const level=Math.max(.25,Math.min(3,currentZoomLevel()));if(Math.abs(Number(slider.value)-level)>0.01)slider.value=level.toFixed(2);}
  requestAnimationFrame(syncSlider);
 })();
 canvas.addEventListener('touchstart',e=>{if(e.touches.length===2){const [a,b]=e.touches;pinchStart=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);e.preventDefault();}},{passive:false});
 canvas.addEventListener('touchmove',e=>{if(e.touches.length!==2||!pinchStart)return;const [a,b]=e.touches;const distance=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);const ratio=1+(pinchStart/distance-1)*.35;const midpointX=(a.clientX+b.clientX)/2,midpointY=(a.clientY+b.clientY)/2;window.reviewWorkspace?.zoomAt?.(ratio,midpointX,midpointY);pinchStart=distance;e.preventDefault();},{passive:false});
 canvas.addEventListener('touchend',()=>{pinchStart=0;});
})();
