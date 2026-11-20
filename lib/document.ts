import { displayDate, lineNet, money, totals, type Item, type OrderDocument, type QuoteDocument } from "./model";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, match =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[match]!);
const text = (value: string) => escape(value).replace(/\n/g, "<br>");
const block = (title: string, body: string) => body ? `<h2>${escape(title)}</h2><p>${text(body)}</p>` : "";
const details = (rows: Array<[string, string]>) => `<dl>${rows.map(([label,value]) =>
  `<div><dt>${escape(label)}</dt><dd>${escape(value || "TBD")}</dd></div>`).join("")}</dl>`;

type Assets = { logo: string; font: (weight: string) => string; image: (id: string) => string; placeholder?: boolean };
export const browserAssets: Assets = {
  logo: "/brand/eis-black.png",
  font: weight => `/brand/HelveticaNowDisplay-${weight}.woff2`,
  image: id => `/api/files/${encodeURIComponent(id)}?inline=1`, placeholder: true,
};
function css(assets: Assets, pageWidth: number, pageHeight: number) {
  const fonts = Object.entries({ Light: 300, Regular: 400, Medium: 500, Bold: 700, ExtraBold: 800 })
    .map(([name, weight]) => `@font-face{font-family:EIS;src:url("${assets.font(name)}") format("woff2");font-weight:${weight}}`).join("");
  return `${fonts}
    *{box-sizing:border-box;letter-spacing:.03em}
    @page{size:${pageWidth}px ${pageHeight}px;margin:0}
    body{margin:0;background:#e8e9ed;color:#171a21;font:400 21px EIS,Arial,sans-serif;letter-spacing:.03em}
    .sheet{position:relative;overflow:hidden;width:${pageWidth}px;height:${pageHeight}px;margin:0 auto 18px;background:white;isolation:isolate}
    .sheet:before,.sheet:after{position:absolute;content:"";border-radius:50%;z-index:-1;pointer-events:none}
    .sheet:before{width:430px;height:430px;right:-225px;top:-270px;border:23px solid #e5e6e8;box-shadow:0 0 0 31px #f4f4f5}
    .sheet:after{width:225px;height:225px;bottom:-170px;left:-120px;border:28px solid #ececef}
    .pagebody{position:absolute;inset:66px 75px 78px;overflow:hidden}
    .sheet.order .pagebody{inset:55px 55px 72px}
    .identity{position:absolute;right:70px;bottom:31px;display:flex;align-items:center;gap:20px;color:#767b83;font-size:13px}
    .order .identity{right:55px}
    .identity img{width:69px;height:auto}
    h1,h2,h3,p{margin:0}
    h1,h2,h3{font-weight:800;letter-spacing:normal}
    h1{font-size:43px;line-height:1.08;margin:0 0 24px;overflow-wrap:anywhere}
    h2{font-size:25px;margin:0 0 12px}
    p{line-height:1.48;overflow-wrap:anywhere}
    p + h2,dl + h2{margin-top:24px}
    .eyebrow{font-size:15px;text-transform:uppercase;color:#696d76;font-weight:700;margin-bottom:13px}
    .center{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:20px}
    .center .mark{width:270px;height:auto}
    .cover h1{max-width:850px;font-size:54px;margin:0}
    .cover p{color:#676b74}
    figure{margin:0;display:flex;min-height:0;flex-direction:column;align-items:center}
    figure img{width:100%;height:100%;object-fit:contain;min-height:0}
    figcaption{font-size:13px;margin-top:8px;text-align:center}
    .split{display:grid;grid-template-columns:1.05fr 1fr;gap:42px;height:340px}
    .large-image{height:420px}
    .large-image figure{height:100%}
    figure{overflow:hidden}
    dl{margin:0 0 19px}
    dl div{display:grid;grid-template-columns:230px 1fr;padding:10px 0;border-bottom:1px solid #e3e5e8}
    dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;font-size:17px;line-height:1.23}
    th,td{text-align:right;padding:8px 10px;border-bottom:1px solid #dfe2e7;vertical-align:top}
    th:first-child,td:first-child{text-align:left;overflow-wrap:anywhere}
    th{background:#f0f1f4;font-weight:700}
    td:not(:first-child){white-space:nowrap}
    .totals{margin:12px 0 0 auto;width:390px;font-size:17px}
    .totals div{grid-template-columns:1fr auto;gap:15px;padding:6px 0}
    .totals dt{font-weight:500}
    .order{font-size:17px}
    .order .intro{white-space:normal}
    .order h1{font-size:39px}
    .order dl div{grid-template-columns:160px 1fr}
    .order table{font-size:15px}
    .order .totals div{grid-template-columns:1fr auto}
    @media print{body{background:white;print-color-adjust:exact}.sheet{margin:0;break-after:page}.sheet:last-child{break-after:auto}}
    @media screen{body{padding:12px 0}}
  `;
}
function render(sheets: Array<string | {content:string;id:string}>, ref: string, assets: Assets, order = false) {
  const [width, height] = order ? [794,1123] : [1280,720];
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(ref)}</title><style>${css(assets,width,height)}</style><body>${
    sheets.map((sheet,index) => `<section class="sheet ${order ? "order" : ""}" data-source="${typeof sheet==="string"?"":escape(sheet.id)}"><div class="pagebody">${typeof sheet==="string"?sheet:sheet.content}</div><footer class="identity">${escape(ref)} · ${index+1}/${sheets.length}<img src="${assets.logo}" alt="EIS"></footer></section>`).join("")
  }</body></html>`;
}
function priceTable(rows: Item[], all: Item[] | null) {
  const amounts = all ? totals(all) : null;
  return `<table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>VAT %</th><th>Amount</th></tr></thead><tbody>${rows.map(row =>
    `<tr><td>${escape(row.description || "Item")}</td><td>${escape(row.quantity)}</td><td>${money(row.rate || 0)}</td><td>${escape(row.vat)}</td><td>${money(lineNet(row))}</td></tr>`).join("")}</tbody></table>${
    amounts ? `<dl class="totals"><div><dt>Subtotal before VAT</dt><dd>${money(amounts.net)} SAR</dd></div><div><dt>VAT</dt><dd>${money(amounts.vat)} SAR</dd></div><div><dt>Total including VAT</dt><dd><strong>${money(amounts.total)} SAR</strong></dd></div></dl>` : ""
  }`;
}
function pricing(title: string, items: Item[], label: string, perPage: number) {
  const pages = [];
  for (let i=0; i<items.length; i+=perPage) {
    const last = i + perPage >= items.length;
    pages.push(`<p class="eyebrow">${escape(label)}</p><h1>${escape(title)}${i ? " (continued)" : ""}</h1>${priceTable(items.slice(i, i+perPage), last ? items : null)}`);
  }
  return pages;
}
export function quoteHtml(doc: QuoteDocument, ref: string, issued: string | null, assets = browserAssets) {
  const date = issued ? displayDate(issued) : "Draft";
  const renderPage = (page: QuoteDocument["pages"][number]): string[] => {
    const option = doc.options.find(option => option.id === page.optionId);
    const title = escape(page.title || page.type);
    const heading = `${option ? `<p class="eyebrow">${escape(option.name)}</p>` : ""}<h1>${title}</h1>`;
    const figure = page.imageId ? `<figure><img src="${assets.image(page.imageId)}" alt=""><figcaption>${escape(page.caption)}</figcaption></figure>` : "";
    switch (page.type) {
      case "Opener": return [`<div class="center"><img class="mark" src="${assets.logo}" alt="EIS"></div>`];
      case "Cover": return [`<div class="center cover"><p class="eyebrow">Commercial offer</p><h1>${escape(doc.title)}</h1><p>Prepared for ${escape(doc.client)}<br>${date}</p></div>`];
      case "Contacts": return [heading + details([["Client",doc.client],["Client contact",doc.clientContact],["Prepared by","Event Innovation Systems"],["Location","Riyadh, Saudi Arabia"]]) + (page.body ? `<p>${text(page.body)}</p>` : "")];
      case "Project details": return [heading + details([["Quotation reference",ref],["Project type",doc.kind],["Venue",doc.venue],["Event dates",[doc.eventStart,doc.eventEnd].filter(Boolean).map(displayDate).join(" – ")],["Installation",doc.installation],["Lead time",doc.leadTime],["Validity",doc.validity + " days"]])];
      case "Pricing": {
        const groups = option ? [option] : [...doc.options, ...doc.addons];
        return groups.flatMap(group => pricing(group.name, group.items, doc.addons.includes(group) ? "Optional add-on · SAR" : "Commercial pricing · SAR", 7));
      }
      case "Scope": return [heading + (figure ?
        `<div class="split"><p>${text(page.body)}</p>${figure}</div>` : `<p>${text(page.body)}</p>`)];
      case "Visual": return [heading + `<div class="large-image">${figure}</div>`];
      case "Payment terms": return [heading + `<p>${text(doc.payment)}</p>`];
      case "Closing": return [`<div class="center cover"><h1>${escape(page.title || "Thank you")}</h1><p>${text(page.body || "Event Innovation Systems\nRiyadh, Saudi Arabia")}</p></div>`];
      default: return [heading + `<p>${text(page.body)}</p>`];
    }
  };
  const sheets = doc.pages.flatMap(page=>renderPage(page).map(content=>({content,id:page.id})));
  return render(sheets, ref, assets);
}
export function supplierHtml(doc: OrderDocument, ref: string, date: string | null, assets = browserAssets) {
  const intro = `<p class="eyebrow">Event Innovation Systems</p><h1>Supplier Purchase Order</h1>${details([
    ["PO reference",ref],["Issue date",date ? displayDate(date) : "Draft"],["Supplier",doc.supplier],
    ["Supplier contact",doc.contact],["Order",doc.title],["Delivery location",doc.location],["Delivery date",doc.delivery ? displayDate(doc.delivery) : "TBD"],
  ])}${block("Scope of supply",doc.scope)}${block("Payment terms",doc.terms)}`;
  return render([intro, ...pricing(doc.title, doc.items, "Supplier pricing · SAR", 18)], ref, assets, true);
}
