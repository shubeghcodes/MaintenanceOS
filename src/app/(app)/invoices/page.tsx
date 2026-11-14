import Link from "next/link";
import { FileText } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getCompanyScope, getReceiptsToReview } from "@/lib/company";
import { getLookups } from "@/lib/data";
import { INVOICE_LABEL, INVOICE_TONE } from "@/lib/constants";
import { fmtDate, fmtMoney } from "@/lib/format";
import { ARCHIVE_TYPE_LABEL, loadInvoiceArchive } from "@/lib/invoice-archive";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import { Badge, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

/** Analytics → Invoices: every vendor invoice and invoice / vendor-receipt file, kept for review. Admins only (GMs never see vendor money). */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const scope = await getCompanyScope();
  const [rows, { sites }, { data: vendors }, reviewCount] = await Promise.all([
    loadInvoiceArchive(supabase, { ...sp, company: scope.companyId }),
    getLookups(supabase),
    supabase.from("vendors").select("id,name").order("name"),
    getReceiptsToReview(),
  ]);

  const invoices = rows.filter((r) => r.type === "vendor_invoice");
  // Latest version per work order + invoice # counts toward the total (revisions replace earlier ones).
  const latest = new Map<string, (typeof rows)[number]>();
  invoices.forEach((r) => {
    const k = `${r.wo?.id}|${r.number}`;
    if (!latest.has(k) || (latest.get(k)!.version ?? 0) < (r.version ?? 0)) latest.set(k, r);
  });
  const current = [...latest.values()].filter((r) => r.status !== "rejected");
  const missing = invoices.filter((r) => !r.file).length;
  const range = sp.from || sp.to ? `${sp.from ? fmtDate(sp.from) : "Start"} – ${sp.to ? fmtDate(sp.to) : "today"}` : "All dates";
  const filtered = Object.entries(sp).some(([k, v]) => v && ["q", "site", "vendor", "from", "to", "type", "status"].includes(k));

  return (
    <>
      <PageHeader title="Analytics" subtitle={`Invoice archive · ${range}`} />
      <AnalyticsTabs active="invoices" reviewCount={reviewCount} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Files on record" value={rows.filter((r) => r.file).length} sub={`${rows.length} items listed`} />
        <Stat label="Vendor invoices" value={fmtMoney(current.reduce((s, r) => s + Number(r.amount ?? 0), 0))} sub={`${current.length} current (revisions counted once)`} />
        <Stat label="Unpaid" value={fmtMoney(current.filter((r) => r.status !== "paid").reduce((s, r) => s + Number(r.amount ?? 0), 0))} sub="Submitted, in review or approved" />
        <Stat label="Invoices without a file" value={missing} tone={missing ? "warning" : "good"} sub="Vendor typed it in, no picture" />
      </div>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2 p-4">
          <Input name="q" placeholder="Vendor, invoice #, WO #, store" defaultValue={sp.q} className="w-56" />
          <Select name="type" defaultValue={sp.type ?? ""} className="w-44">
            <option value="">All types</option>
            {Object.entries(ARCHIVE_TYPE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select name="site" defaultValue={sp.site ?? ""} className="w-40">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="vendor" defaultValue={sp.vendor ?? ""} className="w-44">
            <option value="">All vendors</option>
            {((vendors ?? []) as { id: string; name: string }[]).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-40">
            <option value="">Any status</option>
            {(["submitted", "under_review", "approved", "rejected", "paid"] as const).map((k) => (
              <option key={k} value={k}>
                {INVOICE_LABEL[k]}
              </option>
            ))}
          </Select>
          <label className="text-xs text-slate-500">
            From
            <Input type="date" name="from" defaultValue={sp.from} className="mt-1 w-40" />
          </label>
          <label className="text-xs text-slate-500">
            To
            <Input type="date" name="to" defaultValue={sp.to} className="mt-1 w-40" />
          </label>
          <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Filter</button>
          {filtered && (
            <ButtonLink href="/invoices" variant="ghost" size="sm">
              Clear
            </ButtonLink>
          )}
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No invoices match.">Vendor invoices land here when vendors submit them from their link, along with any invoice files uploaded on a work order.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Date</Th>
                <Th>Vendor · invoice #</Th>
                <Th>Work order</Th>
                <Th className="text-right">Amount</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <Td className="w-24">
                    {r.file?.url ? (
                      <a href={r.file.url} target="_blank" rel="noreferrer" title={`Open ${r.file.name}`} className="block">
                        {r.file.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.file.url} alt={r.file.name} loading="lazy" className="h-16 w-16 rounded-md object-cover ring-1 ring-slate-200 hover:ring-brand-500" />
                        ) : (
                          <span className="flex h-16 w-16 flex-col items-center justify-center rounded-md bg-slate-50 text-[10px] font-medium text-brand-700 ring-1 ring-slate-200 hover:ring-brand-500">
                            <FileText className="mb-1 h-5 w-5" aria-hidden />
                            {r.file.name.split(".").pop()?.toUpperCase() ?? "FILE"}
                          </span>
                        )}
                      </a>
                    ) : (
                      <span className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-amber-300 text-center text-[10px] text-amber-700">No file</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {fmtDate(r.date)}
                    <div className="text-slate-500">{ARCHIVE_TYPE_LABEL[r.type]}</div>
                  </Td>
                  <Td className="text-xs">
                    <div className="font-medium text-slate-900">{r.vendor ?? "—"}</div>
                    {r.number && (
                      <div className="text-slate-600">
                        #{r.number}
                        {r.version && r.version > 1 && <span className="text-slate-400"> · revision {r.version}</span>}
                      </div>
                    )}
                    {r.by && <div className="text-slate-400">by {r.by}</div>}
                  </Td>
                  <Td className="text-xs">
                    {r.wo ? (
                      <>
                        <Link href={`/work-orders/${r.wo.id}`} className="font-medium text-brand-700 hover:underline">
                          #{r.wo.number}
                        </Link>{" "}
                        {r.wo.title}
                        <div className="text-slate-500">{r.wo.site?.code ?? r.wo.site?.name}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right text-xs tabular-nums">{r.amount != null ? fmtMoney(r.amount, 2) : "—"}</Td>
                  <Td>{r.status ? <Badge tone={INVOICE_TONE[r.status]}>{INVOICE_LABEL[r.status]}</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Click a picture to open the full file. Work-order parts receipts and store supplies are under{" "}
        <Link href="/purchases" className="text-brand-700 hover:underline">
          Purchases
        </Link>
        . Work orders with invoices or receipts can’t be deleted, so these records stay on file.
      </p>
    </>
  );
}
