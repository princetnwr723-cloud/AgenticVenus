"use client";

// components/codespace/FileTree.tsx
// Collapsible folder tree. Folders first, then files (both alphabetical), a
// chevron per folder, an icon per file, and the open file highlighted — the
// same structure as the reference design.

import { useEffect, useMemo, useRef, useState } from "react";
import { Chevron, FileIcon } from "@/components/codespace/fileIcons";

type TreeNode = { name: string; path: string; children?: TreeNode[] };

export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const full of paths) {
    const parts = full.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const isFile = i === parts.length - 1;
      node.children = node.children || [];
      let next = node.children.find((c) => c.name === part && !!c.children === !isFile);
      if (!next) {
        next = isFile ? { name: part, path } : { name: part, path, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      const aDir = !!a.children;
      const bDir = !!b.children;
      if (aDir !== bDir) return aDir ? -1 : 1;
      const aDot = a.name.startsWith(".");
      const bDot = b.name.startsWith(".");
      if (aDot !== bDot) return aDot ? 1 : -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    nodes.forEach((n) => n.children && sort(n.children));
  };
  sort(root.children!);
  return root.children!;
}

function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

type Props = {
  paths: string[];
  activePath: string | null;
  onSelect: (path: string) => void;
};

export default function FileTree({ paths, activePath, onSelect }: Props) {
  const tree = useMemo(() => buildTree(paths), [paths]);
  const seenTop = useRef<Set<string>>(new Set(tree.filter((n) => n.children).map((n) => n.path)));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(seenTop.current));

  // Keep the folders containing the open file expanded; open new top-level folders once.
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (activePath) ancestorsOf(activePath).forEach((p) => next.add(p));
      return next.size === prev.size ? prev : next;
    });
  }, [activePath]);

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      tree.filter((n) => n.children).forEach((n) => {
        if (!seenTop.current.has(n.path)) {
          seenTop.current.add(n.path);
          next.add(n.path);
        }
      });
      return next.size === prev.size ? prev : next;
    });
  }, [tree]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNodes(nodes: TreeNode[], depth: number) {
    return nodes.map((node) => {
      const isDir = !!node.children;
      const isOpen = expanded.has(node.path);
      const isActive = !isDir && node.path === activePath;
      return (
        <div key={node.path}>
          <button
            type="button"
            onClick={() => (isDir ? toggle(node.path) : onSelect(node.path))}
            title={node.path}
            className={`flex h-[34px] w-full items-center gap-2 rounded-lg pr-2 text-left text-[13.5px] transition-colors ${
              isActive ? "bg-[#2d2d2d] text-white" : "text-[#d4d4d4] hover:bg-[#242424]"
            }`}
            style={{ paddingLeft: 10 + depth * 14 }}
          >
            {isDir ? <Chevron open={isOpen} /> : <FileIcon name={node.name} />}
            <span className="truncate">{node.name}</span>
          </button>
          {isDir && isOpen && node.children && renderNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  return <div className="space-y-0.5 py-2 pl-1.5 pr-1">{renderNodes(tree, 0)}</div>;
}