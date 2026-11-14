import { personName } from "@/lib/format";

type Person = { id: string; full_name: string | null; email: string | null; role?: string };

/**
 * <option>s for a technician dropdown: technicians only. If the record is already assigned to someone
 * who isn't a tech (e.g. an admin), they stay listed so saving the form doesn't unassign them.
 */
export function TechOptions({ techs, staff = [], current }: { techs: Person[]; staff?: Person[]; current?: string | null }) {
  const extra = current && !techs.some((t) => t.id === current) ? staff.find((p) => p.id === current) : undefined;
  return (
    <>
      {extra && (
        <option value={extra.id}>
          {personName(extra)} (currently assigned)
        </option>
      )}
      {techs.map((t) => (
        <option key={t.id} value={t.id}>
          {personName(t)}
        </option>
      ))}
    </>
  );
}
