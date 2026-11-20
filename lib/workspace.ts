import "server-only";
import { z } from "zod";
import type { Pool, PoolClient } from "pg";
import { audit, db, transaction } from "./db";
import {
  blankQuote, can, canSeeCommercial, canSeeCosting, canSeePurchasing, canUseLibrary, costLinesSchema, day, isSales, librarySchema, opportunitySchema,
  orderSchema, permissions, projectStages, quoteSchema, riyadhDay, roles, scopeAllowed,
  totals, uuid, type AwardedCosts, type CostPlan, type LibraryEntry, type Opportunity, type QuoteDocument, type Scope, type Staff, type Workspace,
} from "./model";
import { deleteObject, getObject, putObject } from "./storage";
import { pdfAssets, renderPdf } from "./pdf";
import { quoteHtml, supplierHtml } from "./document";

export class WorkspaceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const deny = () => { throw new WorkspaceError("You do not have access to this action.",403); };
const requireAccess = (condition: unknown) => { if (!condition) deny(); };
type SQL = Pool | PoolClient;
type Input = Record<string, unknown>;

async function getOpportunity(query: SQL, user: Staff, id: unknown, lock = false) {
  const { rows } = await query.query(
    `SELECT o.* FROM opportunities o WHERE o.id=$1 AND ($2 OR o.owner_id=$3 OR EXISTS
      (SELECT 1 FROM opportunity_access a WHERE a.opportunity_id=o.id AND a.staff_id=$3)) ${lock ? "FOR UPDATE OF o" : ""}`,
    [uuid.parse(id),can(user,"sales_all"),user.id],
  );
  if (!rows[0]) throw new WorkspaceError("Opportunity not found.",404);
  return rows[0] as Opportunity;
}

const salesNote = z.string().trim().max(3000);
const version = z.number().int().nonnegative();
const provided = (input: Input) => uuid.parse(input.id);
const changed = (previous: object, next: object) => Object.keys(next).filter(key =>
  JSON.stringify((previous as Input)[key]) !== JSON.stringify((next as Input)[key]));

export async function loadWorkspace(actor: Staff): Promise<Workspace> {
  const pool = db();
  const { rows: opportunities } = await pool.query<Opportunity>(`
    SELECT o.*, owner.name AS owner_name, updated.name AS updated_name,
      COALESCE(a.net_amount,o.value)::text AS value, r.reference AS award_reference,a.option_id AS awarded_option,
      ARRAY(SELECT staff_id FROM opportunity_access access WHERE access.opportunity_id=o.id) AS assigned
    FROM opportunities o JOIN staff owner ON owner.id=o.owner_id JOIN staff updated ON updated.id=o.updated_by
    LEFT JOIN awards a ON a.opportunity_id=o.id LEFT JOIN quote_revisions r ON r.id=a.revision_id
    WHERE $1 OR o.owner_id=$2 OR EXISTS (SELECT 1 FROM opportunity_access x WHERE x.opportunity_id=o.id AND x.staff_id=$2)
    ORDER BY o.updated_at DESC`, [can(actor,"sales_all"),actor.id]);
  const ids = opportunities.map(row => row.id);
  const scopes = (["project","commercial","purchasing","admin"] as const).filter(scope => scopeAllowed(actor,scope));
  const [staff,revisions,orders,files,history,library,costPlans,awardedCosts] = await Promise.all([
    actor.role === "owner" ? pool.query("SELECT id,email,name,role,active,permissions FROM staff ORDER BY name") : Promise.resolve({rows:[actor]}),
    canSeeCommercial(actor) ? pool.query(`SELECT r.*,q.opportunity_id,s.name as updated_name,
      (r.issue_date+(r.document->>'validity')::integer)::text AS expires
      FROM quote_revisions r JOIN quotations q ON q.id=r.quotation_id JOIN staff s ON s.id=r.updated_by
      WHERE q.opportunity_id=ANY($1::uuid[]) AND r.state!='deleted' ORDER BY r.updated_at DESC`,[ids]) : Promise.resolve({rows:[]}),
    canSeePurchasing(actor) ? pool.query(`SELECT o.*,s.name AS updated_name,r.reference AS award_reference
      FROM supplier_orders o JOIN staff s ON s.id=o.updated_by JOIN quote_revisions r ON r.id=o.award_revision_id
      WHERE o.opportunity_id=ANY($1::uuid[]) ORDER BY o.updated_at DESC`,[ids]) : Promise.resolve({rows:[]}),
    pool.query(`SELECT id,opportunity_id,filename,content_type,size_bytes,visibility FROM files
      WHERE opportunity_id=ANY($1::uuid[]) AND visibility=ANY($2::text[]) ORDER BY created_at DESC`,[ids,scopes]),
    pool.query(`SELECT id,opportunity_id,actor_name,action,entity_type,detail,created_at FROM audit_log
      WHERE (opportunity_id=ANY($1::uuid[]) OR (opportunity_id IS NULL AND $2)) AND visibility=ANY($3::text[])
      ORDER BY id DESC LIMIT 150`,[ids,actor.role==="owner",scopes]),
    canUseLibrary(actor) ? pool.query<LibraryEntry>(`
      SELECT l.id,l.document,l.archived,l.image_key IS NOT NULL AS has_image,l.lock_version,s.name AS updated_name
      FROM quotation_library l JOIN staff s ON s.id=l.updated_by
      WHERE NOT l.archived OR $1 ORDER BY l.archived,l.document->>'title'`,[can(actor,"library_manage")]) : Promise.resolve({rows:[]}),
    canSeeCosting(actor) ? pool.query<CostPlan>(`
      SELECT p.revision_id,p.group_id,p.lines,p.lock_version,s.name AS updated_name
      FROM quotation_cost_plans p JOIN quote_revisions r ON r.id=p.revision_id
      JOIN quotations q ON q.id=r.quotation_id JOIN staff s ON s.id=p.updated_by
      WHERE q.opportunity_id=ANY($1::uuid[]) AND r.state!='deleted'`,[ids]) : Promise.resolve({rows:[]}),
    canSeeCosting(actor) ? pool.query<AwardedCosts>(`
      SELECT a.revision_id AS "revisionId",a.option_id AS "optionId",a.addon_ids AS "addonIds",
        COALESCE(SUM(net.value),0)::text AS committed,COUNT(o.id)::int AS "orderCount"
      FROM awards a LEFT JOIN supplier_orders o ON o.opportunity_id=a.opportunity_id
        AND o.award_revision_id=a.revision_id AND o.state IN ('issued','partially_delivered','delivered','closed')
      LEFT JOIN LATERAL (SELECT SUM((item->>'quantity')::numeric * (item->>'rate')::numeric) AS value
        FROM jsonb_array_elements(o.document->'items') item) net ON true
      WHERE a.opportunity_id=ANY($1::uuid[]) GROUP BY a.opportunity_id,a.revision_id,a.option_id,a.addon_ids`,[ids]) : Promise.resolve({rows:[]}),
  ]);
  const visible = canSeeCommercial(actor) ? opportunities : opportunities.map(row => ({
    ...row, value:null, award_reference:null, awarded_option:null,
  }));
  return { actor, today:riyadhDay(), opportunities:visible, staff:staff.rows, revisions:revisions.rows, orders:orders.rows, files:files.rows, audit:history.rows, library:library.rows, costPlans:costPlans.rows, awardedCosts:awardedCosts.rows };
}

