// ============================================================================
// PT-01-004 -- interactive element wiring crawl (every <a> and <button>)
//
// Deeper than PT-01-002 (route-level render pass) and PT-01-003 (known-nav
// click-through): this script enumerates EVERY <a> and every button-like
// element ([role="button"] included) actually present in the rendered DOM of
// each crawled page -- not just the elements this repo's own nav-items.ts
// already documents -- and classifies each one:
//
//   links   -> resolve href. "#"/""/javascript:void(...) = dead. An in-page
//              "#some-id" fragment is checked against a real matching id on
//              the page. A same-origin path is cross-referenced against
//              already-computed PT-01-002/003 evidence where possible (reuse,
//              not re-verify); anything novel gets a real authenticated
//              same-origin HTTP check (never a full browser navigation for
//              this pass -- see "Live-check method" below). External links
//              (different host) get a well-formed-URL check only, never a
//              live network fetch to a third party -- explicitly out of this
//              audit's scope and a real risk in a sandboxed run.
//   buttons -> classified by inspecting the DOM node's bound handler, per
//              the task's explicit instruction to detect wiring "by
//              inspecting the handler binding, not by firing it": read the
//              element's own React fiber props (the `__reactProps$<id>` /
//              `__reactEventHandlers$<id>` key React attaches directly to
//              the DOM node) for a function onClick/onPointerDown/onMouseDown;
//              fall back to a legacy inline onclick="" attribute; fall back
//              to "rides on an ancestor <a href>" (click bubbles to a real
//              link); fall back to native <button type=submit> inside a
//              <form> that itself has a real onSubmit prop or action attr.
//              No case ever calls .click() -- purely static DOM/props
//              inspection.
//
// Live-check method for a same-origin href with no reusable prior evidence:
// an authenticated same-origin fetch() (this session's real login cookies
// attached), not a second Playwright navigation. Reasons: (1) Next.js's App
// Router returns a real HTTP 404 status for a route with no matching page
// file -- exactly the "404 destination = finding" case this task asks for --
// so a raw status check catches it; (2) some hrefs point at API/download
// routes, not page routes, and a full page.goto() on those can hang waiting
// on a download rather than a navigation; (3) it is far cheaper, so the
// crawl finishes in one sitting. The one thing a raw fetch cannot see is a
// client-side "soft 404" (a real page.tsx that renders "not found" for an
// invalid but well-formed id) -- PT-01-002 already covers that class of
// check for every route in the manifest via real DOM assertions, and is the
// preferred source whenever a novel href matches one of those routes; this
// script's own fetch fallback is reserved for hrefs that match no known
// route pattern at all, where the distinction barely matters (an unmapped
// path is either a real 404 or an intentional server-side redirect, both of
// which a status code correctly resolves).
//
// Page set (per this task's own instruction: "primary-nav page (the sidebar
// + header set) and the top 20 most-important sub-pages... use judgment"):
//   - PRIMARY_PAGES: the exact same PRIMARY_NAV_PATHS set PT-01-002 already
//     established and PT-01-003 already click-verified (34 paths) -- reused
//     verbatim rather than re-derived, per this repo's own precedent of not
//     re-deriving an already-confirmed list without cause.
//   - SUB_PAGES: 20 curated one-level-deep pages (list/detail/create/edit
//     views under a primary section) chosen by hand from
//     test-evidence/pt-01/page-routes.json's real 146-route manifest --
//     deliberately excludes anything already in PRIMARY_PAGES.
//
// Auth: same admin-issued magic-link pattern as PT-01-002/003 -- no password
// touched.
//
// Screenshots: every CONFIRMED-BROKEN element gets one screenshot into
// test-evidence/pt-01/dead-ends/, taken on the same already-loaded page (via
// a `data-audit-id` attribute this script stamps onto every scanned element
// before classification, so the exact node can be re-located without a
// second navigation), with the element outlined in red and a caption banner
// naming the failing assertion injected into the page before the shot.
//
// Writes test-evidence/pt-01/element-graph.json.
//
// ASCII only. Node 20 compatible.
// ============================================================================

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const BASE_URL = process.env.PT01_BASE_URL || "http://localhost:3000";
const EMAIL = "info@faithfoundationsf.org";
const RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "element-graph.json");
const DEAD_ENDS_DIR = path.join(REPO_ROOT, "test-evidence", "pt-01", "dead-ends");
const PAGE_ROUTES_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "page-routes.json");
const RENDER_RESULTS_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "render-results.json");
const NAV_RESOLUTION_PATH = path.join(REPO_ROOT, "test-evidence", "pt-01", "nav-resolution.json");

