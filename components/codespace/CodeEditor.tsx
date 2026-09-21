"use client";

// components/codespace/CodeEditor.tsx
// Line numbers + syntax highlighting like the reference design. Editing works
// with the classic overlay technique: a transparent <textarea> sits exactly on
// top of the highlighted <pre>, so what you type is what you see, with no
// editor dependency. Read-only by default (no on-screen keyboard popping up on
// phones); the pencil in the breadcrumb bar turns editing on.

import { useEffect, useMemo, useRef } from "react";
import { highlightCode } from "@/lib/syntaxHighlight";

type Props = {
  path: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
};

const FONT = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

export default function CodeEditor({ path, value, editing, onChange }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const html = useMemo(() => highlightCode(value, path), [value, path]);
  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"), [lineCount]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0, left: 0 });
  }, [path]);

  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  const gutterWidth = `${Math.max(String(lineCount).length, 2) + 2}ch`;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart, selectionEnd } = el;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = selectionStart + 2;
    });
  }

  const textStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 12.5,
    lineHeight: "20px",
    tabSize: 2,
  };

  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-[#1b1b1b]">
      <div className="flex min-h-full w-max min-w-full">
        <pre
          aria-hidden="true"
          className="sticky left-0 z-10 m-0 shrink-0 select-none bg-[#1b1b1b] py-4 pr-3 text-right text-[#6e7681]"
          style={{ ...textStyle, width: gutterWidth }}
        >
          {gutter}
        </pre>

        <div className="relative min-w-0 flex-1 py-4 pr-8">
          <pre
            aria-hidden="true"
            className="m-0 whitespace-pre text-[#d4d4d4]"
            style={textStyle}
            // The trailing newline keeps the last (empty) line the same height as the textarea's.
            dangerouslySetInnerHTML={{ __html: `${html}\n` }}
          />
          <textarea
            ref={area}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            readOnly={!editing}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            aria-label={path}
            className="absolute inset-0 h-full w-full resize-none overflow-hidden border-0 bg-transparent py-4 pr-8 text-transparent caret-white outline-none selection:bg-[#264f78]/70"
            style={{ ...textStyle, whiteSpace: "pre", WebkitTextFillColor: "transparent" }}
          />
        </div>
      </div>
    </div>
  );
}