"use client";
import { useCallback,useEffect,useState } from "react";
import { Activity as ActivityIcon, ArrowRight, BookOpen, BriefcaseBusiness, ClipboardList, FileText, LayoutDashboard, LogOut, PackageOpen, ShieldCheck, X } from "lucide-react";
import { canSeeCommercial,canSeePurchasing,canUseLibrary,isSales,roleName,type Workspace } from "@/lib/model";
import { Activity,Access } from "@/components/access";
import { Dashboard,OpportunityDetail,OpportunityForm,Pipeline } from "@/components/pipeline";
import { QuotationEditor,QuotationList } from "@/components/quotation";
import { QuotationLibrary } from "@/components/library";
import { OrderEditor,OrderList } from "@/components/orders";
import { Empty,type Mutation } from "@/components/shared";

const nav=[
  { name:"Dashboard",icon:LayoutDashboard,show:()=>true },
  { name:"Pipeline",icon:ClipboardList,show:()=>true },
  { name:"Quotations",icon:FileText,show:canSeeCommercial },
  { name:"Quotation library",icon:BookOpen,show:canUseLibrary },
  { name:"Projects",icon:BriefcaseBusiness,show:()=>true },
  { name:"Supplier POs",icon:PackageOpen,show:canSeePurchasing },
  { name:"Activity",icon:ActivityIcon,show:()=>true },
  { name:"Users & access",icon:ShieldCheck,show:(actor:Workspace["actor"])=>actor.role==="owner" },
];
function readView() {
  if(typeof window==="undefined")return "";
  return decodeURIComponent(window.location.hash.slice(1));
}
export default function Home(){
  const [data,setData]=useState<Workspace|null>(null);
  const [failure,setFailure]=useState("");
  const [view,setView]=useState("Dashboard");
  const [form,setForm]=useState<"new"|"edit"|null>(null);
  const [notice,setNotice]=useState<{text:string;error:boolean}|null>(null);
  const [busy,setBusy]=useState(false);
  const [back,setBack]=useState("Pipeline");
  const refresh=useCallback(async()=>{
    const response=await fetch("/api/workspace",{cache:"no-store"});
    if(response.status===401){window.location.replace("/login");return;}
    const result=await response.json();
    if(!response.ok)throw new Error(result.error);
    setData(result);
  },[]);
  useEffect(()=>{
    refresh().catch(error=>setFailure(error.message));
    const sync=()=>setView(readView()||"Dashboard");
    sync();window.addEventListener("hashchange",sync);
    return ()=>window.removeEventListener("hashchange",sync);
  },[refresh]);
  useEffect(()=>{
    if(!notice||notice.error)return;
    const timer=setTimeout(()=>setNotice(null),3600);
    return ()=>clearTimeout(timer);
  },[notice]);
  const go=(next:string)=>{
    window.location.hash=encodeURIComponent(next);setView(next);
  };
  const open=(id:string)=>{
    if(!view.includes("/"))setBack(view);
    go(`Opportunity/${id}`);
  };
  const quote=(id:string)=>go(`Quotation/${id}`);
  const order=(id:string)=>go(`Supplier PO/${id}`);
  const mutate:Mutation=async(payload,success)=>{
    if(busy)return null;
    setBusy(true);setNotice(null);
    try {
      const response=await fetch("/api/workspace",{method:"POST",headers:payload instanceof FormData?undefined:{"Content-Type":"application/json"},body:payload instanceof FormData?payload:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error);
      await refresh();
      if(success)setNotice({text:success,error:false});
      return result;
    }catch(error){setNotice({text:error instanceof Error?error.message:"Action failed.",error:true});return null;}
    finally{setBusy(false);}
  };
  async function logout(){
    const response=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"signout"})});
    if(response.ok)window.location.replace("/login");
    else setNotice({text:"Sign-out is unavailable in local demo mode.",error:true});
  }
  if(!data)return <main className="loading-shell"><img src="/brand/eis-black.png" alt="Event Innovation Systems" width={130}/><p role={failure?"alert":undefined}>{failure||"Opening workspace…"}</p>{failure&&<button className="secondary" onClick={()=>window.location.reload()}>Try again</button>}</main>;
  const [section,id]=view.split("/");
  const row=data.opportunities.find(item=>item.id===id);
  const revision=data.revisions.find(item=>item.id===id);
  const po=data.orders.find(item=>item.id===id);
  const current=section==="Opportunity"?(back==="Projects"?"Projects":"Pipeline"):section==="Quotation"?"Quotations":section==="Supplier PO"?"Supplier POs":section;
  const newRecord=()=>setForm("new");
  let content;
  if(section==="Dashboard")content=<Dashboard data={data} go={go} open={open} newRecord={newRecord}/>;
  if(section==="Pipeline"||section==="Projects")content=<Pipeline key={section} data={data} open={open} newRecord={newRecord} projects={section==="Projects"}/>;
  if(section==="Quotations"&&canSeeCommercial(data.actor))content=<QuotationList data={data} open={quote}/>;
  if(section==="Quotation library"&&canUseLibrary(data.actor))content=<QuotationLibrary data={data} mutate={mutate}/>;
  if(section==="Supplier POs"&&canSeePurchasing(data.actor))content=<OrderList data={data} open={order}/>;
  if(section==="Opportunity"&&row)content=<OpportunityDetail key={row.id} row={row} data={data} go={()=>go(back)} edit={()=>setForm("edit")} mutate={mutate} quote={quote} order={order}/>;
  if(section==="Quotation"&&revision)content=<QuotationEditor key={revision.id} row={revision} data={data} go={()=>go("Quotations")} open={quote} mutate={mutate}/>;
  if(section==="Supplier PO"&&po)content=<OrderEditor key={po.id} row={po} data={data} go={()=>go("Supplier POs")} mutate={mutate}/>;
  if(section==="Activity")content=<Activity data={data}/>;
  if(section==="Users & access"&&data.actor.role==="owner")content=<Access data={data} mutate={mutate}/>;
  return <div className="workspace">
    <aside className="sidebar"><button className="brand" onClick={()=>go("Dashboard")} aria-label="EIS dashboard"><img src="/brand/eis-black.png" alt="EIS" width={89}/></button>
      <p className="nav-label">WORKSPACE</p><nav aria-label="Workspace">{nav.filter(item=>item.show(data.actor)).map(({name,icon:Icon})=><button key={name} aria-label={name} className={current===name?"active":""} onClick={()=>go(name)}><Icon size={18}/><span>{name}</span></button>)}</nav>
      <div className="sidebar-user"><span className="avatar">{data.actor.name.split(" ").slice(0,2).map(item=>item[0]).join("")}</span>
        <div><strong>{data.actor.name}</strong><small>{roleName[data.actor.role]}</small></div><button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={16}/></button></div>
    </aside>
    <div className="workspace-body"><div className="topbar"><span>Event Innovation Systems</span><ArrowRight size={12}/><strong>{current}</strong><span className="region">Riyadh · SAR</span></div>
      <main className="main-content">{content??<Empty title="Record unavailable">Return to the dashboard to find records you can access.</Empty>}</main></div>
    {form&&isSales(data.actor)&&<OpportunityForm data={data} row={form==="edit"?row:undefined} mutate={mutate} close={()=>setForm(null)} open={open}/>}
    {(notice||busy)&&<div role={notice?.error?"alert":"status"} className={`toast ${notice?.error?"toast-error":""}`}>
      <span>{notice?.text??"Saving changes…"}</span>{notice&&<button className="icon-button" aria-label="Dismiss message" onClick={()=>setNotice(null)}><X size={16}/></button>}</div>}
  </div>;
}