const NAV_TIMEOUT_MS = 30000;
const NETWORK_IDLE_TIMEOUT_MS = 8000;
const SETTLE_MS = 500;
const FETCH_TIMEOUT_MS = 8000;
const MIN_CONTENT_CHARS = 10;

// -- Page set -----------------------------------------------------------------
// PRIMARY_PAGES: verbatim copy of PT-01-002's PRIMARY_NAV_PATHS (34 paths).
const PRIMARY_PAGES = [
  "/alerts", "/activity", "/funders", "/foundations", "/contacts", "/applications",
  "/documents", "/knowledge-base", "/intelligence-library", "/agents/marketplace",
  "/deadlines", "/compliance", "/outcomes", "/financials", "/marketplace",
  "/reports", "/intelligence", "/email", "/outreach",
  "/settings",
  "/command-center", "/admin/orgs", "/admin/system", "/import", "/admin/sales-outreach",
  "/admin/autoapply-ops", "/admin/monitor", "/admin/improvements", "/admin/audit-log",
  "/nonprofits",
  "/dashboard", "/research", "/opportunities", "/autoapply", "/draft-generator", "/donor-discovery",
];

// SUB_PAGES: 20 curated, one level under a primary section, chosen from the
// real 146-route manifest. Each entry names the resolver key (if dynamic)
// used against test-evidence/pt-01/page-routes.json's resolver table below.
const SUB_PAGES = [
  { path: "/applications/list", dynamic: false },
  { path: "/applications/new", dynamic: false },
  { path: "/applications/[id]", dynamic: true, resolver: "applications" },
  { path: "/opportunities/new", dynamic: false },
  { path: "/opportunities/[id]", dynamic: true, resolver: "opportunities" },
  { path: "/draft-generator/[id]", dynamic: true, resolver: "applications" },
  { path: "/donor-discovery/prospects", dynamic: false },
  { path: "/donor-discovery/discover", dynamic: false },
  { path: "/funders/[id]", dynamic: true, resolver: "funders" },
  { path: "/foundations/[id]", dynamic: true, resolver: "foundation_directory" },
  { path: "/settings/organization-setup", dynamic: false },
  { path: "/settings/integrations", dynamic: false },
  { path: "/settings/billing", dynamic: false },
  { path: "/settings/agents", dynamic: false },
  { path: "/admin/orgs/[id]", dynamic: true, resolver: "organizations" },
  { path: "/agents/marketplace/[agentId]", dynamic: true, resolver: "agent_registry" },
  { path: "/knowledge-base/edit", dynamic: false },
  { path: "/intelligence/twin", dynamic: false },
  { path: "/reports/roi", dynamic: false },
  { path: "/autoapply/controls", dynamic: false },
];

function loadEnv() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

async function loginAsFaith(env, context) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const verifyResp = await fetch(linkData.properties.action_link, { redirect: "manual" });
  const hash = (verifyResp.headers.get("location") || "").split("#")[1];
  if (!hash) throw new Error("magic link did not return a redirect with an auth fragment");
  const params = new URLSearchParams(hash);
  const { createServerClient } = await import("@supabase/ssr");
  const setCookies = [];
  const authForCookies = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => [], setAll: (list) => setCookies.push(...list) },
  });
  const { error: sessErr } = await authForCookies.auth.setSession({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
  });
  if (sessErr) throw new Error(`setSession failed: ${sessErr.message}`);
  await context.addCookies(
    setCookies.map((c) => ({ name: c.name, value: c.value, domain: "localhost", path: "/" }))
  );
  return admin;
}

async function resolveDynamicIds(admin, orgId) {
  async function scoped(table) {
    const { data, error } = await admin.from(table).select("id").eq("organization_id", orgId).limit(1);
    if (error) return { value: null, idSource: "placeholder-no-data", queryError: error.message };
    return data && data[0] ? { value: data[0].id, idSource: "real" } : { value: null, idSource: "placeholder-no-data" };
  }
  async function unscoped(table, idColumn = "id") {
    const { data, error } = await admin.from(table).select(idColumn).limit(1);
    if (error) return { value: null, idSource: "placeholder-no-data", queryError: error.message };
    return data && data[0] ? { value: data[0][idColumn], idSource: "real" } : { value: null, idSource: "placeholder-no-data" };
  }
  return {
    applications: await scoped("applications"),
    opportunities: await scoped("opportunities"),
    funders: await scoped("funders"),
    foundation_directory: await unscoped("foundation_directory"),
    organizations: { value: orgId, idSource: "real" },
    agent_registry: await unscoped("agent_registry", "agent_id"),
  };
}

