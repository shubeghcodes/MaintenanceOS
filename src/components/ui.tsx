import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "@/lib/constants";

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-block text-sm text-slate-500 hover:text-slate-800">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={clsx("rounded-xl border border-slate-200 bg-white shadow-sm", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  info: "bg-blue-50 text-blue-800 ring-blue-200",
  good: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  serious: "bg-orange-50 text-orange-900 ring-orange-200",
  critical: "bg-red-50 text-red-800 ring-red-200",
  muted: "bg-slate-50 text-slate-500 ring-slate-200",
};
const DOT_CLASS: Record<Tone, string> = {
  neutral: "bg-slate-400",
  info: "bg-blue-500",
  good: "bg-emerald-500",
  warning: "bg-amber-500",
  serious: "bg-orange-500",
  critical: "bg-red-600",
  muted: "bg-slate-300",
};

export function Badge({ tone = "neutral", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_CLASS[tone],
      )}
    >
      {dot && <span className={clsx("h-1.5 w-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden />}
      {children}
    </span>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const BTN: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  secondary: "bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50",
  danger: "bg-white text-red-700 ring-1 ring-inset ring-red-200 hover:bg-red-50",
  ghost: "text-slate-600 hover:bg-slate-100",
};
export function btnClass(variant: Variant = "primary", size: "sm" | "md" = "md") {
  return clsx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
    BTN[variant],
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  children,
}: {
  href: string;
  variant?: Variant;
  size?: "sm" | "md";
  children: ReactNode;
}) {
  return (
    <Link href={href} className={btnClass(variant, size)}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button className={clsx(btnClass(variant, size), className)} {...rest} />;
}

const inputBase =
  "block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

/** Lets callers override the default full width (e.g. className="w-auto"). */
const base = (className?: string) => (className && /(^|\s)w-/.test(className) ? inputBase.replace("w-full", "") : inputBase);

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={clsx(base(className), className)} {...rest} />;
}
export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={3} className={clsx(inputBase, className)} {...rest} />;
}
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={clsx(base(className), "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

/** Single-number KPI tile. */
export function Stat({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  href?: string;
}) {
  const inner = (
    <Card className={clsx("h-full p-4", href && "transition hover:border-slate-300 hover:shadow")}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
          {tone && <span className={clsx("h-1.5 w-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden />}
          {sub}
        </div>
      )}
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={clsx("whitespace-nowrap px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-slate-500", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  return (
    <td className={clsx("px-4 py-3 align-top text-slate-700", className)} {...rest}>
      {children}
    </td>
  );
}

export function DefList({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "critical", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={clsx("mb-4 rounded-lg px-4 py-3 text-sm ring-1 ring-inset", TONE_CLASS[tone])}>{children}</div>;
}
