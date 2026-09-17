// Rebuild the detector's drawing references while preserving reviewed edits and deletion history.
const fs=require('fs');
const path=require('path');
const vm=require('vm');
const crypto=require('crypto');
const live=process.argv[2];
const output=process.argv[3];
if(!live||!output)throw Error('Usage: node build-outlet-references.cjs LIVE_APP OUTPUT_JSON');
const context={window:{}};vm.createContext(context);
for(const name of ['data.js','expanded-dataset.js'])vm.runInContext(fs.readFileSync(path.join(live,name),'utf8'),context,{filename:name});
const data=context.window.ANNOTATION_DATA;
const previous=JSON.parse(fs.readFileSync(path.join(live,'data','approved-references.json'),'utf8'));
const oldById=new Map(previous.sheets.map(s=>[s.id,s]));
const upgrades=require(path.resolve(live,'outlet-class-upgrades.js'));
const catalog=new Map(),unlinked=[];
let total=0,active=0,deleted=0,legends=0;
const sheets=[];
for(const meta of data.sheets){
  const old=oldById.get(meta.id);
  const annotations=old?[...structuredClone(old.annotations||[]),...structuredClone(old.deletions||[])]:structuredClone(meta.annotations||[]);
  const work={id:meta.id,annotations};upgrades.applyToSheet(work);
  const ids=new Set();for(const a of work.annotations){if(!a.id||ids.has(a.id))throw Error(`Duplicate annotation on ${meta.id}: ${a.id}`);ids.add(a.id);}
  const imagePath=path.join(live,meta.image),hash=crypto.createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex');
  if(meta.sha256&&meta.sha256!==hash)throw Error(`Image SHA mismatch: ${meta.id}`);
  const retained=[],deletions=[];
  for(const a of work.annotations){
    total++;
    if(a.review_state==='deleted'){
      deleted++;deletions.push({id:a.id,layer:a.layer,label:a.label,geometry:a.geometry,legend_entry:a.legend_entry||null,review_state:'deleted'});continue;
    }
    active++;retained.push(a);
    if(a.layer!=='legend')continue;
    legends++;
    const example={source_annotation_id:a.id,source_sheet_id:meta.id,source_sha256:hash,geometry:a.geometry,label:a.label,role:'legend_definition'};
    if(!a.legend_entry){unlinked.push({reference_id:`ref-${meta.id}-${a.id}`,legend_entry:null,...example,role:'unlinked_legend'});continue;}
    if(!catalog.has(a.legend_entry))catalog.set(a.legend_entry,{legend_entry:a.legend_entry,label:a.label,layer:'legend',examples:[]});
    catalog.get(a.legend_entry).examples.push(example);
  }
  sheets.push({id:meta.id,group:meta.group,group_name:meta.group_name||'',title:meta.title||'',sheet_type:meta.sheet_type,image:meta.image,width:meta.width,height:meta.height,sha256:hash,associated_legend_ids:meta.associated_legend_ids||[],active_annotations_count:retained.length,deleted_annotations_count:deletions.length,annotations:retained,deletions,legends:retained.filter(a=>a.layer==='legend'),symbols:retained.filter(a=>a.layer==='symbols')});
}
const result={version:'ved-approved-references-v2',generated_at:new Date().toISOString(),stats:{total_sheets:sheets.length,total_annotations:total,total_active:active,total_deleted:deleted,total_legend_records:legends,total_legend_catalog_entries:catalog.size,total_unlinked_legend_records:unlinked.length},legend_catalog:[...catalog.values()],unlinked_legends:unlinked,sheets};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));
console.log(JSON.stringify(result.stats));
