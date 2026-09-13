(function(root){
 'use strict';
 const clone=x=>JSON.parse(JSON.stringify(x));
 function validGeometry(g,w,h){
  if(!g || !Array.isArray(g.coordinates))return false;
  let points;
  if(g.type==='bbox'){
   if(g.coordinates.length!==4)return false;
   const [x,y,r,b]=g.coordinates;if(!(r>x&&b>y))return false;points=[[x,y],[r,b]];
  }else if(['polyline','polygon'].includes(g.type)){
   points=g.coordinates;if(points.length<(g.type==='polygon'?3:2))return false;
  }else return false;
  return points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&p[0]>=0&&p[1]>=0&&p[0]<=w&&p[1]<=h);
 }
 function translate(g,dx,dy,w,h){
  const out=clone(g),p=g.type==='bbox'?[[g.coordinates[0],g.coordinates[1]],[g.coordinates[2],g.coordinates[3]]]:g.coordinates;
  dx=Math.max(-Math.min(...p.map(q=>q[0])),Math.min(dx,w-Math.max(...p.map(q=>q[0]))));
  dy=Math.max(-Math.min(...p.map(q=>q[1])),Math.min(dy,h-Math.max(...p.map(q=>q[1]))));
  out.coordinates=g.type==='bbox'?g.coordinates.map((v,i)=>v+(i%2?dy:dx)):p.map(q=>[q[0]+dx,q[1]+dy]);return out;
 }
 function normalizeImportedReview(payload,base){
  const out=clone(payload),placeholders=new Set(['','unresolved annotation','unresolved','unmapped annotation','unmapped symbol','no clear legend match']);
  const isPlaceholder=value=>{const text=(value||'').trim().toLowerCase();return placeholders.has(text)||text.startsWith('unresolved ')||text.startsWith('unmapped ')||text.includes('no clear legend match');};
  const legends=new Map(base.sheets.flatMap(s=>s.annotations.filter(a=>a.layer==='legend'&&a.legend_entry&&typeof a.label==='string').map(a=>[a.legend_entry,a])));
  const associatedBySheet=new Map(base.sheets.map(s=>{
   const labels=new Map();
   for(const sourceId of s.associated_legend_ids||[]){
    const source=base.sheets.find(x=>x.id===sourceId);if(!source)continue;
    for(const a of source.annotations.filter(x=>x.layer==='legend'&&x.legend_entry&&typeof x.label==='string')){
     const prior=labels.get(a.label);labels.set(a.label,prior&&prior!==a.legend_entry?null:a.legend_entry);
    }
   }
   return [s.id,labels];
  }));
  for(const sheet of out.sheets||[]){
   const labels=associatedBySheet.get(sheet.id)||new Map();
   for(const a of sheet.annotations||[]){
    const original=a.original_annotation||{};
    if(typeof a.label!=='string'||!a.label.trim())a.label=original.label||a.annotation_label||a.name||a.text||'Unresolved annotation';
    const currentLabel=(a.label||'').trim().toLowerCase();
    const originalLabel=typeof original.label==='string'?original.label.trim():'';
    if(isPlaceholder(a.label)&&originalLabel&&!isPlaceholder(originalLabel))a.label=originalLabel;
    if(isPlaceholder(a.label)&&a.legend_entry&&legends.has(a.legend_entry))a.label=legends.get(a.legend_entry).label;
    if(!a.legend_entry&&typeof a.label==='string'&&labels.has(a.label)&&labels.get(a.label))a.legend_entry=labels.get(a.label);
    if(a.layer==='unresolved'&&original.layer&&original.layer!=='unresolved'&&((a.label||'').trim().toLowerCase()!== 'unresolved annotation'||a.legend_entry))a.layer=original.layer;
   }
  }
  return out;
 }
 function validateReview(payload,base){
  if(payload.schema!=='ved-editable-review-v2'||!Array.isArray(payload.sheets)||payload.sheets.length!==base.sheets.length)throw Error('Not a complete review export for this dataset.');
  const seen=new Set(),layers=new Set(['symbols','geometry','wiring','text','legend','unresolved','regions','ocr']);
  for(const s of payload.sheets){
   const original=base.sheets.find(b=>b.id===s.id);
   if(!original||seen.has(s.id)||s.source_sha256!==original.sha256)throw Error('Sheet identity / source hash mismatch.');seen.add(s.id);
   if(!Array.isArray(s.annotations)||s.annotations.length>20000)throw Error('Invalid annotation count.');
   const ids=new Set();const legends=new Map(base.sheets.flatMap(b=>b.annotations.filter(a=>a.layer==='legend').map(a=>[a.legend_entry,b])));
   const userLegendEntries=new Set(payload.sheets.flatMap(sh=>sh.annotations.filter(a=>a.layer==='legend'&&a.class_state==='user_defined_legend_source').map(a=>a.legend_entry)));
   for(const a of s.annotations){
    if(typeof a.id!=='string'||ids.has(a.id)||!layers.has(a.layer)||typeof a.label!=='string'||a.label.length>1000||!validGeometry(a.geometry,original.width,original.height))throw Error('Invalid annotation or coordinates.');ids.add(a.id);
    if(a.legend_entry){const source=legends.get(a.legend_entry);
     if(!source){if(userLegendEntries.has(a.legend_entry))continue;throw Error('Unknown legend reference.');}
     if(!original.associated_legend_ids.includes(source.id)&&(a.legend_scope!=='cross_group'||a.class_state!=='cross_group_candidate'||a.legend_source?.sheet_id!==source.id||a.legend_source?.source_sha256!==source.sha256||a.legend_source?.group!==source.group))throw Error('Cross-group matches must retain source provenance and candidate status.');}
   }
  }return true;
 }
 function upgradeReview(payload,base){
  const normalized=normalizeImportedReview(payload,base);
  if(normalized?.sheets?.length===base.sheets.length){validateReview(normalized,base);return clone(normalized);}
  const legacy=base.legacy_sheet_ids;
  if(!Array.isArray(legacy)||normalized?.sheets?.length!==legacy.length)throw Error('Review must contain every current page or every original page.');
  const oldBase={sheets:base.sheets.filter(s=>legacy.includes(s.id))};
  const out=clone(normalized);validateReview(out,oldBase);for(const s of base.sheets.filter(s=>!legacy.includes(s.id)))out.sheets.push({id:s.id,source_sha256:s.sha256,width:s.width,height:s.height,training_eligible:false,annotations:clone(s.annotations)});
  out.training_approved=false;validateReview(out,base);return out;
 }
 function mergeProposals(data,items){let count=0;for(const item of items){const s=data.sheets.find(s=>s.id===item.sheet_id);if(!s||s.sha256!==item.source_sha256||!validGeometry(item.annotation.geometry,s.width,s.height))throw Error('Supplemental proposal source/geometry mismatch.');if(!s.annotations.some(a=>a.id===item.annotation.id)){s.annotations.push(clone(item.annotation));count++;}}return count;}
 const api={clone,validGeometry,translate,validateReview,upgradeReview,mergeProposals};root.AnnotationCore=api;
 if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
