import { z } from "zod";
import Decimal from "decimal.js";

Decimal.set({ precision: 48 });
export const stages = ["Enquiry", "Qualified", "Scoping", "Quotation sent", "Negotiation", "Won", "Lost", "On hold"] as const;
export const projectStages = ["Awaiting client PO", "Confirmed", "In production", "Installation", "Live", "Dismantling / Handover", "Completed"] as const;
export const permissions = ["quote_write", "quote_issue", "quote_remove", "po_view", "po_write", "po_issue", "sales_all", "project_write", "library_manage", "cost_view", "cost_write"] as const;
export const pageTypes = ["Opener", "Cover", "Confidentiality", "Contacts", "Project details", "Scope", "Visual", "Responsibilities", "Pricing", "Terms", "Payment terms", "Closing"] as const;
export const roles = ["owner","bd","sales","engineering"] as const;
export type Role = typeof roles[number];
export type Staff = { id: string; email: string; name: string; role: Role; active: boolean; permissions: string[] };
export type Capability = typeof permissions[number];
export type Scope = "project" | "commercial" | "purchasing" | "admin";
export const uuid = z.string().uuid();
export const day = z.iso.date();
const text = z.string().max(5000);
const title = z.string().trim().min(1).max(200);
export const rate = z.string().regex(/^\d{1,9}(\.\d{1,4})?$/, "Enter a positive decimal with up to four decimal places.");
export const tax = rate.refine(value => new Decimal(value).lte(100), "VAT must be between 0 and 100.");
const item = z.object({ id: uuid, description: title, quantity: rate.refine(value => new Decimal(value).gt(0)), rate, vat: tax });
const items = z.array(item).min(1).max(50);
const group = z.object({ id: uuid, name: title, items });
const page = z.object({ id: uuid, type: z.enum(pageTypes), title: text, body: text, optionId: uuid.or(z.literal("")), imageId: uuid.or(z.literal("")), caption: text });
const unique = (rows: {id: string}[]) => new Set(rows.map(row => row.id)).size === rows.length;
export const quoteSchema = z.object({
  title, client: title, clientContact: text, venue: text, kind: z.enum(["Rental","Permanent","Supply"]),
  eventStart: day.or(z.literal("")), eventEnd: day.or(z.literal("")), installation: text, leadTime: text,
  validity: z.number().int().min(1).max(365), payment: text, mode: z.enum(["package", "alternatives"]),
  options: z.array(group).min(1).max(12), addons: z.array(group).max(12), pages: z.array(page).min(1).max(60),
}).superRefine((doc, ctx) => {
  if (!unique([...doc.options, ...doc.addons]) || !unique(doc.pages)) ctx.addIssue({code: "custom", message: "Pages and options must have unique IDs."});
  if ((doc.mode === "package" && doc.options.length !== 1) || (doc.mode === "alternatives" && doc.options.length < 2)) ctx.addIssue({code: "custom", message: "A package needs one price group. Alternatives need at least two."});
  if (doc.pages.some(page => page.optionId && !doc.options.some(option => option.id === page.optionId))) ctx.addIssue({code: "custom", message: "A page references a missing option."});
  if (doc.eventEnd && (!doc.eventStart || doc.eventEnd < doc.eventStart)) ctx.addIssue({code: "custom", message: "Check event dates."});
});
export const orderSchema = z.object({
  supplier: title, contact: text, title, scope: text, location: text,
  delivery: day.or(z.literal("")), terms: text, items,
});
export const opportunitySchema = z.object({
  client: title, title, contact: text, venue: text, event_start: day.or(z.literal("")), event_end: day.or(z.literal("")),
  value: rate, stage: z.enum(stages), next_action: text, follow_up: day.or(z.literal("")),
  owner_id: uuid.optional(), assigned: z.array(uuid).max(30).optional()
}).refine(row => !row.event_end || (row.event_start && row.event_end >= row.event_start), "Check event dates.");
export type QuoteDocument = z.infer<typeof quoteSchema>;
export type OrderDocument = z.infer<typeof orderSchema>;
export type Item = z.infer<typeof item>;
export type Opportunity = {
  id: string; client: string; title: string; contact: string; venue: string; owner_id: string; owner_name: string;
  event_start: string | null; event_end: string | null; value: string | null; stage: typeof stages[number];
  next_action: string; follow_up: string | null; project_status: string | null; project_note: string; technical_scope: string; installation_date: string | null; next_milestone: string; milestone_date: string | null;
  award_reference: string | null; awarded_option: string | null; updated_at: string; updated_name: string; assigned: string[];
};
export type Revision = { id: string; quotation_id: string; opportunity_id: string; version: number; state: string; reference: string | null; issue_date: string | null; expires: string | null; pdf_id: string | null; document: QuoteDocument; lock_version: number; updated_at: string; updated_name: string };
export type Order = { id: string; opportunity_id: string; state: string; reference: string | null; award_reference: string; pdf_id: string | null; issued_at: string | null; document: OrderDocument; lock_version: number; updated_name: string; updated_at: string };
export type Attachment = { id: string; opportunity_id: string; filename: string; content_type: string; size_bytes: number; visibility: Scope };
export type Audit = { id: string; opportunity_id: string | null; actor_name: string; action: string; entity_type: string; detail: Record<string, unknown>; created_at: string };
export const libraryCategories = ["Interactive experience", "AV & display", "Kiosk & hologram", "Fabrication", "Production services", "Other"] as const;
export const librarySchema = z.object({
  title, category: z.enum(libraryCategories), scope: text, siteRequirements: text, exclusions: text, terms: text,
  imageCaption: z.string().max(200), rate: rate.or(z.literal("")), vat: tax,
}).refine(doc=>Boolean(doc.scope.trim()||doc.siteRequirements.trim()||doc.exclusions.trim()||doc.terms.trim()||doc.rate),
  "Add reusable content or a default price.");