async function recordFile(client: PoolClient, rollback: (fn: () => Promise<void>) => void, actor: Staff, opts: {
  opportunity: string; scope: Exclude<Scope,"admin">; buffer: Buffer; filename: string; contentType: string;
}) {
  const id = crypto.randomUUID();
  rollback(() => deleteObject(id));
  await putObject(id,opts.buffer,opts.contentType);
  await client.query("INSERT INTO files(id,opportunity_id,object_key,filename,content_type,size_bytes,visibility,uploaded_by) VALUES($1,$2,$1::uuid::text,$3,$4,$5,$6,$7)",
    [id,opts.opportunity,opts.filename,opts.contentType,opts.buffer.length,opts.scope,actor.id]);
  await audit(client,actor,{ opportunity:opts.opportunity, entity:"File", id, action:"File added", scope:opts.scope, detail:{ filename:opts.filename } });
  return id;
}

export async function upload(actor: Staff, form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size || file.size > 25*1024*1024) throw new WorkspaceError("Select a file up to 25 MB.");
  const target = form.get("target");
  const libraryImage = target === "library-image";
  const scope = libraryImage ? "commercial" : z.enum(["project","commercial","purchasing"]).parse(form.get("visibility"));
  if (libraryImage) {
    requireAccess(can(actor,"library_manage"));
    if (file.size > 8*1024*1024) throw new WorkspaceError("Upload a library image up to 8 MB.");
  } else {
    requireAccess(scope === "project" || (scope === "commercial" && isSales(actor)) || (scope === "purchasing" && can(actor,"po_write")));
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const imageType = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png" :
    buffer[0]===255 && buffer[1]===216 && buffer[2]===255 ? "image/jpeg" :
    buffer.toString("ascii",0,4)==="RIFF" && buffer.toString("ascii",8,12)==="WEBP" ? "image/webp" : null;
  const contentType = imageType ?? (buffer.toString("ascii",0,5) === "%PDF-" ? "application/pdf" : "application/octet-stream");
  const name = file.name.replace(/[\u0000-\u001f\u007f]/g,"").slice(0,200) || "attachment";
  let replacedKey: string|undefined;
  const result = await transaction(async (client,rollback) => {
    if (libraryImage) {
      if (!imageType) throw new WorkspaceError("Use a PNG, JPEG, or WebP image.");
      const entry = await libraryEntry(client,form.get("entry"),true);
      checkLock(entry.lock_version,Number(form.get("lock")));
      if (entry.archived) throw new WorkspaceError("Restore the library entry before changing its visual.",409);
      const key = crypto.randomUUID();
      replacedKey = entry.image_key ?? undefined;
      rollback(()=>deleteObject(key));
      await putObject(key,buffer,imageType);
      await client.query(`UPDATE quotation_library SET image_key=$2,image_type=$3,image_name=$4,updated_by=$5,
        updated_at=now(),lock_version=lock_version+1 WHERE id=$1`,[entry.id,key,imageType,name,actor.id]);
      await audit(client,actor,{entity:"Quotation library",id:entry.id,action:"Library visual uploaded",scope:"admin",detail:{filename:name}});
      return {id:entry.id};
    }
    const row = await getOpportunity(client,actor,form.get("opportunity"));
    return { id:await recordFile(client,rollback,actor,{ opportunity:row.id, scope, buffer, filename:name, contentType }) };
  });
  if (replacedKey) await deleteObject(replacedKey).catch(error=>console.error("Could not remove old library visual.",error));
  return result;
}

