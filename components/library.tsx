"use client";
import { useState, type FormEvent } from "react";
import { Archive, BookOpen, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import { can, libraryCategories, money, type LibraryDocument, type LibraryEntry, type Workspace } from "@/lib/model";
import { Badge, Empty, Modal, Panel, type Mutation } from "./shared";

const initial: LibraryDocument = {title:"",category:"Interactive experience",scope:"",siteRequirements:"",exclusions:"",terms:"",imageCaption:"",rate:"",vat:"15"};
const longFields = {scope:"Scope of work",siteRequirements:"Site requirements",exclusions:"Exclusions",terms:"Commercial terms"} as const;

export function QuotationLibrary({data,mutate}:{data:Workspace;mutate:Mutation}) {
  const manage = can(data.actor,"library_manage");
  const [query,setQuery] = useState("");
  const [category,setCategory] = useState("");
  const [showArchived,setShowArchived] = useState(false);
  const [selected,setSelected] = useState<string|null>(null);
  const selectedEntry = data.library.find(entry=>entry.id===selected);
  const active = data.library.filter(entry=>(showArchived||!entry.archived)&&(!category||entry.document.category===category)&&
    [entry.document.title,entry.document.scope,entry.document.siteRequirements].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header className="page-head"><div><p className="kicker">COMMERCIAL</p><h1>Quotation library</h1>
      <p>Reusable EIS offerings for your quotation drafts.</p></div>
      {manage&&<button className="primary" onClick={()=>setSelected("new")}><Plus size={17}/> Add offering</button>}
    </header>
    <div className="toolbar"><input className="grow-search" type="search" aria-label="Search offerings" placeholder="Search offerings" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Filter offerings by category" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{libraryCategories.map(item=><option key={item}>{item}</option>)}</select>
      {manage&&<label className="check"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived</label>}
    </div>
    {active.length?<div className="library-grid">{active.map(entry=><Panel key={entry.id} title={entry.document.title}
      action={entry.archived?<Badge value="archived"/>:undefined}>
      {entry.has_image&&<img className="library-visual" src={`/api/library-image/${entry.id}?v=${entry.lock_version}`} alt={entry.document.imageCaption||entry.document.title}/>}
      <div className="inset form-stack"><p className="kicker">{entry.document.category}</p>
        {entry.document.scope&&<p className="library-description">{entry.document.scope}</p>}
        {entry.document.rate&&<p className="muted">Default selling price · SAR {money(entry.document.rate)} before VAT</p>}
        <button className="secondary small" onClick={()=>setSelected(entry.id)}>{manage?<Pencil size={15}/>:<BookOpen size={15}/>} {manage&&!entry.archived?"Edit offering":"View offering"}</button>
      </div>
    </Panel>)}</div>:<Panel title="Offerings"><Empty title="No offerings found">{manage?"Add a reusable scope, site requirements, or pricing entry.":"Library offerings appear here when an administrator adds them."}</Empty></Panel>}
    {selected&&(selected==="new"||selectedEntry)&&<LibraryEditor key={`${selected}-${selectedEntry?.lock_version??0}`} entry={selectedEntry} close={()=>setSelected(null)}
      onCreate={id=>setSelected(id)} manage={manage} mutate={mutate}/>}
  </>;
}

function LibraryEditor({entry,close,manage,mutate,onCreate}:{entry?:LibraryEntry;close:()=>void;manage:boolean;mutate:Mutation;onCreate:(id:string)=>void}) {
  const [doc,setDoc] = useState(entry?.document??initial);
  const editable = manage&&!entry?.archived;
  const update = <K extends keyof LibraryDocument>(field:K,value:LibraryDocument[K])=>setDoc(current=>({...current,[field]:value}));
  async function save(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result=await mutate({action:"library.save",id:entry?.id,lock:entry?.lock_version,document:doc},"Offering saved");
    if (result && !entry) onCreate(result.id);
  }
  async function upload(file:File) {
    const form=new FormData();form.set("target","library-image");form.set("entry",entry!.id);
    form.set("lock",String(entry!.lock_version));form.set("file",file);
    await mutate(form,"Library visual uploaded");
  }
  return <Modal title={entry?entry.document.title:"Add a library offering"} close={close}>
    <form className="form-stack modal-form" onSubmit={save}>
      <div className="field-grid"><label>Offering name<input required maxLength={200} value={doc.title} readOnly={!editable} onChange={e=>update("title",e.target.value)}/></label>
        <label>Category<select value={doc.category} disabled={!editable} onChange={e=>update("category",e.target.value as LibraryDocument["category"])}>
          {libraryCategories.map(category=><option key={category}>{category}</option>)}</select></label></div>
      {Object.entries(longFields).map(([field,label])=><label key={field}>{label}<textarea value={doc[field as keyof typeof longFields]} readOnly={!editable} maxLength={5000} onChange={e=>update(field as keyof typeof longFields,e.target.value)}/></label>)}
      <div className="field-grid"><label>Default selling price (SAR, excluding VAT)<input value={doc.rate} inputMode="decimal" readOnly={!editable} onChange={e=>update("rate",e.target.value)} placeholder="Optional"/></label>
        <label>VAT %<input value={doc.vat} inputMode="decimal" readOnly={!editable} onChange={e=>update("vat",e.target.value)}/></label></div>
      <label>Visual caption<input value={doc.imageCaption} maxLength={200} readOnly={!editable} onChange={e=>update("imageCaption",e.target.value)}/></label>
      {entry?.has_image&&<img className="library-visual" src={`/api/library-image/${entry.id}?v=${entry.lock_version}`} alt={entry.document.imageCaption||entry.document.title}/>}
      <div className="form-actions">
        {entry&&manage&&<button type="button" className="secondary" onClick={()=>mutate({action:"library.archive",id:entry.id,lock:entry.lock_version,archived:!entry.archived},entry.archived?"Offering restored":"Offering archived")}>
          {entry.archived?<RotateCcw size={16}/>:<Archive size={16}/>} {entry.archived?"Restore":"Archive"}</button>}
        {entry&&editable&&<label className="secondary file-button"><Upload size={16}/> {entry.has_image?"Replace visual":"Upload visual"}
          <input aria-label="Upload catalog visual" type="file" accept="image/png,image/jpeg,image/webp" disabled={JSON.stringify(doc)!==JSON.stringify(entry.document)} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value="";}}/></label>}
        {editable&&<button className="primary">Save offering</button>}
      </div>
      {entry&&editable&&JSON.stringify(doc)!==JSON.stringify(entry.document)&&<p className="muted">Save text changes before uploading a visual.</p>}
    </form>
  </Modal>;
}

