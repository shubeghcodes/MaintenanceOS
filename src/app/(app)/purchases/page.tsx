import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { getLookups } from "@/lib/data";
import { loadPurchases } from "@/lib/purchases";
import { PAYMENT_LABEL, PURCHASE_CATEGORIES, PURCHASE_STATUS_LABEL, PURCHASE_STATUS_TONE } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, todayISO } from "@/lib/format";
import { Alert, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Input, PageHeader, Select, Stat, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Purchases" };
export const dynamic = "force-dynamic";

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin", "tech");
  const today = todayISO();
  // Default: this month, unless a status queue is selected (then all dates).
  const f = { ...sp, from: sp.from ?? (sp.status || sp.all ? undefined : today.slice(0, 8) + "01"), to: sp.to };
  const [rows, { sites }, { data: people }] = await Promise.all([
    loadPurchases(supabase, f),
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
  const bySite = group((r) => r.wo?.site?.code ?? r.wo?.site?.name ?? "—");
  const byStore = group((r) => r.store).slice(0, 6);
  const byCategory = group((r) => r.category);
  const max = (list: [string, number][]) => Math.max(1, ...list.map(([, v]) => v));
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
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
        subtitle={`Receipts tied to work orders · ${range}`}
        actions={
          <ButtonLink href={`/purchases/export${qs ? `?${qs}` : ""}`} variant="secondary">
            <Download className="h-4 w-4" aria-hidden /> Export CSV
          </ButtonLink>
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Spent" value={fmtMoney(total)} sub={`${counted.length} receipts`} />
        <Stat label="Needs review" value={review.length} sub={fmtMoney(review.reduce((s, r) => s + Number(r.total), 0), 2)} tone={review.length ? "warning" : "good"} href="/purchases?status=review" />
        <Stat label="Owed to employees" value={fmtMoney(owed.reduce((s, r) => s + Number(r.total), 0), 2)} sub={`${owed.length} personal-card receipts`} tone={owed.length ? "serious" : "good"} href="/purchases?status=reimburse" />
        <Stat label="Missing receipt photo" value={noReceipt.length} tone={noReceipt.length ? "warning" : "good"} href="/purchases?status=no_receipt" />
      </div>

      <Card className="mb-4 p-3">
        <form className="flex flex-wrap items-center gap-2">
          <Input name="q" placeholder="Store, item, WO #" defaultValue={sp.q} className="w-44" />
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
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} className="w-auto">
            <option value="">All categories</option>
            {PURCHASE_CATEGORIES.map((c) => (
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
            <EmptyState title="No receipts match.">Add receipts from any work order (Receipts &amp; purchases), or from “My day” on a phone.</EmptyState>
          ) : (
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Date</Th>
                  <Th>Store · item</Th>
                  <Th>Work order</Th>
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
                      <div className="font-medium text-slate-900">{r.store}</div>
                      <div className="text-xs text-slate-500">
                        {r.category}
                        {r.description && ` · ${r.description}`}
                      </div>
                    </Td>
                    <Td className="min-w-[180px] text-xs">
                      <Link href={`/work-orders/${r.wo?.id}#receipts`} className="font-medium text-brand-700 hover:underline">
                        #{r.wo?.number}
                      </Link>{" "}
                      {r.wo?.title}
                      <div className="text-slate-500">{r.wo?.site?.code ?? r.wo?.site?.name}</div>
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
