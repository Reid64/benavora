import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import { listPages, getPage } from "@/lib/marketing/content";
import { marketingMetadata } from "@/lib/marketing/seo";
import {
  PlatformTemplate,
  SolutionTemplate,
  SingleTemplate,
} from "@/components/marketing/PageTemplates";

export const dynamicParams = false;

export function generateStaticParams() {
  return listPages().map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string[] };
}): Promise<Metadata> {
  const page = getPage(params.slug);
  if (!page) return {};
  return marketingMetadata(`/${params.slug.join("/")}`, page.meta.title, page.meta.description);
}

export default async function MarketingContentPage({
  params,
}: {
  params: { slug: string[] };
}) {
  const page = getPage(params.slug);
  if (!page) {
    notFound();
  }

  const { content } = await compileMDX({
    source: page.content,
    options: { parseFrontmatter: false },
  });

  const related = (page.meta.related ?? []).map((href) => {
    const target = getPage(href.split("/").filter(Boolean));
    return { href, title: target?.meta.title ?? href };
  });

  switch (page.meta.layout) {
    case "platform":
      return (
        <PlatformTemplate page={page} related={related}>
          {content}
        </PlatformTemplate>
      );
    case "solution":
      return <SolutionTemplate page={page}>{content}</SolutionTemplate>;
    case "single":
    default:
      return <SingleTemplate page={page}>{content}</SingleTemplate>;
  }
}
