import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Send, Trash2 } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fmtDate, fmtFreq } from "@/lib/format";
import type { FreqUnit } from "@/lib/types";
import { Alert, ButtonLink, Card, CardHeader, EmptyState, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { TemplateForm, type TemplateRow } from "../TemplateForm";
import { deleteTemplateItem, moveTemplateItem, saveTemplateItem } from "../../template-actions";

export const metadata = { title: "PM template" };

const PHOTO_LABEL = { before_after: "Before & after", single: "One photo", none: "No photo" } as const;

type Item = { id: string; position: number; activity: string; description: string | null; activity_es: string | null; description_es: string | null; photo_rule: keyof typeof PHOTO_LABEL };
type Sched = { id: string; next_due_on: string; active: boolean; site: { name: string; code: string | null } | null };

export default async function TemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const [{ data: tplData }, { data: itemData }, { data: schedData }] = await Promise.all([
    supabase.from("pm_templates").select("*").eq("id", id).maybeSingle(),
    supabase.from("pm_template_items").select("id,position,activity,description,activity_es,description_es,photo_rule").eq("template_id", id).order("position"),
    supabase.from("pm_schedules").select("id,next_due_on,active,site:sites(name,code)").eq("template_id", id).order("next_due_on"),
  ]);
  if (!tplData) notFound();
  const tpl = tplData as TemplateRow;
  const items = (itemData ?? []) as Item[];
  const schedules = ((schedData ?? []) as unknown as Sched[]).filter((s) => s.active);

  return (
    <>
      <PageHeader
        title={tpl.name}
        subtitle={`${fmtFreq(tpl.frequency_interval, tpl.frequency_unit as FreqUnit)} · ${tpl.category} · ${items.length} activities`}
        back={{ href: "/pm/templates", label: "PM templates" }}
        actions={
          tpl.active && (
            <ButtonLink href={`/pm/templates/rollout?template=${id}`}>
              <Send className="h-4 w-4" aria-hidden /> Roll out to stores
            </ButtonLink>
          )
        }
      />
      {sp.error && <Alert>{sp.error}</Alert>}
      {sp.saved && (
        <Alert tone="good">
          Template saved{sp.synced ? `, and ${sp.synced} store schedule${sp.synced === "1" ? "" : "s"} updated` : ""}.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card id="items">
            <CardHeader
              title="Activities"
              subtitle="Changes apply to work orders created from now on. Open work orders keep the checklist they started with."
            />
            {items.length === 0 ? (
              <EmptyState title="No activities yet.">Add the first one below.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((it, i) => (
                  <li key={it.id} className="px-5 py-3">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-3">
                        <span className="mt-0.5 w-6 shrink-0 text-right text-xs text-slate-400">{i + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-900">{it.activity}</span>
                          {it.description && <span className="line-clamp-1 text-xs text-slate-500 group-open:hidden">{it.description}</span>}
                          {!it.activity_es && <span className="text-[11px] text-amber-700 group-open:hidden">No Spanish yet</span>}
                        </span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                            it.photo_rule === "before_after" ? "bg-brand-50 text-brand-700" : it.photo_rule === "single" ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"
                          }`}
                        >
                          {PHOTO_LABEL[it.photo_rule]}
                        </span>
                      </summary>
                      <div className="mt-3 space-y-3 pl-9">
                        <form action={saveTemplateItem} className="space-y-2">
                          <input type="hidden" name="template_id" value={id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          <Input name="activity" defaultValue={it.activity} required />
                          <Textarea name="description" rows={2} defaultValue={it.description ?? ""} />
                          <div className="space-y-2 rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
                            <p className="text-xs font-medium text-slate-600">Spanish (shown to techs who use the app in Spanish)</p>
                            <Input name="activity_es" defaultValue={it.activity_es ?? ""} placeholder="Actividad en español" />
                            <Textarea name="description_es" rows={2} defaultValue={it.description_es ?? ""} placeholder="Instrucciones en español" />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Select name="photo_rule" defaultValue={it.photo_rule} className="w-auto">
                              {Object.entries(PHOTO_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </Select>
                            <SubmitButton size="sm">Save</SubmitButton>
                          </div>
                        </form>
                        <form className="flex gap-2">
                          <input type="hidden" name="template_id" value={id} />
                          <input type="hidden" name="item_id" value={it.id} />
                          {i > 0 && (
                            <SubmitButton size="sm" variant="ghost" formAction={moveTemplateItem.bind(null, "up")}>
                              <ArrowUp className="h-3.5 w-3.5" /> Up
                            </SubmitButton>
                          )}
                          {i < items.length - 1 && (
                            <SubmitButton size="sm" variant="ghost" formAction={moveTemplateItem.bind(null, "down")}>
                              <ArrowDown className="h-3.5 w-3.5" /> Down
                            </SubmitButton>
                          )}
                          <SubmitButton size="sm" variant="ghost" formAction={deleteTemplateItem} confirm={`Remove “${it.activity}” from this template?`}>
                            <Trash2 className="h-3.5 w-3.5" /> Remove
                          </SubmitButton>
                        </form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <form action={saveTemplateItem} className="space-y-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4">
              <input type="hidden" name="template_id" value={id} />
              <div className="text-sm font-medium text-slate-800">Add an activity</div>
              <Input name="activity" required placeholder="e.g. Condenser coils" />
              <Textarea name="description" rows={2} placeholder="What the tech should do" />
              <details>
                <summary className="cursor-pointer text-xs text-slate-500">Add Spanish (optional)</summary>
                <div className="mt-2 space-y-2">
                  <Input name="activity_es" placeholder="Actividad en español" />
                  <Textarea name="description_es" rows={2} placeholder="Instrucciones en español" />
                </div>
              </details>
              <div className="flex flex-wrap items-center gap-2">
                <Select name="photo_rule" defaultValue="before_after" className="w-auto">
                  {Object.entries(PHOTO_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
                <SubmitButton size="sm">Add activity</SubmitButton>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <TemplateForm tpl={tpl} scheduleCount={schedules.length} />
          <Card>
            <CardHeader title={`Stores using it (${schedules.length})`} />
            {schedules.length === 0 ? (
              <p className="px-5 py-4 text-sm text-slate-500">Not rolled out yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {schedules.map((s) => (
                  <li key={s.id} className="flex items-center justify-between px-5 py-2">
                    <Link href={`/pm/${s.id}`} className="text-slate-800 hover:text-brand-700">
                      {s.site?.code ?? s.site?.name}
                    </Link>
                    <span className="text-xs text-slate-500">next {fmtDate(s.next_due_on)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
