import { getCompanyScope, getReceiptsToReview } from "@/lib/company";
import { AnalyticsTabs } from "@/components/AnalyticsTabs";
import Link from "next/link";
import { Download, Plus, Receipt } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { loadPurchases, placeName } from "@/lib/purchases";
import { PAYMENT_LABEL, PURCHASE_CATEGORIES, PURCHASE_KIND_LABEL, PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE, SHOP_LABEL, SUPPLY_CATEGORIES } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, todayISO } from "@/lib/format";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Purchases" };
export const dynamic = "force-dynamic";

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase, profile } = await requireRole("admin", "tech", "manager");
  const today = todayISO();
  // Default: this month, unless a status queue is selected (then all dates).
  const f = { ...sp, from: sp.from ?? (sp.status || sp.all ? undefined : today.slice(0, 8) + "01"), to: sp.to };
  const [rows, { sites }, { data: people }] = await Promise.all([
    loadPurchases(supabase, { ...f, company: (await getCompanyScope()).companyId }),
    getLookups(supabase),
    supabase.from("profiles").select("id,full_name,email").in("role", ["admin", "tech", "manager"]).order("full_name"),
  ]);

  const counted = rows.filter((r) => r.status !== "rejected");
  const total = counted.reduce((s, r) => s + Number(r.total), 0);
  const review = rows.filter((r) => r.status === "submitted");
  const owed = counted.filter((r) => r.reimbursable && !r.reimbursed_at);
  const noReceipt = counted.filter((r) => !r.receipt_attachment_id);
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    counted.forEach((r) => m.set(key(r), (m.get(key(r)) ?? 0) + Number(r.total)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const parts = counted.filter((r) => r.kind === "part");
  const supplies = counted.filter((r) => r.kind === "supply");
  const sum = (list: typeof rows) => list.reduce((s, r) => s + Number(r.total), 0);
  const bySite = group((r) => placeName(r, SHOP_LABEL));
  const byStore = group((r) => r.store).slice(0, 6);
  const byCategory = group((r) => r.category);
  const max = (list: [string, number][]) => Math.max(1, ...list.map(([, v]) => v));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const categories = [...new Set([...PURCHASE_CATEGORIES, ...SUPPLY_CATEGORIES])];
  const kindHref = (k?: string) => {
    const q = new URLSearchParams(Object.entries({ ...f, kind: k }).filter(([, v]) => v) as [string, string][]).toString();
    return `/purchases${q ? `?${q}` : ""}`;
  };
  const DONE: Record<string, string> = { deleted: "Purchase deleted.", added: "Purchase saved." };
  const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : "Start"} – ${f.to ? fmtDate(f.to) : "today"}` : "All dates";

  const Breakdown = ({ title, list }: { title: string; list: [string, number][] }) => (
    <Card>
      <CardHeader title={title} />
      <ul className="space-y-2 p-4">
        {list.length === 0 && <li className="text-sm text-slate-500">—</li>}
        {list.map(([k, v]) => (
          <li key={k} className="text-sm" title={`${k}: ${fmtMoney(v, 2)}`}>
            <div className="flex justify-between gap-2">
              <span className="truncate text-slate-700">{k}</span>
              <span className="tabular-nums text-slate-900">{fmtMoney(v)}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100">
              <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(v / max(list)) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle={`Work-order receipts and store supplies · ${range}`}
        actions={
          <>
            <ButtonLink href={`/purchases/export${qs ? `?${qs}` : ""}`} variant="secondary">
              <Download className="h-4 w-4" aria-hidden /> Export CSV
            </ButtonLink>
            <ButtonLink href="/purchases/new">
              <Plus className="h-4 w-4" aria-hidden /> Log a purchase
            </ButtonLink>
          </>
        }
      />
      {profile.role === "admin" && <AnalyticsTabs active="purchases" reviewCount={await getReceiptsToReview()} />}
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.receipt && DONE[sp.receipt] && <Alert tone="good">{DONE[sp.receipt]}</Alert>}

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Purchase type">
        {[
          { k: undefined, label: "All purchases" },
          { k: "part", label: "Work-order parts" },
          { k: "supply", label: "Store supplies" },
        ].map(({ k, label }) => (
          <Link
            key={label}
            href={kindHref(k)}
            role="tab"
            aria-selected={(sp.kind ?? undefined) === k}
            className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${(sp.kind ?? undefined) === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-600 ring-slate-300 hover:bg-slate-50"}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className={`mb-6 grid grid-cols-2 gap-3 ${sp.kind ? "md:grid-cols-4" : "md:grid-cols-3 lg:grid-cols-6"}`}>
        <Stat label="Spent" value={fmtMoney(total)} sub={`${counted.length} receipts${sp.kind === "part" ? " · counts as R&M" : sp.kind === "supply" ? " · not R&M" : ""}`} />
        {!sp.kind && (
          <>
            <Stat label="Work-order parts" value={fmtMoney(sum(parts))} sub={`${parts.length} · counts as R&M`} href={kindHref("part")} />
            <Stat label="Store supplies" value={fmtMoney(sum(supplies))} sub={`${supplies.length} · not R&M`} href={kindHref("supply")} />
          </>
        )}
        <Stat label="Needs review" value={review.length} sub={fmtMoney(review.reduce((s, r) => s + Number(r.total), 0), 2)} tone={review.length ? "warning" : "good"} href="/purchases?status=review" />
        <Stat label="Owed to employees" value={fmtMoney(owed.reduce((s, r) => s + Number(r.total), 0), 2)} sub={`${owed.length} personal-card receipts`} tone={owed.length ? "serious" : "good"} href="/purchases?status=reimburse" />
        <Stat label="Missing receipt photo" value={noReceipt.length} tone={noReceipt.length ? "warning" : "good"} href="/purchases?status=no_receipt" />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap items-center gap-2">
          {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
          <Input name="q" placeholder="Vendor, item, WO #" defaultValue={sp.q} className="w-44" />
          <Select name="status" defaultValue={sp.status ?? ""} className="w-auto">
            <option value="">Any status</option>
            <option value="review">Needs review</option>
            <option value="reimburse">To reimburse</option>
            <option value="no_receipt">Missing receipt</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Select name="site" defaultValue={sp.site ?? ""} className="w-auto">
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code ?? s.name}
              </option>
            ))}
            {profile.role !== "manager" && <option value="shop">{SHOP_LABEL}</option>}
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-auto">
            <option value="">All categories</option>
            {(sp.kind === "part" ? [...PURCHASE_CATEGORIES] : sp.kind === "supply" ? [...SUPPLY_CATEGORIES] : categories).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
          <Select name="method" defaultValue={sp.method ?? ""} className="w-auto">
            <option value="">Any payment</option>
            {Object.entries(PAYMENT_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Select name="person" defaultValue={sp.person ?? ""} className="w-auto">
            <option value="">Anyone</option>
            {((people ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => (
              <option key={p.id} value={p.id}>
                {personName(p)}
              </option>
            ))}
          </Select>
          <Input type="date" name="from" defaultValue={f.from} className="w-auto py-1.5" aria-label="From" />
          <Input type="date" name="to" defaultValue={f.to} className="w-auto py-1.5" aria-label="To" />
          <Button variant="secondary" type="submit">
            Filter
          </Button>
          <Link href="/purchases?all=1" className="text-xs text-slate-500 hover:text-brand-700">
            All dates
          </Link>
        </form>
      </Card>

      <div className="space-y-6">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No purchases match.">
              Add parts receipts from the work order (Receipts &amp; purchases). For restaurant supplies, use{" "}
              <Link href="/purchases/new" className="font-medium text-brand-700 hover:underline">
                Log a purchase
              </Link>
              .
            </EmptyState>
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Date</Th>
                  <Th>Vendor · item</Th>
                  <Th>For</Th>
                  <Th>Paid with · by</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                  <Th>Receipt</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className={r.status === "rejected" ? "opacity-60" : r.status === "submitted" ? "bg-amber-50/40 hover:bg-amber-50" : "hover:bg-slate-50"}>
                    <Td className="whitespace-nowrap text-xs">{fmtDate(r.purchase_date)}</Td>
                    <Td className="min-w-[180px]">
                      <Link href={`/purchases/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {r.store}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {r.category}
                        {r.description && ` · ${r.description}`}
                      </div>
                    </Td>
                    <Td className="min-w-[180px] text-xs">
                      {r.wo ? (
                        <>
                          <Link href={`/work-orders/${r.wo.id}#receipts`} className="font-medium text-brand-700 hover:underline">
                            #{r.wo.number}
                          </Link>{" "}
                          {r.wo.title}
                        </>
                      ) : (
                        <Badge tone="info" dot={false}>
                          {PURCHASE_KIND_LABEL.supply}
                        </Badge>
                      )}
                      <div className="text-slate-500">{placeName(r, SHOP_LABEL)}</div>
                    </Td>
                    <Td className="text-xs">
                      {PAYMENT_LABEL[r.payment_method]}
                      {r.card_last4 && ` ••${r.card_last4}`}
                      <div className="text-slate-500">{personName(r.buyer)}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-right tabular-nums font-medium">{fmtMoney(r.total, 2)}</Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={PURCHASE_STATUS_TONE[r.status]}>{PURCHASE_STATUS_LABEL[r.status]}</Badge>
                        {r.reimbursable && r.status !== "rejected" && (
                          <Badge tone={r.reimbursed_at ? "good" : "serious"} dot={false}>
                            {r.reimbursed_at ? "Reimbursed" : "Reimburse"}
                          </Badge>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {r.receipt_url ? (
                        <a href={r.receipt_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                          <Receipt className="h-3.5 w-3.5" aria-hidden /> View
                        </a>
                      ) : (
                        <span className="text-xs text-amber-700">Missing</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="grid gap-6 md:grid-cols-3">
          <Breakdown title="By site" list={bySite} />
          <Breakdown title="By category" list={byCategory} />
          <Breakdown title="Top stores" list={byStore} />
        </div>
      </div>
    </>
  );
}
