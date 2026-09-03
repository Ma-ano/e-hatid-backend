import type { GeographicLocation } from "../models/geographicLocation.js";
import type { RiderRecruitmentLocation } from "../models/riderRecruitmentLocation.js";

type Geo = GeographicLocation & { _id: unknown };
type Recruitment = RiderRecruitmentLocation & { _id: unknown };

export interface RiderPageData {
  recruitment: Recruitment;
  location: Geo;
  ancestors: Geo[];
  related: Array<{ slug: string; displayName: string; recruitmentStatus: string }>;
  childLocations: Array<{ slug: string; displayName: string; geographicLevel: string; recruitmentStatus: string }>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function statusLabel(status: string): string {
  return ({
    active: "Applications open",
    coming_soon: "Recruitment not currently open",
    paused: "Applications paused",
    closed: "Applications closed",
    inactive: "Location inactive",
  } as Record<string, string>)[status] ?? "Status unavailable";
}

function shell(options: {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  body: string;
  jsonLd?: unknown[];
}): string {
  const speedInsightsBootstrap = "window.si=window.si||function(){(window.siq=window.siq||[]).push(arguments)};";
  const scripts = (options.jsonLd ?? [])
    .map((item) => `<script type="application/ld+json">${safeJsonLd(item)}</script>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(options.title)}</title>
  <meta name="description" content="${escapeHtml(options.description)}">
  <meta name="robots" content="${escapeHtml(options.robots)}">
  <link rel="canonical" href="${escapeHtml(options.canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="E-Hatid">
  <meta property="og:title" content="${escapeHtml(options.title)}">
  <meta property="og:description" content="${escapeHtml(options.description)}">
  <meta property="og:url" content="${escapeHtml(options.canonical)}">
  <meta name="twitter:card" content="summary">
  ${scripts}
  <script>${speedInsightsBootstrap}</script>
  <script defer src="/_vercel/speed-insights/script.js" data-sdkn="@vercel/speed-insights/html"></script>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b;background:#fafafa;line-height:1.55}*{box-sizing:border-box}body{margin:0}a{color:inherit}.topbar{background:#fff;border-bottom:1px solid #e4e4e7}.wrap{width:min(1120px,calc(100% - 32px));margin:auto}.topbar .wrap{display:flex;align-items:center;justify-content:space-between;min-height:68px}.brand{text-decoration:none;font-weight:900;color:#4c1d95;font-size:1.25rem}.nav{display:flex;gap:18px;font-weight:700;font-size:.9rem}.nav a{text-decoration:none}.hero{padding:60px 0 36px;background:linear-gradient(145deg,#f5f3ff,#fff 58%,#ecfdf5)}.crumbs{font-size:.86rem;color:#71717a;margin-bottom:22px}.crumbs a{color:#5b21b6}.badge{display:inline-flex;border-radius:999px;background:#fff;border:1px solid #d4d4d8;padding:7px 12px;font-size:.8rem;font-weight:800;color:#52525b}.hero h1{max-width:820px;font-size:clamp(2rem,5vw,4.2rem);line-height:1.04;letter-spacing:-.045em;margin:18px 0}.lede{font-size:1.08rem;max-width:760px;color:#52525b}.cta{display:inline-flex;margin-top:24px;padding:13px 20px;background:#5b21b6;color:#fff;text-decoration:none;border-radius:999px;font-weight:800}.cta:hover{background:#3b0764}.grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(260px,.75fr);gap:28px;padding:38px 0 64px}.card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;padding:24px;margin-bottom:20px;box-shadow:0 8px 28px rgba(39,39,42,.04)}h2{font-size:1.35rem;margin:0 0 12px}ul{padding-left:20px}.links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;list-style:none;padding:0}.links a{display:block;border:1px solid #e4e4e7;border-radius:12px;padding:12px;text-decoration:none;font-weight:700}.links a:hover{border-color:#8b5cf6;color:#5b21b6}.notice{background:#fffbeb;border-color:#fde68a;color:#78350f}.faq details{border-top:1px solid #e4e4e7;padding:14px 0}.faq summary{cursor:pointer;font-weight:800}.faq p{color:#52525b}.muted{color:#71717a;font-size:.9rem}.footer{border-top:1px solid #e4e4e7;background:#fff;padding:28px 0;color:#71717a;font-size:.85rem}.footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}@media(max-width:760px){.nav a:first-child{display:none}.hero{padding-top:38px}.grid{grid-template-columns:1fr}.links{grid-template-columns:1fr}.wrap{width:min(100% - 24px,1120px)}}
  </style>
</head>
<body>
  <header class="topbar"><div class="wrap"><a class="brand" href="/">E-Hatid</a><nav class="nav" aria-label="Primary"><a href="/stalls">Marketplace</a><a href="/riders">Rider locations</a><a href="/become-rider">Apply</a></nav></div></header>
  ${options.body}
  <footer class="footer"><div class="wrap"><span>© ${new Date().getUTCFullYear()} E-Hatid</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></div></footer>
</body>
</html>`;
}

export function renderRiderLocationPage(data: RiderPageData, siteUrl: string): string {
  const { recruitment, location } = data;
  const canonical = `${siteUrl}/riders/${recruitment.slug}`;
  const breadcrumbItems = [
    { name: "Home", item: `${siteUrl}/` },
    { name: "Rider locations", item: `${siteUrl}/riders` },
    ...data.ancestors.map((item) => ({ name: item.displayName, item: `${siteUrl}/riders/${item.slug}` })),
    { name: location.displayName, item: canonical },
  ];
  const jsonLd: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "E-Hatid",
      url: siteUrl,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: breadcrumbItems.map((item, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: item.name,
        item: item.item,
      })),
    },
  ];
  if (recruitment.faqs.length > 0) {
    jsonLd.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: recruitment.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  if (recruitment.recruitmentStatus === "active" && recruitment.isPublished) {
    const jobPosting: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: recruitment.headline,
      description: recruitment.introduction,
      datePosted: recruitment.publishedAt ?? recruitment.createdAt,
      hiringOrganization: { "@type": "Organization", name: "E-Hatid", sameAs: siteUrl },
      jobLocation: {
        "@type": "Place",
        address: {
          "@type": "PostalAddress",
          addressLocality: location.displayName,
          addressRegion: data.ancestors.at(-1)?.displayName ?? "Luzon",
          addressCountry: "PH",
        },
      },
      employmentType: "CONTRACTOR",
      directApply: false,
    };
    if (recruitment.validThrough) jobPosting.validThrough = recruitment.validThrough;
    if (recruitment.salary) {
      jobPosting.baseSalary = {
        "@type": "MonetaryAmount",
        currency: recruitment.salary.currency,
        value: {
          "@type": "QuantitativeValue",
          minValue: recruitment.salary.minValue,
          maxValue: recruitment.salary.maxValue,
          unitText: recruitment.salary.unitText,
        },
      };
    }
    jsonLd.push(jobPosting);
  }

  const crumbs = breadcrumbItems.map((item, index) => index === breadcrumbItems.length - 1
    ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
    : `<a href="${escapeHtml(item.item.replace(siteUrl, ""))}">${escapeHtml(item.name)}</a>`).join(" / ");
  const list = (items: string[]) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const childLinks = data.childLocations.map((item) => `<li><a href="/riders/${escapeHtml(item.slug)}">${escapeHtml(item.displayName)}<br><span class="muted">${escapeHtml(statusLabel(item.recruitmentStatus))}</span></a></li>`).join("");
  const relatedLinks = data.related.map((item) => `<li><a href="/riders/${escapeHtml(item.slug)}">${escapeHtml(item.displayName)}<br><span class="muted">${escapeHtml(statusLabel(item.recruitmentStatus))}</span></a></li>`).join("");
  const body = `<main>
    <section class="hero"><div class="wrap">
      <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
      <span class="badge">${escapeHtml(statusLabel(recruitment.recruitmentStatus))}</span>
      <h1>${escapeHtml(recruitment.headline)}</h1>
      <p class="lede">${escapeHtml(recruitment.introduction)}</p>
      <a class="cta" href="/become-rider?source=rider-location&amp;location=${encodeURIComponent(recruitment.slug)}" data-cta="rider-location-apply">Go to the rider application</a>
    </div></section>
    <div class="wrap grid"><div>
      ${recruitment.recruitmentStatus !== "active" ? `<section class="card notice"><h2>Current recruitment status</h2><p>${escapeHtml(statusLabel(recruitment.recruitmentStatus))}. Submitting an application does not guarantee approval or confirm local availability.</p></section>` : ""}
      <section class="card"><h2>About ${escapeHtml(location.displayName)}</h2><ul>${list(recruitment.localInformation)}</ul><p class="muted">Geographic reference: Philippine Statistics Authority PSGC ${escapeHtml(location.source.version)}.</p></section>
      <section class="card"><h2>How the E-Hatid rider process works</h2><ul>${list(recruitment.benefits)}</ul></section>
      <section class="card"><h2>Application requirements</h2><ul>${list(recruitment.requirements)}</ul>${recruitment.applicationNotes ? `<p class="muted">${escapeHtml(recruitment.applicationNotes)}</p>` : ""}</section>
      ${data.childLocations.length > 0 ? `<section class="card"><h2>Locations in ${escapeHtml(location.displayName)}</h2><ul class="links">${childLinks}</ul></section>` : ""}
      <section class="card faq"><h2>Frequently asked questions</h2>${recruitment.faqs.map((faq) => `<details><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p></details>`).join("")}</section>
    </div><aside>
      <section class="card"><h2>Official location reference</h2><p><strong>${escapeHtml(location.displayName)}</strong></p><p class="muted">PSGC code ${escapeHtml(location.psgcCode)}<br>${escapeHtml(location.geographicLevel)} · Luzon</p></section>
      ${data.related.length > 0 ? `<section class="card"><h2>Nearby rider pages</h2><ul class="links">${relatedLinks}</ul></section>` : ""}
    </aside></div>
  </main>`;
  return shell({
    title: recruitment.seoTitle,
    description: recruitment.metaDescription,
    canonical,
    robots: recruitment.isIndexable && recruitment.recruitmentStatus === "active" ? "index,follow" : "noindex,follow",
    body,
    jsonLd,
  });
}

