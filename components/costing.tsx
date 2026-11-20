"use client";
import { useEffect, useState } from "react";
import Decimal from "decimal.js";
import { Plus, Save, X } from "lucide-react";
import { can, costCategories, costLinesSchema, costSummary, money, totals, type CostLine, type QuoteDocument, type Revision, type Workspace } from "@/lib/model";
import { Empty, Panel, type Mutation } from "./shared";

const newLine = ():CostLine => ({id:crypto.randomUUID(),category:"EIS equipment",source:"Internal",description:"",quantity:"1",rate:"0"});

export function QuotationCosting({data,row,doc,dirty,mutate,pending,onPending}:{data:Workspace;row:Revision;doc:QuoteDocument;dirty:boolean;mutate:Mutation;pending:boolean;onPending:(dirty:boolean)=>void}) {
  const groups=[...doc.options,...doc.addons];
  const [selected,setSelected]=useState(groups[0].id);
  const group=groups.find(item=>item.id===selected)??groups[0];
  const plans=data.costPlans.filter(item=>item.revision_id===row.id);
  const existing=plans.find(item=>item.group_id===group.id);
  const awarded=data.awardedCosts.find(item=>item.revisionId===row.id);
  const awardedGroups=awarded?groups.filter(item=>item.id===awarded.optionId||awarded.addonIds.includes(item.id)):[];
  const quoteWritable=row.state==="draft"&&can(data.actor,"cost_write");
  const estimateReady=awardedGroups.length>0&&awardedGroups.every(item=>plans.some(plan=>plan.group_id===item.id&&plan.lines.length));
  const supplierEstimate=costSummary(plans.filter(plan=>awardedGroups.some(item=>item.id===plan.group_id)).flatMap(plan=>plan.lines),0).supplier;
  return <div className="form-stack">
    <Panel title="Internal costing">
      <div className="inset form-stack"><p className="muted">Amounts are in SAR before VAT. Cost lines and margins are private and excluded from quotation PDFs.</p>
        <label>Option or add-on<select value={group.id} onChange={e=>{if(!pending||window.confirm("Discard the unsaved changes to this estimate?"))setSelected(e.target.value);}}>{groups.map(item=><option key={item.id} value={item.id}>{item.name}{doc.addons.includes(item)?" (add-on)":""}</option>)}</select></label>
        {dirty&&<p className="muted">Save the quotation draft to refresh its selling price and edit estimates.</p>}
        <Estimate key={`${group.id}-${existing?.lock_version??0}`} lines={existing?.lines??[]} group={group} editor={existing?.updated_name}
          writable={quoteWritable&&!dirty} onPending={onPending} save={lines=>mutate({action:"quote.cost.save",id:row.id,group:group.id,documentLock:row.lock_version,lock:existing?.lock_version??0,lines},"Estimate saved")}/>
      </div>
    </Panel>
    {awarded&&<Panel title="Awarded scope and supplier commitments"><div className="inset form-stack">
      <p><strong>{awardedGroups.map(item=>item.name).join(" + ")}</strong> · {awarded.orderCount} committed supplier {awarded.orderCount===1?"PO":"POs"}</p>
      <dl className="detail-grid costing-summary">
        <div><dt>Supplier estimate</dt><dd>{estimateReady?`SAR ${money(supplierEstimate)}`:"Estimate incomplete"}</dd></div>
        <div><dt>Committed supplier spend</dt><dd>SAR {money(awarded.committed)}</dd></div>
        <div><dt>Variance (committed less estimate)</dt><dd>{estimateReady?`SAR ${money(new Decimal(awarded.committed).minus(supplierEstimate))}`:"—"}</dd></div>
      </dl>
      <p className="muted">Includes issued, partially delivered, delivered, and closed supplier POs for this award. Figures are commitments and exclude VAT.</p>
    </div></Panel>}
  </div>;
}

