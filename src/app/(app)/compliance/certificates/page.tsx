import { getCompanyScope } from "@/lib/company";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { loadCertificates, type CertRow } from "@/lib/certificates";
import { fmtDate } from "@/lib/format";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";
import { ComplianceTabs } from "../ComplianceTabs";

export const metadata = { title: "Compliance certificates" };
export const dynamic = "force-dynamic";

const STATUS: Record<CertRow["status"], [string, "good" | "warning" | "critical" | "muted"]> = {
  current: ["Current", "good"],
  expiring: ["Expiring ≤ 30 days", "warning"],
  expired: ["Expired", "critical"],
  failed: ["Failed — needs follow-up", "critical"],
  superseded: ["Superseded", "muted"],
};

export default async function CertificatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await getSession();
  const [{ sites }, rows] = await Promise.all([getLookups(supabase), loadCertificates(supabase, { ...sp, company: (await getCompanyScope()).companyId })]);
  const counts = { current: 0, expiring: 0, expired: 0, failed: 0, superseded: 0 };
  rows.forEach((r) => counts[r.status]++);
  const missingFile = rows.filter((r) => r.status !== "superseded" && r.result !== "fail" && r.files.length === 0).length;
  const categories = [...new Set(rows.map((r) => r.req?.category).filter(Boolean))].sort() as string[];
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Compliance"
        subtitle="Completed inspections and services, with certificates and how long each one is valid."
        actions={
          <ButtonLink href={`/compliance/certificates/export${exportQs ? `?${exportQs}` : ""}`} variant="secondary">
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </ButtonLink>
        }
      />
      <ComplianceTabs active="certificates" site={sp.site} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current" value={counts.current} tone="good" sub="Valid more than 30 days" />
        <Stat label="Expiring soon" value={counts.expiring} tone={counts.expiring ? "warning" : "good"} sub="Within 30 days" />
        <Stat label="Expired / failed" value={counts.expired + counts.failed} tone={counts.expired + counts.failed ? "critical" : "good"} sub="Latest record not valid" />
        <Stat label="Missing certificate file" value={missingFile} tone={missingFile ? "warning" : "good"} sub="Completed without an upload" />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap items-center gap-2">
          <Input name="q" placeholder="Search item, cert #, vendor" defaultValue={sp.q} className="w-56" />
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-auto">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select name="view" defaultValue={sp.view ?? ""} className="w-auto">
            <option value="">Latest per item</option>
            <option value="all">Full history</option>
          </Select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            From <Input type="date" name="from" defaultValue={sp.from} className="w-auto py-1.5" />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            to <Input type="date" name="to" defaultValue={sp.to} className="w-auto py-1.5" />
          </label>
          <Button variant="secondary" type="submit">
            Filter
          </Button>
        </form>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No completed compliance work yet.">Completions show up here when a compliance work order is closed or a completion is recorded.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Requirement</Th>
                <Th>Site</Th>
                <Th>Completed</Th>
                <Th>Valid until</Th>
                <Th>Status</Th>
                <Th>Vendor · Cert #</Th>
                <Th>Certificate</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const [label, tone] = STATUS[r.status];
                return (
                  <tr key={r.id} className={r.status === "superseded" ? "opacity-60" : "hover:bg-slate-50"}>
                    <Td>
                      <Link href={`/compliance/${r.requirement_id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {r.req?.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.req?.category}
                        {r.req?.authority && ` · ${r.req.authority}`}
                        {r.wo && (
                          <>
                            {" · "}
                            <Link href={`/work-orders/${r.work_order_id}`} className="text-brand-700">
                              WO #{r.wo.number}
                            </Link>
                          </>
                        )}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{r.req?.site?.code ?? r.req?.site?.name}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.completed_on)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(r.valid_until)}</Td>
                    <Td>
                      <Badge tone={tone}>{label}</Badge>
                      {r.result === "conditional" && <div className="mt-1 text-xs text-amber-700">Conditional pass</div>}
                    </Td>
                    <Td className="text-xs">
                      <div>{r.vendor?.name ?? "In-house"}</div>
                      <div className="font-mono text-slate-500">{r.certificate_number ?? "—"}</div>
                    </Td>
                    <Td className="text-xs">
                      {r.files.length ? (
                        <ul className="space-y-0.5">
                          {r.files.map((f) => (
                            <li key={f.id}>
                              <a href={f.url ?? "#"} target="_blank" rel="noreferrer" className="inline-flex max-w-[200px] items-center gap-1 text-brand-700 hover:underline">
                                <FileText className="h-3.5 w-3.5 flex-none" aria-hidden />
                                <span className="truncate">{f.name}</span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : r.result === "fail" ? (
                        "—"
                      ) : (
                        <Link href={`/compliance/${r.requirement_id}#certificates`} className="font-medium text-amber-700">
                          Upload certificate
                        </Link>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
