import type { SupabaseClient } from "@supabase/supabase-js";
import { Package } from "lucide-react";
import { PART_OPEN, PART_READY_WHERE, PART_STATUS_LABEL, PART_STATUS_TONE, type PartStatus } from "@/lib/constants";
import { fmtDate, fmtMoney, personName, todayISO } from "@/lib/format";
import type { AttachmentWithUrl } from "@/lib/attachments";
import type { Profile } from "@/lib/types";
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PhotoInput } from "@/components/PhotoInput";
import { getT } from "@/lib/i18n/server";
import { deletePart, requestPart, setPartStatus, updatePart } from "../part-actions";

type Person = { id: string; full_name: string | null; email: string | null } | null;
type Part = {
  id: string;
  name: string;
  part_number: string | null;
  quantity: number;
  notes: string | null;
  supplier: string | null;
  link: string | null;
  est_cost: number | null;
  cost: number | null;
  order_ref: string | null;
  eta: string | null;
  ready_location: string | null;
  location_note: string | null;
  photo_id: string | null;
  status: PartStatus;
  cancel_reason: string | null;
  requested_at: string;
  ordered_at: string | null;
  ready_at: string | null;
  installed_at: string | null;
  requested_by: string | null;
  requester: Person;
  approver: Person;
  orderer: Person;
};

const COLS =
  "id,name,part_number,quantity,notes,supplier,link,est_cost,cost,order_ref,eta,ready_location,location_note,photo_id,status,cancel_reason," +
  "requested_at,ordered_at,ready_at,installed_at,requested_by," +
  "requester:profiles!wo_parts_requested_by_fkey(id,full_name,email)," +
  "approver:profiles!wo_parts_approved_by_fkey(id,full_name,email)," +
  "orderer:profiles!wo_parts_ordered_by_fkey(id,full_name,email)";

