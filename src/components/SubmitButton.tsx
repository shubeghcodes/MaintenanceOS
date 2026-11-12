"use client";

import { useFormStatus } from "react-dom";
import { btnClass } from "./ui";
import type { ReactNode } from "react";

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  pendingText = "Saving…",
  name,
  value,
  confirm,
  formAction,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  pendingText?: string;
  name?: string;
  value?: string;
  confirm?: string;
  /** Per-button server action (e.g. a bound action) — use instead of name/value for multi-button forms. */
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending, data, action } = useFormStatus();
  // In forms with several submit buttons, only the one that was clicked shows the pending label.
  const isMine = pending && (formAction ? action === formAction : !name || data?.get(name) === value);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      aria-busy={isMine}
      className={btnClass(variant, size)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {isMine ? pendingText : children}
    </button>
  );
}