const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";
function fillDynamicPath(routePath, resolvedIds, resolverKey) {
  const res = resolvedIds[resolverKey];
  const value = (res && res.value) || PLACEHOLDER_UUID;
  return { filled: routePath.replace(/\[[^\]]+\]/g, value), idSource: res ? res.idSource : "placeholder-no-data" };
}

// -- Shared classifiers (same signatures as PT-01-002/003) -------------------

function isLoadingOnly(text) {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return false;
  return /^(loading|loading\.{1,3}|please wait\.{0,3}|please wait|one moment\.{0,3})$/.test(t);
}

function detectErrorBoundary(bodyText, htmlLower) {
  if (htmlLower.includes("nextjs-portal") && htmlLower.includes("runtime error")) {
    return "Next.js dev error overlay (Unhandled Runtime Error)";
  }
  if (/application error: a client-side exception has occurred/i.test(bodyText)) {
    return "React client-side exception boundary";
  }
  if (/unhandled runtime error/i.test(bodyText)) {
    return "Unhandled Runtime Error text present";
  }
  if (/^\s*500\s*$/i.test(bodyText.trim())) {
    return "bare 500 body";
  }
  if (/internal server error/i.test(bodyText) && !/this page could not be found/i.test(bodyText)) {
    return "Internal Server Error text present";
  }
  return null;
}

function detect404(bodyText) {
  return /this page could not be found/i.test(bodyText);
}

// Replicates PT-01-002's isFailure() exactly, for reusing render-results.json rows.
function renderResultIsFailure(r) {
  if (r.navigationError) return true;
  if (r.errorBoundaryInDom) return true;
  if (r.httpStatus !== null && r.httpStatus >= 500) return true;
  if (!r.hasRealContent) return true;
  return false;
}

// -- Route-manifest matching --------------------------------------------------

function loadRouteManifest() {
  const j = JSON.parse(fs.readFileSync(PAGE_ROUTES_PATH, "utf8"));
  return j.pageRoutes.map((r) => ({
    ...r,
    regex: r.dynamic ? new RegExp("^" + r.path.replace(/\[[^\]]+\]/g, "[^/]+").replace(/\//g, "\\/") + "$") : null,
  }));
}

function matchRoute(routes, normalizedPath) {
  for (const r of routes) {
    if (!r.dynamic && r.path === normalizedPath) return r;
  }
  for (const r of routes) {
    if (r.dynamic && r.regex.test(normalizedPath)) return r;
  }
  return null;
}

function normalizeInternalPath(href) {
  return (href.split("?")[0].split("#")[0] || "/").replace(/\/+$/, "") || "/";
}

// -- In-page element scan (runs inside the browser) ---------------------------

const SCAN_ELEMENTS_FN = () => {
  const out = [];
  let idx = 0;
  const nodes = document.querySelectorAll("a, button, [role=\"button\"]");
  nodes.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const isRoleButton = tag !== "a" && tag !== "button" && el.getAttribute("role") === "button";
    if (tag !== "a" && tag !== "button" && !isRoleButton) return;

    const auditId = "audit-" + idx++;
    el.setAttribute("data-audit-id", auditId);

    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    const label = (el.getAttribute("aria-label") || el.innerText || el.textContent || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 140);

    if (tag === "a") {
      out.push({
        auditId,
        elementType: "a",
        label,
        href: el.getAttribute("href"),
        targetAttr: el.getAttribute("target"),
        visible,
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      });
      return;
    }

    // button (native or role="button")
    let hasHandler = false;
    let handlerSource = null;
    const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
    if (propsKey) {
      const props = el[propsKey];
      if (props && typeof props.onClick === "function") {
        hasHandler = true;
        handlerSource = "reactProps.onClick";
      } else if (props && typeof props.onPointerDown === "function") {
        hasHandler = true;
        handlerSource = "reactProps.onPointerDown";
      } else if (props && typeof props.onMouseDown === "function") {
        hasHandler = true;
        handlerSource = "reactProps.onMouseDown";
      }
    }
    if (!hasHandler) {
      const legacyKey = Object.keys(el).find((k) => k.startsWith("__reactEventHandlers$"));
      if (legacyKey) {
        const props = el[legacyKey];
        if (props && typeof props.onClick === "function") {
          hasHandler = true;
          handlerSource = "reactEventHandlers.onClick";
        }
      }
    }
    if (!hasHandler && el.getAttribute("onclick")) {
      hasHandler = true;
      handlerSource = "inline-onclick-attr";
    }

    const typeAttr = (el.getAttribute("type") || (tag === "button" ? "submit" : "")).toLowerCase();
    const form = el.closest("form");
    let formHasHandler = false;
    if (form) {
      const formPropsKey = Object.keys(form).find((k) => k.startsWith("__reactProps$"));
      if (formPropsKey) {
        const fp = form[formPropsKey];
        formHasHandler = !!(fp && (typeof fp.onSubmit === "function" || fp.action));
      } else if (form.getAttribute("action")) {
        formHasHandler = true;
      }
    }
    const ancestorLink = el.closest("a[href]");

    out.push({
      auditId,
      elementType: tag === "button" ? "button" : "role_button",
      label,
      visible,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      typeAttr,
      hasHandler,
      handlerSource,
      hasFormAncestor: !!form,
      formHasHandler,
      ancestorLinkHref: ancestorLink ? ancestorLink.getAttribute("href") : null,
    });
  });
  return out;
};

