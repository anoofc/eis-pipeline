import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running this command.");
const operation = process.argv[2];
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  if (operation === "migrate") {
    await client.query("SELECT pg_advisory_xact_lock(318455148)");
    const directory = new URL("../sql/", import.meta.url);
    for (const file of (await readdir(directory)).filter(name=>/^\d{3}-.*\.sql$/.test(name)).sort()) {
      await client.query(await readFile(new URL(file,directory),"utf8"));
    }
  } else if (operation === "owners") {
    const emails = [process.env.EIS_ANOOF_EMAIL,process.env.EIS_GM_EMAIL].map(value=>value?.trim().toLowerCase());
    if (emails.some(value=>!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || emails[0]===emails[1]) {
      throw new Error("Set distinct EIS_ANOOF_EMAIL and EIS_GM_EMAIL values.");
    }
    for (const [index,email] of emails.entries()) {
      const name = index===0 ? "Anoof Chappangathil" : process.env.EIS_GM_NAME || "General Manager";
      await client.query(`INSERT INTO staff(name,email,role) VALUES($1,$2,'owner')
        ON CONFLICT(email) DO NOTHING`,[name,email]);
      const {rows:[staff]}=await client.query("SELECT role,active FROM staff WHERE email=$1",[email]);
      if(staff?.role!=="owner"||!staff.active)throw new Error("An owner email is already registered with different access.");
    }
  } else if (operation === "demo") {
    if (process.env.EIS_LOCAL_DEMO!=="1" || process.env.NODE_ENV==="production") throw new Error("Demo data requires explicit local demo mode.");
    const {rows:[owner]}=await client.query(`INSERT INTO staff(id,name,email,role)
      VALUES('17db37ee-a0d6-43bf-a9ab-e1c818a0a1bb','Anoof Chappangathil','anoof@example.test','owner')
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
    for(const [name,email,role] of [
      ["General Manager","gm@example.test","owner"],["Business Development","bd@example.test","bd"],
      ["Sales Manager","sales@example.test","sales"],["Project Engineer","engineer@example.test","engineering"],
    ]) await client.query("INSERT INTO staff(name,email,role) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING",[name,email,role]);
    const records=[
      ["390e3fb8-b8c5-4ca1-8ad4-5e685535bb61","Expo Client A","Interactive exhibition booth","Riyadh Front","2026-12-21","43600","Scoping","Confirm booth footprint","2026-11-17"],
      ["f975a67c-15cd-4dab-a741-5a2d138dfd93","Events Client B","Portrait photobooth","Riyadh","2026-12-16","18360","Quotation sent","Confirm print quantities","2026-11-20"],
      ["7a95635b-af67-4dcf-9f62-c9addbd82c23","Activation Client C","Registration kiosks","Riyadh","2026-12-10","22750","Qualified","Check loading access","2026-11-21"],
      ["34cb6e41-2488-4dfd-bc11-6d64751220ce","Experience Client D","Interactive LED games","Riyadh","2027-01-04","35740","Negotiation","Review technical scope","2026-11-10"],
      ["ce2f09cf-f17b-4d43-8911-cc20ad8f2ea9","Expo Client E","HoloTube rental","Riyadh","2026-12-28","16930","Enquiry","Set up briefing","2026-11-22"],
    ];
    for(const row of records) await client.query(`INSERT INTO opportunities(id,client,title,venue,event_start,value,stage,next_action,follow_up,owner_id,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT(id) DO NOTHING`,[...row,owner.id]);
    const offerings = [
      ["7499f30a-3503-4cab-ba6f-9a352ab3a6a9","Interactive LED floor","Interactive experience",
        "Supply and integrate an interactive floor using modular LED tiles. Configure playable zones, scoring, and session reset for the event.",
        "Confirm footprint, power points, access for equipment, and the managed visitor queue."],
      ["7499f30a-3503-4cab-ba6f-9a352ab3a6aa","Registration kiosk","Kiosk & hologram",
        "Supply and commission a freestanding registration kiosk with a touch display. Confirm screen size, enclosure finish, and unit quantity.",
        "Provide power at each kiosk location, registration software access, and internet connectivity."],
      ["7499f30a-3503-4cab-ba6f-9a352ab3a6ab","Exhibition booth","Fabrication",
        "Fabricate, install, and dismantle an exhibition booth based on the approved layout and finishes.",
        "Confirm the venue access window, power allocation, booth dimensions, and organizer approvals."],
      ["7499f30a-3503-4cab-ba6f-9a352ab3a6ac","Portrait photobooth","Interactive experience",
        "Supply and operate an event photobooth. Confirm the capture workflow, backdrop, lighting, and delivery format before production.",
        "Provide a level floor, power, load-in access, and a suitable visitor queue area."],
    ];
    for (const [id,title,category,scope,siteRequirements] of offerings) {
      await client.query("INSERT INTO quotation_library(id,document,updated_by) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING",
        [id,{title,category,scope,siteRequirements,exclusions:"",terms:"",imageCaption:"",rate:"",vat:"15"},owner.id]);
    }
  } else throw new Error("Expected migrate, owners, or demo.");
  await client.query("COMMIT");
  console.log(operation+" complete.");
} catch(error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