export function renderRiderHubPage(items: Array<{ slug: string; displayName: string; recruitmentStatus: string }>, siteUrl: string): string {
  const body = `<main><section class="hero"><div class="wrap"><span class="badge">Official PSGC-backed locations</span><h1>E-Hatid rider locations</h1><p class="lede">Browse location-specific rider application information. Each page shows its current recruitment status; a listed location does not automatically mean applications are open.</p><a class="cta" href="/become-rider">Go to the rider application</a></div></section><div class="wrap grid"><section class="card"><h2>Location pages</h2><ul class="links">${items.map((item) => `<li><a href="/riders/${escapeHtml(item.slug)}">${escapeHtml(item.displayName)}<br><span class="muted">${escapeHtml(statusLabel(item.recruitmentStatus))}</span></a></li>`).join("")}</ul></section><aside><section class="card"><h2>Before you apply</h2><p class="muted">Applications use your existing E-Hatid account and are reviewed by an administrator. Approval and local recruitment availability are not guaranteed.</p></section></aside></div></main>`;
  return shell({
    title: "E-Hatid rider locations in Luzon",
    description: "Browse E-Hatid rider application information and current recruitment status for supported locations in Luzon.",
    canonical: `${siteUrl}/riders`,
    robots: "index,follow",
    body,
    jsonLd: [{ "@context": "https://schema.org", "@type": "Organization", name: "E-Hatid", url: siteUrl }],
  });
}

export function renderSeoNotFound(siteUrl: string): string {
  return shell({
    title: "Rider location not found | E-Hatid",
    description: "The requested E-Hatid rider location page could not be found.",
    canonical: `${siteUrl}/riders`,
    robots: "noindex,nofollow",
    body: `<main><section class="hero"><div class="wrap"><span class="badge">404</span><h1>Rider location not found</h1><p class="lede">This page is unavailable or has not been published.</p><a class="cta" href="/riders">Browse rider locations</a></div></section></main>`,
  });
}