/** Parts needed for this job: request → (approve) → ordered → ready → installed. GMs see it read-only. */
export async function PartsCard({
  supabase,
  woId,
  companyId,
  profile,
  closed,
  files,
  open,
}: {
  supabase: SupabaseClient;
  woId: string;
  companyId: string | null;
  profile: Profile;
  closed: boolean;
  files: AttachmentWithUrl[];
  open: boolean;
}) {
  const t = await getT();
  const L = t.locale;
  const [{ data }, { data: co }] = await Promise.all([
    supabase.from("wo_parts").select(COLS).eq("work_order_id", woId).order("requested_at"),
    companyId ? supabase.from("companies").select("parts_approval_limit").eq("id", companyId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const parts = (data ?? []) as unknown as Part[];
  const limit = Number((co as { parts_approval_limit: number } | null)?.parts_approval_limit ?? 250);
  const isAdmin = profile.role === "admin";
  const canAct = (isAdmin || profile.role === "tech") && !closed;
  const showMoney = isAdmin || profile.role === "tech";
  const photo = (id: string | null) => (id ? files.find((f) => f.id === id) : undefined);
  const today = todayISO();

  const openParts = parts.filter((p) => PART_OPEN.includes(p.status));
  const waiting = parts.filter((p) => p.status === "requested" || p.status === "approved" || p.status === "ordered").length;
  const ready = parts.filter((p) => p.status === "ready").length;
  const needsApproval = (p: Part) => p.status === "requested" && (p.est_cost == null || Number(p.est_cost) > limit);

  if (!parts.length && !canAct) return null;

  const subtitle = parts.length
    ? [waiting && t("{n} waiting", { n: waiting }), ready && t("{n} ready", { n: ready }), !openParts.length && t("all done")].filter(Boolean).join(" · ")
    : t("Request parts you need to finish this job");

  return (
    <Card id="parts" className="scroll-mt-6">
      <CardHeader title={t("Parts")} subtitle={subtitle} />
      {parts.length > 0 && (
        <ul className="divide-y divide-slate-100 border-b border-slate-100">
          {parts.map((p) => {
            const img = photo(p.photo_id);
            const late = p.status === "ordered" && p.eta && p.eta < today;
            const ids = (
              <>
                <input type="hidden" name="work_order_id" value={woId} />
                <input type="hidden" name="part_id" value={p.id} />
              </>
            );
            return (
              <li key={p.id} className={`px-5 py-3 ${p.status === "cancelled" ? "opacity-60" : ""}`}>
                <div className="flex items-start gap-3">
                  {img?.url && img.content_type?.startsWith("image/") ? (
                    <a href={img.url} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="" className="h-12 w-12 rounded-md object-cover ring-1 ring-slate-200" />
                    </a>
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-50 ring-1 ring-slate-200">
                      <Package className="h-5 w-5 text-slate-400" aria-hidden />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`font-medium text-slate-900 ${p.status === "cancelled" ? "line-through" : ""}`}>
                        {p.name}
                        {Number(p.quantity) !== 1 && <span className="font-normal text-slate-500"> ×{Number(p.quantity)}</span>}
                      </span>
                      <Badge tone={late ? "critical" : PART_STATUS_TONE[p.status]}>
                        {p.status === "ordered" && p.eta
                          ? late
                            ? t("Late · was due {date}", { date: fmtDate(p.eta, L) })
                            : t("Ordered · arriving {date}", { date: fmtDate(p.eta, L) })
                          : t(PART_STATUS_LABEL[p.status])}
                      </Badge>
                      {needsApproval(p) && (
                        <Badge tone="serious" dot={false}>
                          {p.est_cost == null ? t("No price yet") : t("Over {limit} · needs approval", { limit: fmtMoney(limit) })}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {[
                        p.part_number && `${t("Part #")} ${p.part_number}`,
                        showMoney && (p.cost != null ? fmtMoney(p.cost, 2) : p.est_cost != null ? `${t("est.")} ${fmtMoney(p.est_cost, 2)}` : null),
                        p.supplier,
                        p.order_ref && `${t("Order #")} ${p.order_ref}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      {p.link && (
                        <>
                          {" · "}
                          <a href={p.link} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                            {t("Link")}
                          </a>
                        </>
                      )}
                    </p>
                    {p.notes && <p className="mt-1 whitespace-pre-line text-xs text-slate-600">{p.notes}</p>}
                    {p.status === "ready" && (p.ready_location || p.location_note) && (
                      <p className="mt-1 text-xs font-medium text-emerald-700">
                        {[p.ready_location && t(PART_READY_WHERE[p.ready_location] ?? p.ready_location), p.location_note].filter(Boolean).join(" — ")}
                      </p>
                    )}
                    {p.status === "cancelled" && p.cancel_reason && <p className="mt-1 text-xs text-slate-500">{t("Cancelled: {reason}", { reason: p.cancel_reason })}</p>}
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t("Requested by {name} {date}", { name: p.requester ? personName(p.requester) : "—", date: fmtDate(p.requested_at, L) })}
                      {p.approver && ` · ${t("approved by {name}", { name: personName(p.approver) })}`}
                      {p.ordered_at && ` · ${t("ordered {date}", { date: fmtDate(p.ordered_at, L) })}${p.orderer ? ` (${personName(p.orderer)})` : ""}`}
                      {p.ready_at && ` · ${t("ready {date}", { date: fmtDate(p.ready_at, L) })}`}
                      {p.installed_at && ` · ${t("installed {date}", { date: fmtDate(p.installed_at, L) })}`}
                    </p>

                    {canAct && PART_OPEN.includes(p.status) && (
                      <div className="mt-2 flex flex-wrap items-start gap-2">
                        {/* Approve (admins, over the limit) */}
                        {isAdmin && p.status === "requested" && (
                          <form action={setPartStatus.bind(null, "approved")}>
                            {ids}
                            <SubmitButton size="sm" variant="secondary">
                              {t("Approve")}
                            </SubmitButton>
                          </form>
                        )}

                        {/* Ordered / bought it */}
                        {(p.status === "requested" || p.status === "approved") && (isAdmin || !needsApproval(p) || p.est_cost == null) && (
                          <details className="w-full rounded-lg ring-1 ring-slate-200 sm:w-auto sm:min-w-[22rem]">
                            <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium text-brand-700">{t("Mark ordered / bought")}</summary>
                            <form className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
                              {ids}
                              <Field label={t("Cost ($)")}>
                                <Input name="cost" inputMode="decimal" defaultValue={p.est_cost ?? ""} required={!isAdmin} />
                              </Field>
                              <Field label={t("Supplier")}>
                                <Input name="supplier" defaultValue={p.supplier ?? ""} />
                              </Field>
                              <Field label={t("Order / confirmation #")}>
                                <Input name="order_ref" />
                              </Field>
                              <Field label={t("Expected arrival")}>
                                <Input type="date" name="eta" min={today} />
                              </Field>
                              {!isAdmin && p.status === "requested" && (
                                <p className="text-xs text-slate-500 sm:col-span-2">{t("Over {limit} needs an admin's approval first.", { limit: fmtMoney(limit) })}</p>
                              )}
                              <div className="flex flex-wrap gap-2 sm:col-span-2">
                                <SubmitButton size="sm" formAction={setPartStatus.bind(null, "ordered")}>
                                  {t("Ordered")}
                                </SubmitButton>
                                <SubmitButton size="sm" variant="secondary" formAction={setPartStatus.bind(null, "ready")}>
                                  {t("Bought it — have it now")}
                                </SubmitButton>
                              </div>
                              <p className="text-xs text-slate-500 sm:col-span-2">{t("Add the receipt under Receipts & purchases so the cost counts toward this job.")}</p>
                            </form>
                          </details>
                        )}
                        {!isAdmin && needsApproval(p) && p.est_cost != null && (
                          <p className="text-xs text-amber-700">{t("Waiting for an admin to approve before ordering.")}</p>
                        )}

                        {/* Arrived */}
                        {p.status === "ordered" && (
                          <details className="w-full rounded-lg ring-1 ring-slate-200 sm:w-auto sm:min-w-[22rem]">
                            <summary className="cursor-pointer px-3 py-1.5 text-sm font-medium text-brand-700">{t("Mark ready")}</summary>
                            <form action={setPartStatus.bind(null, "ready")} className="grid gap-2 border-t border-slate-100 p-3">
                              {ids}
                              <Field label={t("Where is it?")}>
                                <Select name="ready_location" defaultValue="shop">
                                  {Object.entries(PART_READY_WHERE).map(([k, v]) => (
                                    <option key={k} value={k}>
                                      {t(v)}
                                    </option>
                                  ))}
                                </Select>
                              </Field>
                              <Input name="location_note" placeholder={t("e.g. Shelf B in the shop, or with the store manager")} />
                              {p.cost == null && <Input name="cost" inputMode="decimal" placeholder={t("Final cost ($), if you have it")} />}
                              <SubmitButton size="sm">{t("Part is ready")}</SubmitButton>
                            </form>
                          </details>
                        )}

                        {/* Installed */}
                        {(p.status === "ready" || p.status === "ordered") && (
                          <form action={setPartStatus.bind(null, "installed")}>
                            {ids}
                            <SubmitButton size="sm" variant={p.status === "ready" ? "primary" : "ghost"}>
                              {t("Installed")}
                            </SubmitButton>
                          </form>
                        )}

                        {/* Edit details */}
                        <details className="w-full rounded-lg ring-1 ring-slate-200 sm:w-auto sm:min-w-[22rem]">
                          <summary className="cursor-pointer px-3 py-1.5 text-sm text-slate-600">{t("Edit")}</summary>
                          <form action={updatePart} className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
                            {ids}
                            <Field label={t("Part")} className="sm:col-span-2">
                              <Input name="name" defaultValue={p.name} required />
                            </Field>
                            <Field label={t("Part / model #")}>
                              <Input name="part_number" defaultValue={p.part_number ?? ""} />
                            </Field>
                            <Field label={t("Quantity")}>
                              <Input name="quantity" inputMode="decimal" defaultValue={Number(p.quantity)} />
                            </Field>
                            <Field label={t("Estimated cost ($)")}>
                              <Input name="est_cost" inputMode="decimal" defaultValue={p.est_cost ?? ""} disabled={!isAdmin && p.status === "approved"} />
                            </Field>
                            <Field label={t("Where to get it")}>
                              <Input name="supplier" defaultValue={p.supplier ?? ""} />
                            </Field>
                            <Field label={t("Link (optional)")} className="sm:col-span-2">
                              <Input name="link" defaultValue={p.link ?? ""} />
                            </Field>
                            <Field label={t("Notes")} className="sm:col-span-2">
                              <Textarea name="notes" rows={2} defaultValue={p.notes ?? ""} />
                            </Field>
                            <div className="flex flex-wrap gap-2 sm:col-span-2">
                              <SubmitButton size="sm" variant="secondary">
                                {t("Save")}
                              </SubmitButton>
                              {p.status === "requested" && (isAdmin || p.requested_by === profile.id) && (
                                <SubmitButton size="sm" variant="ghost" formAction={deletePart} confirm={t("Remove this part request?")}>
                                  {t("Remove")}
                                </SubmitButton>
                              )}
                            </div>
                          </form>
                        </details>

                        {/* Cancel */}
                        {(isAdmin || p.status === "requested" || p.status === "approved") && (
                          <details className="w-full rounded-lg ring-1 ring-slate-200 sm:w-auto">
                            <summary className="cursor-pointer px-3 py-1.5 text-sm text-slate-600">{t("Cancel part")}</summary>
                            <form action={setPartStatus.bind(null, "cancelled")} className="flex flex-wrap gap-2 border-t border-slate-100 p-3">
                              {ids}
                              <Input name="cancel_reason" required placeholder={t("Why isn't it needed?")} className="min-w-[14rem] flex-1" />
                              <SubmitButton size="sm" variant="danger">
                                {t("Cancel part")}
                              </SubmitButton>
                            </form>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canAct && (
        <details open={open}>
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-brand-700">+ {t("Request a part")}</summary>
          <form action={requestPart} className="grid gap-3 border-t border-slate-100 p-5 sm:grid-cols-2">
            <input type="hidden" name="work_order_id" value={woId} />
            <Field label={`${t("What part?")} *`} className="sm:col-span-2">
              <Input name="name" required placeholder={t("e.g. Condenser fan motor 1/3 HP 208-230V")} />
            </Field>
            <Field label={t("Part / model #")}>
              <Input name="part_number" placeholder={t("From the nameplate or old part")} />
            </Field>
            <Field label={t("Quantity")}>
              <Input name="quantity" inputMode="decimal" defaultValue="1" />
            </Field>
            <Field label={t("Estimated cost ($)")} hint={t("Up to {limit} you can order it yourself.", { limit: fmtMoney(limit) })}>
              <Input name="est_cost" inputMode="decimal" />
            </Field>
            <Field label={t("Where to get it")}>
              <Input name="supplier" placeholder={t("e.g. Johnstone Supply, Grainger")} />
            </Field>
            <Field label={t("Link (optional)")} className="sm:col-span-2">
              <Input name="link" placeholder="https://" />
            </Field>
            <Field label={t("Notes")} className="sm:col-span-2">
              <Textarea name="notes" rows={2} placeholder={t("Anything the person ordering should know")} />
            </Field>
            <Field label={t("Photo of the nameplate or old part")} className="sm:col-span-2">
              <PhotoInput name="photo" multiple={false} capture="environment" />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton pendingText={t("Saving…")}>{t("Request part")}</SubmitButton>
            </div>
          </form>
        </details>
      )}
    </Card>
  );
}