export type LibraryDocument = z.infer<typeof librarySchema>;
export type LibraryEntry = { id: string; document: LibraryDocument; archived: boolean; has_image: boolean; lock_version: number; updated_name: string };

export const costCategories = ["EIS equipment", "Supplier AV", "Fabrication", "Labour", "Transport", "Contingency", "Other"] as const;
export const costLinesSchema = z.array(z.object({
  id: uuid, description: title, category: z.enum(costCategories), source: z.enum(["Internal","Supplier"]),
  quantity: rate.refine(value=>new Decimal(value).gt(0)), rate,
})).max(100).refine(unique, "Cost lines must have unique IDs.");
export type CostLine = z.infer<typeof costLinesSchema>[number];
export type CostPlan = { revision_id: string; group_id: string; lines: CostLine[]; lock_version: number; updated_name: string };
export type AwardedCosts = { revisionId: string; optionId: string; addonIds: string[]; committed: string; orderCount: number };

export type Workspace = { actor: Staff; staff: Staff[]; opportunities: Opportunity[]; revisions: Revision[]; orders: Order[]; files: Attachment[]; audit: Audit[]; library: LibraryEntry[]; costPlans: CostPlan[]; awardedCosts: AwardedCosts[]; today: string };

export const roleName: Record<Role, string> = { owner: "Administrator", bd: "Senior Business Development Manager", sales: "Sales Manager", engineering: "Engineering" };
export const can = (user: Staff, capability: Capability) => user.role === "owner" || user.permissions.includes(capability) || (capability === "sales_all" && user.role === "bd");
export const canSeeCommercial = (user: Staff) => user.role !== "engineering" || can(user, "sales_all") || can(user, "quote_write") || can(user, "quote_issue") || can(user, "quote_remove");
export const canSeePurchasing = (user: Staff) => can(user, "po_view") || can(user, "po_write") || can(user, "po_issue");
export const canUseLibrary = (user: Staff) => can(user,"quote_write") || can(user,"library_manage");
export const canSeeCosting = (user: Staff) => canSeeCommercial(user) && (can(user,"cost_view") || can(user,"cost_write"));
export const scopeAllowed = (user: Staff, scope: Scope) =>
  scope === "project" || (scope === "commercial" && canSeeCommercial(user)) || (scope === "purchasing" && canSeePurchasing(user)) || (scope === "admin" && user.role === "owner");
export const isSales = (user: Staff) => user.role !== "engineering" || can(user, "sales_all");
export const riyadhDay = (date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
export const money = (value: Decimal.Value) => {
  const number = new Decimal(value);
  const digits = Math.max(2, number.decimalPlaces());
  const [whole, fraction] = number.toFixed(digits).split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
};
export const lineNet = (row: Item) => new Decimal(row.quantity || 0).mul(row.rate || 0);
export function totals(items: Item[]) {
  return items.reduce((sum, row) => {
    const net = lineNet(row);
    const vat = net.mul(row.vat || 0).div(100);
    return { net: sum.net.plus(net), vat: sum.vat.plus(vat), total: sum.total.plus(net).plus(vat) };
  }, { net: new Decimal(0), vat: new Decimal(0), total: new Decimal(0) });
}
export const makeItem = (): Item => ({ id: crypto.randomUUID(), description: "", quantity: "1", rate: "0", vat: "15" });
export function blankQuote(row: Opportunity): QuoteDocument {
  return {
    title: row.title, client: row.client, clientContact: row.contact, venue: row.venue, kind: "Rental",
    eventStart: row.event_start ?? "", eventEnd: row.event_end ?? "", installation: "TBD", leadTime: "30 days",
    validity: 7, payment: "70% advance upon PO\n30% after installation completion", mode: "package",
    options: [{ id: crypto.randomUUID(), name: "Package", items: [{ ...makeItem(), description: row.title, rate: row.value ?? "0" }] }],
    addons: [],
    pages: pageTypes.filter(type => type !== "Visual").map(type => ({
      id: crypto.randomUUID(), type, title: "", optionId: "", imageId: "", caption: "",
      body: type === "Confidentiality" ? "This commercial offer contains confidential information prepared by Event Innovation Systems for the named client." : type === "Terms" ? "All prices are in Saudi Riyals. Changes to the approved scope are subject to written agreement." : "",
    })),
  };
}
export const displayDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", year: "numeric" }).format(new Date(value.length === 10 ? value + "T12:00:00Z" : value))
  : "—";

export const displayTimestamp = (value: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Riyadh", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));

export function costSummary(lines: CostLine[], sell: Decimal.Value) {
  const net = new Decimal(sell);
  const estimated = lines.reduce((sum,line)=>sum.plus(lineNet({...line,vat:"0"})),new Decimal(0));
  const supplier = lines.filter(line=>line.source==="Supplier").reduce((sum,line)=>sum.plus(lineNet({...line,vat:"0"})),new Decimal(0));
  const profit = net.minus(estimated);
  return { net, estimated, supplier, profit, margin: net.gt(0) ? profit.div(net).times(100) : null };
}
