import Link from "next/link";
import { Plus, Send } from "lucide-react";
import { requireRole } from "@/lib/auth";
import { fmtFreq } from "@/lib/format";
import type { FreqUnit } from "@/lib/types";
import { Alert, Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { PmTabs } from "../PmTabs";

export const metadata = { title: "PM templates" };

type Tpl = {
  id: string;
  name: string;
  category: string;
  frequency_interval: number;
  frequency_unit: FreqUnit;
  active: boolean;
  items: { photo_rule: string; active: boolean }[];
  schedules: { id: string; active: boolean }[];
};

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireRole("admin");
  const { data, error } = await supabase
    .from("pm_templates")
    .select("id,name,category,frequency_interval,frequency_unit,active,items:pm_template_items(photo_rule,active),schedules:pm_schedules(id,active)")
    .order("active", { ascending: false })
    .order("name");
  const rows = (data ?? []) as unknown as Tpl[];

  return (
    <>
      <PageHeader
        title="Preventive maintenance"
        subtitle="Templates are reusable PM checklists. Roll one out to many stores at once; every work order it creates carries the checklist with required photos."
        actions={
          <>
            {rows.some((r) => r.active) && (
              <ButtonLink href="/pm/templates/rollout" variant="secondary">
                <Send className="h-4 w-4" aria-hidden /> Roll out to stores
              </ButtonLink>
            )}
            <ButtonLink href="/pm/templates/new">
              <Plus className="h-4 w-4" aria-hidden /> New template
            </ButtonLink>
          </>
        }
      />
      <PmTabs active="templates" />
      {(sp.error || error) && <Alert>{sp.error ?? error?.message}</Alert>}

      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No templates yet.">Create one for each recurring checklist, e.g. Quarterly HVAC PM.</EmptyState>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <Th>Template</Th>
                <Th>Frequency</Th>
                <Th>Activities</Th>
                <Th>Photos</Th>
                <Th>Stores</Th>
                <Th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => {
                const items = t.items.filter((i) => i.active);
                const ba = items.filter((i) => i.photo_rule === "before_after").length;
                const one = items.filter((i) => i.photo_rule === "single").length;
                return (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <Td>
                      <Link href={`/pm/templates/${t.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                        {t.name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        {t.category}
                        {!t.active && " · archived"}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtFreq(t.frequency_interval, t.frequency_unit)}</Td>
                    <Td>{items.length}</Td>
                    <Td className="text-xs text-slate-600">
                      {ba > 0 && <div>{ba} before &amp; after</div>}
                      {one > 0 && <div>{one} one photo</div>}
                    </Td>
                    <Td>
                      <Badge tone={t.schedules.some((s) => s.active) ? "good" : "neutral"} dot={false}>
                        {t.schedules.filter((s) => s.active).length}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      {t.active && (
                        <Link href={`/pm/templates/rollout?template=${t.id}`} className="text-xs font-medium text-brand-700 hover:underline">
                          Roll out
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