function classifyButtonRow(row) {
  if (row.disabled) {
    return { resolved_status: "disabled_at_load", verdict: "CONFIRMED-OK", target_or_handler: null };
  }
  if (row.hasHandler) {
    return { resolved_status: "has_click_handler", verdict: "CONFIRMED-OK", target_or_handler: row.handlerSource };
  }
  if (row.ancestorLinkHref) {
    return {
      resolved_status: "wired_via_ancestor_link",
      verdict: "CONFIRMED-OK",
      target_or_handler: `ancestor <a href="${row.ancestorLinkHref}">`,
    };
  }
  if (row.typeAttr === "submit" && row.hasFormAncestor && row.formHasHandler) {
    return { resolved_status: "form_submit_wired", verdict: "CONFIRMED-OK", target_or_handler: "ancestor <form> onSubmit/action" };
  }
  if (row.typeAttr === "submit" && row.hasFormAncestor && !row.formHasHandler) {
    // Not a finding: a plain HTML <form> with no onSubmit/action still has a
    // real, well-defined action -- the browser's native default (submit to
    // the current URL, method as declared, e.g. method="GET" for a
    // server-rendered searchParams-driven page). There is no such thing as
    // a native <form> submit button that "does nothing" absent JS actively
    // preventing it, and preventDefault() would itself show up as a real
    // onSubmit handler above -- so this branch is never a dead end, only a
    // progressively-enhanced-vs-plain distinction. Confirmed against a real
    // instance: src/app/(dashboard)/nonprofits/page.tsx's search form is a
    // server component with <form method="GET"> and no client JS at all,
    // and clicking Search genuinely navigates to the filtered URL -- this
    // was the one false positive this classifier produced on its first full
    // run (PT-01-004, 2026-08-19), found and fixed the same session.
    return {
      resolved_status: "form_native_submit_no_js_handler",
      verdict: "CONFIRMED-OK",
      target_or_handler: `ancestor <form> (native ${row.typeAttr === "submit" ? "submit" : ""} -- no onSubmit/action, real browser default applies)`,
    };
  }
  if (row.typeAttr === "submit" && !row.hasFormAncestor) {
    return {
      resolved_status: "submit_button_no_form",
      verdict: "CONFIRMED-BROKEN",
      target_or_handler: "type=submit with no ancestor <form>",
    };
  }
  return { resolved_status: "no_handler_detected", verdict: "CONFIRMED-BROKEN", target_or_handler: null };
}

async function classifyLinkRow(row, ctx) {
  const href = row.href;
  if (href === null || href === undefined || href.trim() === "" || href.trim() === "#") {
    return { resolved_status: "dead_href_empty_or_bare_hash", verdict: "CONFIRMED-BROKEN", target_or_handler: href ?? "" };
  }
  if (/^javascript:\s*(void\(0?\))?\s*;?\s*$/i.test(href.trim())) {
    return { resolved_status: "dead_href_javascript_void", verdict: "CONFIRMED-BROKEN", target_or_handler: href };
  }
  if (href.startsWith("#")) {
    const targetId = href.slice(1);
    const exists = await ctx.page.evaluate((id) => !!document.getElementById(id), targetId).catch(() => false);
    return exists
      ? { resolved_status: "in_page_anchor_valid", verdict: "CONFIRMED-OK", target_or_handler: href }
      : { resolved_status: "in_page_anchor_missing_target", verdict: "CONFIRMED-BROKEN", target_or_handler: href };
  }
  if (/^mailto:/i.test(href)) {
    const ok = /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+/i.test(href);
    return ok
      ? { resolved_status: "mailto_format_ok", verdict: "CONFIRMED-OK", target_or_handler: href }
      : { resolved_status: "malformed_mailto", verdict: "CONFIRMED-BROKEN", target_or_handler: href };
  }
  if (/^tel:/i.test(href)) {
    const ok = /^tel:[+\d][\d\-().\s]{2,}$/i.test(href);
    return ok
      ? { resolved_status: "tel_format_ok", verdict: "CONFIRMED-OK", target_or_handler: href }
      : { resolved_status: "malformed_tel", verdict: "CONFIRMED-BROKEN", target_or_handler: href };
  }
  if (/^https?:\/\//i.test(href)) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return { resolved_status: "malformed_external_url", verdict: "CONFIRMED-BROKEN", target_or_handler: href };
    }
    if (url.host !== ctx.baseHost) {
      // External host: format-checked only, never live-fetched (see file header).
      return { resolved_status: "external_link_not_live_checked", verdict: "CONFIRMED-OK", target_or_handler: href };
    }
    // Same-origin but written as an absolute URL -- fall through to internal handling.
    return classifyInternalHref(url.pathname + url.search, href, ctx);
  }
  // Relative / absolute-path internal href.
  return classifyInternalHref(href, href, ctx);
}

