"use client";
import { useState } from "react";
import { ArrowLeft, Download, Save, Send } from "lucide-react";
import { can,makeItem,money,totals,type Order,type OrderDocument,type Workspace } from "@/lib/model";
import { supplierHtml } from "@/lib/document";
import { Preview } from "./quotation";
import { Badge,dateLabel,Empty,Modal,Panel,Prices,type Mutation } from "./shared";

const statuses=["draft","pending","issued","partially_delivered","delivered","closed","cancelled"];
export function OrderList({data,open}:{data:Workspace;open:(id:string)=>void}){
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("");
  const rows=data.orders.filter(row=>(!filter||row.state===filter)&&`${row.document.title} ${row.document.supplier} ${row.reference??"Draft"}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header className="page-head"><div><p className="kicker">PROCUREMENT</p><h1>Supplier purchase orders</h1><p>Prepare, issue, and track orders against awarded projects.</p></div></header>
    <div className="toolbar"><input className="grow-search" type="search" aria-label="Search supplier orders" placeholder="Search supplier, order or reference" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Supplier order status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(item=><option key={item} value={item}>{item.replaceAll("_"," ")}</option>)}</select></div>
    <Panel title="Supplier order register">{rows.length?<div className="table-scroll"><table className="data-table"><thead><tr><th>Order</th><th>Reference</th><th>Status</th><th>Delivery</th><th>Last editor</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.id}><td><button className="cell-link" onClick={()=>open(row.id)}><strong>{row.document.title}</strong><small>{row.document.supplier||"Supplier TBD"}</small></button></td>
        <td>{row.reference??"Draft"}</td><td><Badge value={row.state}/></td><td>{dateLabel(row.document.delivery)}</td><td>{row.updated_name}</td></tr>)}</tbody></table></div>:<Empty title="No supplier POs match">Create supplier orders from the Documents tab of an awarded project.</Empty>}</Panel>
  </>;
}

const fields={title:"Order title",supplier:"Supplier name",contact:"Supplier contact",location:"Delivery location",delivery:"Delivery date",scope:"Scope of supply",terms:"Payment terms"} as const;
const transitions:Record<string,string[]>={draft:["cancelled"],pending:["cancelled"],issued:["partially_delivered","delivered","cancelled"],partially_delivered:["delivered","cancelled"],delivered:["closed"]};

export function OrderEditor({data,row,mutate,go}:{data:Workspace;row:Order;mutate:Mutation;go:()=>void}){
  const [doc,setDoc]=useState(row.document);
  const [status,setStatus]=useState("");
  const [tab,setTab]=useState("Details");
  const writable=["draft","pending"].includes(row.state)&&can(data.actor,"po_write");
  const dirty=JSON.stringify(doc)!==JSON.stringify(row.document);
  const update=<K extends keyof OrderDocument>(key:K,value:OrderDocument[K])=>setDoc(previous=>({...previous,[key]:value}));
  let amounts="";
  let preview="";
  try{const {net,vat,total}=totals(doc.items);amounts=`Subtotal ${money(net)} SAR · VAT ${money(vat)} SAR · Total ${money(total)} SAR`;preview=supplierHtml(doc,row.reference??"Draft",row.issued_at);}catch{/* The user may be entering a decimal. */}
  return <>
    <button className="text-link back-link" onClick={()=>{if(!dirty||window.confirm("Discard changes that have not been saved?"))go();}}><ArrowLeft size={16}/> Supplier POs</button>
    <header className="page-head"><div><p className="kicker">{row.reference??"SUPPLIER PO DRAFT"}</p><h1>{doc.title}</h1><p>Award {row.award_reference} · Last edited by {row.updated_name}</p></div>
      <div className="header-actions"><Badge value={row.state}/>
        {writable&&<button className="secondary" disabled={!dirty} onClick={()=>mutate({action:"order.save",id:row.id,lock:row.lock_version,document:doc},"Supplier PO saved")}><Save size={16}/> Save draft</button>}
        {writable&&row.state==="draft"&&<button className="secondary" onClick={()=>mutate({action:"order.submit",id:row.id,lock:row.lock_version,document:doc},"Supplier PO submitted")}>Submit for approval</button>}
        {row.state==="pending"&&can(data.actor,"po_issue")&&<button className="primary" disabled={dirty} onClick={()=>mutate({action:"order.issue",id:row.id,lock:row.lock_version},"Supplier PO issued")}><Send size={16}/> Issue supplier PO</button>}
        {row.pdf_id&&<a className="secondary" href={`/api/files/${row.pdf_id}`}><Download size={16}/> PDF</a>}
        {(can(data.actor,"po_write")||can(data.actor,"po_issue"))&&transitions[row.state]?.some(state=>state!=="cancelled"||!row.pdf_id||can(data.actor,"po_issue"))&&<button className="secondary" onClick={()=>setStatus("change")}>Update status</button>}
      </div>
    </header>
    <div className="tabs">{["Details","Preview"].map(item=><button className={tab===item?"active":""} key={item} onClick={()=>setTab(item)}>{item}</button>)}
      <span className="tabs-end muted tiny">{dirty?"Unsaved changes":row.state.replaceAll("_"," ")}</span></div>
    {tab==="Details"?<div className="dashboard-grid"><Panel title="Supplier details"><div className="form-stack inset">{Object.entries(fields).map(([name,label])=>{
      const key=name as keyof typeof fields;
      return <label key={key}>{label}{key==="scope"||key==="terms"?<textarea rows={3} readOnly={!writable} value={doc[key]} onChange={e=>update(key,e.target.value)}/>:
        <input type={key==="delivery"?"date":"text"} readOnly={!writable} value={doc[key]} onChange={e=>update(key,e.target.value)}/>}</label>;
    })}</div></Panel><Panel title="Supplier pricing"><div className="inset form-stack">
      <Prices items={doc.items} readOnly={!writable} setItems={rows=>update("items",rows)} add={()=>update("items",[...doc.items,makeItem()])}/>
      <p className="group-total">{amounts||"Enter valid quantities and rates."}</p>
    </div></Panel></div>:<Panel title="Supplier PDF preview">{preview?<Preview html={preview} width={794} title="Supplier PO preview"/>:<Empty title="Enter valid pricing to preview"/>}</Panel>}
    {status&&<Modal title="Update supplier PO status" close={()=>setStatus("")}><form className="form-stack modal-form" onSubmit={async e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);
      if(await mutate({action:"order.status",id:row.id,state:form.get("state"),reason:form.get("reason")},"Supplier PO updated"))setStatus("");
    }}><label>New status<select name="state">{transitions[row.state].filter(state=>state!=="cancelled"||!row.pdf_id||can(data.actor,"po_issue")).map(state=><option key={state} value={state}>{state.replaceAll("_"," ")}</option>)}</select></label>
      <label>Note or cancellation reason<textarea name="reason"/></label><div className="form-actions"><button className="primary">Update status</button></div></form></Modal>}
  </>;
}
