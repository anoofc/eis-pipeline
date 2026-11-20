"use client";
import { useState } from "react";
import { Clock3, Plus, ShieldCheck } from "lucide-react";
import { displayTimestamp,permissions,roleName,roles,type Audit,type Staff,type Workspace } from "@/lib/model";
import { Badge,Empty,Modal,Panel,type Mutation } from "./shared";

const description:Record<typeof permissions[number],string>={quote_write:"Create and edit quotation drafts",quote_issue:"Issue quotations",quote_remove:"Delete drafts and withdraw quotations",po_view:"View supplier orders",po_write:"Prepare and update supplier orders",po_issue:"Approve and issue supplier orders",sales_all:"Access all opportunity records",project_write:"Update project delivery",library_manage:"Manage the quotation library",cost_view:"View internal costing on accessible quotations",cost_write:"Edit internal costing on accessible quotation drafts"};
export function Access({data,mutate}:{data:Workspace;mutate:Mutation}) {
  const [selected,setSelected]=useState<Staff|"new"|null>(null);
  const [role,setRole]=useState<Staff["role"]>("engineering");
  const item=selected==="new"?null:selected;
  return <>
    <header className="page-head"><div><p className="kicker">ADMINISTRATION</p><h1>Users & access</h1><p>Manage named accounts and their workspace permissions.</p></div>
      <button className="primary" onClick={()=>{setRole("engineering");setSelected("new");}}><Plus size={17}/> Add user</button></header>
    <Panel title="Workspace users"><div className="list">{data.staff.map(staff=><button className="list-row" key={staff.id} onClick={()=>{setRole(staff.role);setSelected(staff);}}>
      <span className="list-icon purple"><ShieldCheck size={17}/></span><span><strong>{staff.name}</strong><small>{staff.email} · {roleName[staff.role]}</small></span><Badge value={staff.active?"Active":"Inactive"}/>
    </button>)}</div></Panel>
    {selected&&<Modal title={item?"Edit user access":"Add user"} close={()=>setSelected(null)}><form className="form-stack modal-form" onSubmit={async e=>{
      e.preventDefault();const form=new FormData(e.currentTarget);const document={name:form.get("name"),email:form.get("email"),role,permissions:form.getAll("permission"),active:form.has("active")};
      if(await mutate({action:"staff.save",id:item?.id,document},item?"User access updated":"User access created"))setSelected(null);
    }}><div className="field-grid"><label>Name<input name="name" required defaultValue={item?.name}/></label>
      <label>Work email<input name="email" type="email" required defaultValue={item?.email} readOnly={!!item}/></label></div>
      <label>Role<select value={role} onChange={e=>setRole(e.target.value as Staff["role"])}>{roles.map(role=><option key={role} value={role}>{roleName[role]}</option>)}</select></label>
      <p className="muted">Use the same address when provisioning the managed sign-in account.</p>
      {role!=="owner"&&<fieldset><legend>Additional permissions</legend>{permissions.map(permission=><label key={permission} className="check"><input type="checkbox" value={permission} name="permission" defaultChecked={item?.permissions.includes(permission)}/>{description[permission]}</label>)}</fieldset>}
      <label className="check"><input name="active" type="checkbox" defaultChecked={item?.active??true}/> Active account</label>
      <div className="form-actions"><button className="primary">Save user access</button></div>
    </form></Modal>}
  </>;
}

export function Activity({data}:{data:Workspace}) {
  const [filter,setFilter]=useState("");
  const [older,setOlder]=useState<Audit[]>([]);
  const [hasMore,setHasMore]=useState(true);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const combined=[...data.audit,...older.filter(item=>!data.audit.some(current=>current.id===item.id))];
  const entries=combined.filter(item=>!filter||item.entity_type===filter);
  const types=[...new Set(combined.map(item=>item.entity_type))];
  async function more(){
    const cursor=combined.at(-1);
    if(!cursor)return;
    setLoading(true);setError("");
    try{
      const response=await fetch(`/api/activity?before=${encodeURIComponent(cursor.id)}`);
      const body=await response.json();
      if(!response.ok)throw new Error(body.error);
      setOlder(previous=>[...previous,...body]);
      setHasMore(body.length===150);
    }catch(error){setError(error instanceof Error?error.message:"Could not load activity.");}
    finally{setLoading(false);}
  }
  return <>
    <header className="page-head"><div><p className="kicker">HISTORY</p><h1>Activity log</h1><p>Document issues, edits, uploads, and access changes.</p></div></header>
    <div className="toolbar"><select aria-label="Filter activity" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All activity</option>{types.map(type=><option key={type}>{type}</option>)}</select></div>
    <Panel title="Recent activity">{entries.length?<div className="list">{entries.map(item=><details className="audit-entry" key={item.id}><summary className="list-row">
      <span className="list-icon"><Clock3 size={17}/></span><span><strong>{item.action}</strong><small>{item.actor_name} · {item.entity_type} · {displayTimestamp(item.created_at)}</small></span>
    </summary>{Object.keys(item.detail).length>0&&<dl>{Object.entries(item.detail).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g," $1")}</dt><dd>{Array.isArray(value)?value.join(", "):String(value??"—")}</dd></div>)}</dl>}</details>)}</div>:<Empty title="No activity yet"/>}</Panel>
    {hasMore&&data.audit.length===150&&<div className="inset"><button className="secondary" disabled={loading} onClick={more}>Load older activity</button></div>}
    {error&&<p role="alert">{error}</p>}
  </>;
}
