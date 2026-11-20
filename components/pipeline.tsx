"use client";
import { useMemo,useState,type FormEvent } from "react";
import { ArrowDownRight, ArrowUpRight, BriefcaseBusiness, CalendarDays, CircleCheck, Clock3, FileText, List, Plus, Search, LayoutGrid } from "lucide-react";
import Decimal from "decimal.js";
import { can, canSeeCommercial, displayTimestamp, isSales, money, projectStages, stages, type Opportunity, type Workspace } from "@/lib/model";
import { Badge,dateLabel,Empty,FileList,Modal,Panel,sar,TextLink,type Mutation } from "./shared";

export function Dashboard({data,go,open,newRecord}:{data:Workspace;go:(path:string)=>void;open:(id:string)=>void;newRecord:()=>void}) {
  const {opportunities,revisions,orders,today}=data;
  const openRows=opportunities.filter(row=>!["Won","Lost","On hold"].includes(row.stage));
  const won=opportunities.filter(row=>row.stage==="Won");
  const lost=opportunities.filter(row=>row.stage==="Lost");
  const follow=openRows.filter(row=>row.follow_up&&row.follow_up<today).sort((a,b)=>a.follow_up!.localeCompare(b.follow_up!));
  const expiring=revisions.filter(row=>row.state==="issued"&&openRows.some(item=>item.id===row.opportunity_id)&&row.expires&&row.expires>=today&&new Date(row.expires).valueOf()-new Date(today).valueOf()<8*86400000);
  const awaiting=orders.filter(row=>["pending","issued","partially_delivered"].includes(row.state));
  const upcoming=won.flatMap(row=>[...(row.installation_date&&row.installation_date>=today?[{row,date:row.installation_date,label:"Installation"}]:[]),
    ...(row.event_start&&row.event_start>=today?[{row,date:row.event_start,label:"Event"}]:[])])
    .filter(item=>item.row.project_status!=="Completed").sort((a,b)=>a.date.localeCompare(b.date));
  const sums=(rows:Opportunity[])=>money(rows.reduce((sum,row)=>sum.plus(row.value??0),new Decimal(0)));
  const track=stages.filter(stage=>!["Lost","Won","On hold"].includes(stage)).map(stage=>({stage,count:openRows.filter(row=>row.stage===stage).length}));
  const winRate=won.length+lost.length?Math.round(100*won.length/(won.length+lost.length)):null;
  const visible=canSeeCommercial(data.actor);
  return <>
    <header className="page-head"><div><p className="kicker">OVERVIEW</p><h1>Workspace overview</h1><p>Sales, projects and supplier orders at a glance.</p></div>
      {isSales(data.actor)&&<button className="primary" onClick={newRecord}><Plus size={18}/> New opportunity</button>}</header>
    <div className="metric-grid">
      {[
        {label:"Open pipeline",value:visible?`SAR ${sums(openRows)}`:String(openRows.length),note:`${openRows.length} active opportunities`,Icon:BriefcaseBusiness,style:"purple",route:"Pipeline"},
        {label:"Won value",value:visible?`SAR ${sums(won)}`:String(won.length),note:winRate!==null?`${winRate}% win rate · ${lost.length} lost`:`${won.length} won · ${lost.length} lost`,Icon:CircleCheck,style:"green",route:"Projects"},
        {label:"Overdue follow-ups",value:String(follow.length),note:follow.length?"Require attention":"No overdue follow-ups",Icon:Clock3,style:"amber",route:"Pipeline"},
        {label:"Expiring quotations",value:String(expiring.length),note:"Within the next 7 days",Icon:FileText,style:"blue",route:"Quotations"},
      ].map(({label,value,note,Icon,style,route})=><button className="metric" key={label} onClick={()=>go(route)}>
        <span className={`metric-icon ${style}`}><Icon size={19}/></span><ArrowUpRight size={16} className="metric-arrow"/><span className="metric-label">{label}</span>
        <strong>{value}</strong><small>{note}</small></button>)}
    </div>
    <div className="dashboard-grid">
      <Panel title="Pipeline by stage" action={<TextLink onClick={()=>go("Pipeline")}>View pipeline</TextLink>}>
        <div className="bars">{track.map(({stage,count})=><div className="bar-row" key={stage}><span>{stage}</span>
          <div className="bar-track"><div style={{width:`${100*count/Math.max(1,...track.map(item=>item.count))}%`}}/></div><strong>{count}</strong></div>)}</div>
      </Panel>
      <Panel title="Needs attention" action={<span className="muted tiny">{follow.length+expiring.length+awaiting.length} items</span>}>
        <div className="list">
          {follow.slice(0,3).map(row=><button className="list-row" key={row.id} onClick={()=>open(row.id)}><span className="list-icon amber"><Clock3 size={17}/></span>
            <span><strong>{row.title}</strong><small>Follow-up due {dateLabel(row.follow_up)}</small></span><ArrowUpRight className="push" size={16}/></button>)}
          {expiring.slice(0,2).map(row=><button className="list-row" key={row.id} onClick={()=>go(`Quotation/${row.id}`)}><span className="list-icon blue"><FileText size={17}/></span>
            <span><strong>{row.document.title}</strong><small>Offer expires {dateLabel(row.expires)}</small></span><ArrowUpRight className="push" size={16}/></button>)}
          {awaiting.slice(0,2).map(row=><button className="list-row" key={row.id} onClick={()=>go(`Supplier PO/${row.id}`)}><span className="list-icon purple"><BriefcaseBusiness size={17}/></span>
            <span><strong>{row.document.supplier||row.document.title}</strong><small>Supplier PO · {row.state.replaceAll("_"," ")}</small></span><ArrowUpRight className="push" size={16}/></button>)}
          {!follow.length&&!expiring.length&&!awaiting.length&&<Empty title="You’re up to date"/>}
        </div>
      </Panel>
      <Panel title="Recent opportunities" className="span-two" action={<TextLink onClick={()=>go("Pipeline")}>View all</TextLink>}>
        <OpportunityTable rows={opportunities.slice(0,5)} open={open}/>
      </Panel>
      <Panel title="Upcoming projects" className="span-two" action={<TextLink onClick={()=>go("Projects")}>View projects</TextLink>}>
        {upcoming.length?<div className="list">{upcoming.slice(0,6).map(({row,date,label})=><button className="list-row" key={row.id+label} onClick={()=>open(row.id)}>
          <span className="list-icon purple"><CalendarDays size={17}/></span><span><strong>{row.title}</strong><small>{label} · {dateLabel(date)} · {row.venue||row.client}</small></span>
          <Badge value={row.project_status??"Confirmed"}/><ArrowUpRight className="push" size={16}/></button>)}</div>:<Empty title="No upcoming projects"/>}
      </Panel>
    </div>
  </>;
}