async function classifyInternalHref(pathAndQuery, rawHref, ctx) {
  const normalized = normalizeInternalPath(pathAndQuery);

  // 1. Exact reuse: PT-01-003 already click-verified this literal href.
  const navHit = ctx.navByTarget.get(rawHref) || ctx.navByTarget.get(normalized);
  if (navHit) {
    return {
      resolved_status: navHit.resolved_status,
      verdict: navHit.verdict,
      target_or_handler: rawHref,
      reusedFrom: "test-evidence/pt-01/nav-resolution.json",
    };
  }

  // 2. Route-manifest match -> reuse PT-01-002's real DOM-verified render result.
  const route = matchRoute(ctx.routes, normalized);
  if (route) {
    const rr = ctx.renderByPath.get(route.path);
    if (rr) {
      const broken = renderResultIsFailure(rr);
      return {
        resolved_status: broken
          ? rr.navigationError
            ? "navigation_error"
            : rr.errorBoundaryInDom
            ? "error_boundary"
            : rr.httpStatus !== null && rr.httpStatus >= 500
            ? "http_5xx"
            : "blank_render"
          : "renders",
        verdict: broken ? "CONFIRMED-BROKEN" : "CONFIRMED-OK",
        target_or_handler: rawHref,
        reusedFrom: "test-evidence/pt-01/render-results.json",
        reusedRoutePattern: route.path,
      };
    }
    // Route exists in the manifest but PT-01-002 has no row for it (should not
    // normally happen -- manifest and render-results are generated together) --
    // fall through to a live check rather than assume either way.
  }

  // 3. Novel href -- live authenticated same-origin HTTP check (see file header
  //    for why this is a fetch, not a second browser navigation).
  if (ctx.liveCheckCache.has(normalized)) {
    return ctx.liveCheckCache.get(normalized);
  }
  let result;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(ctx.baseUrl + pathAndQuery, {
      headers: { cookie: ctx.cookieHeader },
      redirect: "follow",
      signal: controller.signal,
    }).catch((e) => ({ __fetchError: String(e.message || e) }));
    clearTimeout(t);
    if (resp.__fetchError) {
      result = { resolved_status: "live_check_fetch_error", verdict: "CONFIRMED-BROKEN", target_or_handler: rawHref, liveCheckDetail: resp.__fetchError };
    } else if (resp.status === 404) {
      result = { resolved_status: "404_not_found", verdict: "CONFIRMED-BROKEN", target_or_handler: rawHref, liveCheckDetail: `HTTP ${resp.status}` };
    } else if (resp.status >= 500) {
      result = { resolved_status: "http_5xx", verdict: "CONFIRMED-BROKEN", target_or_handler: rawHref, liveCheckDetail: `HTTP ${resp.status}` };
    } else if (resp.status >= 400) {
      result = { resolved_status: `http_${resp.status}`, verdict: "CONFIRMED-BROKEN", target_or_handler: rawHref, liveCheckDetail: `HTTP ${resp.status}` };
    } else {
      result = {
        resolved_status: "reachable_http_only_not_dom_verified",
        verdict: "CONFIRMED-OK",
        target_or_handler: rawHref,
        liveCheckDetail: `HTTP ${resp.status}`,
      };
    }
  } catch (err) {
    result = { resolved_status: "live_check_error", verdict: "CONFIRMED-BROKEN", target_or_handler: rawHref, liveCheckDetail: String(err.message || err) };
  }
  ctx.liveCheckCache.set(normalized, result);
  return result;
}

