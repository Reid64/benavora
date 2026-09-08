import fs from "fs";
import path from "path";
import matter from "gray-matter";

export type PageLayout = "platform" | "solution" | "single";

export type DemoKind = "replay" | "theater" | "analysis" | "pipeline" | "assist" | "none";

export type ProblemPair = {
  problem: string;
  solution: string;
};

export type CapabilityItem = {
  title: string;
  body: string;
  href?: string;
};

export type StepItem = {
  title: string;
  body: string;
  agent: string;
  humanGate: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type PageMeta = {
  slug: string;
  layout: PageLayout;
  title: string;
  description: string;
  eyebrow?: string;
  hero?: string;
  heroImage?: string;
  capabilities?: CapabilityItem[];
  problems?: ProblemPair[];
  steps?: StepItem[];
  faq?: FaqItem[];
  related?: string[];
  demo?: DemoKind;
};

export type MarketingPage = {
  meta: PageMeta;
  content: string;
  filePath: string;
};

const CONTENT_DIR = path.join(process.cwd(), "content", "marketing");

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (entry.isFile() && entry.name.endsWith(".mdx")) return [full];
    return [];
  });
}

function filePathToSlugParts(filePath: string): string[] {
  const rel = path.relative(CONTENT_DIR, filePath);
  const withoutExt = rel.replace(/\.mdx$/, "");
  return withoutExt.split(path.sep);
}

export function listPages(): { slug: string[] }[] {
  return walk(CONTENT_DIR).map((filePath) => ({ slug: filePathToSlugParts(filePath) }));
}

export function readPage(slugParts: string[]): MarketingPage | null {
  const filePath = path.join(CONTENT_DIR, ...slugParts) + ".mdx";
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const meta: PageMeta = {
    ...(data as Omit<PageMeta, "slug">),
    slug: slugParts.join("/"),
  };
  return { meta, content, filePath };
}

export function getPage(slugParts: string[]): MarketingPage | null {
  return readPage(slugParts);
}