function Estimate({lines:stored,group,editor,writable,save,onPending}:{lines:CostLine[];group:QuoteDocument["options"][number];editor?:string;writable:boolean;onPending:(dirty:boolean)=>void;save:(lines:CostLine[])=>ReturnType<Mutation>}) {
  const [lines,setLines]=useState(stored);
  const update=<K extends keyof CostLine>(id:string,field:K,value:CostLine[K])=>setLines(previous=>previous.map(line=>line.id===id?{...line,[field]:value}:line));
  const valid=costLinesSchema.safeParse(lines).success;
  const dirty=lines.length!==stored.length||lines.some((line,index)=>!stored[index]||Object.keys(line).some(key=>line[key as keyof CostLine]!==stored[index][key as keyof CostLine]));
  useEffect(()=>{onPending(dirty);return ()=>onPending(false);},[dirty,onPending]);
  let summary;
  try { summary=costSummary(valid?lines:[],totals(group.items).net); } catch { /* Incomplete pricing is handled in the quotation editor. */ }
  return <div className="form-stack">
    {lines.length?<div className="table-scroll"><table className="data-table cost-table">
      <thead><tr><th>Cost item</th><th>Category</th><th>Source</th><th>Qty</th><th>Rate (SAR)</th>{writable&&<th><span className="sr-only">Remove line</span></th>}</tr></thead>
      <tbody>{lines.map((line,index)=><tr key={line.id}>
        <td><input aria-label={`Cost item ${index+1}`} value={line.description} readOnly={!writable} onChange={e=>update(line.id,"description",e.target.value)}/></td>
        <td><select aria-label={`Cost category ${index+1}`} value={line.category} disabled={!writable} onChange={e=>update(line.id,"category",e.target.value as CostLine["category"])}>
          {costCategories.map(item=><option key={item}>{item}</option>)}</select></td>
        <td><select aria-label={`Cost source ${index+1}`} value={line.source} disabled={!writable} onChange={e=>update(line.id,"source",e.target.value as CostLine["source"])}><option>Internal</option><option>Supplier</option></select></td>
        <td><input aria-label={`Cost quantity ${index+1}`} value={line.quantity} readOnly={!writable} inputMode="decimal" onChange={e=>update(line.id,"quantity",e.target.value)}/></td>
        <td><input aria-label={`Cost rate ${index+1}`} value={line.rate} readOnly={!writable} inputMode="decimal" onChange={e=>update(line.id,"rate",e.target.value)}/></td>
        {writable&&<td><button className="icon-button" aria-label={`Remove cost line ${index+1}`} onClick={()=>setLines(previous=>previous.filter(item=>item.id!==line.id))}><X size={16}/></button></td>}
      </tr>)}</tbody>
    </table></div>:<Empty title="No estimate for this option">Add the equipment, labour, and supplier costs for this scope.</Empty>}
    {!valid&&<p className="muted">Enter each description, a positive quantity, and a valid rate of zero or more.</p>}
    {summary&&<dl className="detail-grid costing-summary">
      <div><dt>Selling price</dt><dd>SAR {money(summary.net)}</dd></div>
      <div><dt>Estimated cost</dt><dd>{valid&&lines.length?`SAR ${money(summary.estimated)}`:"—"}</dd></div>
      <div><dt>Estimated gross profit</dt><dd>{valid&&lines.length?`SAR ${money(summary.profit)}`:"—"}</dd></div>
      <div><dt>Estimated gross margin</dt><dd>{valid&&lines.length&&summary.margin?`${summary.margin.toFixed(2)}%`:"—"}</dd></div>
    </dl>}
    <div className="group-heading">
      {writable&&<button className="secondary" disabled={lines.length>=100} onClick={()=>setLines(current=>[...current,newLine()])}><Plus size={16}/> Add cost line</button>}
      {editor&&<span className="muted tiny">Last edited by {editor}</span>}
      {writable&&<button className="primary" disabled={!valid||!dirty} onClick={()=>save(lines)}><Save size={16}/> Save estimate</button>}
    </div>
  </div>;
}