export function AddLibraryEntry({data,options,close,apply}:{data:Workspace;options: {id:string;name:string}[];close:()=>void;apply:(entry:string,optionId:string,includePrice:boolean)=>Promise<void>}) {
  const [query,setQuery]=useState("");
  const [selected,setSelected]=useState("");
  const [option,setOption]=useState("");
  const [include,setInclude]=useState(false);
  const entries=data.library.filter(entry=>!entry.archived&&entry.document.title.toLowerCase().includes(query.trim().toLowerCase()));
  const entry=entries.find(item=>item.id===selected);
  const priceAllowed=Boolean(entry?.document.rate&&(option||options.length===1));
  return <Modal title="Add from quotation library" close={close}><form className="form-stack modal-form" onSubmit={e=>{
    e.preventDefault();if(entry)void apply(entry.id,option,priceAllowed&&include);
  }}>
    <label>Search offerings<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <label>Offering<select aria-label="Offering" value={selected} onChange={e=>{setSelected(e.target.value);setInclude(false);}} required>
      <option value="">Select an offering</option>{entries.map(item=><option value={item.id} key={item.id}>{item.document.title}</option>)}</select></label>
    {entry&&<p className="muted">{entry.document.scope||entry.document.category}</p>}
    <label>Apply pages to<select value={option} onChange={e=>{setOption(e.target.value);setInclude(false);}}><option value="">Entire quotation</option>{options.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    {entry?.document.rate&&<label className="check"><input type="checkbox" disabled={!priceAllowed} checked={include} onChange={e=>setInclude(e.target.checked)}/>
      Include selling price of SAR {money(entry.document.rate)} before VAT</label>}
    {entry?.document.rate&&!priceAllowed&&<p className="muted">Select a specific option to add a selling price to a multi-option quote.</p>}
    <div className="form-actions"><button className="primary" disabled={!entry}>Add to draft</button></div>
  </form></Modal>;
}
