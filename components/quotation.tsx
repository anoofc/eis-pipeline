"use client";
import { useEffect,useMemo,useRef,useState,type FormEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Copy, Download, FileText, GripVertical, History, Plus, Save, Send, Trash2, Upload } from "lucide-react";
import { can, canSeeCosting, displayDate, isSales, makeItem, money, pageTypes, quoteSchema, totals, type QuoteDocument, type Revision, type Workspace } from "@/lib/model";
import { AddLibraryEntry } from "./library";
import { QuotationCosting } from "./costing";
import { quoteHtml } from "@/lib/document";
import { Badge,Empty,Modal,Panel,Prices,type Mutation } from "./shared";

type Page=QuoteDocument["pages"][number];
type Group=QuoteDocument["options"][number];

function Preview({html,width=1280,title="Quotation PDF preview",selected}:{html:string;width?:number;title?:string;selected?:string}) {
  const ref=useRef<HTMLDivElement>(null);
  const frame=useRef<HTMLIFrameElement>(null);
  const [scale,setScale]=useState(0.5);
  const [height,setHeight]=useState(720);
  const [content,setContent]=useState(html);
  useEffect(()=>{
    const timer=setTimeout(()=>setContent(html),180);
    return ()=>clearTimeout(timer);
  },[html]);
  useEffect(()=>{
    const target=ref.current;
    if(!target)return;
    const observer=new ResizeObserver(entries=>setScale(Math.min(1,(entries[0].contentRect.width-18)/width)));
    observer.observe(target);
    return ()=>observer.disconnect();
  },[width]);
  function showPage() {
    const target=frame.current?.contentDocument?.querySelector<HTMLElement>(`[data-source="${CSS.escape(selected??"")}"]`);
    if(target&&ref.current)ref.current.scrollTop=Math.max(0,target.offsetTop*scale-5);
  }
  useEffect(showPage,[selected,scale]);
  return <div className="preview-scroll" ref={ref}><div className="preview-size" style={{width:width*scale,height:height*scale}}>
    <iframe title={title} sandbox="allow-same-origin" ref={frame} srcDoc={content} style={{width,height:height+2,transform:`scale(${scale})`}}
      onLoad={()=>{const body=frame.current?.contentDocument?.body;if(body)setHeight(body.scrollHeight+4);showPage();}}/></div></div>;
}
export { Preview };

