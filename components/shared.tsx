"use client";
import type { ReactNode } from "react";
import { ArrowUpRight, Download, File, FolderOpen, X } from "lucide-react";
import { displayDate, money, type Attachment, type Item, type QuoteDocument } from "@/lib/model";
export type Mutation = (payload: Record<string,unknown> | FormData, success?: string) => Promise<{id:string;document?:QuoteDocument}|null>;

export function Empty({title,children}:{title:string;children?:ReactNode}) {
  return <div className="empty"><FolderOpen size={23}/><h3>{title}</h3>{children&&<p>{children}</p>}</div>;
}
export function Badge({value}:{value:string}) {
  const colors:Record<string,string>={Enquiry:"muted",Qualified:"blue",Scoping:"purple","Quotation sent":"blue",Negotiation:"amber",Won:"green",Lost:"red","On hold":"muted",
    draft:"muted",pending:"amber",issued:"green",superseded:"muted",withdrawn:"red",expired:"amber",delivered:"green",partially_delivered:"amber",cancelled:"red",closed:"muted"};
  return <span className={`badge ${colors[value]??"blue"}`}><i/>{value.replaceAll("_"," ")}</span>;
}
export function Panel({title,action,children,className=""}:{title:string;action?:ReactNode;children:ReactNode;className?:string}) {
  return <section className={`panel ${className}`}><header className="panel-head"><h2>{title}</h2>{action}</header>{children}</section>;
}
export function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
  return <div className="modal-shade" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
    <section role="dialog" aria-modal="true" aria-label={title} className="modal"><header><h2>{title}</h2><button aria-label="Close" className="icon-button" onClick={close}><X size={20}/></button></header>{children}</section>
  </div>;
}
export function Prices({items,setItems,readOnly,add}:{items:Item[];setItems:(rows:Item[])=>void;readOnly:boolean;add:()=>void}) {
  return <div className="price-editor">
    <div className="price-labels"><span>Item description</span><span>Qty</span><span>Unit price</span><span>VAT %</span><span/></div>
    {items.map((item,i)=><div className="price-row" key={item.id}>
      {(["description","quantity","rate","vat"] as const).map(key=><input key={key} aria-label={`${key} for item ${i+1}`} value={item[key]} readOnly={readOnly}
        inputMode={key==="description"?"text":"decimal"} onChange={e=>{const value=e.target.value;setItems(items.map(row=>row.id===item.id?{...row,[key]:value}:row));}}/>)}
      <button className="icon-button" title="Remove item" aria-label={`Remove item ${i+1}`} disabled={readOnly||items.length===1} onClick={()=>setItems(items.filter(row=>row.id!==item.id))}><X size={16}/></button>
    </div>)}
    {!readOnly&&<button className="secondary small" onClick={add}>Add line item</button>}
  </div>;
}
export function FileList({files}:{files:Attachment[]}) {
  return files.length?<div className="list">{files.map(file=><a key={file.id} href={`/api/files/${file.id}`} className="list-row">
    <span className="list-icon"><File size={17}/></span><span><strong>{file.filename}</strong><small>{file.visibility} · {Math.ceil(file.size_bytes/1024)} KB</small></span><Download className="push" size={16}/></a>)}</div>:<Empty title="No attachments yet"/>;
}
export const dateLabel = displayDate;
export const sar = (value:string|null) => value===null?"—":`SAR ${money(value)}`;
export function TextLink({children,onClick}:{children:ReactNode;onClick:()=>void}){
  return <button className="text-link" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>;
}