export async function download(actor: Staff, file: unknown) {
  const { rows } = await db().query("SELECT * FROM files WHERE id=$1",[uuid.parse(file)]);
  const row = rows[0];
  if (!row || !scopeAllowed(actor,row.visibility)) throw new WorkspaceError("File not found.",404);
  await getOpportunity(db(),actor,row.opportunity_id);
  return { filename:row.filename as string, type:row.content_type as string, buffer:await getObject(row.object_key) };
}

async function libraryEntry(query: SQL, id: unknown, lock = false) {
  const {rows:[entry]} = await query.query(`SELECT * FROM quotation_library WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,[uuid.parse(id)]);
  if (!entry) throw new WorkspaceError("Library entry not found.",404);
  return entry;
}

export async function downloadLibraryImage(actor: Staff, id: unknown) {
  requireAccess(canUseLibrary(actor));
  const entry = await libraryEntry(db(),id);
  if (!entry.image_key || (entry.archived && !can(actor,"library_manage"))) throw new WorkspaceError("Image not found.",404);
  return { type:entry.image_type as string, buffer:await getObject(entry.image_key) };
}

async function sequence(client: PoolClient, series: "quote" | "po", day: string) {
  const {rows} = await client.query(`INSERT INTO document_sequences(series,day,last_number) VALUES($1,$2,1)
    ON CONFLICT (series,day) DO UPDATE SET last_number=document_sequences.last_number+1 RETURNING last_number`,[series,day]);
  return String(rows[0].last_number).padStart(2,"0");
}
async function revision(client: PoolClient, actor: Staff, id: unknown) {
  const {rows} = await client.query(`SELECT r.*,q.opportunity_id,q.base_reference FROM quote_revisions r
    JOIN quotations q ON q.id=r.quotation_id WHERE r.id=$1 FOR UPDATE OF q,r`,[uuid.parse(id)]);
  if (!rows[0]) throw new WorkspaceError("Quotation not found.",404);
  await getOpportunity(client,actor,rows[0].opportunity_id);
  return rows[0];
}
async function supplierOrder(client: PoolClient, actor: Staff, id: unknown) {
  const {rows} = await client.query("SELECT * FROM supplier_orders WHERE id=$1 FOR UPDATE",[uuid.parse(id)]);
  if (!rows[0]) throw new WorkspaceError("Supplier order not found.",404);
  await getOpportunity(client,actor,rows[0].opportunity_id);
  return rows[0];
}
function checkLock(existing: number, input: unknown) {
  if (existing !== version.parse(input)) throw new WorkspaceError("Someone saved changes after you opened this document. Reload before editing again.",409);
}
async function quoteImages(client: PoolClient, actor: Staff, opportunityId: string, doc: QuoteDocument, load: boolean) {
  const keys = [...new Set(doc.pages.map(page => page.imageId).filter(Boolean))];
  if (!keys.length) return {};
  const {rows} = await client.query(`SELECT id,object_key,content_type,size_bytes FROM files WHERE opportunity_id=$1 AND id=ANY($2::uuid[])
       AND visibility IN ('project','commercial') AND content_type IN ('image/png','image/jpeg','image/webp')`,[opportunityId,keys]);
  requireAccess(canSeeCommercial(actor) && rows.length === keys.length);
  if (!load) return {};
  if (rows.reduce((size,row) => size + row.size_bytes,0)>32*1024*1024) throw new WorkspaceError("Quotation images exceed 32 MB together. Upload optimized copies for the offer.");
  return Object.fromEntries(await Promise.all(rows.map(async row =>
    [row.id,`data:${row.content_type};base64,${(await getObject(row.object_key)).toString("base64")}`])));
}

export async function mutate(actor: Staff, input: Input) {
  return transaction(async (client,rollback) => {
    switch (input.action) {
      case "opportunity.save": {
        requireAccess(isSales(actor));
        const data = opportunitySchema.parse(input.document);
        const existing = input.id ? await getOpportunity(client,actor,input.id,true) : null;
        const owner = actor.role === "owner" ? data.owner_id ?? existing?.owner_id ?? actor.id : existing?.owner_id ?? actor.id;
        if (data.stage === "Won" && existing?.stage !== "Won") throw new WorkspaceError("Record the client's quotation acceptance to mark a project won.");
        if (existing?.stage === "Won" && data.stage !== "Won") throw new WorkspaceError("A project with a recorded award must keep its won sales stage.");
        if (actor.role === "owner" && data.assigned) {
          const {rowCount} = await client.query("SELECT id FROM staff WHERE active AND id=ANY($1::uuid[])",[data.assigned]);
          if (rowCount !== new Set(data.assigned).size) throw new WorkspaceError("One of the assigned users is unavailable.");
        }
        const args = [owner,data.client,data.title,data.contact,data.venue,data.event_start||null,data.event_end||null,data.value,data.stage,data.next_action,data.follow_up||null,actor.id];
        const {rows:[row]} = existing ? await client.query(`UPDATE opportunities SET owner_id=$1,client=$2,title=$3,contact=$4,venue=$5,event_start=$6,event_end=$7,
          value=$8,stage=$9,next_action=$10,follow_up=$11,updated_by=$12,updated_at=now() WHERE id=$13 RETURNING id`,[...args,existing.id]) :
          await client.query(`INSERT INTO opportunities(owner_id,client,title,contact,venue,event_start,event_end,value,stage,next_action,follow_up,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,args);
        if (actor.role === "owner" && data.assigned) {
          await client.query("DELETE FROM opportunity_access WHERE opportunity_id=$1",[row.id]);
          await client.query("INSERT INTO opportunity_access(opportunity_id,staff_id) SELECT $1,unnest($2::uuid[]) ON CONFLICT DO NOTHING",[row.id,data.assigned]);
        }
        await audit(client,actor,{ opportunity:row.id, entity:"Opportunity", id:row.id, action:existing?"Opportunity updated":"Opportunity created", scope:"commercial",
          detail:{ title:data.title, fields:existing ? changed(existing,data) : [], stage:data.stage } });
        return {id:row.id};
      }
      case "project.update": {
        const existing = await getOpportunity(client,actor,input.id,true);
        requireAccess(actor.role === "engineering" || can(actor,"project_write"));
        const status = existing.stage==="Won" ? z.enum(projectStages).parse(input.status) : existing.project_status;
        const note = salesNote.parse(input.note ?? existing.project_note);
        const technicalScope = z.string().trim().max(5000).parse(input.technicalScope ?? existing.technical_scope);
        const install = day.or(z.literal("")).parse(input.installationDate ?? existing.installation_date ?? "");
        const milestone = z.string().trim().max(200).parse(input.nextMilestone ?? existing.next_milestone);
        const due = day.or(z.literal("")).parse(input.milestoneDate ?? existing.milestone_date ?? "");
        await client.query(`UPDATE opportunities SET project_status=$2,project_note=$3,technical_scope=$4,installation_date=$5,
          next_milestone=$6,milestone_date=$7,updated_by=$8,updated_at=now() WHERE id=$1`,
          [existing.id,status,note,technicalScope,install||null,milestone,due||null,actor.id]);
        await audit(client,actor,{ opportunity:existing.id, entity:"Project", id:existing.id,
          action:status!==existing.project_status?"Delivery status updated":"Project details updated", scope:"project",
          detail:{ from:existing.project_status,to:status,fields:changed(existing,{project_note:note,technical_scope:technicalScope,
            installation_date:install||null,next_milestone:milestone,milestone_date:due||null}) } });
        return {id:existing.id};
      }
      case "library.save": {
        requireAccess(can(actor,"library_manage"));
        const document = librarySchema.parse(input.document);
        const current = input.id ? await libraryEntry(client,input.id,true) : null;
        if (current) {
          checkLock(current.lock_version,input.lock);
          if (current.archived) throw new WorkspaceError("Restore the library entry before editing.",409);
          await client.query(`UPDATE quotation_library SET document=$2,updated_by=$3,updated_at=now(),
            lock_version=lock_version+1 WHERE id=$1`,[current.id,document,actor.id]);
        }
        const {rows:[row]} = current ? {rows:[current]} : await client.query(
          "INSERT INTO quotation_library(document,updated_by) VALUES($1,$2) RETURNING id",[document,actor.id],
        );
        await audit(client,actor,{entity:"Quotation library",id:row.id,action:current?"Library entry updated":"Library entry created",
          scope:"admin",detail:{title:document.title}});
        return {id:row.id};
      }
      case "library.archive": {
        requireAccess(can(actor,"library_manage"));
        const entry = await libraryEntry(client,input.id,true);
        checkLock(entry.lock_version,input.lock);
        const archived = z.boolean().parse(input.archived);
        await client.query(`UPDATE quotation_library SET archived=$2,updated_by=$3,updated_at=now(),
          lock_version=lock_version+1 WHERE id=$1`,[entry.id,archived,actor.id]);
        await audit(client,actor,{entity:"Quotation library",id:entry.id,action:archived?"Library entry archived":"Library entry restored",
          scope:"admin",detail:{title:entry.document.title}});
        return {id:entry.id};
      }
      case "quote.library.apply": {
        requireAccess(can(actor,"quote_write"));
        const current = await revision(client,actor,input.id);
        if (current.state !== "draft") throw new WorkspaceError("Apply library content to a draft quotation.",409);
        checkLock(current.lock_version,input.lock);
        const library = await libraryEntry(client,input.entry,true);
        if (library.archived) throw new WorkspaceError("This library entry has been archived.",409);
        const details = librarySchema.parse(library.document);
        const doc = quoteSchema.parse(current.document);
        const optionId = uuid.or(z.literal("")).parse(input.optionId ?? "");
        const priceGroup = optionId ? doc.options.find(group=>group.id===optionId) : doc.options.length===1 ? doc.options[0] : undefined;
        if (optionId && !priceGroup) throw new WorkspaceError("Select an option from this quotation.");
        const includePrice = z.boolean().parse(input.includePrice ?? false);
        if (includePrice && (!priceGroup || !details.rate)) throw new WorkspaceError("Select a priced option and a library entry with a default price.");
        const images = Boolean(library.image_key);
        let imageId = "";
        if (images) {
          imageId = await recordFile(client,rollback,actor,{opportunity:current.opportunity_id,scope:"commercial",
            buffer:await getObject(library.image_key),filename:library.image_name,contentType:library.image_type});
        }
        const pages: QuoteDocument["pages"] = [];
        const appendPage = (type: QuoteDocument["pages"][number]["type"], title: string, body: string, image = "", caption = "") =>
          pages.push({id:crypto.randomUUID(),type,title,body,optionId,imageId:image,caption});
        if (details.scope || images) appendPage("Scope", details.title, details.scope,imageId,details.imageCaption);
        if (details.siteRequirements) appendPage("Responsibilities",details.title+" — Site requirements",details.siteRequirements);
        if (details.exclusions) appendPage("Responsibilities",details.title+" — Exclusions",details.exclusions);
        if (details.terms) appendPage("Terms",details.title+" — Terms",details.terms);
        if (includePrice && priceGroup) {
          priceGroup.items.push({id:crypto.randomUUID(),description:details.title,quantity:"1",rate:details.rate,vat:details.vat});
        }
        if (!pages.length && !includePrice) {
          throw new WorkspaceError("Select the default price to apply this price-only entry.");
        }
        const closing = doc.pages.findIndex(page=>page.type==="Closing");
        doc.pages.splice(closing<0?doc.pages.length:closing,0,...pages);
        const document = quoteSchema.parse(doc);
        await client.query(`UPDATE quote_revisions SET document=$2,lock_version=lock_version+1,
          updated_at=now(),updated_by=$3 WHERE id=$1`,[current.id,document,actor.id]);
        await audit(client,actor,{opportunity:current.opportunity_id,entity:"Quotation",id:current.id,action:"Library entry added",
          scope:"commercial",detail:{title:details.title,option:optionId?priceGroup?.name:"Shared",includedPrice:includePrice}});
        return {id:current.id,document};
      }
      case "quote.cost.save": {
        requireAccess(canSeeCosting(actor) && can(actor,"cost_write"));
        const current = await revision(client,actor,input.id);
        if (current.state !== "draft") throw new WorkspaceError("Open a draft revision to edit its estimates.",409);
        checkLock(current.lock_version,input.documentLock);
        const groupId = uuid.parse(input.group);
        const doc = quoteSchema.parse(current.document);
        if (![...doc.options,...doc.addons].some(group=>group.id===groupId)) throw new WorkspaceError("Pricing group not found.",404);
        const lines = costLinesSchema.parse(input.lines);
        const {rows:[prior]} = await client.query("SELECT lock_version FROM quotation_cost_plans WHERE revision_id=$1 AND group_id=$2",[current.id,groupId]);
        checkLock(prior?.lock_version ?? 0,input.lock);
        await client.query(`INSERT INTO quotation_cost_plans(revision_id,group_id,lines,updated_by) VALUES($1,$2,$3::jsonb,$4)
          ON CONFLICT(revision_id,group_id) DO UPDATE SET lines=EXCLUDED.lines,updated_by=EXCLUDED.updated_by,
          updated_at=now(),lock_version=quotation_cost_plans.lock_version+1`,[current.id,groupId,JSON.stringify(lines),actor.id]);
        await audit(client,actor,{opportunity:current.opportunity_id,entity:"Internal costing",id:current.id,action:"Estimate saved",
          scope:"admin",detail:{group:groupId,lineCount:lines.length}});
        return {id:current.id};
      }
      case "quote.create": {
        requireAccess(can(actor,"quote_write"));
        const opportunity = await getOpportunity(client,actor,input.opportunity);
        const {rows:[q]} = await client.query("INSERT INTO quotations(opportunity_id,created_by) VALUES ($1,$2) RETURNING id",[opportunity.id,actor.id]);
        const {rows:[r]} = await client.query("INSERT INTO quote_revisions(quotation_id,version,state,document,updated_by) VALUES ($1,1,'draft',$2,$3) RETURNING id",[q.id,blankQuote(opportunity),actor.id]);
        await audit(client,actor,{ opportunity:opportunity.id, entity:"Quotation", id:r.id, action:"Quotation draft created", scope:"commercial" });
        return {id:r.id};
      }
      case "quote.save": {
        requireAccess(can(actor,"quote_write"));
        const current = await revision(client,actor,input.id);
        if (current.state !== "draft") throw new WorkspaceError("Create a revision before editing an issued offer.",409);
        checkLock(current.lock_version,input.lock);
        const document = quoteSchema.parse(input.document);
        await quoteImages(client,actor,current.opportunity_id,document,false);
        const keptGroups = [...document.options,...document.addons].map(group=>group.id);
        const savedCosts = await client.query(`SELECT 1 FROM quotation_cost_plans WHERE revision_id=$1
          AND NOT (group_id=ANY($2::uuid[])) AND jsonb_array_length(lines)>0 LIMIT 1`,[current.id,keptGroups]);
        if (savedCosts.rowCount) throw new WorkspaceError(canSeeCosting(actor) ? "Clear the estimate for a pricing group before removing it." : "This pricing group is in use. Ask an administrator to review it before removal.",409);
        await client.query("UPDATE quote_revisions SET document=$2,lock_version=lock_version+1,updated_at=now(),updated_by=$3 WHERE id=$1",[current.id,document,actor.id]);
        await audit(client,actor,{ opportunity:current.opportunity_id, entity:"Quotation", id:current.id, action:"Quotation draft saved", scope:"commercial",
          detail:{ fields:changed(current.document,document), addedPages:document.pages.filter(p=>!current.document.pages.some((old:{id:string})=>old.id===p.id)).map(p=>p.title||p.type),
          removedPages:(current.document as QuoteDocument).pages.filter(p=>!document.pages.some(next=>next.id===p.id)).map(p=>p.title||p.type) } });
        return {id:current.id};
      }
      case "quote.issue": {
        requireAccess(can(actor,"quote_issue"));
        const current = await revision(client,actor,input.id);
        if (current.pdf_id) return {id:current.id};
        if (current.state !== "draft") throw new WorkspaceError("Only an active draft can be issued.",409);
        checkLock(current.lock_version,input.lock);
        const doc = quoteSchema.parse(current.document);
        if (!doc.pages.some(page=>page.type==="Cover")) throw new WorkspaceError("Add a cover page before issuing this quotation.");
        const pricing = doc.pages.filter(page=>page.type==="Pricing");
        if (!pricing.some(page=>!page.optionId) && (doc.addons.length || doc.options.some(option=>!pricing.some(page=>page.optionId===option.id)))) {
          throw new WorkspaceError("Include a price page for each option and add-on before issuing.");
        }
        const issueDay = riyadhDay();
        const assets = await pdfAssets(await quoteImages(client,actor,current.opportunity_id,doc,true));
        const base = current.base_reference ?? issueDay.replaceAll("-","")+"p"+await sequence(client,"quote",issueDay);
        const {rows:[number]} = await client.query("SELECT COUNT(reference)::int+1 AS n FROM quote_revisions WHERE quotation_id=$1",[current.quotation_id]);
        const reference = base+"v"+String(number.n).padStart(2,"0");
        const pdf = await renderPdf(quoteHtml(doc,reference,issueDay,assets)).catch(error => {
          if (error instanceof Error && /^Content exceeds|^A document image/.test(error.message)) throw new WorkspaceError(error.message);
          throw error;
        });
        const pdfId = await recordFile(client,rollback,actor,{ opportunity:current.opportunity_id, scope:"commercial", buffer:pdf, filename:reference+".pdf", contentType:"application/pdf" });
        await client.query("UPDATE quotations SET base_reference=$2 WHERE id=$1",[current.quotation_id,base]);
        await client.query("UPDATE quote_revisions SET state='superseded',updated_at=now(),updated_by=$2 WHERE quotation_id=$1 AND state='issued'",[current.quotation_id,actor.id]);
        await client.query("UPDATE quote_revisions SET state='issued',reference=$2,pdf_id=$3,issued_at=now(),issue_date=$4,updated_by=$5,updated_at=now(),lock_version=lock_version+1 WHERE id=$1",[current.id,reference,pdfId,issueDay,actor.id]);
        await audit(client,actor,{ opportunity:current.opportunity_id, entity:"Quotation", id:current.id, action:"Quotation issued", scope:"commercial", detail:{reference} });
        return {id:current.id};
      }
      case "quote.revise": {
        requireAccess(can(actor,"quote_write"));
        const current = await revision(client,actor,input.id);
        if (!current.pdf_id) throw new WorkspaceError("Select an issued version to revise.");
        const {rows:[draft]} = await client.query("SELECT id FROM quote_revisions WHERE quotation_id=$1 AND state='draft'",[current.quotation_id]);
        if (draft) return {id:draft.id};
        const {rows:[row]} = await client.query(`INSERT INTO quote_revisions(quotation_id,version,state,document,updated_by)
          SELECT $1,MAX(version)+1,'draft',$2,$3 FROM quote_revisions WHERE quotation_id=$1 RETURNING id`,[current.quotation_id,current.document,actor.id]);
        await client.query(`INSERT INTO quotation_cost_plans(revision_id,group_id,lines,updated_by)
          SELECT $1,group_id,lines,$3 FROM quotation_cost_plans WHERE revision_id=$2`,[row.id,current.id,actor.id]);
        await audit(client,actor,{ opportunity:current.opportunity_id, entity:"Quotation", id:row.id, action:"Revision draft created", scope:"commercial", detail:{ from:current.reference } });
        return {id:row.id};
      }
      case "quote.remove": {
        requireAccess(can(actor,"quote_remove"));
        const current = await revision(client,actor,input.id);
        const reason = salesNote.trim().min(3).parse(input.reason);
        if (!["draft","issued","superseded"].includes(current.state)) throw new WorkspaceError("This revision cannot be withdrawn or deleted.");
        const state = current.state === "draft" ? "deleted" : "withdrawn";
        const {rowCount} = await client.query("SELECT 1 FROM awards WHERE revision_id=$1",[current.id]);
        if (rowCount) throw new WorkspaceError("This revision is the recorded client award and cannot be withdrawn.");
        await client.query("UPDATE quote_revisions SET state=$2,updated_at=now(),updated_by=$3 WHERE id=$1",[current.id,state,actor.id]);
        await audit(client,actor,{ opportunity:current.opportunity_id, entity:"Quotation", id:current.id, action:state==="deleted"?"Quotation draft deleted":"Quotation withdrawn", scope:"commercial",detail:{reason,reference:current.reference} });
        return {id:current.id};
      }
      case "quote.accept": {
        requireAccess(isSales(actor));
        const current = await revision(client,actor,input.id);
        if (!["issued","superseded"].includes(current.state)) throw new WorkspaceError("Select an issued quotation revision.");
        const date = day.parse(input.date);
        if (date < current.issue_date || date > riyadhDay()) throw new WorkspaceError("Acceptance date must be on or after issue and cannot be in the future.");
        const evidence = salesNote.trim().min(3).parse(input.evidence);
        const poReference = z.string().trim().max(120).parse(input.poReference ?? "");
        const optionId = uuid.parse(input.option);
        const addonIds = [...new Set(z.array(uuid).max(12).parse(input.addons))];
        const evidenceId = z.union([uuid,z.literal("")]).parse(input.file ?? "");
        if (evidenceId) {
          const {rowCount} = await client.query("SELECT 1 FROM files WHERE id=$1 AND opportunity_id=$2 AND visibility IN ('commercial','project')",[evidenceId,current.opportunity_id]);
          if (!rowCount) throw new WorkspaceError("Select evidence attached to this project.");
        }
        const doc = quoteSchema.parse(current.document);
        const option = doc.options.find(item=>item.id===optionId);
        const addons = doc.addons.filter(item=>addonIds.includes(item.id));
        if (!option || addons.length!==addonIds.length) throw new WorkspaceError("Select options and add-ons from this revision.");
        await getOpportunity(client,actor,current.opportunity_id,true);
        const amounts = totals([...option.items,...addons.flatMap(addon=>addon.items)]);
        const {rowCount} = await client.query(`INSERT INTO awards(opportunity_id,revision_id,option_id,addon_ids,net_amount,tax_amount,accepted_on,evidence,evidence_file_id,recorded_by,client_po_reference)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
          [current.opportunity_id,current.id,optionId,addonIds,amounts.net.toString(),amounts.vat.toString(),date,evidence,evidenceId||null,actor.id,poReference]);
        if (!rowCount) throw new WorkspaceError("This opportunity already has a recorded acceptance.",409);
        await client.query("UPDATE opportunities SET stage='Won',project_status=$2,updated_at=now(),updated_by=$3 WHERE id=$1",
          [current.opportunity_id,poReference?"Confirmed":"Awaiting client PO",actor.id]);
        await audit(client,actor,{ opportunity:current.opportunity_id, entity:"Quotation", id:current.id, action:"Client acceptance recorded", scope:"commercial",
          detail:{reference:current.reference,option:option.name,addons:addons.map(a=>a.name),evidence,date,poReference} });
        return {id:current.opportunity_id};
      }
      case "order.create": {
        requireAccess(can(actor,"po_write"));
        const opportunity = await getOpportunity(client,actor,input.opportunity);
        const {rows:[award]} = await client.query("SELECT revision_id FROM awards WHERE opportunity_id=$1",[opportunity.id]);
        if (!award) throw new WorkspaceError("Record client acceptance before creating a supplier PO.");
        const doc = { supplier:"",contact:"",title:opportunity.title,scope:"",location:opportunity.venue,delivery:"",terms:"",
          items:[{id:crypto.randomUUID(),description:"",quantity:"1",rate:"0",vat:"15"}] };
        const {rows:[row]} = await client.query(`INSERT INTO supplier_orders(opportunity_id,award_revision_id,state,document,updated_by)
          VALUES($1,$2,'draft',$3,$4) RETURNING id`,[opportunity.id,award.revision_id,doc,actor.id]);
        await audit(client,actor,{ opportunity:opportunity.id,entity:"Supplier PO",id:row.id,action:"Supplier PO draft created",scope:"purchasing" });
        return {id:row.id};
      }
      case "order.save":
      case "order.submit": {
        requireAccess(can(actor,"po_write"));
        const row = await supplierOrder(client,actor,input.id);
        if (!["draft","pending"].includes(row.state)) throw new WorkspaceError("This supplier order has already left draft.");
        checkLock(row.lock_version,input.lock);
        const doc = orderSchema.parse(input.document);
        const state = input.action === "order.submit" ? "pending" : "draft";
        await client.query("UPDATE supplier_orders SET state=$2,document=$3,updated_by=$4,updated_at=now(),lock_version=lock_version+1 WHERE id=$1",[row.id,state,doc,actor.id]);
        await audit(client,actor,{ opportunity:row.opportunity_id,entity:"Supplier PO",id:row.id,action:state==="pending"?"Supplier PO submitted":"Supplier PO draft saved",scope:"purchasing",detail:{fields:changed(row.document,doc)} });
        return {id:row.id};
      }
      case "order.issue": {
        requireAccess(can(actor,"po_issue"));
        const row = await supplierOrder(client,actor,input.id);
        if (row.pdf_id) return {id:row.id};
        if (row.state!=="pending") throw new WorkspaceError("Submit the order for approval before issuing.");
        checkLock(row.lock_version,input.lock);
        const doc = orderSchema.parse(row.document);
        const today = riyadhDay();
        const reference = "EIS-PO-"+today.replaceAll("-","")+"-"+await sequence(client,"po",today);
        const pdf = await renderPdf(supplierHtml(doc,reference,today,await pdfAssets())).catch(error => {
          if (error instanceof Error && /^Content exceeds/.test(error.message)) throw new WorkspaceError(error.message);
          throw error;
        });
        const pdfId = await recordFile(client,rollback,actor,{ opportunity:row.opportunity_id, scope:"purchasing", buffer:pdf, filename:reference+".pdf", contentType:"application/pdf" });
        await client.query("UPDATE supplier_orders SET state='issued',reference=$2,pdf_id=$3,issued_at=now(),updated_by=$4,updated_at=now(),lock_version=lock_version+1 WHERE id=$1",[row.id,reference,pdfId,actor.id]);
        await audit(client,actor,{ opportunity:row.opportunity_id,entity:"Supplier PO",id:row.id,action:"Supplier PO issued",scope:"purchasing",detail:{reference} });
        return {id:row.id};
      }
      case "order.status": {
        requireAccess(can(actor,"po_write") || can(actor,"po_issue"));
        const row = await supplierOrder(client,actor,input.id);
        const allowed:Record<string,string[]> = { draft:["cancelled"], pending:["cancelled"], issued:["partially_delivered","delivered","cancelled"], partially_delivered:["delivered","cancelled"], delivered:["closed"] };
        const next = z.enum(["partially_delivered","delivered","closed","cancelled"]).parse(input.state);
        if (!allowed[row.state]?.includes(next)) throw new WorkspaceError("This status change is unavailable.");
        if (next==="cancelled" && row.pdf_id) requireAccess(can(actor,"po_issue"));
        const reason = salesNote.parse(input.reason ?? "");
        if (next==="cancelled" && !reason.trim()) throw new WorkspaceError("Enter a reason for cancellation.");
        await client.query("UPDATE supplier_orders SET state=$2,updated_by=$3,updated_at=now(),lock_version=lock_version+1 WHERE id=$1",[row.id,next,actor.id]);
        await audit(client,actor,{ opportunity:row.opportunity_id,entity:"Supplier PO",id:row.id,action:"Supplier PO status updated",scope:"purchasing",detail:{from:row.state,to:next,reason} });
        return {id:row.id};
      }
      case "staff.save": {
        requireAccess(actor.role==="owner");
        const data = z.object({ name:z.string().trim().min(2).max(120),email:z.email().max(200).transform(value=>value.toLowerCase()),
          role:z.enum(roles),permissions:z.array(z.enum(permissions)).max(20),active:z.boolean() }).parse(input.document);
        const id = input.id ? provided(input) : null;
        let saved = id;
        if (id) {
          await client.query("LOCK TABLE staff IN SHARE ROW EXCLUSIVE MODE");
          const {rows:[prior]} = await client.query("SELECT * FROM staff WHERE id=$1 FOR UPDATE",[id]);
          if (!prior) throw new WorkspaceError("User not found.",404);
          if (prior.email !== data.email) throw new WorkspaceError("Email is fixed after account creation. Add a new user to use a different email.");
          if (actor.id===id && (!data.active || data.role!=="owner")) throw new WorkspaceError("Ask the other Administrator to change your account access.");
          await client.query("UPDATE staff SET name=$2,role=$3,permissions=$4,active=$5 WHERE id=$1",[id,data.name,data.role,data.permissions,data.active]);
        } else {
          const {rows:[row]} = await client.query("INSERT INTO staff(name,email,role,permissions,active) VALUES($1,$2,$3,$4,$5) RETURNING id",[data.name,data.email,data.role,data.permissions,data.active]);
          saved=row.id;
        }
        await audit(client,actor,{entity:"User",id:saved!,action:id?"User access updated":"User access created",scope:"admin",detail:data});
        return {id:saved};
      }
      default: throw new WorkspaceError("Action not found.",404);
    }
  });
}

export async function olderActivity(actor: Staff, before: string) {
  const cursor = z.string().regex(/^\d{1,19}$/).parse(before);
  const scopes = (["project","commercial","purchasing","admin"] as const).filter(scope=>scopeAllowed(actor,scope));
  const { rows } = await db().query(`
    SELECT l.id,l.opportunity_id,l.actor_name,l.action,l.entity_type,l.detail,l.created_at
    FROM audit_log l LEFT JOIN opportunities o ON o.id=l.opportunity_id
    WHERE l.id<$1 AND l.visibility=ANY($2::text[])
    AND ((l.opportunity_id IS NULL AND $3) OR (o.id IS NOT NULL AND
      ($4 OR o.owner_id=$5 OR EXISTS (SELECT 1 FROM opportunity_access a WHERE a.opportunity_id=o.id AND a.staff_id=$5))))
    ORDER BY l.id DESC LIMIT 150`,[cursor,scopes,actor.role==="owner",can(actor,"sales_all"),actor.id]);
  return rows;
}