export function QuotationList({data,open}:{data:Workspace;open:(id:string)=>void}) {
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("");
  const rows=data.revisions.filter(row=>(!filter||row.state===filter)&&`${row.reference??"Draft"} ${row.document.title} ${row.document.client}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header className="page-head"><div><p className="kicker">COMMERCIAL</p><h1>Quotations</h1><p>Create an offer from an opportunity and track issued revisions here.</p></div></header>
    <div className="toolbar"><input className="grow-search" type="search" aria-label="Search quotations" placeholder="Search title, client or reference" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Quotation status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{["draft","issued","superseded","withdrawn"].map(item=><option key={item}>{item}</option>)}</select></div>
    <Panel title="Quotation register">{rows.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Quotation</th><th>Reference</th><th>Status</th><th>Expires</th><th>Last editor</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}><td><button className="cell-link" onClick={()=>open(row.id)}><strong>{row.document.title}</strong><small>{row.document.client}</small></button></td>
        <td>{row.reference??"Draft"}</td><td><Badge value={row.state==="issued"&&row.expires&&row.expires<data.today?"expired":row.state}/></td><td>{displayDate(row.expires)}</td><td>{row.updated_name}</td></tr>)}</tbody></table></div>:<Empty title="No quotations match"/>}</Panel>
  </>;
}

const labels = {title:"Offer title",client:"Client name",clientContact:"Client contact",venue:"Venue",installation:"Installation",leadTime:"Lead time",payment:"Payment terms",eventStart:"Event start",eventEnd:"Event end"} as const;
const addPage=(type: Page["type"]):Page=>({id:crypto.randomUUID(),type,title:"",body:"",optionId:"",imageId:"",caption:""});
const newGroup=(name:string):Group=>({id:crypto.randomUUID(),name,items:[makeItem()]});
type Overlay="accept"|"history"|"remove"|"library"|null;
const documentSignature = (document:QuoteDocument) => JSON.stringify(document, (_key,value) =>
  value && typeof value==="object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))) : value);

export function QuotationEditor({data,row,go,open,mutate}:{data:Workspace;row:Revision;go:()=>void;open:(id:string)=>void;mutate:Mutation}) {
  const [doc,setDoc]=useState(row.document);
  const [tab,setTab]=useState("Pages");
  const [selected,setSelected]=useState(row.document.pages[0].id);
  const [drag,setDrag]=useState("");
  const [overlay,setOverlay]=useState<Overlay>(null);
  const [pageKind,setPageKind]=useState<Page["type"]>("Scope");
  const [compare,setCompare]=useState("");
  const [pendingCosts,setPendingCosts]=useState(false);
  const writable=row.state==="draft"&&can(data.actor,"quote_write");
  const editLocked=!writable;
  const costing=canSeeCosting(data.actor);
  const dirty=documentSignature(doc)!==documentSignature(row.document);
  const project=data.opportunities.find(item=>item.id===row.opportunity_id);
  const revisions=data.revisions.filter(item=>item.quotation_id===row.quotation_id).sort((a,b)=>a.version-b.version);
  const files=data.files.filter(item=>item.opportunity_id===row.opportunity_id&&item.visibility!=="purchasing");
  const images=files.filter(file=>file.content_type.startsWith("image/"));
  const current=doc.pages.find(item=>item.id===selected)??doc.pages[0];
  const preview=useMemo(()=>{
    try {return quoteHtml(doc,row.reference??"Draft",row.issue_date);}
    catch {return "<!doctype html><html lang='en'><p style='font:16px system-ui;padding:24px'>Enter valid pricing to refresh the preview.</p></html>";}
  },[doc,row.reference,row.issue_date]);
  const update=<K extends keyof QuoteDocument>(key:K,value:QuoteDocument[K])=>setDoc(previous=>({...previous,[key]:value}));
  const updatePage=<K extends keyof Page>(key:K,value:Page[K])=>update("pages",doc.pages.map(page=>page.id===current.id?{...page,[key]:value}:page));
  const updateGroup=(key:"options"|"addons", next:Group)=>update(key,doc[key].map(item=>item.id===next.id?next:item));
  function move(id:string,target:string) {
    if(!writable||id===target)return;
    const pages=[...doc.pages];
    const source=pages.findIndex(page=>page.id===id);
    const destination=pages.findIndex(page=>page.id===target);
    if(source<0||destination<0)return;
    pages.splice(destination,0,pages.splice(source,1)[0]);
    update("pages",pages);
  }
  function append() {
    const page=addPage(pageKind);
    update("pages",[...doc.pages,page]);setSelected(page.id);
  }
  function removePage(){
    if(doc.pages.length<=1)return;
    const pages=doc.pages.filter(page=>page.id!==current.id);
    update("pages",pages);setSelected(pages[0].id);
  }
  function duplicatePage(){
    const page={...current,id:crypto.randomUUID()};
    const pages=[...doc.pages];
    pages.splice(pages.indexOf(current)+1,0,page);
    update("pages",pages);setSelected(page.id);
  }
  async function save() {
    return mutate({action:"quote.save",id:row.id,lock:row.lock_version,document:doc},"Quotation saved");
  }
  async function addImage(file:File) {
    const form=new FormData();form.set("file",file);form.set("visibility","commercial");form.set("opportunity",row.opportunity_id);
    const result=await mutate(form,"Image uploaded");
    if(result)updatePage("imageId",result.id);
  }
  const field=(key:keyof typeof labels)=>{
    const value=doc[key];
    return <label key={key}>{labels[key]}{key==="payment"?<textarea value={value} readOnly={editLocked} onChange={e=>update(key,e.target.value)}/>:
      <input value={value} type={key==="eventStart"||key==="eventEnd"?"date":"text"} readOnly={editLocked} onChange={e=>update(key,e.target.value)}/>}</label>;
  };
  const compared=revisions.find(revision=>revision.id===compare);
  const differences=compared?Object.keys(row.document).filter(key=>JSON.stringify(row.document[key as keyof QuoteDocument])!==JSON.stringify(compared.document[key as keyof QuoteDocument])):[];
  const index=doc.pages.indexOf(current);
  const validation=quoteSchema.safeParse(doc);
  return <>
    <button className="text-link back-link" onClick={()=>{if((!dirty&&!pendingCosts)||window.confirm("Discard changes that have not been saved?"))go();}}><ArrowLeft size={16}/> Quotations</button>
    <header className="page-head editor-head"><div><p className="kicker">{row.reference??"QUOTATION DRAFT"}</p><h1>{doc.title||"Untitled quotation"}</h1><p>{doc.client} · Last edited by {row.updated_name}</p></div>
      <div className="header-actions"><Badge value={row.state}/>
        <button className="secondary" onClick={()=>setOverlay("history")}><History size={16}/> History</button>
        {row.pdf_id&&<a className="secondary" href={`/api/files/${row.pdf_id}`}><Download size={16}/> PDF</a>}
        {row.pdf_id&&can(data.actor,"quote_write")&&<button className="secondary" onClick={async()=>{const result=await mutate({action:"quote.revise",id:row.id},"Revision draft opened");if(result)open(result.id);}}>Create revision</button>}
        {["issued","superseded"].includes(row.state)&&!project?.award_reference&&isSales(data.actor)&&<button className="primary" onClick={()=>setOverlay("accept")}>Record acceptance</button>}
        {writable&&<button className="secondary" disabled={dirty||!data.library.some(entry=>!entry.archived)}
          title={dirty?"Save this draft before adding library content":undefined} onClick={()=>setOverlay("library")}><BookOpen size={16}/> Add from library</button>}
        {writable&&<button className="secondary" disabled={!dirty} onClick={save}><Save size={16}/> Save draft</button>}
        {row.state==="draft"&&can(data.actor,"quote_issue")&&<button className="primary" title={dirty||pendingCosts?"Save your changes before issuing":undefined} disabled={dirty||pendingCosts||!validation.success} onClick={()=>mutate({action:"quote.issue",id:row.id,lock:row.lock_version},"Quotation issued")}><Send size={16}/> Issue quotation</button>}
      </div>
    </header>
    <div className="tabs">{["Pages","Offer details","Pricing",...(costing?["Costing"]:[])].map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}
      <span className="tabs-end muted tiny">{dirty?"Unsaved changes":row.state==="draft"?"Draft saved":"Issued revision"}</span></div>
    {tab==="Pages"&&<div className="editor-grid">
      <Panel title="Pages" className="page-rail"><div className="page-list">{doc.pages.map((page,i)=><button className={page.id===current.id?"selected":""} key={page.id} draggable={writable}
        onDragStart={()=>setDrag(page.id)} onDragEnd={()=>setDrag("")} onDragOver={e=>e.preventDefault()} onDrop={()=>{move(drag,page.id);setDrag("");}} onClick={()=>setSelected(page.id)}>
        <span className="page-thumbnail" data-kind={page.type} aria-hidden="true">{page.imageId?
          <img loading="lazy" alt="" src={`/api/files/${page.imageId}?inline=1`}/>:page.type==="Opener"?
          <img alt="" src="/brand/eis-black.png"/>:<span/>}</span><span><span className="page-number">{String(i+1).padStart(2,"0")}</span> {page.title||page.type}</span>{writable&&<GripVertical size={14}/>}</button>)}</div>
        {writable&&<div className="rail-actions"><select aria-label="Page type to add" value={pageKind} onChange={e=>setPageKind(e.target.value as Page["type"])}>{pageTypes.map(type=><option key={type}>{type}</option>)}</select><button className="secondary" onClick={append}><Plus size={16}/> Add page</button></div>}</Panel>
      <Panel title="Live preview" className="preview-panel"><Preview html={preview} selected={current.id}/></Panel>
      <Panel title={current.type} className="properties">
        <div className="form-stack inset">
          {writable&&<div className="page-tools">
            <button className="icon-button" title="Move page up" aria-label="Move page up" disabled={!index} onClick={()=>move(current.id,doc.pages[index-1].id)}><ArrowUp size={17}/></button>
            <button className="icon-button" title="Move page down" aria-label="Move page down" disabled={index===doc.pages.length-1} onClick={()=>move(current.id,doc.pages[index+1].id)}><ArrowDown size={17}/></button>
            <button className="icon-button" title="Duplicate page" aria-label="Duplicate page" onClick={duplicatePage}><Copy size={17}/></button>
            <button className="icon-button danger" title="Remove page" aria-label="Remove page" disabled={doc.pages.length<2} onClick={removePage}><Trash2 size={17}/></button>
          </div>}
          {["Opener","Cover","Project details"].includes(current.type)?<p className="muted">This layout uses your branding and Offer details.</p>:<>
            {current.type!=="Pricing"&&<label>Page heading<input readOnly={editLocked} value={current.title} placeholder={current.type} onChange={e=>updatePage("title",e.target.value)}/></label>}
            {["Scope","Confidentiality","Contacts","Responsibilities","Terms","Closing"].includes(current.type)&&<label>Page content<textarea rows={7} readOnly={editLocked} value={current.body} onChange={e=>updatePage("body",e.target.value)}/></label>}
            {current.type==="Pricing"&&<p className="muted">Prices are calculated from the Pricing tab.</p>}
            {current.type==="Payment terms"&&field("payment")}
            <label>Applies to<select disabled={editLocked} value={current.optionId} onChange={e=>updatePage("optionId",e.target.value)}><option value="">Entire quotation</option>{doc.options.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            {["Scope","Visual"].includes(current.type)&&<><label>Image<select disabled={editLocked} value={current.imageId} onChange={e=>updatePage("imageId",e.target.value)}><option value="">Select image</option>{images.map(file=><option key={file.id} value={file.id}>{file.filename}</option>)}</select></label>
              {writable&&<label className="secondary file-button"><Upload size={16}/> Upload image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)void addImage(file);e.target.value="";}}/></label>}
              <label>Image caption<input value={current.caption} readOnly={editLocked} onChange={e=>updatePage("caption",e.target.value)}/></label></>}
          </>}
          {can(data.actor,"quote_remove")&&["draft","issued","superseded"].includes(row.state)&&project?.award_reference!==row.reference&&
            <button className="text-link danger" onClick={()=>setOverlay("remove")}>{row.state==="draft"?"Delete draft":"Withdraw quotation"}</button>}
          {can(data.actor,"quote_remove")&&row.state==="draft"&&project?.award_reference===row.reference&&<button className="text-link danger" onClick={()=>setOverlay("remove")}>Delete draft</button>}
        </div>
      </Panel>
    </div>}
    {tab==="Offer details"&&<Panel title="Offer details"><div className="form-stack inset"><div className="field-grid">
      {(["title","client","clientContact","venue","eventStart","eventEnd","installation","leadTime"] as const).map(field)}
      <label>Project type<select value={doc.kind} disabled={editLocked} onChange={e=>update("kind",e.target.value as QuoteDocument["kind"])}>{["Rental","Permanent","Supply"].map(type=><option key={type}>{type}</option>)}</select></label>
      <label>Validity (days)<input type="number" min={1} max={365} value={doc.validity||""} readOnly={editLocked} onChange={e=>update("validity",Number(e.target.value))}/></label>
    </div>{field("payment")}</div></Panel>}
    {tab==="Pricing"&&<Panel title="Pricing in SAR"><div className="form-stack inset">
      <label>Pricing structure<select disabled={editLocked} value={doc.mode} onChange={e=>{
        const mode=e.target.value as QuoteDocument["mode"];
        if(mode==="package"&&doc.options.length>1&&!window.confirm("Keep the first price group and remove the other alternatives?"))return;
        const options=mode==="package"?doc.options.slice(0,1):doc.options.length>1?doc.options:[{...doc.options[0],name:"Option 1"},newGroup("Option 2")];
        setDoc({...doc,mode,options,pages:doc.pages.map(page=>page.optionId&&!options.some(option=>option.id===page.optionId)?{...page,optionId:""}:page)});
      }}><option value="package">Single offer or combined package</option><option value="alternatives">Alternative options</option></select></label>
      {(["options","addons"] as const).map(key=><div className="group-stack" key={key}><div className="group-heading"><h3>{key==="options"?"Price groups":"Optional add-ons"}</h3>
        {writable&&(key==="addons"||doc.mode==="alternatives")&&<button className="secondary small" onClick={()=>update(key,[...doc[key],newGroup(key==="options"?`Option ${doc.options.length+1}`:`Add-on ${doc.addons.length+1}`)])}><Plus size={15}/> {key==="options"?"Add option":"Add add-on"}</button>}</div>
        {doc[key].map(group=><div className="price-group" key={group.id}><div className="group-heading"><label>{key==="options"?"Price group name":"Add-on name"}<input readOnly={editLocked} value={group.name} onChange={e=>updateGroup(key,{...group,name:e.target.value})}/></label>
          {writable&&(key==="addons"||doc.options.length>2)&&<button className="icon-button danger" aria-label={`Remove ${group.name}`} onClick={()=>setDoc({...doc,[key]:doc[key].filter(item=>item.id!==group.id),pages:doc.pages.map(page=>page.optionId===group.id?{...page,optionId:""}:page)})}><Trash2 size={17}/></button>}</div>
          <Prices items={group.items} setItems={items=>updateGroup(key,{...group,items})} readOnly={editLocked} add={()=>updateGroup(key,{...group,items:[...group.items,makeItem()]})}/>
          <GroupTotals group={group}/></div>)}</div>)}
    </div></Panel>}
    {costing&&<div hidden={tab!=="Costing"}><QuotationCosting data={data} row={row} doc={doc} dirty={dirty} mutate={mutate} pending={pendingCosts} onPending={setPendingCosts}/></div>}
    {overlay==="library"&&<AddLibraryEntry data={data} options={doc.options} close={()=>setOverlay(null)} apply={async (entry,optionId,includePrice)=>{
      const result=await mutate({action:"quote.library.apply",id:row.id,lock:row.lock_version,entry,optionId,includePrice},"Offering added to draft");
      if(result?.document){
        const first=result.document.pages.find(page=>!doc.pages.some(prior=>prior.id===page.id));
        setDoc(result.document);
        if(first){setSelected(first.id);setTab("Pages");}
        else setTab("Pricing");
        setOverlay(null);
      }
    }}/>}
    {overlay==="history"&&<Modal title="Revision history" close={()=>setOverlay(null)}>
      <div className="list">{revisions.map(revision=><button key={revision.id} className="list-row" onClick={()=>{setOverlay(null);if((!dirty&&!pendingCosts)||window.confirm("Discard changes that have not been saved?"))open(revision.id);}}>
        <span className="list-icon"><FileText size={17}/></span><span><strong>{revision.reference??"Draft"}</strong><small>{revision.updated_name} · {displayDate(revision.updated_at)}</small></span><Badge value={revision.state}/></button>)}</div>
      <div className="inset form-stack"><label>Compare with<select value={compare} onChange={e=>setCompare(e.target.value)}><option value="">Select revision</option>{revisions.filter(item=>item.id!==row.id).map(item=><option value={item.id} key={item.id}>{item.reference??"Draft"}</option>)}</select></label>
        {compared&&<p>{differences.length?`Changed fields · ${differences.map(item=>item.replace(/([A-Z])/g," $1").toLowerCase()).join(", ")}`:"No content differences."}</p>}</div>
    </Modal>}
    {overlay==="accept"&&<Modal title="Record client acceptance" close={()=>setOverlay(null)}><form className="form-stack modal-form" onSubmit={async e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);
      const result=await mutate({action:"quote.accept",id:row.id,date:form.get("date"),evidence:form.get("evidence"),option:form.get("option"),addons:form.getAll("addon"),file:form.get("file"),poReference:form.get("poReference")},"Client acceptance recorded");
      if(result)setOverlay(null);
    }}>
      <label>Accepted option<select name="option">{row.document.options.map(group=><option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      {row.document.addons.length>0&&<fieldset><legend>Approved add-ons</legend>{row.document.addons.map(group=><label className="check" key={group.id}><input name="addon" type="checkbox" value={group.id}/>{group.name}</label>)}</fieldset>}
      <label>Acceptance date<input type="date" name="date" required defaultValue={data.today} max={data.today} min={row.issue_date??undefined}/></label>
      <label>Approval evidence<textarea name="evidence" minLength={3} required placeholder="Client PO number, approval email, or other reference"/></label>
      <label>Client PO reference (if received)<input name="poReference"/></label>
      <label>Supporting attachment<select name="file"><option value="">Select if available</option>{files.filter(file=>file.id!==row.pdf_id).map(file=><option key={file.id} value={file.id}>{file.filename}</option>)}</select></label>
      <div className="form-actions"><button className="primary">Record acceptance</button></div>
    </form></Modal>}
    {overlay==="remove"&&<Modal title={row.state==="draft"?"Delete quotation draft":"Withdraw quotation"} close={()=>setOverlay(null)}><form className="form-stack modal-form" onSubmit={async (e:FormEvent<HTMLFormElement>)=>{
      e.preventDefault();const reason=new FormData(e.currentTarget).get("reason");const result=await mutate({action:"quote.remove",id:row.id,reason},"Quotation record updated");
      if(result){setOverlay(null);if(row.state==="draft")go();}
    }}><label>Reason<textarea name="reason" required minLength={3}/></label><div className="form-actions"><button className="primary danger-button">Confirm</button></div></form></Modal>}
  </>;
}
function GroupTotals({group}:{group:Group}) {
  try {
    const amounts=totals(group.items);
    return <p className="group-total">Subtotal {money(amounts.net)} SAR · VAT {money(amounts.vat)} SAR <strong>Total {money(amounts.total)} SAR</strong></p>;
  } catch {return <p className="muted">Enter valid quantities and rates to calculate totals.</p>;}
}
