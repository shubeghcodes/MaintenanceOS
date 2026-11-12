"use client";

import { useRef, useState } from "react";

const MAX_DIM = 1800;
const QUALITY = 0.82;

/**
 * File input that shrinks large photos in the browser before upload (phone photos are often 3–8 MB).
 * Keeps uploads fast on cell signal and under hosting request limits. PDFs and small images pass through untouched.
 */
export function PhotoInput({
  name,
  accept = "image/*,application/pdf",
  multiple = true,
  required,
  className,
  capture,
}: {
  name: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  className?: string;
  capture?: "environment" | "user";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function shrink(f: File): Promise<File> {
    if (!f.type.startsWith("image/") || f.type === "image/gif" || f.size < 600_000) return f;
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
      if (!blob || blob.size >= f.size) return f;
      return new File([blob], f.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg", lastModified: f.lastModified });
    } catch {
      return f; // unsupported format in this browser — upload as-is
    }
  }

  return (
    <div>
      <input
        ref={ref}
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        required={required}
        capture={capture}
        className={
          className ??
          "block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        }
        onChange={async (e) => {
          const input = e.currentTarget;
          const files = Array.from(input.files ?? []);
          if (!files.length) return setStatus(null);
          setStatus("Preparing…");
          const form = input.form;
          const buttons = form ? Array.from(form.querySelectorAll<HTMLButtonElement>("button[type=submit]")) : [];
          buttons.forEach((b) => (b.disabled = true));
          const out = await Promise.all(files.map(shrink));
          const dt = new DataTransfer();
          out.forEach((f) => dt.items.add(f));
          input.files = dt.files;
          buttons.forEach((b) => (b.disabled = false));
          const total = out.reduce((s, f) => s + f.size, 0);
          const tooBig = out.filter((f) => f.size > 10 * 1024 * 1024);
          setStatus(
            tooBig.length
              ? `${tooBig.map((f) => f.name).join(", ")} is over 10 MB. Please choose a smaller file.`
              : `${out.length} file${out.length > 1 ? "s" : ""} ready · ${total < 100 * 1024 ? `${Math.max(1, Math.round(total / 1024))} KB` : `${(total / 1024 / 1024).toFixed(1)} MB`}`,
          );
        }}
      />
      {status && <p className="mt-1 text-xs text-slate-500">{status}</p>}
    </div>
  );
}
