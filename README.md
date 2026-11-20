# EIS Pipeline and Quotation Manager

Phase 1 covers opportunities, project delivery, native quotation authoring and revisions, supplier purchase orders, and access administration. Quotation numbers use Riyadh business dates. Amounts use decimal arithmetic and preserve fractional values. The UI and PDF renderer use the supplied EIS branding.

## Local development

Install Node 24, then run these commands from the project directory:

```sh
npm ci
npx playwright install chromium
npm run demo
```

Open http://127.0.0.1:3000. The demo command starts its own local PostgreSQL on an available loopback port, runs the schema and seed, and starts Next.js. A fresh launch does not need Docker, a separate PostgreSQL installation, or a manually set database URL. The browser install is only needed once for PDF export. Set `CHROMIUM_PATH` if using a system Chromium.

Stop the demo with Ctrl+C. Data and files persist under `.eis-data/local-demo`. Use `npm run demo -- -p 3001` if the web port is already in use. Set `EIS_DEMO_DB_PORT` only if you need a specific PostgreSQL port. The demo uses a development-only identity and fictional seed records. `EIS_DEMO_EMAIL` can select another seeded role.

If you already have a separate local PostgreSQL database you want to keep using, start that database, set `DATABASE_URL` with its real credentials, and run `EIS_LOCAL_DEMO=1 npm run db:migrate`, `EIS_LOCAL_DEMO=1 npm run db:demo`, and `EIS_LOCAL_DEMO=1 npm run dev`. The automatic demo uses its own database directory and does not migrate records from a separate database. Production builds require real authentication and S3 credentials.

## Production wiring

1. Copy `.env.example` to `.env` on the target system. Keep it out of version control. Set a real database password and the HTTPS app origin.
2. Create a private S3-compatible bucket. Provide deployment credentials scoped to that bucket. The app authenticates each download and sends assets privately.
3. Configure Supabase Auth with email/password and TOTP. Disable public signup and provision confirmed staff identities in the managed Auth system. Use **Users & access** in the EIS app to set record visibility and permissions for the matching work email. The app requires TOTP for all roles. Managed credentials and MFA recovery are administered in the identity provider.
4. Set `EIS_ANOOF_EMAIL` and `EIS_GM_EMAIL` to the verified work identities. Run the database migration and bootstrap the two full-access accounts.

```sh
docker compose up -d postgres
docker compose run --rm app node scripts/database.mjs migrate
docker compose run --rm app node scripts/database.mjs owners
docker compose up -d app
```

The Compose example binds to loopback for an HTTPS reverse proxy. Configure its upload limit to at least 26 MB for app attachments. Production cloud services can instead connect the same image to a managed PostgreSQL endpoint. Run the migration with schema-owner credentials, and grant the runtime role only the specific database operations it needs. Keep the database and bucket private. Deployment needs an approved host, domain or HTTPS endpoint, verified staff identities, and credentials.

Both quotation and supplier order issue requests save the final Chromium PDF before marking a record issued. This first implementation renders in the issue request. Run one or more long-lived app instances with suitable request timeouts, and test a representative large quotation before rollout.

## Recovery and release checks

Back up PostgreSQL and the private bucket independently. Restore them into an isolated environment and verify that the recorded award, exact quotation revision, and issued PDFs all open. Restrict backup access as you would production. The Oracle pilot and Dammam production hosting arrangements are provisioned separately from this source package.

Run `npm run check` and `npm run build` after source changes. For a production-like localhost check of the build, use `npm start` with managed authentication and private storage configured.

## Phase 2 · Quotation library and costing

Back up the workspace database and attachments before upgrading a pilot installation. Apply all numbered SQL migrations with `npm run db:migrate` before starting the upgraded app. The local demo runs migrations on startup. If you extract the upgrade into a new folder and want to retain records from a previous local demo, stop the old demo and copy its entire `.eis-data/local-demo` directory into the new project folder before starting it.

- **Quotation library.** Administrators, and users granted library management, can create, edit, archive, and restore offerings. Save an entry before uploading its visual. A quotation writer can add an active offering to a saved draft. The draft receives independent copies of text, the visual, and any selected default selling price. The demo includes four editable example offerings.
- **Costing.** Administrators can view and edit costs. To delegate costing, grant cost view or cost edit to someone who already has access to the quotation. Cost estimates are per option or add-on and are stored separately from client-facing quotation data. Save the quotation itself before saving estimates. Issued estimates are read-only and carried forward to a new revision.
- **Awarded projects.** The costing view compares supplier estimates for the accepted option and add-ons against issued supplier PO commitments for that revision, before VAT. This reports committed spend from POs.
