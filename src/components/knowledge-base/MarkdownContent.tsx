import { Fragment, type ReactNode } from "react";

/**
 * A dependency-free Markdown renderer for the lightweight subset the
 * {@link NarrativeEditor} toolbar produces: headings (`#`/`##`/`###`),
 * bulleted lists (`- `), block quotes (`> `), and inline **bold** / _italic_.
 *
 * It builds React nodes directly (never dangerouslySetInnerHTML), so stored
 * narrative content can be rendered as rich text without any XSS surface.
 */
export function MarkdownContent({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  if (blocks.length === 0) {
    return <p className="text-sm text-navy-400">No content yet.</p>;
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed text-navy-700">
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

type Block =
  | { type: "heading"; level: 2 | 3 | 4; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "paragraph"; lines: string[] };

/** Group raw lines into headings, lists, quotes, and paragraphs. */
function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", lines: para });
      para = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (trimmed.trim() === "") {
      flushPara();
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const level = (heading[1]!.length + 1) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: heading[2] ?? '' });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const item = trimmed.replace(/^[-*]\s+/, "");
      const last = blocks[blocks.length - 1];
      if (last && last.type === "list") last.items.push(item);
      else blocks.push({ type: "list", items: [item] });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote = trimmed.replace(/^>\s?/, "");
      const last = blocks[blocks.length - 1];
      if (last && last.type === "quote") last.lines.push(quote);
      else blocks.push({ type: "quote", lines: [quote] });
      continue;
    }

    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

function renderBlock(block: Block): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (`h${block.level}` as "h2" | "h3" | "h4");
      const size =
        block.level === 2
          ? "text-lg"
          : block.level === 3
            ? "text-base"
            : "text-sm";
      return (
        <Tag className={`${size} font-semibold text-navy-900`}>
          {renderInline(block.text)}
        </Tag>
      );
    }
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5">
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="border-l border-teal-300 pl-3 italic text-navy-600">
          {block.lines.map((line, i) => (
            <p key={i}>{renderInline(line)}</p>
          ))}
        </blockquote>
      );
    case "paragraph":
      return (
        <p>
          {block.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              {renderInline(line)}
            </Fragment>
          ))}
        </p>
      );
  }
}

/** Render inline **bold** and _italic_ spans within a line of text. */
function renderInline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-navy-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

