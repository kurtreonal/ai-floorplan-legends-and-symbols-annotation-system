(() => {
 'use strict';
 const D=window.ANNOTATION_DATA,$=id=>document.getElementById(id),C=window.AnnotationCore;
 const colors={symbols:'#B8F23D',geometry:'#29B6F6',wiring:'#FF9F43',text:'#F472B6',legend:'#22D3EE',unresolved:'#FF5C7A',regions:'#FFD166',ocr:'#C4B5FD'};
 const enabled=new Set(['symbols','geometry','wiring','legend','unresolved','regions']);
 const baseline=C.clone(D),decisions={},history=[],future=[],multi=new Set();
 let clipboard=[];
 let current,selected=null,drawing=[],gesture=null,drag=null,stage,imageLayer,marksLayer,draftLayer,view=[0,0,1,1],attachedImage=null;
 let rotation=0;const rotationBySheet={};
 let legendColors={};
 const legendPalette=['#B8F23D','#29B6F6','#FF9F43','#F472B6','#22D3EE','#FF5C7A','#FFD166','#C4B5FD','#F97316','#38BDF8','#A3E635','#F43F5E','#2DD4BF','#FACC15','#818CF8','#FB7185'];
  const LR=()=>window.LegendRegistry;
 function legendKeyOf(id){return id?((LR()?.resolve(id))||id):null;}
 function legendLabelOf(id){return id?((LR()?.labelFor(id))||id):'';}
 function colorForLegend(id){if(!id)return null;const key=legendKeyOf(id);if(!legendColors[key]){let h=0;for(let i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))>>>0;legendColors[key]=legendPalette[h%legendPalette.length];}return legendColors[key];}
 function setLegendColor(id,color){if(!id||!color)return;legendColors[legendKeyOf(id)]=color;persist();renderMarks();window.workspaceUI?.show(current);}
  const wallTypeCatalog={
    standard:{label:'Standard wall',description:'Standard masonry, concrete hollow block (CHB), or full-height structural wall partition',color:'#3b82f6'},
    glass:{label:'Glass wall / partition',description:'Interior architectural glass wall, glazed storefront, or full-height glazed partition',color:'#06b6d4'},
    partition:{label:'Partition (non-glass)',description:'Non-structural drywall, gypsum board, timber stud, or modular office partition',color:'#8b5cf6'},
    fire_rated:{label:'Fire-rated wall',description:'Fire-rated smoke barrier wall, 1-hour/2-hour fire-resistive assembly, or masonry firewall',color:'#ef4444'},
    curtain_wall:{label:'Curtain wall',description:'Exterior non-load-bearing glazed curtain wall facade or structural glass envelope',color:'#0ea5e9'},
    opening:{label:'Opening / doorway (no wall)',description:'Wall opening, passage, cased opening, or doorway boundary without a physical wall',color:'#f59e0b'},
    other:{label:'Other (custom wall)',description:'Special architectural wall, acoustic wall finish, decorative panel, or custom wall assembly',color:'#64748b'}
  };
  const wallTypeLabels=Object.fromEntries(Object.entries(wallTypeCatalog).map(([k,v])=>[k,v.label]));
  function colorForAnnotation(a){
    if(a.wall_type && wallTypeCatalog[a.wall_type]?.color){
      return wallTypeCatalog[a.wall_type].color;
    }
    return a.legend_entry?colorForLegend(a.legend_entry):(colors[a.layer]||'#1683ff');
  }
  function syncWallTypeUI(key){
    const select=$('edit-wall-type');
    if(select&&key!==undefined)select.value=key||'';
    const chips=document.querySelectorAll('.wall-type-chip');
    chips.forEach(c=>{
      const isActive=Boolean(key&&c.dataset.key===key);
      c.classList.toggle('active',isActive);
      c.setAttribute('aria-checked',String(isActive));
    });
    const descBox=$('wall-type-desc');
    if(descBox){
      const def=key?wallTypeCatalog[key]:null;
      if(def){
        descBox.innerHTML=`<strong class="wall-desc-title">${def.label}</strong><span>${def.description}</span>`;
      }else{
        descBox.innerHTML='<span>Click or select a wall type below to automatically assign its architectural description and label to the wall.</span>';
      }
    }
  }
  function renderWallTypeChips(){
    const host=$('wall-type-chips');
    if(!host)return;
    host.replaceChildren();
    for(const [key,item] of Object.entries(wallTypeCatalog)){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='wall-type-chip';
      btn.dataset.key=key;
      btn.setAttribute('role','radio');
      btn.setAttribute('aria-checked','false');
      btn.title=`${item.label}: ${item.description}`;
      const titleSpan=document.createElement('span');
      titleSpan.className='wall-type-chip-title';
      const ind=document.createElement('span');
      ind.className='wall-type-chip-indicator';
      ind.style.backgroundColor=item.color;
      const nameSpan=document.createElement('span');
      nameSpan.className='wall-type-chip-name';
      nameSpan.textContent=item.label;
      titleSpan.append(ind,nameSpan);
      const descSpan=document.createElement('span');
      descSpan.className='wall-type-chip-desc';
      descSpan.textContent=item.description;
      btn.append(titleSpan,descSpan);
      btn.onclick=e=>{
        e.preventDefault();
        applyWallType(key);
      };
      host.append(btn);
    }
  }
  function applyWallType(key){
    const def=wallTypeCatalog[key];
    syncWallTypeUI(key);
    if(!def){
      if(key===''&&selected){
        const targets=selectedAnnotations();
        for(const a of targets){if(a.layer==='geometry')a.wall_type=null;}
        persist();renderMarks();updateAnnotationList();describeSelection();
      }
      return;
    }
    const fullText=def.label+' - '+def.description;
    $('edit-layer').value='geometry';
    $('wall-type-field').hidden=false;
    $('edit-wall-type').value=key;
    $('edit-label').value=fullText;
    const c=$('edit-legend-color');
    if(c&&def.color)c.value=def.color;

    const targets=selectedAnnotations();
    if(targets.length){
      checkpoint();
      for(const a of targets){
        preserve(a);
        a.layer='geometry';
        a.wall_type=key;
        a.label=fullText;
        a.note=def.description;
        enabled.add('geometry');
      }
      persist();
      renderMarks();
      updateAnnotationList();
      describeSelection();
      status(`Applied wall type: ${def.label}. Description added to selected wall.`);
    }else{
      status(`Wall type: ${def.label} selected. Draw a wall or select one to apply.`);
    }
  }
  const status=(m,type)=>{
    const el=$('editor-status');
    if(!el)return;
    el.textContent=m;
    if(type==='error'){
      el.style.backgroundColor='var(--warn-bg)';
      el.style.color='var(--danger)';
      el.style.fontWeight='600';
    }else if(type==='success'){
      el.style.backgroundColor='var(--accent-soft)';
      el.style.color='var(--accent-strong)';
      el.style.fontWeight='600';
    }else{
      el.style.backgroundColor='';
      el.style.color='';
      el.style.fontWeight='';
    }
  };
 const payload=()=>({schema:'ved-editable-review-v2',created_at:new Date().toISOString(),training_approved:false,coordinate_system:'per_sheet_pixel_frame',baseline_revision:'expanded-review-2026-09-09',decisions:C.clone(decisions),legend_colors:C.clone(legendColors),sheets:D.sheets.map(s=>({id:s.id,source_sha256:s.sha256,width:s.width,height:s.height,coordinate_frame:s.coordinate_frame||'original_image_pixels',original_source_sha256:s.original_source_sha256||s.sha256,pdf_page:s.pdf_page||null,training_eligible:false,group:s.group,group_name:s.group_name,title:s.title,filename:s.filename,sheet_type:s.sheet_type||'plan',image:s.id.startsWith('imported-')?s.image:undefined,associated_legend_ids:s.associated_legend_ids||[],issues:s.issues||[],annotations:C.clone(s.annotations)}))});
  const storageKey=()=> 'ved-editable-review-v2:'+D.sheets.map(s=>s.sha256).join(':');
  function persist(){
    try{localStorage.setItem(storageKey(),JSON.stringify(payload()));}catch{}
    if(window.VEDSessionStore){
      window.VEDSessionStore.scheduleAutoSave(payload);
    }
  }
  function applyRestoredReview(saved){
    try{
      const upgraded=C.upgradeReview(saved,baseline);
      for(const sheet of upgraded.sheets){
        let target=D.sheets.find(s=>s.id===sheet.id);
        if(!target && sheet.id.startsWith('imported-')){
          const newSheet={
            id:sheet.id,
            group:sheet.group||(Math.max(0,...D.sheets.map(s=>Number(s.group)||0))+1),
            group_name:sheet.group_name||('Group '+(sheet.group||'Imported')),
            title:sheet.title||sheet.filename||'Imported Plan',
            filename:sheet.filename||sheet.title||'Imported Plan',
            sheet_type:sheet.sheet_type||'plan',
            image:sheet.image,
            width:sheet.width||1000,
            height:sheet.height||1000,
            sha256:sheet.source_sha256||sheet.sha256||'',
            coordinate_system:sheet.coordinate_frame||'original_image_pixels',
            associated_legend_ids:sheet.associated_legend_ids||[],
            issues:sheet.issues||['Imported floor plan restored from session.'],
            annotations:C.clone(sheet.annotations||[])
          };
          D.sheets.push(newSheet);
          baseline.sheets.push(C.clone(newSheet));
          if(![...$('group').options].some(o=>o.value===String(newSheet.group))){
            $('group').append(new Option(newSheet.group_name||('Group '+newSheet.group),newSheet.group));
          }
          target=newSheet;
        }
        if(target){
          const baselineSheet=baseline.sheets.find(s=>s.id===target.id);
          const baselineLegends=(baselineSheet?.annotations||[]).filter(a=>a.layer==='legend'||a.layer==='text');
          const restoredAnnotations=C.clone(sheet.annotations||[]);
          const restoredHasLegends=restoredAnnotations.some(a=>a.layer==='legend');
          if(!restoredHasLegends&&baselineLegends.length>0){
            target.annotations=[...restoredAnnotations,...C.clone(baselineLegends)];
          }else{
            target.annotations=restoredAnnotations;
          }
          window.OUTLET_CLASS_UPGRADES?.mergeRestored(target,baselineSheet);
        }
      }
      for(const key of Object.keys(decisions))delete decisions[key];
      Object.assign(decisions,upgraded.decisions||{});
      for(const key of Object.keys(legendColors))delete legendColors[key];
      Object.assign(legendColors,upgraded.legend_colors||{});
      D.counts.images=D.sheets.length;
      D.counts.groups=new Set(D.sheets.map(s=>s.group)).size;
      D.counts.plans=D.sheets.filter(s=>s.sheet_type==='plan'||s.sheet_type==='plan_with_legend').length;
      D.counts.legend_reference_sheets=D.sheets.filter(s=>s.sheet_type==='legend_reference').length;
      $('counts').textContent=`${D.counts.images} images · ${D.counts.groups} numbered groups · ${D.counts.plans} plans · ${D.counts.legend_reference_sheets} legend/reference sheets`;
      return true;
    }catch(error){
      console.warn('Saved review could not be restored.',error);
      return false;
    }
  }
  function restoreDraft(){
    try{
      const raw=localStorage.getItem(storageKey());
      if(!raw)return false;
      return applyRestoredReview(JSON.parse(raw));
    }catch(error){
      console.warn('Saved review could not be restored.',error);
      return false;
    }
  }
 function updateHistoryButtons(){const u=$('undo'),r=$('redo');if(!u||!r)return;u.disabled=!history.some(h=>h.id===current?.id);r.disabled=!future.some(h=>h.id===current?.id);}
 function checkpoint(){history.push({id:current.id,annotations:C.clone(current.annotations),view:[...view],selected,multi:new Set(multi)});if(history.length>100)history.shift();future.length=0;updateHistoryButtons();}
 function selectedAnnotation(){return current?.annotations.find(a=>a.id===selected);}
 function selectedAnnotations(){return multi.size?current.annotations.filter(a=>multi.has(a.id)):(selectedAnnotation()?[selectedAnnotation()]:[]);}
 function preserve(a){if(!a.original_annotation)a.original_annotation=C.clone(baseline.sheets.find(s=>s.id===current.id)?.annotations.find(x=>x.id===a.id)||a);a.review_state='corrected';a.last_edited_at=new Date().toISOString();}
 function viewTransform(v,rot,rectW,rectH){const rad=rot*Math.PI/180,swap=rot%180!==0,effW=swap?v[3]:v[2],effH=swap?v[2]:v[3];return{scale:Math.min(rectW/effW,rectH/effH),rad,cx:v[0]+v[2]/2,cy:v[1]+v[3]/2,canvasCx:rectW/2,canvasCy:rectH/2};}
 function screenToWorld(sx,sy,t){const dx=sx-t.canvasCx,dy=sy-t.canvasCy,cos=Math.cos(-t.rad),sin=Math.sin(-t.rad);return[t.cx+(dx*cos-dy*sin)/t.scale,t.cy+(dx*sin+dy*cos)/t.scale];}
 function fit(){view=[0,0,current.width,current.height];applyView();}
 function applyView(){if(!stage||!current)return;const r=$('canvas').getBoundingClientRect(),t=viewTransform(view,rotation,r.width,r.height);stage.rotation(rotation);stage.offset({x:t.cx,y:t.cy});stage.scale({x:t.scale,y:t.scale});stage.position({x:t.canvasCx,y:t.canvasCy});stage.batchDraw();}
 function zoom(factor,clientX,clientY){if(!stage||!current)return;const rect=$('canvas').getBoundingClientRect(),screenX=clientX===undefined?rect.width/2:clientX-rect.left,screenY=clientY===undefined?rect.height/2:clientY-rect.top,t0=viewTransform(view,rotation,rect.width,rect.height),world=screenToWorld(screenX,screenY,t0),nextWidth=view[2]*factor,nextHeight=view[3]*factor,t1=viewTransform([0,0,nextWidth,nextHeight],rotation,rect.width,rect.height),dx=screenX-rect.width/2,dy=screenY-rect.height/2,cos=Math.cos(-t1.rad),sin=Math.sin(-t1.rad),cx=world[0]-(dx*cos-dy*sin)/t1.scale,cy=world[1]-(dx*sin+dy*cos)/t1.scale;view=[cx-nextWidth/2,cy-nextHeight/2,nextWidth,nextHeight];applyView();}
 function rotateView(){rotation=(rotation+90)%360;if(current)rotationBySheet[current.id]=rotation;applyView();renderMarks();status('Rotated the drawing to '+rotation+'°. Annotation coordinates are unchanged.');}
 function point(e){const p=stage.getRelativePointerPosition();if(!p)return null;return[p.x,p.y];}
 function bounds(a){const g=a.geometry;if(g.type==='bbox')return g.coordinates;const xs=g.coordinates.map(p=>p[0]),ys=g.coordinates.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
 function connectionAnchors(a){const g=a.geometry;if(g.type==='bbox'){const[x,y,r,b]=g.coordinates;return[[x,y],[(x+r)/2,y],[r,y],[r,(y+b)/2],[r,b],[(x+r)/2,b],[x,b],[x,(y+b)/2]];}return g.coordinates||[];}
 function connectionTolerance(){return Math.max(10,Math.min(current.width,current.height)/140);}
 function connectedComponent(id){const ids=new Set([id]),queue=[id];while(queue.length){const next=queue.shift(),a=current.annotations.find(x=>x.id===next);for(const otherId of (a?.connections||[])){if(ids.has(otherId))continue;const other=current.annotations.find(x=>x.id===otherId);if(!other||other.review_state==='deleted')continue;ids.add(otherId);queue.push(otherId);}}return [...ids];}
 function disconnectAnnotation(a){const linked=new Set(a.connections||[]);for(const id of linked){const other=current.annotations.find(x=>x.id===id);if(other)other.connections=(other.connections||[]).filter(x=>x!==a.id);}a.connections=[];}
 function linkConnections(a){for(const other of current.annotations){if(other===a||other.review_state==='deleted')continue;const linked=a.connections||[];if(linked.includes(other.id))continue;const hit=connectionAnchors(a).some(p=>connectionAnchors(other).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<=connectionTolerance()));if(hit){a.connections=[...(a.connections||[]),other.id];other.connections=[...(other.connections||[]),a.id];}}}
  function distToSegment(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,l2=dx*dx+dy*dy;if(l2===0)return Math.hypot(px-x1,py-y1);let t=((px-x1)*dx+(py-y1)*dy)/l2;t=Math.max(0,Math.min(1,t));return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));}
  function distToPolyline(p,coords){if(!coords||coords.length<2)return Infinity;let minD=Infinity;for(let i=0;i<coords.length-1;i++){const d=distToSegment(p[0],p[1],coords[i][0],coords[i][1],coords[i+1][0],coords[i+1][1]);if(d<minD)minD=d;}return minD;}
  function pointInPolygon(p,vs){if(!vs||vs.length<3)return false;const x=p[0],y=p[1];let inside=false;for(let i=0,j=vs.length-1;i<vs.length;j=i++){const xi=vs[i][0],yi=vs[i][1],xj=vs[j][0],yj=vs[j][1];const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi);if(intersect)inside=!inside;}return inside;}
  function distToPolygonEdges(p,vs){if(!vs||vs.length<2)return Infinity;let minD=Infinity;for(let i=0,j=vs.length-1;i<vs.length;j=i++){const d=distToSegment(p[0],p[1],vs[i][0],vs[i][1],vs[j][0],vs[j][1]);if(d<minD)minD=d;}return minD;}
  function distToBox(p,coords){if(!coords||coords.length<4)return Infinity;const minX=Math.min(coords[0],coords[2]),maxX=Math.max(coords[0],coords[2]),minY=Math.min(coords[1],coords[3]),maxY=Math.max(coords[1],coords[3]);if(p[0]>=minX&&p[0]<=maxX&&p[1]>=minY&&p[1]<=maxY)return 0;const dx=Math.max(minX-p[0],0,p[0]-maxX),dy=Math.max(minY-p[1],0,p[1]-maxY);return Math.hypot(dx,dy);}
  function annotationArea(a){const g=a.geometry;if(!g)return 1e9;if(g.type==='polyline')return 0;if(g.type==='bbox'){return Math.max(1,Math.abs(g.coordinates[2]-g.coordinates[0])*Math.abs(g.coordinates[3]-g.coordinates[1]));}if(g.type==='polygon'){const vs=g.coordinates;if(!vs||vs.length<3)return 1e9;let area=0;for(let i=0,j=vs.length-1;i<vs.length;j=i++)area+=(vs[j][0]+vs[i][0])*(vs[j][1]-vs[i][1]);return Math.max(1,Math.abs(area/2));}return 1e9;}
  function hitTestAnnotation(a,p,tol){const g=a.geometry;if(!g)return{hit:false,dist:Infinity};if(g.type==='bbox'){const d=distToBox(p,g.coordinates);return{hit:d<=tol,dist:d};}if(g.type==='polygon'){if(pointInPolygon(p,g.coordinates))return{hit:true,dist:0};const d=distToPolygonEdges(p,g.coordinates);return{hit:d<=tol,dist:d};}if(g.type==='polyline'){const d=distToPolyline(p,g.coordinates);return{hit:d<=tol,dist:d};}return{hit:false,dist:Infinity};}
  function annotationsAtPoint(p){if(!p||!current||$('show-overlays')?.checked===false)return[];const scale=stage?.scaleX()||1,tol=Math.max(8,Math.min(48,16/scale)),hits=[];for(const a of current.annotations){if(!enabled.has(a.layer)||a.review_state==='deleted')continue;const res=hitTestAnnotation(a,p,tol);if(res.hit)hits.push({annotation:a,dist:res.dist,area:annotationArea(a)});}hits.sort((a,b)=>{if(Math.abs(a.area-b.area)>1)return a.area-b.area;return a.dist-b.dist;});return hits.map(h=>h.annotation);}
  let lastSelectionClickTime=0;
  function handleSelectionClick(p,opts={}){const now=Date.now();if(now-lastSelectionClickTime<40)return;lastSelectionClickTime=now;if($('tool').value!=='pan'||!current)return;let candidates=p?annotationsAtPoint(p):[];if(opts.clickedId&&!candidates.some(c=>c.id===opts.clickedId)){const direct=current.annotations.find(a=>a.id===opts.clickedId&&enabled.has(a.layer)&&a.review_state!=='deleted');if(direct)candidates.unshift(direct);}if(!candidates.length){if(selected||multi.size){multi.clear();selected=null;describeSelection();renderMarks();renderList();status('Selection cleared.');}return;}if(opts.shift){choose(candidates[0].id,{shift:true});return;}if(candidates.length===1){choose(candidates[0].id);return;}const currentIndex=candidates.findIndex(c=>c.id===selected);let targetIndex=0;if(currentIndex!==-1){targetIndex=(currentIndex+1)%candidates.length;}const target=candidates[targetIndex];choose(target.id);const label=target.label||target.id.split('-').pop();status(`Selected ${targetIndex+1} of ${candidates.length} overlapping marks: ${label} (click again to cycle).`);}
  function nodeFor(a,color){
    const g=a.geometry,sel=a.id===selected||multi.has(a.id);
    const isAutoPending=(a.method==='auto_annotation_gemini'||(a.id&&a.id.includes('-ai-')) )&&a.review_state==='needs_review';
    const shapeFill=(g.type==='bbox'||g.type==='polygon')?(sel?(color+'26'):'rgba(0,0,0,0.001)'):undefined;
    const common={stroke:color,strokeWidth:sel?6:4,dash:isAutoPending?[8,4]:undefined,fill:shapeFill,opacity:1,hitStrokeWidth:28,name:'annotation',shadowEnabled:sel,shadowColor:color,shadowBlur:sel?12:0,shadowOpacity:sel?.9:0};
    let n;
    if(g.type==='bbox'){
      const[x,y,r,b]=g.coordinates;
      n=new Konva.Rect({...common,x,y,width:r-x,height:b-y});
    }else n=new Konva.Line({...common,points:g.coordinates.flat(),closed:g.type==='polygon'});
    n.draggable($('tool').value==='pan');
    n.setAttr('annotationId',a.id);
    n.on('mouseenter',()=>{if($('tool').value==='pan')stage.container().style.cursor='grab';});
    n.on('mouseleave',()=>{if($('tool').value==='pan'&&!n.isDragging())stage.container().style.cursor='';});
    n.on('mousedown touchstart',e=>{if(e.evt?.button===2){n.stopDrag();e.cancelBubble=true;}});
    n.on('click tap',e=>{if($('tool').value!=='pan')return;e.cancelBubble=true;handleSelectionClick(point(e),{shift:e.evt?.shiftKey,clickedId:a.id});});
    n.on('dragstart',e=>{
      if(e.evt?.button===2){n.stopDrag();return;}
      stage.container().style.cursor='grabbing';
      checkpoint();
      if(selected!==a.id&&!multi.has(a.id)){
        selected=a.id;
        multi.clear();
        describeSelection();
        formSelection();
        renderList();
      }
      const isMulti=multi.has(a.id)&&multi.size>1;
      const ids=isMulti?[...multi]:((a.geometry.type==='bbox'||a.layer==='geometry')?connectedComponent(a.id):[a.id]);
      const base={},peerOrigins={},labelOrigins={},pinOrigins={},handleOrigins=[];
      for(const id of ids){
        const item=current.annotations.find(x=>x.id===id);
        if(item)base[id]=C.clone(item.geometry);
        const peerNode=id===a.id?n:marksLayer.findOne(x=>x.name()==='annotation'&&x.getAttr('annotationId')===id);
        if(peerNode)peerOrigins[id]=peerNode.position();
        const lblNode=marksLayer.findOne(x=>x.className==='Label'&&x.getAttr('annotationId')===id);
        if(lblNode)labelOrigins[id]=lblNode.position();
        const pinNode=marksLayer.findOne(x=>x.name()==='annotation-pin'&&x.getAttr('annotationId')===id);
        if(pinNode)pinOrigins[id]=pinNode.position();
      }
      const handles=marksLayer.find(x=>x.name()==='handle');
      for(const h of handles){
        handleOrigins.push({node:h,pos:h.position(),id:h.getAttr('annotationId')});
      }
      n.setAttr('dragGroup',{ids,base,peerOrigins,labelOrigins,pinOrigins,handleOrigins,origin:n.position()});
    });
    n.on('dragmove',()=>{
      const state=n.getAttr('dragGroup');
      if(!state)return;
      const pos=n.position(),dx=pos.x-state.origin.x,dy=pos.y-state.origin.y;
      for(const id of state.ids){
        const item=current.annotations.find(x=>x.id===id);
        if(!item)continue;
        const g2=C.translate(state.base[id],dx,dy,current.width,current.height);
        if(!C.validGeometry(g2,current.width,current.height))continue;
        item.geometry=g2;
        const peer=marksLayer.findOne(x=>x.name()==='annotation'&&x.getAttr('annotationId')===id);
        const peerOrigin=state.peerOrigins[id];
        if(peer&&peer!==n&&peerOrigin)peer.position({x:peerOrigin.x+dx,y:peerOrigin.y+dy});
        const lbl=marksLayer.findOne(x=>x.className==='Label'&&x.getAttr('annotationId')===id);
        const lblOrigin=state.labelOrigins?.[id];
        if(lbl&&lblOrigin)lbl.position({x:lblOrigin.x+dx,y:lblOrigin.y+dy});
        const pin=marksLayer.findOne(x=>x.name()==='annotation-pin'&&x.getAttr('annotationId')===id);
        const pinOrigin=state.pinOrigins?.[id];
        if(pin&&pinOrigin)pin.position({x:pinOrigin.x+dx,y:pinOrigin.y+dy});
      }
      for(const h of (state.handleOrigins||[])){
        if(state.ids.includes(h.id)){
          h.node.position({x:h.pos.x+dx,y:h.pos.y+dy});
        }
      }
      marksLayer.batchDraw();
    });
    n.on('dragend',()=>{
      stage.container().style.cursor=$('tool').value==='pan'?'grab':'';
      const state=n.getAttr('dragGroup');
      for(const id of state?.ids||[a.id]){
        const item=current.annotations.find(x=>x.id===id);
        if(item)preserve(item);
      }
      if((state?.ids?.length||1)<=1&&a.geometry.type!=='bbox'&&a.layer!=='geometry')disconnectAnnotation(a);
      n.setAttr('dragGroup',null);
      persist();
      renderMarks();
      status(state?.ids?.length>1?'Connected annotations moved together.':'Annotation moved.');
    });
    n.on('contextmenu',e=>{e.evt.preventDefault();e.cancelBubble=true;n.stopDrag();openMenu(e.evt.clientX,e.evt.clientY,a.id);});
    return n;
  }
  function renderMarks(){
    if(!marksLayer)return;
    marksLayer.destroyChildren();
    if($('show-overlays')?.checked===false){marksLayer.draw();return;}
    for(const a of current.annotations){
      if(!a.legendKey)a.legendKey=a.legend_entry;
      if(!enabled.has(a.layer)||a.review_state==='deleted')continue;
      const color=colorForAnnotation(a);
      marksLayer.add(nodeFor(a,color));
      const [x,y]=bounds(a);
      const label=(a.label||a.layer).length>28?(a.label||a.layer).slice(0,27)+'…':(a.label||a.layer);
      const lbl=new Konva.Label({x,y:y-24,rotation:-rotation,opacity:a.id===selected||multi.has(a.id)?1:.92,listening:false,children:[new Konva.Tag({fill:'#07111d',stroke:color,strokeWidth:2,cornerRadius:3,padding:4}),new Konva.Text({text:label,fontFamily:'Arial',fontSize:12,fontStyle:'bold',fill:'#ffffff',padding:4})]});
      lbl.setAttr('annotationId',a.id);
      marksLayer.add(lbl);
      if(a.layer==='symbols'&&a.geometry.type==='bbox'){
        const [bx,by,br,bb]=a.geometry.coordinates,cx=(bx+br)/2,cy=(by+bb)/2;
        const isSel=a.id===selected||multi.has(a.id);
        const isAutoPending=(a.method==='auto_annotation_gemini'||(a.id&&a.id.includes('-ai-')) )&&a.review_state==='needs_review';
        const ringColor=a.review_state==='user_reviewed'?'#22c55e':(a.review_state==='corrected'?'#29b6f6':(isAutoPending?'#ff5c7a':'#f59e0b'));
        marksLayer.add(new Konva.Circle({x:cx,y:cy,radius:isSel?10:7,stroke:ringColor,strokeWidth:isSel?3:2,dash:a.review_state==='user_reviewed'?undefined:[3,2],listening:false}));
        const pin=new Konva.Circle({x:cx,y:cy,radius:isSel?4.5:3,fill:color,stroke:'#07111d',strokeWidth:1.5,name:'annotation-pin',listening:false});
        pin.setAttr('annotationId',a.id);
        marksLayer.add(pin);
      }
      if(($('tool').value==='polyline'||$('tool').value==='polygon'||a.id===selected||multi.has(a.id))&&a.geometry.type!=='bbox'){
        for(const p of connectionAnchors(a)){
          const anchor=new Konva.Circle({x:p[0],y:p[1],radius:Math.max(5,Math.min(current.width,current.height)/220),fill:'#b8f23d',stroke:'#07111d',strokeWidth:2,name:'connection-anchor'});
          anchor.setAttr('annotationId',a.id);
          anchor.on('mousedown touchstart',e=>{if(['polyline','polygon'].includes($('tool').value)){e.cancelBubble=true;addDrawingPointAt(p);}});
          marksLayer.add(anchor);
        }
      }
    }
    const selIds=selected?[selected]:[...multi];
    for(const id of selIds){
      const selNode=marksLayer.findOne(n=>n.name()==='annotation'&&n.getAttr('annotationId')===id);
      if(selNode)selNode.moveToTop();
      const selLbl=marksLayer.findOne(n=>n.className==='Label'&&n.getAttr('annotationId')===id);
      if(selLbl)selLbl.moveToTop();
      const selPin=marksLayer.findOne(n=>n.name()==='annotation-pin'&&n.getAttr('annotationId')===id);
      if(selPin)selPin.moveToTop();
    }
    if(selected){
      const a=selectedAnnotation(),g=a?.geometry;
      if(g){
        const pts=g.type==='bbox'?[[g.coordinates[0],g.coordinates[1]],[g.coordinates[2],g.coordinates[3]]]:g.coordinates;
        pts.forEach((p,i)=>{
          const h=new Konva.Circle({x:p[0],y:p[1],radius:Math.max(view[2],view[3])/85,fill:'#ffffff',stroke:colorForAnnotation(a),strokeWidth:4,draggable:$('tool').value==='pan',name:'handle'});
          h.setAttr('annotationId',a.id);
          h.on('mouseenter',()=>{stage.container().style.cursor='nwse-resize';});
          h.on('mouseleave',()=>{stage.container().style.cursor=$('tool').value==='pan'?'grab':'';});
          h.on('dragmove',()=>reshape(a,i,h.position()));
          h.on('dragend',()=>finishEdit(a));
          marksLayer.add(h);
        });
      }
    }
    marksLayer.draw();
  }
  function describeSelection(){
    const box=$('selected');box.replaceChildren();
    if(multi.size>1){
      const h=document.createElement('h3');
      h.textContent=multi.size+' annotations selected';
      box.append(h);
      return;
    }
    const a=selectedAnnotation();
    if(!a){
      box.append(Object.assign(document.createElement('p'),{textContent:'Select an annotation or draw a new one.'}));
      return;
    }
    const h=document.createElement('h3');
    h.textContent=a.label;
    const p=document.createElement('p');
    p.textContent=a.note||'Proposal requires review.';
    const small=document.createElement('small');
    small.textContent=`${a.id} · ${a.review_state} · ${legendLabelOf(a.legend_entry||a.legendKey)||'No legend class assigned'}${a.wall_type?' · '+(wallTypeLabels[a.wall_type]||a.wall_type):''}`;
    box.append(h,p,small);
  }
  function matchesAnnotationFilter(a,term){
    if(!term)return true;
    const t=term.toLowerCase().trim();
    const idStr=(a.id||'').toLowerCase();
    const labelStr=(a.label||'').toLowerCase();
    const layerStr=(a.layer||'').toLowerCase();
    const legendStr=((a.legend_entry||a.legendKey||'')+' '+legendLabelOf(a.legend_entry||a.legendKey)).toLowerCase();
    const statusStr=(a.review_state||'').toLowerCase();
    const wallStr=(a.wall_type||'').toLowerCase();
    const confStr=a.confidence!==undefined?String(a.confidence):'';
    return labelStr.includes(t)||idStr.includes(t)||legendStr.includes(t)||layerStr.includes(t)||statusStr.includes(t)||wallStr.includes(t)||confStr.includes(t);
  }
  function updateAnnotationList(){
    const list=$('list');if(!list||!current)return;
    list.replaceChildren();
    const term=($('annotation-search')?.value||'').trim();
    let targetRow=null;
    let pendingAutoCount=0;
    for(const a of current.annotations){
      if(!a.legendKey)a.legendKey=a.legend_entry;
      const isAutoPending=(a.method==='auto_annotation_gemini'||(a.id&&a.id.includes('-ai-')) )&&a.review_state==='needs_review';
      if(isAutoPending)pendingAutoCount++;
      if(!enabled.has(a.layer)||a.review_state==='deleted'||!matchesAnnotationFilter(a,term))continue;
      const b=document.createElement('button');
      const isSel=a.id===selected||multi.has(a.id);
      b.className='item'+(isSel?' active':'')+(isAutoPending?' auto-pending':'');
      b.dataset.id=a.id;
      b.textContent=a.id.split('-').pop()+' · '+a.label;
      const small=document.createElement('small');
      const legName=legendLabelOf(a.legend_entry||a.legendKey);const legText=legName?(' · '+(legName.length>22?legName.slice(0,20)+'…':legName)):'';
      small.textContent=a.layer+' · '+(isAutoPending?'auto suggestion':a.review_state)+legText;
      b.append(small);
      b.onclick=e=>{choose(a.id,{shift:e.shiftKey});if(!e.shiftKey)focusSelected();};
      list.append(b);
      if(isSel&&!targetRow)targetRow=b;
    }
    const btnAcceptAuto=$('accept-all-auto');
    const btnRejectAuto=$('reject-all-auto');
    if(btnAcceptAuto){
      btnAcceptAuto.disabled=pendingAutoCount===0;
      btnAcceptAuto.textContent=pendingAutoCount>0?`Accept all auto (${pendingAutoCount})`:'Accept all auto';
    }
    if(btnRejectAuto){
      btnRejectAuto.disabled=pendingAutoCount===0;
      btnRejectAuto.textContent=pendingAutoCount>0?`Reject all auto (${pendingAutoCount})`:'Reject all auto';
    }
    if(targetRow)targetRow.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  function renderList(){updateAnnotationList();}
  function choose(id,opts={}){
    if(opts.shift){
      if(!multi.size&&selected)multi.add(selected);
      multi.has(id)?multi.delete(id):multi.add(id);
      selected=multi.size===1?[...multi][0]:null;
      if(multi.size===1)multi.clear();
    }else{
      multi.clear();
      selected=id;
    }
    describeSelection();
    renderMarks();
    updateAnnotationList();
    formSelection();
    window.referencePanel?.show(current,id);
    window.workspaceUI?.selected();
  }
  function formSelection(){
    const a=selectedAnnotation();if(!a)return;
    $('edit-layer').value=a.layer;
    $('edit-label').value=a.label;
    $('edit-class').value=legendKeyOf(a.legend_entry||a.legendKey)||'';
    $('edit-wall-type').value=a.wall_type||'';
    $('wall-type-field').hidden=a.layer!=='geometry';
    syncWallTypeUI(a.wall_type);
    const c=$('edit-legend-color');
    if(c)c.value=colorForAnnotation(a);
  }
  function addGeometry(geometry){
    if(!C.validGeometry(geometry,current.width,current.height)){status('Draw a larger box, or add more points.');return;}
    const layer=$('edit-layer').value||'unresolved';
    checkpoint();
    const id=current.id+'-user-'+Date.now().toString(36);
    const wallType=layer==='geometry'?($('edit-wall-type').value||null):null;
    const wallDef=wallType?wallTypeCatalog[wallType]:null;
    const defaultNote=wallDef?wallDef.description:'User correction; dataset training approval remains pending.';
    const annotation={id,layer,label:$('edit-label').value.trim()||'Unresolved annotation',geometry,connections:[],legend_entry:['symbols','wiring','text'].includes(layer)?($('edit-class').value||null):null,wall_type:wallType,review_state:'manually_added',method:'human_manual_annotation',class_state:'unmapped',production_class_id:null,note:defaultNote,created_at:new Date().toISOString()};
    current.annotations.push(annotation);
    if(annotation.geometry.type!=='bbox')linkConnections(annotation);
    selected=id;
    multi.clear();
    enabled.add(layer);
    persist();
    renderMarks();
    renderList();
    describeSelection();
  }
 function preview(cursorPoint){
  if(!draftLayer)return;
  draftLayer.destroyChildren();
  if(!current||(!drawing.length&&!gesture)){
   draftLayer.batchDraw();
   return;
  }
  const tool=$('tool')?.value;
  const activeLayer=$('edit-layer')?.value||'symbols';
  const activeClass=$('edit-class')?.value;
  const activeLegendColor=activeClass?colorForLegend(activeClass):null;
  const activeWallType=activeLayer==='geometry'?$('edit-wall-type')?.value:null;
  const activeWallColor=activeWallType&&wallTypeCatalog[activeWallType]?.color?wallTypeCatalog[activeWallType].color:null;
  const color=activeWallColor||activeLegendColor||colors[activeLayer]||'#1683ff';

  if(tool==='box'&&gesture?.type==='box'){
   const s=gesture.start;
   const p=cursorPoint||(drawing.length>=3?drawing[2]:s);
   if(s&&p){
    const x=Math.min(s[0],p[0]),y=Math.min(s[1],p[1]);
    const w=Math.abs(p[0]-s[0]),h=Math.abs(p[1]-s[1]);
    if(w>0||h>0){
     draftLayer.add(new Konva.Rect({
      x,y,width:w,height:h,
      stroke:color,
      strokeWidth:2.5,
      dash:[6,4],
      fill:color+'26',
      listening:false
     }));
     draftLayer.add(new Konva.Circle({
      x:s[0],y:s[1],radius:4,fill:color,stroke:'#ffffff',strokeWidth:1.5,listening:false
     }));
     draftLayer.add(new Konva.Circle({
      x:p[0],y:p[1],radius:4,fill:color,stroke:'#ffffff',strokeWidth:1.5,listening:false
     }));
    }
   }
  }else if(tool==='polyline'){
   const pts=cursorPoint?[...drawing,cursorPoint]:[...drawing];
   if(pts.length>=2){
    draftLayer.add(new Konva.Line({
     points:pts.flat(),
     stroke:color,
     strokeWidth:3,
     dash:[6,4],
     lineCap:'round',
     lineJoin:'round',
     listening:false
    }));
   }
   for(let i=0;i<drawing.length;i++){
    const pt=drawing[i];
    draftLayer.add(new Konva.Circle({
     x:pt[0],y:pt[1],
     radius:5,
     fill:i===0?'#b8f23d':'#ffffff',
     stroke:color,
     strokeWidth:2,
     listening:false
    }));
   }
   if(cursorPoint){
    draftLayer.add(new Konva.Circle({
     x:cursorPoint[0],y:cursorPoint[1],
     radius:4,
     fill:color,
     stroke:'#ffffff',
     strokeWidth:1.5,
     listening:false
    }));
   }
  }else if(tool==='polygon'){
   const pts=cursorPoint?[...drawing,cursorPoint]:[...drawing];
   if(pts.length>=2){
    draftLayer.add(new Konva.Line({
     points:pts.flat(),
     stroke:color,
     strokeWidth:3,
     dash:[6,4],
     closed:pts.length>=3,
     fill:pts.length>=3?(color+'26'):undefined,
     lineCap:'round',
     lineJoin:'round',
     listening:false
    }));
   }
   for(let i=0;i<drawing.length;i++){
    const pt=drawing[i];
    draftLayer.add(new Konva.Circle({
     x:pt[0],y:pt[1],
     radius:5,
     fill:i===0?'#b8f23d':'#ffffff',
     stroke:color,
     strokeWidth:2,
     listening:false
    }));
   }
   if(cursorPoint){
    draftLayer.add(new Konva.Circle({
     x:cursorPoint[0],y:cursorPoint[1],
     radius:4,
     fill:color,
     stroke:'#ffffff',
     strokeWidth:1.5,
     listening:false
    }));
   }
  }
  draftLayer.batchDraw();
 }
 function finishDrawing(){
  const type=$('tool').value;
  if(!['polyline','polygon'].includes(type))return false;
  const g={type,coordinates:C.clone(drawing)};
  if(!C.validGeometry(g,current.width,current.height)){
   status(type==='polygon'?'A boundary needs at least 3 points.':'A line needs at least 2 points.','error');
   return false;
  }
  drawing=[];
  gesture=null;
  preview();
  addGeometry(g);
  status(type==='polygon'?'Boundary annotation created.':'Line annotation created.','success');
  return true;
 }
 function addDrawingPointAt(p){
  const tool=$('tool').value;
  if(!['polyline','polygon'].includes(tool))return;
  const next=[Math.max(0,Math.min(current.width,p[0])),Math.max(0,Math.min(current.height,p[1]))];
  const previous=drawing[drawing.length-1];
  if(previous&&Math.hypot(previous[0]-next[0],previous[1]-next[1])<1)return;
  if(tool==='polygon'&&drawing.length>=3){
   const first=drawing[0];
   if(Math.hypot(first[0]-next[0],first[1]-next[1])<=connectionTolerance()){
    finishDrawing();
    return;
   }
  }
  const snap=connectionAnchorsForAll(next);
  drawing.push(snap||next);
  preview();
  status(`${tool==='polygon'?'Boundary':'Line'} point ${drawing.length} added. Click next point or click Finish drawing.`);
 }
 function connectionAnchorsForAll(p){let best=null,dist=connectionTolerance();for(const a of current.annotations){if(a.review_state==='deleted')continue;for(const q of connectionAnchors(a)){const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<=dist){dist=d;best=[q[0],q[1]];}}}return best;}
 function copySelection(){clipboard=selectedAnnotations().map(a=>C.clone(a));if(clipboard.length)status(`${clipboard.length} annotation${clipboard.length===1?'':'s'} copied. Press Ctrl+V to paste.`);}
 function pasteSelection(){if(!clipboard.length)return;checkpoint();const dx=24,dy=24,ids=[];for(const source of clipboard){const copy=C.clone(source);copy.id=current.id+'-user-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);copy.geometry=C.translate(copy.geometry,dx,dy,current.width,current.height);copy.connections=[];copy.review_state='manually_added';copy.method='human_manual_annotation';current.annotations.push(copy);if(copy.geometry.type!=='bbox')linkConnections(copy);ids.push(copy.id);}multi.clear();ids.forEach(id=>multi.add(id));selected=null;persist();renderMarks();renderList();describeSelection();status('Pasted copied annotations.');}
 function cancelDrawing(){drawing=[];gesture=null;preview();}
 function reshape(a,index,pos){
  if(!a._reshapeCheckpointed){checkpoint();a._reshapeCheckpointed=true;}
  const g=C.clone(a.geometry);
  const x=Math.max(0,Math.min(current.width,pos.x)),y=Math.max(0,Math.min(current.height,pos.y));
  if(g.type==='bbox'){
   // Keep the dragged corner associated with its opposite corner. Normalizing
   // here also allows a corner to cross over the opposite one while resizing.
   const opposite=index?g.coordinates.slice(0,2):g.coordinates.slice(2,4);
   g.coordinates=index?[opposite[0],opposite[1],x,y]:[x,y,opposite[0],opposite[1]];
   const [left,top,right,bottom]=g.coordinates;
   g.coordinates=[Math.min(left,right),Math.min(top,bottom),Math.max(left,right),Math.max(top,bottom)];
  }else g.coordinates[index]=[x,y];
  if(!C.validGeometry(g,current.width,current.height))return;
  a.geometry=g;

  // Do not rebuild the layer during drag. Recreating the handle that is
  // currently being dragged cancels/interferes with Konva's gesture state.
  const node=marksLayer.findOne(n=>n.name()==='annotation'&&n.getAttr('annotationId')===a.id);
  if(node){
   if(g.type==='bbox'){
    const [left,top,right,bottom]=g.coordinates;
    node.position({x:left,y:top});node.size({width:right-left,height:bottom-top});
   }else node.points(g.coordinates.flat());
  }
  const label=marksLayer.findOne(n=>n.className==='Label'&&n.x()===bounds(a)[0]&&n.y()===bounds(a)[1]-24);
  if(label)label.position({x:bounds(a)[0],y:bounds(a)[1]-24});
  marksLayer.batchDraw();
 }
 function focusSelected(){const a=selectedAnnotation();if(!a)return;const [x,y,r,b]=bounds(a),pad=Math.max(80,Math.max(r-x,b-y)*1.5);view=[Math.max(0,x-pad),Math.max(0,y-pad),Math.min(current.width,pad*2),Math.min(current.height,pad*2)];applyView();status('Zoomed to selected annotation.');}
 function finishEdit(a){delete a._reshapeCheckpointed;preserve(a);persist();status('Shape updated.');}
 function beginStage(){
  stage=new Konva.Stage({container:'canvas',width:1,height:1});
  imageLayer=new Konva.Layer();
  marksLayer=new Konva.Layer();
  draftLayer=new Konva.Layer();
  stage.add(imageLayer,marksLayer,draftLayer);
  stage.on('mousedown touchstart',e=>{
   if(e.evt?.button===2){e.evt.preventDefault();return;}
   const tool=$('tool').value,p=point(e);
   if(!p)return;
   if(tool==='polyline'||tool==='polygon'){
    addDrawingPointAt(p);
    return;
   }
   if(tool==='box'){
    gesture={type:'box',start:p};
    drawing=[p,p];
    preview(p);
    return;
   }
   if(tool==='pan'&&!e.target.hasName('annotation')&&!e.target.hasName('handle')&&!e.target.hasName('connection-anchor'))
    drag={x:e.evt.clientX,y:e.evt.clientY,v:[...view]};
  });
  let didPanRecently=false;
  stage.on('mousemove touchmove',e=>{
   if(drag){
    const dxs=e.evt.clientX-drag.x,dys=e.evt.clientY-drag.y;
    if(Math.hypot(dxs,dys)>4)drag.moved=true;
    const rad=rotation*Math.PI/180,scale=stage.scaleX()||1,cos=Math.cos(-rad),sin=Math.sin(-rad),wdx=(dxs*cos-dys*sin)/scale,wdy=(dxs*sin+dys*cos)/scale;
    view=[drag.v[0]-wdx,drag.v[1]-wdy,drag.v[2],drag.v[3]];
    applyView();
    return;
   }
   const tool=$('tool').value;
   if(gesture?.type==='box'){
    const p=point(e),s=gesture.start;
    if(p&&s){
     drawing=[s,[p[0],s[1]],p,[s[0],p[1]],s];
     preview(p);
    }
    return;
   }
   if(['polyline','polygon'].includes(tool)&&drawing.length>0){
    const p=point(e);
    if(p)preview(p);
   }
  });
  stage.on('mouseup touchend',e=>{
   if(drag){
    const dx=(e.evt?.clientX??drag.x)-drag.x,dy=(e.evt?.clientY??drag.y)-drag.y,moved=drag.moved||Math.hypot(dx,dy)>4;
    drag=null;
    if(moved){
     didPanRecently=true;
     setTimeout(()=>{didPanRecently=false;},300);
     return;
    }
    handleSelectionClick(point(e),{shift:e.evt?.shiftKey});
    return;
   }
   if(!gesture)return;
   const g=gesture;
   gesture=null;
   if(g.type==='box'){
    const p=point(e)||(drawing.length>=3?drawing[2]:g.start);
    drawing=[];
    preview();
    if(p&&g.start){
     const minX=Math.max(0,Math.min(current.width,Math.min(g.start[0],p[0])));
     const minY=Math.max(0,Math.min(current.height,Math.min(g.start[1],p[1])));
     const maxX=Math.max(0,Math.min(current.width,Math.max(g.start[0],p[0])));
     const maxY=Math.max(0,Math.min(current.height,Math.max(g.start[1],p[1])));
     if(maxX-minX>2&&maxY-minY>2){
      addGeometry({type:'bbox',coordinates:[minX,minY,maxX,maxY]});
      status('Box annotation created.','success');
     }else{
      status('Draw a larger box.');
     }
    }
   }
  });
  stage.on('click tap',e=>{
   if($('tool').value!=='pan')return;
   if(didPanRecently)return;
   if(e.target.hasName('handle')||e.target.hasName('connection-anchor'))return;
   handleSelectionClick(point(e),{shift:e.evt?.shiftKey});
  });
  stage.on('dblclick dbltap',e=>{
   const tool=$('tool').value;
   if(['polyline','polygon'].includes(tool)&&drawing.length>=(tool==='polygon'?3:2)){
    finishDrawing();
   }
  });
  stage.on('contextmenu',e=>{e.evt.preventDefault();openMenu(e.evt.clientX,e.evt.clientY,e.target.getAttr('annotationId'));});
  window.addEventListener('resize',resizeStage);
  resizeStage();
 }
 function resizeStage(){const r=$('canvas').getBoundingClientRect();stage?.size({width:r.width,height:Math.max(420,r.height)});applyView();}
 function load(afterLoad){current=D.sheets.find(r=>r.id===$('sheet').value);rotation=rotationBySheet[current.id]||0;selected=null;multi.clear();$('title').textContent=current.title;$('image-meta').textContent=`${current.filename} · ${current.width} × ${current.height} original pixels · image unchanged`;$('coverage').textContent='Detailed annotations: partial. Human review: pending. Training eligibility: false.';$('decision').value=(decisions[current.id]||{decision:'pending'}).decision;$('notes').value=(decisions[current.id]||{}).notes||'';const img=new Image();img.onload=()=>{imageLayer.destroyChildren();imageLayer.add(new Konva.Image({image:img,x:0,y:0,width:current.width,height:current.height,listening:false}));if(attachedImage)imageLayer.add(new Konva.Image({image:attachedImage,x:0,y:0,width:current.width,height:current.height,opacity:.28,listening:false}));imageLayer.draw();fit();renderMarks();renderList();describeSelection();updateHistoryButtons();if(typeof afterLoad==='function')afterLoad();};img.src=current.image;$('issues').replaceChildren(...[...current.issues,'Full-page symbol, wall/opening and wiring completeness has not been verified.'].map(t=>Object.assign(document.createElement('li'),{textContent:t})));populateLegendDropdowns();window.referencePanel?.show(current);window.workspaceUI?.show(current);}

 // Which drawing groups a sheet's legend catalogue should be scoped to:
 // its own group, plus any group(s) its associated legend-reference sheets belong to.
 // The registry itself stays universal (one key per symbol, matched across every
 // group); this only narrows what the pickers *display* for the open drawing.
 function relevantGroupsForSheet(sheet){
  const groups=new Set();
  if(!sheet)return groups;
  if(sheet.group!=null)groups.add(sheet.group);
  for(const id of (sheet.associated_legend_ids||[])){
   const src=(D.sheets||[]).find(s=>s.id===id)||(baseline.sheets||[]).find(s=>s.id===id);
   if(src&&src.group!=null)groups.add(src.group);
  }
  return groups;
 }
 // Selecting a universal legend should only select/highlight the matching
 // annotation(s) already on THIS sheet's list - never navigate the canvas or
 // jump to wherever the symbol was originally defined.
 function highlightLegendMatches(legendId){
  if(!current||!legendId)return 0;
  const registry=LR();
  const matches=current.annotations.filter(a=>a.review_state!=='deleted'&&(a.legend_entry||a.legendKey)&&(registry?registry.sameSymbol(a.legend_entry||a.legendKey,legendId):(a.legend_entry===legendId||a.legendKey===legendId)));
  multi.clear();
  matches.forEach(a=>multi.add(a.id));
  selected=matches.length===1?matches[0].id:null;
  describeSelection();
  renderMarks();
  updateAnnotationList();
  if(matches.length)status(matches.length+' annotation'+(matches.length===1?'':'s')+" on this drawing use '"+legendLabelOf(legendId)+"'.");
  return matches.length;
 }
 function focusLegendByKey(legendId){
  const src=LR()?.bestSource(legendId,current?.id);
  if(!src||!src.sheet_id||!src.geometry||src.geometry.type!=='bbox')return false;
  return focusLegendSource(src.sheet_id,src.geometry.coordinates,legendLabelOf(legendId));
 }
 function focusLegendSource(sheetId,coords,label){
  const targetSheet=D.sheets.find(s=>s.id===sheetId);
  if(!targetSheet||!Array.isArray(coords)||coords.length<4)return false;
  const zoomToBox=()=>{
   const [x,y,r,b]=coords,pad=Math.max(60,Math.max(r-x,b-y)*0.8);
   view=[Math.max(0,x-pad),Math.max(0,y-pad),Math.min(current.width,(r-x)+pad*2),Math.min(current.height,(b-y)+pad*2)];
   applyView();renderMarks();
   status('Zoomed to legend'+(label?': '+label:'')+'.');
  };
  if(current&&current.id===sheetId){zoomToBox();return true;}
  $('group').value=String(targetSheet.group);
  const values=D.sheets.filter(r=>r.group===Number($('group').value));
  $('sheet').replaceChildren(...values.map(r=>Object.assign(document.createElement('option'),{value:r.id,textContent:r.filename})));
  $('sheet').value=sheetId;
  load(zoomToBox);
  return true;
 }
 function groupChanged(){attachedImage=null;const values=D.sheets.filter(r=>r.group===Number($('group').value));$('sheet').replaceChildren(...values.map(r=>Object.assign(document.createElement('option'),{value:r.id,textContent:r.filename})));load();}
  window.legendList=window.legendList||[];
  function populateLegendDropdowns(filterQuery){
    const sel=$('edit-class');if(!sel)return;
    const registry=LR();
    const previousValue=sel.value;
    const term=(filterQuery!==undefined?filterQuery:($('edit-class-search')?.value||'')).toLowerCase().trim();
    // One universal catalogue: every legend row on every sheet, from every group,
    // plus every uploaded crop, folded onto one entry per distinct symbol.
    if(registry){
      registry.rebuild({baseline,data:D,custom:window.CUSTOM_LEGEND_ENTRIES||[]});
      window.legendList=registry.list().map(e=>({
        legend_entry:e.key,legendKey:e.key,key:e.key,label:e.label,
        aliases:Array.from(e.aliases),sources:e.sources,
        sheet_ids:Array.from(e.sheetIds),usage:e.usage||0,custom:!!e.custom,
        universal:true
      }));
    }else{
      const legendMap=new Map();
      for(const s of (baseline?.sheets||[])){
        for(const a of (s.annotations||[]).filter(x=>x.layer==='legend'&&x.legend_entry&&x.review_state!=='deleted')){
          if(!legendMap.has(a.legend_entry)){
            legendMap.set(a.legend_entry,{legend_entry:a.legend_entry,legendKey:a.legend_entry,label:a.label||a.legend_entry,group:s.group,group_name:s.group_name||s.title||('Group '+s.group),sheet_id:s.id,source:'baseline'});
          }
        }
      }
      for(const s of (D?.sheets||[])){
        for(const a of (s.annotations||[]).filter(x=>x.layer==='legend'&&x.legend_entry&&x.review_state!=='deleted')){
          if(!legendMap.has(a.legend_entry)){
            legendMap.set(a.legend_entry,{legend_entry:a.legend_entry,legendKey:a.legend_entry,label:a.label||a.legend_entry,group:s.group,group_name:s.group_name||s.title||('Group '+s.group),sheet_id:s.id,source:'sheet'});
          }
        }
      }
      for(const entry of [...(window.CUSTOM_LEGEND_ENTRIES||[]),...(window.legendList||[])]){
        const id=entry.legend_entry||entry.legendKey;
        if(id&&!legendMap.has(id)){
          legendMap.set(id,{legend_entry:id,legendKey:id,label:entry.label||id,group:current?.group||1,group_name:'Custom / Uploaded',sheet_id:null,source:'custom'});
        }
      }
      window.legendList=Array.from(legendMap.values());
    }
    sel.replaceChildren(new Option('Unresolved / no clear legend match',''));

    const relevantGroups=relevantGroupsForSheet(current);
    const ranked=e=>{
      if(current&&registry.isUsedOn(e.key,current.id))return 0;
      if(e.groups&&Array.from(e.groups).some(g=>relevantGroups.has(g)))return 1;
      return 2;
    };
    const entries=registry?registry.list(term).sort((a,b)=>ranked(a)-ranked(b)||a.label.localeCompare(b.label)):[];
    for(const e of entries){
      const onSheet=current&&registry.isUsedOn(e.key,current.id);
      const inSelectedGroup=e.groups&&Array.from(e.groups).some(g=>relevantGroups.has(g));
      const drawings=e.sheetIds?e.sheetIds.size:0;
      const bits=[];
      if(onSheet)bits.push('on this drawing');
      else if(inSelectedGroup&&current?.group!=null)bits.push('Group '+current.group);
      if(drawings>1)bits.push(drawings+' drawings');
      if(e.usage)bits.push(e.usage+' placed');
      if(e.custom)bits.push('uploaded');
      const opt=new Option(e.label+(bits.length?'  ·  '+bits.join(' · '):''),e.key);
      opt.dataset.label=e.label;
      opt.dataset.universal='1';
      if(onSheet)opt.dataset.onSheet='1';
      if(inSelectedGroup)opt.dataset.selectedGroup='1';
      sel.append(opt);
    }

    const countEl=$('legend-catalog-count');
    if(countEl)countEl.textContent=entries.length+' universal symbol'+(entries.length===1?'':'s')+(term?' matching':' in the shared catalogue');

    const resolvedPrev=registry?registry.resolve(previousValue):previousValue;
    if(resolvedPrev&&Array.from(sel.options).some(o=>o.value===resolvedPrev))sel.value=resolvedPrev;
  }
  function fillClasses(){populateLegendDropdowns();}
  function save(){decisions[current.id]={source_sha256:current.sha256,decision:$('decision').value,notes:$('notes').value};persist();$('saved').textContent='Draft updated. Export your corrections before closing.';}
  function applyTheme(t){document.documentElement.dataset.theme=t;const b=$('theme-toggle');b.textContent=t==='dark'?'Light mode':'Dark mode';b.setAttribute('aria-pressed',String(t==='dark'));try{localStorage.setItem('ved-review-theme',t);}catch{}}
  function toggleTheme(){applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');}
  function setTool(tool){$('tool').value=tool;cancelDrawing();renderMarks();status(tool==='pan'?'Select and pan mode.':tool==='box'?'Draw a box by dragging.':tool==='polyline'?'Draw a line by clicking points, then finish.':'Draw a boundary by clicking points, then finish.');}
  function openMenu(x,y,id){document.getElementById('ctx-menu')?.remove();if(!document.getElementById('radial-menu-style')){const style=document.createElement('style');style.id='radial-menu-style';style.textContent='#ctx-menu.radial-menu{position:fixed;z-index:30;width:236px;height:236px;transform:translate(-50%,-50%);pointer-events:none}#ctx-menu.radial-menu::before{content:"";position:absolute;inset:62px;border-radius:50%;background:transparent;border:0;box-shadow:none;opacity:1}#ctx-menu.radial-menu button{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px;border-radius:50%;display:grid;place-items:center;padding:0;background:var(--surface);border:2px solid var(--border-strong);color:var(--text);font-size:22px;line-height:1;box-shadow:0 4px 12px #10233e30;pointer-events:auto;transition:transform .14s ease,background .14s ease,border-color .14s ease}#ctx-menu.radial-menu button:hover,#ctx-menu.radial-menu button:focus-visible{background:var(--accent-soft);border-color:var(--focus);transform:translate(var(--dx),var(--dy)) scale(1.12)}#ctx-menu.radial-menu button.danger{color:var(--danger)}#ctx-menu.radial-menu .radial-close{width:38px;height:38px;margin:-19px;font-size:16px;background:var(--surface-2);border-color:var(--border)}';document.head.append(style);}const m=document.createElement('div');m.id='ctx-menu';m.className='radial-menu';m.style.left=Math.max(122,Math.min(innerWidth-122,x))+'px';m.style.top=Math.max(122,Math.min(innerHeight-122,y))+'px';m.setAttribute('role','menu');const actions=[['←','Select / pan',()=>setTool('pan')],['▣','Draw box',()=>setTool('box')],['／','Draw line',()=>setTool('polyline')],['⬠','Draw boundary',()=>setTool('polygon')]];if(drawing.length){actions.push(['×','Cancel drawing',cancelDrawing]);}if(id){actions.push(['✥','Move / reshape',()=>{setTool('pan');choose(id)}]);actions.push(['✓','Mark reviewed',()=>{choose(id);$('confirm').click()}]);actions.push(['⌫','Reject',()=>{choose(id);$('delete').click()},{danger:true}]);}const radius=86,step=(Math.PI*2)/actions.length,start=-Math.PI/2;actions.forEach(([icon,label,fn,opts],index)=>{const b=document.createElement('button');b.type='button';b.textContent=icon;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('role','menuitem');if(opts?.danger)b.className='danger';const angle=start+index*step;b.style.setProperty('--dx',`${Math.cos(angle)*radius}px`);b.style.setProperty('--dy',`${Math.sin(angle)*radius}px`);b.style.transform='translate(var(--dx),var(--dy))';b.onclick=e=>{e.stopPropagation();m.remove();fn();};m.append(b);});const close=document.createElement('button');close.type='button';close.className='radial-close';close.textContent='×';close.title='Close menu';close.setAttribute('aria-label','Close menu');close.onclick=()=>m.remove();m.append(close);m.onpointerdown=e=>e.stopPropagation();document.body.append(m);setTimeout(()=>document.addEventListener('pointerdown',()=>m.remove(),{once:true}),0);}
  $('counts').textContent=`${D.counts.images} images · ${D.counts.groups} numbered groups · ${D.counts.plans} plans · ${D.counts.legend_reference_sheets} legend/reference sheets`;
  for(const [index,text] of ['Pointer - select and pan','Draw box','Draw line','Draw boundary'].entries())if($('tool').options[index])$('tool').options[index].text=text;
  for(const g of [...new Set(D.sheets.map(r=>r.group))])$('group').append(new Option('Group '+g,D.sheets.find(s=>s.group===g)?.group));for(const layer of Object.keys(colors)){const l=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.checked=enabled.has(layer);i.dataset.layer=layer;i.onchange=()=>{i.checked?enabled.add(layer):enabled.delete(layer);renderMarks();updateAnnotationList();};l.append(i,document.createTextNode(layer));l.style.color=colors[layer];$('layers').append(l);}
  beginStage();populateLegendDropdowns();renderWallTypeChips();syncWallTypeUI('');$('group').onchange=groupChanged;$('sheet').onchange=load;$('fit').onclick=fit;$('zin').onclick=()=>zoom(.65);$('zout').onclick=()=>zoom(1.5);$('focus').onclick=focusSelected;$('rotate').onclick=rotateView;$('show-overlays').onchange=renderMarks;
  $('annotation-search').oninput=updateAnnotationList;
  $('edit-class-search')?.addEventListener('input',()=>populateLegendDropdowns($('edit-class-search').value));
  $('tool').onchange=()=>setTool($('tool').value);$('edit-layer').onchange=()=>{const isGeom=$('edit-layer').value==='geometry';$('wall-type-field').hidden=!isGeom;if(isGeom)syncWallTypeUI($('edit-wall-type').value);};$('edit-wall-type').onchange=()=>applyWallType($('edit-wall-type').value);$('edit-class').onchange=()=>{const o=$('edit-class').selectedOptions[0];if(o?.dataset?.label)$('edit-label').value=o.dataset.label;const c=$('edit-legend-color');if(c)c.value=colorForLegend($('edit-class').value)||'#1683ff';if($('edit-class').value)highlightLegendMatches($('edit-class').value);};$('edit-legend-color')?.addEventListener('input',()=>{const id=$('edit-class').value;if(!id){status('Choose a legend class first, then pick its color.');return;}setLegendColor(id,$('edit-legend-color').value);});  $('finish').onclick=()=>finishDrawing();$('cancel').onclick=()=>{cancelDrawing();status('Drawing cancelled.');};$('decision').onchange=save;$('notes').oninput=save;$('theme-toggle').onclick=toggleTheme;$('attach-image').onchange=e=>{const file=e.target.files[0];if(!file)return;attachedImage=null;if(window.reviewWorkspace?.importFloorPlan){window.reviewWorkspace.importFloorPlan(file);}e.target.value='';};
  $('update').onclick=()=>{
    const targets=selectedAnnotations();
    if(!targets.length){status('Select at least one annotation first.');return;}
    checkpoint();
    for(const a of targets){
      preserve(a);
      a.layer=$('edit-layer').value;
      a.label=$('edit-label').value.trim()||'Unresolved annotation';
      a.legend_entry=$('edit-class').value||null;
      a.legendKey=a.legend_entry;
      a.wall_type=a.layer==='geometry'?($('edit-wall-type').value||null):null;
      if(a.wall_type&&wallTypeCatalog[a.wall_type]&&(!a.note||a.note==='Proposal requires review.')){
        a.note=wallTypeCatalog[a.wall_type].description;
      }
      enabled.add(a.layer);
    }
    persist();
    renderMarks();
    updateAnnotationList();
    describeSelection();
    status('Applied changes.');
  };
  function handleCorrectedAction(){
    const targets=selectedAnnotations();
    if(!targets.length){status('Select at least one annotation first.');return;}
    checkpoint();
    for(const a of targets){
      preserve(a);
      a.legend_entry=a.pendingLegendKey||a.legendKey||a.legend_entry||null;
      a.legendKey=a.legend_entry;
      delete a.pendingLegendKey;
      a.review_state='corrected';
      a.last_edited_at=new Date().toISOString();
    }
    persist();
    renderMarks();
    updateAnnotationList();
    describeSelection();
    status(targets.length+' annotation'+(targets.length===1?'':'s')+' saved as corrected with individual legends preserved.');
  }
  const btnCorrected=$('btn-corrected')||$('corrected');
  if(btnCorrected)btnCorrected.onclick=handleCorrectedAction;
  $('confirm').onclick=()=>{const targets=selectedAnnotations();if(!targets.length)return;checkpoint();targets.forEach(preserve);targets.forEach(a=>a.review_state='user_reviewed');persist();renderMarks();updateAnnotationList();status('Marked reviewed.');};
  $('delete').onclick=()=>{const targets=selectedAnnotations();if(!targets.length)return;checkpoint();targets.forEach(preserve);targets.forEach(a=>{a.review_state='deleted';disconnectAnnotation(a);});persist();renderMarks();updateAnnotationList();describeSelection();};
  function selectAll(){
    if(!current)return;
    multi.clear();
    const activeLegendKey=$('edit-class')?.value||window.currentActiveLegendKey||null;
    const term=($('annotation-search')?.value||'').trim();
    const targets=current.annotations.filter(a=>{
      if(!enabled.has(a.layer)||a.review_state==='deleted')return false;
      if(activeLegendKey&&!(LR()?.sameSymbol(a.legend_entry||a.legendKey,activeLegendKey)??((a.legend_entry===activeLegendKey)||(a.legendKey===activeLegendKey))))return false;
      if(!matchesAnnotationFilter(a,term))return false;
      return true;
    });
    targets.forEach(a=>multi.add(a.id));
    selected=null;
    describeSelection();
    renderMarks();
    updateAnnotationList();
    status(`Selected ${targets.length} annotation${targets.length===1?'':'s'}`+(activeLegendKey?` matching legend '${legendLabelOf(activeLegendKey)}'.`:'.'));
  }
  $('select-all-visible').onclick=selectAll;
  $('mark-all-corrected').onclick=()=>{const targets=current.annotations.filter(a=>enabled.has(a.layer)&&a.review_state!=='deleted');if(!targets.length){status('No visible annotations to mark.');return;}checkpoint();targets.forEach(preserve);targets.forEach(a=>a.review_state='user_reviewed');multi.clear();targets.forEach(a=>multi.add(a.id));selected=null;persist();describeSelection();renderMarks();updateAnnotationList();status(targets.length+' visible annotation'+(targets.length===1?'':'s')+' marked reviewed.');};
  $('clear-selection').onclick=()=>{multi.clear();selected=null;describeSelection();renderMarks();updateAnnotationList();};
  $('group-selection').onclick=()=>{const targets=selectedAnnotations();if(targets.length<2){status('Select two or more annotations to group them.');return;}checkpoint();for(const a of targets){const linked=new Set(a.connections||[]);for(const b of targets)if(b.id!==a.id)linked.add(b.id);a.connections=[...linked];}persist();renderMarks();updateAnnotationList();status(targets.length+' annotations grouped — drag any one to move them together.');};
  $('ungroup-selection').onclick=()=>{const targets=selectedAnnotations();if(!targets.length){status('Select at least one annotation to ungroup.');return;}checkpoint();targets.forEach(disconnectAnnotation);persist();renderMarks();updateAnnotationList();status('Ungrouped — shapes now move independently.');};
  function undoChange(){if(!current){status('Nothing to undo.');return;}const s=history.pop();if(!s){status('Nothing to undo.');return;}if(s.id!==current.id){history.push(s);status('Undo is available for the active drawing only.');return;}future.push({id:current.id,annotations:C.clone(current.annotations),view:[...view],selected,multi:new Set(multi)});current.annotations=C.clone(s.annotations);view=s.view;selected=s.selected;multi.clear();s.multi.forEach(id=>multi.add(id));applyView();renderMarks();updateAnnotationList();describeSelection();updateHistoryButtons();status('Undid the last change.');}function redoChange(){if(!current){status('Nothing to redo.');return;}const s=future.pop();if(!s){status('Nothing to redo.');return;}if(s.id!==current.id){future.push(s);status('Redo is available for the active drawing only.');return;}history.push({id:current.id,annotations:C.clone(current.annotations),view:[...view],selected,multi:new Set(multi)});current.annotations=C.clone(s.annotations);view=s.view;selected=s.selected;multi.clear();s.multi.forEach(id=>multi.add(id));applyView();renderMarks();updateAnnotationList();describeSelection();updateHistoryButtons();status('Redid the last change.');}$('undo').addEventListener('click',undoChange);$('redo').addEventListener('click',redoChange);updateHistoryButtons();
  async function autoAnnotateCurrentSheet(){
    if(!current){status('Please choose a drawing first.','error');return;}
    if(current.sheet_type==='legend_reference'){
      status("Notice: '"+(current.filename||current.id)+"' is an approved legend reference sheet, not a floor plan layout. Select a floor plan drawing (such as Drawing 2: BASEMENT LIGHTING LAYOUT or Group 11 / 12) or an imported floor plan to detect symbols.",'error');
      return;
    }
    const targetSheetId=current.id;
    const targetSha256=current.sha256;
    const targetSheetTitle=current.filename||current.id;
    const targetWidth=current.width;
    const targetHeight=current.height;

    const btn=$('btn-auto-annotate');
    const origText=btn?btn.textContent:'Auto annotate';
    if(btn){btn.disabled=true;btn.textContent='Annotating...';}
    status('Detecting missing symbols on '+targetSheetTitle+'...');
    try{
      const apiBase=(location.protocol==='file:'||!location.port)?'http://localhost:3000':'';
      const res=await fetch(apiBase+'/api/auto-annotate',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          sheet_id:targetSheetId,
          current_annotations:current.annotations,
          sheet_meta:{
            id:targetSheetId,
            title:current.title||current.filename||'Imported Plan',
            sheet_type:current.sheet_type||'floor_plan',
            width:targetWidth,
            height:targetHeight,
            image:current.image,
            sha256:targetSha256,
            associated_legend_ids:current.associated_legend_ids||[]
          }
        })
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        throw new Error(err.error||('Server returned status '+res.status));
      }
      const data=await res.json();
      if(data.status==='references_only'){
        status(data.message||'Legend reference sheet; no floor-plan drawing to annotate.','error');
        return;
      }
      if(data.status==='api_key_missing'){
        status('GEMINI_API_KEY is not configured on the server. Set the environment variable to enable live detection.','error');
        return;
      }
      // Protect against sheet-switching during async request
      if(!current||current.id!==targetSheetId){
        console.warn('Auto-annotation discarded: active drawing changed from '+targetSheetId+' to '+(current?current.id:'none'));
        status('Auto-annotation result for '+targetSheetTitle+' was discarded because you switched drawings.','info');
        return;
      }
      const newAnnotations=data.annotations||[];
      if(!newAnnotations.length){
        status('Auto-annotation complete: No additional missing symbols found on '+targetSheetTitle+'.');
        return;
      }
      checkpoint();
      let addedCount=0;
      for(const ann of newAnnotations){
        if(C.validGeometry(ann.geometry,current.width,current.height)){
          current.annotations.push(ann);
          addedCount++;
        }
      }
      persist();
      renderMarks();
      updateAnnotationList();
      renderCoverage();
      status('Auto-annotated '+addedCount+' new symbol'+(addedCount===1?'':'s')+' on '+targetSheetTitle+'. Click Accept all auto or Ctrl+Z to undo.','success');
    }catch(err){
      console.error('Auto-annotation failed:',err);
      status('Auto-annotation failed: '+err.message,'error');
    }finally{
      if(btn){btn.disabled=false;btn.textContent=origText;}
    }
  }
  function acceptAllAuto(){
    if(!current){status('Please choose a drawing first.');return;}
    const targets=current.annotations.filter(a=>(a.method==='auto_annotation_gemini'||(a.id&&a.id.includes('-ai-')) )&&a.review_state==='needs_review');
    if(!targets.length){status('No pending auto-detected annotations on this drawing.');return;}
    checkpoint();
    targets.forEach(preserve);
    targets.forEach(a=>{
      a.review_state='user_reviewed';
      if(a.legend_entry)a.class_state='approved_legend_mapping';
      a.last_edited_at=new Date().toISOString();
    });
    persist();
    renderMarks();
    updateAnnotationList();
    renderCoverage();
    status('Accepted '+targets.length+' auto-detected annotation'+(targets.length===1?'':'s')+'. Press Ctrl+Z to undo.');
  }
  function rejectAllAuto(){
    if(!current){status('Please choose a drawing first.');return;}
    const targets=current.annotations.filter(a=>(a.method==='auto_annotation_gemini'||(a.id&&a.id.includes('-ai-')) )&&a.review_state==='needs_review');
    if(!targets.length){status('No pending auto-detected annotations to reject.');return;}
    checkpoint();
    targets.forEach(preserve);
    targets.forEach(a=>{
      a.review_state='deleted';
      disconnectAnnotation(a);
      a.last_edited_at=new Date().toISOString();
    });
    persist();
    renderMarks();
    updateAnnotationList();
    describeSelection();
    renderCoverage();
    status('Rejected '+targets.length+' auto-detected annotation'+(targets.length===1?'':'s')+'. Press Ctrl+Z to undo.');
  }
  $('btn-auto-annotate')?.addEventListener('click',autoAnnotateCurrentSheet);
  $('accept-all-auto')?.addEventListener('click',acceptAllAuto);
  $('reject-all-auto')?.addEventListener('click',rejectAllAuto);
  $('export').onclick=()=>{try{C.validateReview(payload(),baseline);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload(),null,2)],{type:'application/json'}));a.download='ved-annotation-corrections.json';a.click();}catch(e){status('Export blocked: '+e.message);}};
  $('btn-export-training')?.addEventListener('click',async ()=>{
    try {
      status('Saving training dataset (images, YOLO .txt labels, and dataset.yaml)...');
      const dataPayload=payload();
      C.validateReview(dataPayload,baseline);
      const res=await fetch('/api/export-training-data',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({payload:dataPayload})
      });
      if(!res.ok){
        const err=await res.json().catch(()=>({}));
        throw new Error(err.error||res.statusText);
      }
      const result=await res.json();
      const count=result.summary?.total_bounding_boxes||0;
      const sheetsCount=result.summary?.total_sheets||0;
      status(`Training dataset saved! ${count} YOLO labels across ${sheetsCount} sheets written to training_dataset/ (ready for AI training).`);
    } catch(e) {
      status('Server export failed: '+e.message+'. Downloading client JSON review export instead.');
      $('export').click();
    }
  });
  window.addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey;if(mod&&e.key.toLowerCase()==='z'){$('undo').click();e.preventDefault();}else if(mod&&e.key.toLowerCase()==='y'){$('redo').click();e.preventDefault();}else if(mod&&e.key.toLowerCase()==='a'){$('btn-auto-annotate')?.click();e.preventDefault();}else if(mod&&e.key.toLowerCase()==='c'){copySelection();e.preventDefault();}else if(mod&&e.key.toLowerCase()==='v'){pasteSelection();e.preventDefault();}else if(mod&&e.key.toLowerCase()==='g'){e.preventDefault();(e.shiftKey?$('ungroup-selection'):$('group-selection')).click();}else if(e.key==='Backspace'){const tag=(e.target&&e.target.tagName||'').toLowerCase();if(tag==='input'||tag==='textarea'||e.target?.isContentEditable)return;e.preventDefault();if(drawing.length){drawing.pop();if(drawing.length)preview();else cancelDrawing();}else if(selected||multi.size){$('delete').click();}}else if(e.key==='Enter'&&drawing.length)window.reviewWorkspace.finishDrawing();else if(e.key==='Escape')cancelDrawing();else if(e.key==='+'||e.key==='=')zoom(.65);else if(e.key==='-')zoom(1.5);else if(e.key.toLowerCase()==='t')toggleTheme();else if(e.key.toLowerCase()==='f')fit();});
  function renderCoverage(){const body=$('all-sheets');if(!body)return;body.replaceChildren();for(const sheet of D.sheets){const counts={};for(const a of sheet.annotations.filter(a=>a.review_state!=='deleted'))counts[a.layer]=(counts[a.layer]||0)+1;const row=document.createElement('tr');[sheet.group,sheet.filename,counts.symbols||0,counts.geometry||0,counts.wiring||0,counts.legend||0,counts.ocr||0].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});body.append(row);}}
  function toggleHelp(force){const overlay=$('help-overlay');if(!overlay)return;overlay.hidden=force===undefined?!overlay.hidden:!force;}
  function restoreReview(file){return file.text().then(text=>{let out;try{out=JSON.parse(text);}catch{throw Error('The selected file is not valid JSON.');}if(!out||out.schema!=='ved-editable-review-v2'||!Array.isArray(out.sheets))throw Error('Choose a VED review export JSON file.');if(!window.confirm('Importing this review will overwrite the current annotations and notes. Continue?'))return;const upgraded=C.upgradeReview(out,baseline);for(const sheet of upgraded.sheets){const target=D.sheets.find(s=>s.id===sheet.id);if(target)target.annotations=C.clone(sheet.annotations);}for(const key of Object.keys(decisions))delete decisions[key];Object.assign(decisions,upgraded.decisions||{});for(const key of Object.keys(legendColors))delete legendColors[key];Object.assign(legendColors,upgraded.legend_colors||{});load();populateLegendDropdowns();renderCoverage();persist();status('Review imported. Existing annotations and notes were replaced by the imported review.');}).catch(error=>status('Review import failed: '+error.message));}
  function removeSheet(id){const index=D.sheets.findIndex(sheet=>sheet.id===id);if(index<0)return false;const sheet=D.sheets[index];if(!sheet.id.startsWith('imported-')){status('Only imported floor plans can be removed.');return false;}if(!window.confirm('Delete this imported floor plan and all of its annotations?'))return false;D.sheets.splice(index,1);const baselineIndex=baseline.sheets.findIndex(item=>item.id===id);if(baselineIndex>=0)baseline.sheets.splice(baselineIndex,1);D.counts.images=D.sheets.length;D.counts.groups=new Set(D.sheets.map(s=>s.group)).size;const next=D.sheets[0];if(!next)return false;$('group').value=String(next.group);groupChanged();renderCoverage();status('Imported floor plan deleted.');return true;}
  window.reviewWorkspace={getCurrent:()=>current,getSelected:selectedAnnotation,getSelectedId:()=>selected,renderMarks,getStage:()=>stage,getMarksLayer:()=>marksLayer,getView:()=>view,annotationsAtPoint,handleSelectionClick,choose,refreshList:updateAnnotationList,updateAnnotationList,selectAll,handleCorrectedAction,populateLegendDropdowns,legendList:()=>window.legendList,persist,renderCoverage,getLegendColor:colorForLegend,setLegendColor,getRotation:()=>rotation,focusLegendSource,focusLegendByKey,highlightLegendMatches,relevantLegendGroups:relevantGroupsForSheet,legendRegistry:()=>window.LegendRegistry,resolveLegendKey:id=>legendKeyOf(id),legendLabel:id=>legendLabelOf(id),acceptAllAuto,rejectAllAuto,autoAnnotate:autoAnnotateCurrentSheet,applyWallType,syncWallTypeUI,renderWallTypeChips,getWallTypeCatalog:()=>wallTypeCatalog,removeAnnotationById(id){const index=current.annotations.findIndex(a=>a.id===id);if(index<0)return false;if(!window.confirm('Delete this legend or annotation?'))return false;checkpoint();current.annotations.splice(index,1);if(selected===id)selected=null;persist();renderMarks();updateAnnotationList();renderCoverage();return true;},addSheet(sheet){D.sheets.push(sheet);baseline.sheets.push(C.clone(sheet));D.counts.images=D.sheets.length;D.counts.groups=new Set(D.sheets.map(s=>s.group)).size;if(sheet.sheet_type==='legend_reference'){D.counts.legend_reference_sheets=(D.counts.legend_reference_sheets||0)+1;}else{D.counts.plans=(D.counts.plans||0)+1;}if(![...$('group').options].some(o=>o.value===String(sheet.group))){$('group').append(new Option(sheet.group_name||('Group '+sheet.group),sheet.group));}$('counts').textContent=`${D.counts.images} images · ${D.counts.groups} numbered groups · ${D.counts.plans} plans · ${D.counts.legend_reference_sheets} legend/reference sheets`;},clearAttachedImage(){attachedImage=null;if(current)load();},removeSheet};
  window.updateAnnotationList=updateAnnotationList;
  window.selectAll=selectAll;
  window.populateLegendDropdowns=populateLegendDropdowns;
  window.handleCorrectedAction=handleCorrectedAction;
 $('help-btn')?.addEventListener('click',()=>toggleHelp(true));$('help-close')?.addEventListener('click',()=>toggleHelp(false));$('help-overlay')?.addEventListener('click',event=>{if(event.target===$('help-overlay'))toggleHelp(false);});$('import')?.addEventListener('change',event=>{const file=event.target.files[0];if(file)restoreReview(file);event.target.value='';});
  $('btn-save-session')?.addEventListener('click', async () => {
    status('Saving current session...');
    if (window.VEDSessionStore) {
      await window.VEDSessionStore.performSave(payload());
      status('Session saved to disk and browser storage. Progress is safe.');
    } else {
      persist();
      status('Session saved to local storage.');
    }
  });
 window.reviewWorkspace.setTool=setTool;
 window.reviewWorkspace.finishDrawing=finishDrawing;
 window.reviewWorkspace.cancelDrawing=cancelDrawing;
 window.reviewWorkspace.getDrawing=()=>drawing;
 window.reviewWorkspace.addDrawingPoint=p=>{
  if(Array.isArray(p))addDrawingPointAt(p);
  else if(stage){
   const pt=stage.getRelativePointerPosition();
   if(pt)addDrawingPointAt([pt.x,pt.y]);
  }
 };
 $('finish').onclick=()=>finishDrawing();
  window.reviewWorkspace.zoomAt=(factor,x,y)=>zoom(factor,x,y);const restoredDraft=restoreDraft();applyTheme(document.documentElement.dataset.theme||'light');groupChanged();renderCoverage();if(restoredDraft)status('Restored the saved review, including imported labels and legend links.');
  if(window.VEDSessionStore){
    window.VEDSessionStore.setPayloadGetter(payload);
    window.VEDSessionStore.restoreBestSession(baseline).then(best=>{
      if(best && best.data){
        const ok = applyRestoredReview(best.data);
        if(ok){
          groupChanged();
          populateLegendDropdowns();
          renderCoverage();
          renderMarks();
          const timeStr = best.saved_at ? new Date(best.saved_at).toLocaleTimeString() : '';
          status(`Restored saved session from ${timeStr || 'previous work'}. All annotations and progress were preserved.`);
        }
      }
    }).catch(e=>{
      console.warn('[SessionStore] Session restoration notice:', e.message);
    });
  }
})();
