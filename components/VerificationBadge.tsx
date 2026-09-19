"use client";

export default function VerificationBadge({ verified, reason }: { verified: boolean; reason?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        verified ? "bg-moss/15 text-moss" : "bg-amber-100 text-amber-800"
      }`}
      title={reason}
    >
      {verified ? "✓ Verified live" : "⚠ Not verified"}
    </span>
  );
}