(()=>{
 'use strict';const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
 function tab(name){for(const id of ['edit','legends','review']){$('panel-'+id).hidden=id!==name;$('tab-'+id).setAttribute('aria-selected',String(id===name));}}
 for(const id of ['edit','legends','review'])$('tab-'+id).addEventListener('click',()=>tab(id));
 function show(s){
  if(!s)return;
  $('annotation-search').value='';
  window.reviewWorkspace.refreshList();

  const host=$('own-legend-entries');host.replaceChildren();
  const associated=$('legends');associated.replaceChildren();
  const associatedIds=Array.isArray(s?.associated_legend_ids)?s.associated_legend_ids:(Array.isArray(s?.associated_legend_sheets)?s.associated_legend_sheets:[]);
  for(const id of associatedIds){
   const source=(window.ANNOTATION_DATA.sheets||[]).find(x=>x.id===id);
   if(!source||!source.image)continue;
   const wrap=document.createElement('div');wrap.className='associated-legend';
   const label=document.createElement('strong');label.textContent=source.filename||source.id;
   const img=document.createElement('img');img.src=source.image;img.alt=(source.filename||source.id)+' associated legend sheet';
   wrap.append(label,img);associated.append(wrap);
  }
  const associatedDetails=associated.closest('details');
  if(associatedDetails)associatedDetails.open=associated.children.length>0;

  // Universal catalogue: one card per distinct symbol, never one per sheet.
  const registry=window.LegendRegistry;
  window.reviewWorkspace.populateLegendDropdowns?.();
  // Still ONE flat universal list - no groups, no duplicates. Symbols already
  // used on the open drawing simply sort to the top so the panel stays usable.
  const relevantGroups=window.reviewWorkspace.relevantLegendGroups?.(s)||new Set([s.group]);
  const entries=registry?registry.list(($('legend-catalog-search')?.value)||'',{groups:relevantGroups})
   .sort((a,b)=>{const ua=registry.isUsedOn(a.key,s.id)?0:1,ub=registry.isUsedOn(b.key,s.id)?0:1;
    return ua!==ub?ua-ub:a.label.localeCompare(b.label);}):[];

  for(const entry of entries){
   const src=registry.bestSource(entry.key,s.id);
   const onSheet=registry.isUsedOn(entry.key,s.id);
   const card=document.createElement('div');
   card.className='legend-card'+(onSheet?' legend-card-onsheet':'');

   const b=document.createElement('button');
   b.textContent=entry.label;
   b.title=entry.label+(entry.aliases.size?'  ·  also known here as: '+Array.from(entry.aliases).join(', '):'');
   b.addEventListener('click',()=>{
    $('edit-class').value=entry.key;
    $('edit-label').value=entry.label;
    $('edit-layer').value='symbols';
    const colorField=$('edit-legend-color');
    if(colorField)colorField.value=window.reviewWorkspace.getLegendColor(entry.key)||'#1683ff';
    tab('edit');
    const selected=window.reviewWorkspace.getSelected?.();
    if(selected){
     $('update').click();
     $('editor-status').textContent='Legend applied to the selected annotation: '+entry.label+'.';
    }else{
     // Just select/highlight whatever on THIS drawing already uses this
     // symbol, in the annotation list. Never jump the canvas or switch to
     // wherever the symbol happened to be first defined.
     const count=window.reviewWorkspace.highlightLegendMatches?.(entry.key)||0;
     $('editor-status').textContent=count
      ? count+' annotation'+(count===1?'':'s')+' on this drawing use "'+entry.label+'" — highlighted in the list.'
      : '"'+entry.label+'" loaded. Draw a new box, or select an annotation to apply it.';
    }
   });

   const swatch=document.createElement('input');
   swatch.type='color';swatch.className='legend-color-swatch';
   swatch.title='Color used for this symbol on every drawing';
   swatch.setAttribute('aria-label','Color for '+entry.label);
   swatch.value=window.reviewWorkspace.getLegendColor(entry.key)||'#1683ff';
   b.style.color=swatch.value;
   swatch.addEventListener('click',e=>e.stopPropagation());
   swatch.addEventListener('input',e=>{
    e.stopPropagation();
    window.reviewWorkspace.setLegendColor(entry.key,swatch.value);
    b.style.color=swatch.value;
    const colorField=$('edit-legend-color');
    if(colorField&&$('edit-class').value===entry.key)colorField.value=swatch.value;
   });

   if(src&&src.uploaded_crop){
    const img=document.createElement('img');
    img.src=src.uploaded_crop;img.alt=entry.label+' (uploaded legend crop)';
    img.style.cssText='width:100%;height:80px;object-fit:contain;background:#fff';
    card.append(img);
    const tag=document.createElement('small');
    tag.textContent='Uploaded reference — not part of the original drawing legend.';
    card.append(tag);
   }else if(src&&src.geometry&&src.geometry.type==='bbox'&&src.sheet_id){
    const sheet=(window.ANNOTATION_DATA.sheets||[]).find(x=>x.id===src.sheet_id);
    if(sheet&&sheet.image){
     const [x,y,r,bottom]=src.geometry.coordinates;
     const svg=document.createElementNS(NS,'svg');
     svg.setAttribute('viewBox',[x,y,r-x,bottom-y].join(' '));
     svg.setAttribute('role','img');
     svg.setAttribute('aria-label',entry.label+' legend symbol');
     const image=document.createElementNS(NS,'image');
     image.setAttribute('href',sheet.image);
     image.setAttribute('width',sheet.width);
     image.setAttribute('height',sheet.height);
     svg.append(image);card.append(svg);
    }
   }

   const row=document.createElement('div');row.className='legend-row';
   row.append(swatch,b);card.append(row);

   const meta=document.createElement('small');
   meta.className='legend-meta';
   const drawings=entry.sheetIds.size;
   const groupSpan=entry.groups?entry.groups.size:0;
   const parts=[];
   if(onSheet)parts.push('on this drawing');
   if(drawings>1)parts.push('shared across '+drawings+' drawings');
   if(groupSpan>1)parts.push('used in '+groupSpan+' groups');
   if(entry.usage)parts.push(entry.usage+' placed');
   meta.textContent=parts.join(' · ')||'not yet placed';
   card.append(meta);

   if(entry.custom){
    const remove=document.createElement('button');
    remove.className='danger small';
    remove.textContent='Delete uploaded legend';
    remove.addEventListener('click',()=>{
     const own=entry.sources.filter(x=>x.annotation_id&&x.sheet_id===s.id);
     let removed=false;
     for(const o of own){if(window.reviewWorkspace.removeAnnotationById(o.annotation_id))removed=true;}
     if(removed)show(window.reviewWorkspace.getCurrent());
    });
    card.append(remove);
   }

   host.append(card);
  }

  if(!host.children.length){
   const p=document.createElement('p');
   p.textContent='No legend symbols for this group yet. Upload a legend sheet below to add the first one — it stays available to every drawing that shares this group, and will merge automatically if the same symbol already exists elsewhere.';
   host.append(p);
  }
 }
 document.addEventListener('legend-entries-changed',()=>{const c=window.reviewWorkspace?.getCurrent?.();if(c)show(c);});
 $('legend-catalog-search')?.addEventListener('input',()=>{const c=window.reviewWorkspace?.getCurrent?.();if(c)show(c);});
 window.workspaceUI={show,selected:()=>tab('edit')};show(window.reviewWorkspace.getCurrent());
})();