// -- Screenshot capture for a CONFIRMED-BROKEN element -------------------------

async function screenshotDeadEnd(page, pagePath, row, classification) {
  fs.mkdirSync(DEAD_ENDS_DIR, { recursive: true });
  const safePage = pagePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "root";
  const safeElement = (row.label || row.elementType).replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40).replace(/^_+|_+$/g, "") || row.auditId;
  const filePath = path.join(DEAD_ENDS_DIR, `${safePage}__${row.elementType}__${safeElement}__${row.auditId}.png`);

  const assertion = `AUDIT DEAD-END | page=${pagePath} | element=${row.elementType} "${(row.label || "").slice(0, 60)}" | assertion FAILED: expected a working destination/handler, got resolved_status="${classification.resolved_status}" target="${classification.target_or_handler || "none"}"`;

  try {
    await page.evaluate(
      ({ auditId, assertionText }) => {
        const el = document.querySelector(`[data-audit-id="${auditId}"]`);
        if (el) {
          el.style.outline = "4px solid #ff0033";
          el.style.outlineOffset = "2px";
          el.scrollIntoView({ block: "center", inline: "center" });
        }
        let banner = document.getElementById("__pt01004_audit_banner__");
        if (!banner) {
          banner = document.createElement("div");
          banner.id = "__pt01004_audit_banner__";
          banner.style.position = "fixed";
          banner.style.top = "0";
          banner.style.left = "0";
          banner.style.right = "0";
          banner.style.zIndex = "2147483647";
          banner.style.background = "#ff0033";
          banner.style.color = "#ffffff";
          banner.style.font = "bold 13px monospace";
          banner.style.padding = "6px 10px";
          banner.style.whiteSpace = "pre-wrap";
          document.body.appendChild(banner);
        }
        banner.textContent = assertionText;
      },
      { auditId: row.auditId, assertionText: assertion }
    );
    await page.waitForTimeout(150);
    await page.screenshot({ path: filePath, fullPage: false, timeout: 10000 });
    await page.evaluate(() => {
      const b = document.getElementById("__pt01004_audit_banner__");
      if (b) b.remove();
    }).catch(() => {});
    return path.relative(REPO_ROOT, filePath).replace(/\\/g, "/");
  } catch (err) {
    return null;
  }
}

// -- Main -----------------------------------------------------------------

async function crawlPage(page, pagePath, category, ctx) {
  console.log(`\n[${category}] ${pagePath}`);
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 300));
  };
  page.on("console", onConsole);

  let navOk = true;
  try {
    await page.goto(ctx.baseUrl + pagePath, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
  } catch (err) {
    navOk = false;
    console.log(`  navigation failed: ${String(err.message || err).split("\n")[0]}`);
  }
  page.off("console", onConsole);

  if (!navOk) {
    return [
      {
        page: pagePath,
        pageCategory: category,
        elementType: "page",
        label: "(page load)",
        target_or_handler: pagePath,
        resolved_status: "page_navigation_failed",
        verdict: "CONFIRMED-BROKEN",
        severity: category === "primary_nav" ? "P0" : "P1",
      },
    ];
  }

  const finalPath = page.url().replace(ctx.baseUrl, "").split("?")[0];
  if (finalPath === "/login") {
    console.log("  WARNING: session redirected to /login -- session likely expired mid-crawl.");
    return [
      {
        page: pagePath,
        pageCategory: category,
        elementType: "page",
        label: "(page load)",
        target_or_handler: pagePath,
        resolved_status: "session_redirected_to_login",
        verdict: "CONFIRMED-BROKEN",
        severity: category === "primary_nav" ? "P0" : "P1",
      },
    ];
  }

  const rawRows = await page.evaluate(SCAN_ELEMENTS_FN);
  console.log(`  ${rawRows.length} element(s) found (a + button + role=button)`);

  const results = [];
  for (const row of rawRows) {
    let classification;
    if (row.elementType === "a") {
      classification = await classifyLinkRow(row, { ...ctx, page });
    } else {
      classification = classifyButtonRow(row);
    }

    const broken = classification.verdict === "CONFIRMED-BROKEN";
    const severity = broken ? (category === "primary_nav" && row.visible ? "P0" : "P1") : null;

    const out = {
      page: pagePath,
      pageCategory: category,
      elementType: row.elementType,
      auditId: row.auditId,
      label: row.label || "(no label)",
      target_or_handler: classification.target_or_handler,
      visible: row.visible,
      disabled: !!row.disabled,
      resolved_status: classification.resolved_status,
      verdict: classification.verdict,
      severity,
    };
    if (classification.reusedFrom) out.reusedFrom = classification.reusedFrom;
    if (classification.reusedRoutePattern) out.reusedRoutePattern = classification.reusedRoutePattern;
    if (classification.liveCheckDetail) out.liveCheckDetail = classification.liveCheckDetail;
    if (row.elementType === "a") {
      out.href = row.href;
      out.targetAttr = row.targetAttr;
    } else {
      out.handlerSource = row.handlerSource || null;
      out.hasFormAncestor = !!row.hasFormAncestor;
      out.ancestorLinkHref = row.ancestorLinkHref || null;
    }

    if (broken) {
      const shot = await screenshotDeadEnd(page, pagePath, row, classification);
      if (shot) out.screenshot = shot;
    }

    results.push(out);
  }

  const brokenCount = results.filter((r) => r.verdict === "CONFIRMED-BROKEN").length;
  console.log(`  ${results.length - brokenCount}/${results.length} CONFIRMED-OK, ${brokenCount} CONFIRMED-BROKEN`);
  return results;
}

