"use client";

// components/codespace/fileIcons.tsx
// Small, dependency-free icons for the Codespace file tree and toolbars.

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-[#9aa0a6] transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <path d="M4.2 2.4 7.8 6l-3.6 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const box = "flex h-5 w-5 shrink-0 items-center justify-center text-[#a8adb4]";

function Glyph({ text }: { text: string }) {
  return <span className={`${box} text-[10px] font-bold tracking-tight`}>{text}</span>;
}

export function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop()! : "";

  if (lower === ".gitignore" || lower === ".gitkeep" || lower === ".gitattributes") {
    return (
      <span className={box}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="4" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="12" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M4 5.1v5.8M4 9c0-2 8-1 8-4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  if (ext === "tsx" || ext === "jsx") {
    return (
      <span className={box}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <ellipse cx="8" cy="8" rx="6.4" ry="2.6" stroke="currentColor" strokeWidth="1.1" />
          <ellipse cx="8" cy="8" rx="6.4" ry="2.6" stroke="currentColor" strokeWidth="1.1" transform="rotate(60 8 8)" />
          <ellipse cx="8" cy="8" rx="6.4" ry="2.6" stroke="currentColor" strokeWidth="1.1" transform="rotate(120 8 8)" />
        </svg>
      </span>
    );
  }

  if (ext === "ts") return <Glyph text="TS" />;
  if (ext === "js" || ext === "mjs" || ext === "cjs") return <Glyph text="JS" />;
  if (ext === "css" || ext === "scss" || ext === "less") return <Glyph text="#" />;
  if (ext === "py") return <Glyph text="Py" />;
  if (ext === "md" || ext === "mdx") return <Glyph text="M↓" />;
  if (ext === "sh") return <Glyph text="$_" />;
  if (ext === "json" || lower === ".prettierrc" || lower === ".eslintrc") return <Glyph text="{ }" />;

  if (ext === "html" || ext === "htm" || ext === "vue" || ext === "svelte") {
    return (
      <span className={box}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 1.8h5.2L12.6 5.2V13a1.2 1.2 0 0 1-1.2 1.2H4A1.2 1.2 0 0 1 2.8 13V3A1.2 1.2 0 0 1 4 1.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="m6.6 8.2-1.5 1.4 1.5 1.4M9.4 8.2l1.5 1.4-1.5 1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  if (ext === "svg" || ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif") {
    return (
      <span className={box}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="6" cy="6.5" r="1.1" fill="currentColor" />
          <path d="m2.6 12 3.6-3.4 2.4 2.2 2-1.8 2.8 3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return (
    <span className={box}>
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 1.8h5.2L12.6 5.2V13a1.2 1.2 0 0 1-1.2 1.2H4A1.2 1.2 0 0 1 2.8 13V3A1.2 1.2 0 0 1 4 1.8Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9 2v3.4h3.4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </span>
  );
}