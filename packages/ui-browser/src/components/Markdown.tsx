import { Fragment, memo, useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { RefractorNode } from "refractor/core";
import { resolveLanguageByAlias } from "@/lib/highlight";
import { cn } from "@/lib/utils";

type Props = {
  source: string;
  className?: string;
};

const renderHast = (node: RefractorNode, key: number): ReactNode => {
  if (node.type === "text") return node.value;
  const rawCls = node.properties.className;
  const className = Array.isArray(rawCls) ? rawCls.join(" ") : undefined;
  return (
    <span key={key} className={className}>
      {node.children.map((child, i) => renderHast(child, i))}
    </span>
  );
};

const PrismBlock = ({
  code,
  language,
}: {
  code: string;
  language: string | undefined;
}) => {
  const [tree, setTree] = useState<RefractorNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    if (!language) return undefined;
    void (async () => {
      const resolved = await resolveLanguageByAlias(language);
      if (cancelled || !resolved) return;
      try {
        const nodes = resolved.refractor.highlight(code, resolved.language);
        if (!cancelled) setTree(nodes);
      } catch {
        if (!cancelled) setTree(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  return (
    <pre className="my-2 overflow-x-auto rounded-md border bg-muted p-3 text-xs">
      <code>
        {tree
          ? tree.map((node, i) => (
              <Fragment key={i}>{renderHast(node, i)}</Fragment>
            ))
          : code}
      </code>
    </pre>
  );
};

export const Markdown = memo(({ source, className }: Props) => (
  <div
    className={cn(
      "prose prose-sm max-w-none break-words text-sm leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0",
      className,
    )}
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code(props) {
          const { className: cls, children, node: _node, ...rest } = props;
          const match = /language-(\w+)/.exec(cls ?? "");
          const code = (typeof children === "string" ? children : "").replace(
            /\n$/,
            "",
          );
          if (match) {
            return <PrismBlock code={code} language={match[1]} />;
          }
          return (
            <code
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
              {...rest}
            >
              {children}
            </code>
          );
        },
        a(props) {
          return (
            <a
              {...props}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            />
          );
        },
      }}
    >
      {source}
    </ReactMarkdown>
  </div>
));
Markdown.displayName = "Markdown";