async function main() {
  const env = loadEnv();
  console.log(`PT-01-004: base URL ${BASE_URL}`);
  console.log(`PT-01-004: ${PRIMARY_PAGES.length} primary-nav pages + ${SUB_PAGES.length} sub-pages to crawl`);

  const routes = loadRouteManifest();
  const renderResultsFile = JSON.parse(fs.readFileSync(RENDER_RESULTS_PATH, "utf8"));
  const renderByPath = new Map(renderResultsFile.results.map((r) => [r.path, r]));
  const navResolutionFile = JSON.parse(fs.readFileSync(NAV_RESOLUTION_PATH, "utf8"));
  const navByTarget = new Map();
  for (const r of navResolutionFile.results) {
    if (!navByTarget.has(r.target)) navByTarget.set(r.target, r);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const admin = await loginAsFaith(env, context);

  const page = await context.newPage();
  const sanity = await page.goto(BASE_URL + "/dashboard", { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  const sanityPath = page.url().replace(BASE_URL, "").split("?")[0];
  if (sanityPath === "/login") {
    console.error("PT-01-004 FATAL: authenticated session redirected to /login on /dashboard sanity check.");
    await browser.close();
    process.exit(1);
  }
  console.log(`PT-01-004: session sanity check OK (${sanity ? sanity.status() : "?"} on /dashboard)`);

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("organization_id")
    .eq("email", EMAIL)
    .maybeSingle();
  if (profErr || !profile) {
    console.error("PT-01-004 FATAL: could not resolve organization_id for", EMAIL, profErr && profErr.message);
    await browser.close();
    process.exit(1);
  }
  const orgId = profile.organization_id;
  const resolvedIds = await resolveDynamicIds(admin, orgId);
  console.log("PT-01-004: dynamic-route id resolutions:");
  for (const [key, res] of Object.entries(resolvedIds)) {
    console.log(`  ${key} -> idSource=${res.idSource}${res.value ? ` value=${res.value}` : ""}`);
  }

  const cookies = await context.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const baseHost = new URL(BASE_URL).host;

  const ctx = {
    baseUrl: BASE_URL,
    baseHost,
    routes,
    renderByPath,
    navByTarget,
    cookieHeader,
    liveCheckCache: new Map(),
  };

  // Resume support: a prior run (2026-08-19, ~09:55 UTC) checkpointed 22/36
  // primary-nav pages into element-graph.json before its host process was
  // killed (no error in the log -- consistent with a foreground command
  // timeout, not an app-level crash). Checkpointing only ever writes after a
  // page's crawlPage() call fully returns, so every page already present in
  // the file's elements[] is genuinely complete -- safe to skip on resume
  // rather than re-crawl (cheaper, and avoids re-touching whatever made the
  // prior run stall right at /admin/system).
  const allElements = [];
  const donePrimaryPages = new Set();
  const doneSubRoutePatterns = new Set();
  if (fs.existsSync(RESULTS_PATH)) {
    try {
      const prior = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
      if (Array.isArray(prior.elements) && prior.elements.length > 0) {
        allElements.push(...prior.elements);
        for (const p of PRIMARY_PAGES) {
          if (prior.elements.some((r) => r.pageCategory === "primary_nav" && r.page === p)) {
            donePrimaryPages.add(p);
          }
        }
        for (const s of SUB_PAGES) {
          if (prior.elements.some((r) => r.pageCategory === "sub_page" && r.routePattern === s.path)) {
            doneSubRoutePatterns.add(s.path);
          }
        }
        console.log(
          `PT-01-004: resuming from checkpoint -- ${allElements.length} element row(s) already recorded, ` +
            `${donePrimaryPages.size}/${PRIMARY_PAGES.length} primary-nav pages and ` +
            `${doneSubRoutePatterns.size}/${SUB_PAGES.length} sub-pages already done.`
        );
      }
    } catch (err) {
      console.log(`PT-01-004: could not parse prior checkpoint (${err.message}) -- starting fresh.`);
    }
  }

  // Checkpointing: this crawl is long-running (56 pages, live same-origin
  // fetch checks per novel href, per-element screenshots on failures) and can
  // be interrupted by an external timeout before it reaches the last page. A
  // result file written only once at the very end means any interruption
  // loses all progress and leaves verify-pt01-004.mjs with nothing to check
  // (exactly the failure this recovery pass is fixing). Persist after every
  // page instead, so the file on disk always reflects real crawled progress.
  function writeResults(partial) {
    const brokenRows = allElements.filter((r) => r.verdict === "CONFIRMED-BROKEN");
    const p0 = brokenRows.filter((r) => r.severity === "P0").length;
    const p1 = brokenRows.filter((r) => r.severity === "P1").length;

    const byPage = {};
    for (const r of allElements) {
      byPage[r.page] = byPage[r.page] || { total: 0, broken: 0 };
      byPage[r.page].total++;
      if (r.verdict === "CONFIRMED-BROKEN") byPage[r.page].broken++;
    }

    const byResolvedStatus = {};
    for (const r of allElements) {
      byResolvedStatus[r.resolved_status] = (byResolvedStatus[r.resolved_status] || 0) + 1;
    }

    const output = {
      generatedAt: new Date().toISOString(),
      baseUrl: BASE_URL,
      authenticatedAs: EMAIL,
      orgId,
      partial,
      pageSet: {
        primaryNavPages: PRIMARY_PAGES,
        subPages: SUB_PAGES.map((s) => s.path),
      },
      totalPagesCrawled: PRIMARY_PAGES.length + SUB_PAGES.length,
      totalElements: allElements.length,
      elements: allElements,
      summary: {
        confirmedOk: allElements.length - brokenRows.length,
        confirmedBroken: brokenRows.length,
        p0Count: p0,
        p1Count: p1,
        byPage,
        byResolvedStatus,
      },
    };

    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(RESULTS_PATH, JSON.stringify(output, null, 2), "utf8");
    return output;
  }

  for (const p of PRIMARY_PAGES) {
    if (donePrimaryPages.has(p)) {
      console.log(`\n[primary_nav] ${p} -- SKIPPED (already checkpointed from a prior run)`);
      continue;
    }
    const rows = await crawlPage(page, p, "primary_nav", ctx);
    allElements.push(...rows);
    writeResults(true);
  }

  for (const sub of SUB_PAGES) {
    if (doneSubRoutePatterns.has(sub.path)) {
      console.log(`\n[sub_page] ${sub.path} -- SKIPPED (already checkpointed from a prior run)`);
      continue;
    }
    let testedPath = sub.path;
    let idSource = "n/a-static";
    if (sub.dynamic) {
      const filled = fillDynamicPath(sub.path, resolvedIds, sub.resolver);
      testedPath = filled.filled;
      idSource = filled.idSource;
    }
    const rows = await crawlPage(page, testedPath, "sub_page", ctx);
    for (const r of rows) {
      r.routePattern = sub.path;
      r.idSource = idSource;
    }
    allElements.push(...rows);
    writeResults(true);
  }

  await browser.close();

  const output = writeResults(false);
  const brokenRows = output.elements.filter((r) => r.verdict === "CONFIRMED-BROKEN");

  console.log(`\nPT-01-004 DONE: ${allElements.length} element(s) across ${output.totalPagesCrawled} page(s).`);
  console.log(`  ${output.summary.confirmedOk} CONFIRMED-OK, ${brokenRows.length} CONFIRMED-BROKEN (P0=${output.summary.p0Count}, P1=${output.summary.p1Count}).`);
  console.log(`Results written to ${path.relative(REPO_ROOT, RESULTS_PATH)}`);
  if (brokenRows.length > 0) {
    console.log("\nBroken elements:");
    for (const b of brokenRows) {
      console.log(`  [${b.severity}] ${b.page} :: ${b.elementType} "${b.label}" -> ${b.resolved_status}${b.screenshot ? ` (${b.screenshot})` : ""}`);
    }
  }
}

main().catch((err) => {
  console.error("PT-01-004 FATAL:", err);
  process.exit(1);
});