function OpportunityTable({rows,open,projects=false}:{rows:Opportunity[];open:(id:string)=>void;projects?:boolean}) {
  if(!rows.length)return <Empty title={projects?"No projects match":"No opportunities match"}/>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>{projects?"Project":"Opportunity"}</th><th>Stage</th><th>Owner</th><th>{projects?"Event date":"Follow-up"}</th><th>Value</th><th><span className="sr-only">Open</span></th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.id}>
      <td><button onClick={()=>open(row.id)} className="cell-link"><strong>{row.title}</strong><small>{row.client}</small></button></td>
      <td><Badge value={projects?row.project_status??"Confirmed":row.stage}/></td><td>{row.owner_name}</td>
      <td>{dateLabel(projects?row.event_start:row.follow_up)}</td><td className="amount">{sar(row.value)}</td><td><button className="icon-button" aria-label={`Open ${row.title}`} onClick={()=>open(row.id)}><ArrowUpRight size={17}/></button></td>
    </tr>)}</tbody></table></div>;
}

export function Pipeline({data,open,newRecord,projects}:{data:Workspace;open:(id:string)=>void;newRecord:()=>void;projects:boolean}) {
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("");
  const [view,setView]=useState("table");
  const filters=projects?projectStages:stages;
  const status=(row:Opportunity)=>projects?row.project_status:row.stage;
  const rows=data.opportunities.filter(row=>(!projects||row.stage==="Won")&&(!filter||status(row)===filter)&&`${row.title} ${row.client} ${row.venue} ${row.owner_name}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header className="page-head"><div><p className="kicker">{projects?"DELIVERY":"SALES"}</p><h1>{projects?"Projects":"Sales pipeline"}</h1>
      <p>{projects?"Track event delivery, project updates and procurement.":"Track enquiries, follow-ups, and opportunities through award."}</p></div>
      {!projects&&isSales(data.actor)&&<button className="primary" onClick={newRecord}><Plus size={18}/> New opportunity</button>}</header>
    <div className="toolbar"><label className="search-box"><Search size={17}/><input aria-label="Search opportunities" value={query} onChange={e=>setQuery(e.target.value)} placeholder={projects?"Search projects":"Search opportunities"}/></label>
      <select aria-label="Filter by status" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">All stages</option>{filters.map(stage=><option key={stage}>{stage}</option>)}</select>
      <div className="view-toggle"><button className={view==="table"?"selected":""} onClick={()=>setView("table")} aria-label="Table view"><List size={18}/></button>
        <button className={view==="board"?"selected":""} onClick={()=>setView("board")} aria-label="Board view"><LayoutGrid size={17}/></button></div></div>
    {view==="table"?<div className="panel"><OpportunityTable rows={rows} open={open} projects={projects}/></div>:<div className="board">
      {(filter?[filter]:filters).map(stage=><div className="board-col" key={stage}><h3>{stage} <span>{rows.filter(row=>status(row)===stage).length}</span></h3>
        {rows.filter(row=>status(row)===stage).map(row=><button className="board-card" key={row.id} onClick={()=>open(row.id)}><strong>{row.title}</strong><small>{row.client}</small><span>{sar(row.value)}</span></button>)}
      </div>)}</div>}
  </>;
}

export function OpportunityForm({data,row,mutate,close,open}:{data:Workspace;row?:Opportunity;mutate:Mutation;close:()=>void;open:(id:string)=>void}) {
  const created=!!row;
  async function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();const form=new FormData(e.currentTarget);
    const payload=Object.fromEntries(form);
    const document={...payload, ...(data.actor.role==="owner"?{assigned:form.getAll("assigned")}:{}), ...(row?.stage==="Won"?{stage:"Won"}:{})};
    const result=await mutate({action:"opportunity.save",id:row?.id,document},created?"Opportunity updated":"Opportunity created");
    if(result){close();open(result.id);}
  }
  return <Modal title={created?"Edit opportunity":"New opportunity"} close={close}><form onSubmit={save} className="form-stack modal-form">
    <div className="field-grid"><label>Project title<input name="title" required defaultValue={row?.title}/></label><label>Client<input name="client" required defaultValue={row?.client}/></label>
      <label>Client contact<input name="contact" defaultValue={row?.contact}/></label><label>Venue<input name="venue" defaultValue={row?.venue}/></label>
      <label>Event start<input type="date" name="event_start" defaultValue={row?.event_start??""}/></label><label>Event end<input type="date" name="event_end" defaultValue={row?.event_end??""}/></label>
      <label>Pipeline value (SAR)<input name="value" inputMode="decimal" required readOnly={row?.stage==="Won"} defaultValue={row?.value??"0"}/></label>
      <label>Sales stage<select name="stage" disabled={row?.stage==="Won"} defaultValue={row?.stage??"Enquiry"}>{stages.filter(stage=>stage!=="Won"||row?.stage==="Won").map(stage=><option key={stage}>{stage}</option>)}</select></label>
      <label>Next action<input name="next_action" defaultValue={row?.next_action}/></label><label>Follow-up date<input type="date" name="follow_up" defaultValue={row?.follow_up??""}/></label>
      {data.actor.role==="owner"&&<><label>Record owner<select name="owner_id" defaultValue={row?.owner_id??data.actor.id}>{data.staff.filter(staff=>staff.active||staff.id===row?.owner_id).map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label>
      <label>Assigned staff<select name="assigned" multiple size={Math.min(4,data.staff.length)} defaultValue={row?.assigned??[]}>{data.staff.filter(staff=>staff.active).map(staff=><option key={staff.id} value={staff.id}>{staff.name}</option>)}</select></label></>}
    </div><div className="form-actions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="primary">{created?"Save changes":"Create opportunity"}</button></div>
  </form></Modal>;
}

export function OpportunityDetail({data,row,go,edit,mutate,quote,order}:{data:Workspace;row:Opportunity;go:()=>void;edit:()=>void;mutate:Mutation;quote:(id:string)=>void;order:(id:string)=>void}) {
  const files=useMemo(()=>data.files.filter(file=>file.opportunity_id===row.id),[data.files,row.id]);
  const revisions=data.revisions.filter(item=>item.opportunity_id===row.id);
  const orders=data.orders.filter(item=>item.opportunity_id===row.id);
  const history=data.audit.filter(item=>item.opportunity_id===row.id);
  const [tab,setTab]=useState("Overview");
  const canUpdateProject=data.actor.role==="engineering"||can(data.actor,"project_write");
  const [uploadKey,setUploadKey]=useState(0);
  async function upload(e:FormEvent<HTMLFormElement>){
    e.preventDefault();const form=new FormData(e.currentTarget);form.set("opportunity",row.id);
    if(await mutate(form,"Attachment uploaded"))setUploadKey(key=>key+1);
  }
  return <>
    <button className="text-link back-link" onClick={go}><ArrowDownRight className="back-arrow" size={16}/> Back to records</button>
    <header className="page-head"><div><p className="kicker">{row.client}</p><h1>{row.title}</h1><p>{row.venue||"Venue to be confirmed"} · Last edited by {row.updated_name}</p></div>
      <div className="header-actions">{isSales(data.actor)&&<button className="secondary" onClick={edit}>Edit opportunity</button>}{can(data.actor,"quote_write")&&<button className="primary" onClick={async()=>{
        const result=await mutate({action:"quote.create",opportunity:row.id},"Draft created");if(result)quote(result.id);
      }}><Plus size={17}/> New quotation</button>}</div>
    </header>
    <div className="tabs">{["Overview","Documents","Activity"].map(item=><button key={item} className={tab===item?"active":""} onClick={()=>setTab(item)}>{item}</button>)}</div>
    {tab==="Overview"&&<div className="dashboard-grid">
      <Panel title="Opportunity details"><dl className="detail-grid">
        <div><dt>Sales stage</dt><dd><Badge value={row.stage}/></dd></div><div><dt>Owner</dt><dd>{row.owner_name}</dd></div>
        <div><dt>Event dates</dt><dd>{dateLabel(row.event_start)}{row.event_end&&` – ${dateLabel(row.event_end)}`}</dd></div>
        <div><dt>Value</dt><dd>{sar(row.value)}</dd></div><div><dt>Client contact</dt><dd>{row.contact||"—"}</dd></div>
        <div><dt>Next action</dt><dd>{row.next_action||"—"}</dd></div><div><dt>Follow-up</dt><dd>{dateLabel(row.follow_up)}</dd></div>
        {row.award_reference&&<div><dt>Accepted quotation</dt><dd>{row.award_reference} · {revisions.find(item=>item.reference===row.award_reference)?.document.options.find(item=>item.id===row.awarded_option)?.name}</dd></div>}
      </dl></Panel>
      <Panel title="Technical scope & delivery"><form className="form-stack inset" onSubmit={async e=>{
        e.preventDefault();const form=new FormData(e.currentTarget);
        await mutate({action:"project.update",id:row.id,status:form.get("status"),note:form.get("note"),
          technicalScope:form.get("technicalScope"),installationDate:form.get("installationDate"),
          nextMilestone:form.get("nextMilestone"),milestoneDate:form.get("milestoneDate")},"Project updated");
      }}>
        <label>Technical scope<textarea name="technicalScope" defaultValue={row.technical_scope} readOnly={!canUpdateProject}/></label>
        {row.stage==="Won"&&<><label>Delivery status<select name="status" defaultValue={row.project_status??"Awaiting client PO"} disabled={!canUpdateProject}>{projectStages.map(item=><option key={item}>{item}</option>)}</select></label>
        <label>Progress note<textarea name="note" defaultValue={row.project_note} readOnly={!canUpdateProject}/></label>
        <div className="field-grid"><label>Installation date<input type="date" name="installationDate" defaultValue={row.installation_date??""} readOnly={!canUpdateProject}/></label>
        <label>Milestone due<input type="date" name="milestoneDate" defaultValue={row.milestone_date??""} readOnly={!canUpdateProject}/></label></div>
        <label>Next milestone<input name="nextMilestone" defaultValue={row.next_milestone} readOnly={!canUpdateProject}/></label></>}
        {canUpdateProject&&<button className="primary self-end">Update project</button>}
      </form></Panel>
    </div>}
    {tab==="Documents"&&<div className="dashboard-grid">
      <Panel title="Quotations"><div className="list">{revisions.length?revisions.map(item=><button className="list-row" key={item.id} onClick={()=>quote(item.id)}><span className="list-icon"><FileText size={17}/></span><span><strong>{item.document.title}</strong><small>{item.reference??"Draft"}</small></span><Badge value={item.state}/></button>):<Empty title="No visible quotations"/>}</div></Panel>
      <Panel title="Supplier purchase orders" action={row.stage==="Won"&&can(data.actor,"po_write")&&<TextLink onClick={async()=>{
        const result=await mutate({action:"order.create",opportunity:row.id},"PO draft created");if(result)order(result.id);
      }}>Create PO</TextLink>}><div className="list">{orders.length?orders.map(item=><button className="list-row" key={item.id} onClick={()=>order(item.id)}><span className="list-icon"><BriefcaseBusiness size={17}/></span><span><strong>{item.document.supplier||item.document.title}</strong><small>{item.reference??"Draft"}</small></span><Badge value={item.state}/></button>):<Empty title="No visible supplier POs"/>}</div></Panel>
      <Panel title="Attachments" className="span-two">
        <form className="upload-form" key={uploadKey} onSubmit={upload}><input aria-label="Attachment" name="file" type="file" required/>
          <select aria-label="File visibility" name="visibility" defaultValue={isSales(data.actor)?"commercial":"project"}>
            <option value="project">Assigned project team</option>{isSales(data.actor)&&<option value="commercial">Commercial records</option>}{can(data.actor,"po_write")&&<option value="purchasing">Purchasing records</option>}
          </select><button className="secondary">Upload attachment</button></form><FileList files={files}/>
      </Panel>
    </div>}
    {tab==="Activity"&&<Panel title="Project activity">{history.length?<div className="list">{history.map(item=><div className="list-row" key={item.id}><span className="list-icon"><Clock3 size={17}/></span><span><strong>{item.action}</strong><small>{item.actor_name} · {displayTimestamp(item.created_at)}</small></span></div>)}</div>:<Empty title="No visible activity"/>}</Panel>}
  </>;
}
