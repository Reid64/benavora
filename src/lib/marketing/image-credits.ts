// Real license and attribution data for every licensed photograph on the
// marketing site, sourced from the Openverse API (api.openverse.org), which
// indexes Creative Commons and public-domain works. Nothing here is
// AI-generated. Fields are copied verbatim from the Openverse record (title,
// creator, license) so the attribution shown to visitors is accurate and
// verifiable at `openverseUrl`.

export type ImageCredit = {
  /** Width/height in pixels, used to size the next/image element correctly. */
  width: number;
  height: number;
  /** Title as recorded by the source provider (e.g. a Flickr photo title). */
  title: string;
  creator: string;
  creatorUrl: string;
  /** Short license slug as used by Creative Commons, e.g. "CC BY 2.0". */
  licenseLabel: string;
  licenseUrl: string;
  /** The original photo page on the source platform (e.g. Flickr). */
  sourceUrl: string;
  /** The Openverse record this credit data was read from. */
  openverseUrl: string;
  provider: string;
};

export const IMAGE_CREDITS: Record<string, ImageCredit> = {
  "solutions/housing.jpg": {
    width: 1024,
    height: 678,
    title: "707th Airmen revamp abandoned houses",
    creator: "Fort George G. Meade",
    creatorUrl: "https://www.flickr.com/photos/64000826@N08",
    licenseLabel: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourceUrl: "https://www.flickr.com/photos/64000826@N08/7163877571",
    openverseUrl: "https://openverse.org/image/a742e02c-e38a-4d59-a37c-3d0285fc027c",
    provider: "Flickr",
  },
  "solutions/faith-based.jpg": {
    width: 576,
    height: 1024,
    title: "Little Food Pantry at Unitarian Universalist Church in Eugene, Oregon",
    creator: "Only in Oregon",
    creatorUrl: "https://www.flickr.com/photos/46052415@N08",
    licenseLabel: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourceUrl: "https://www.flickr.com/photos/46052415@N08/50373369437",
    openverseUrl: "https://openverse.org/image/044db063-75fb-414c-afd5-88b998b984ed",
    provider: "Flickr",
  },
  "solutions/veterans.jpg": {
    width: 1024,
    height: 768,
    title: "240722 SecVA DelBenFair 12",
    creator: "U.S. Department of Veterans Affairs",
    creatorUrl: "https://www.flickr.com/photos/44636446@N04",
    licenseLabel: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://www.flickr.com/photos/44636446@N04/54276312256",
    openverseUrl: "https://openverse.org/image/73d49923-7cf2-4c6e-b3fb-35713446c756",
    provider: "Flickr",
  },
  "solutions/education.jpg": {
    width: 1024,
    height: 683,
    title: "First grade reading - small group breakout",
    creator: "woodleywonderworks",
    creatorUrl: "https://www.flickr.com/photos/73645804@N00",
    licenseLabel: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourceUrl: "https://www.flickr.com/photos/73645804@N00/4005631298",
    openverseUrl: "https://openverse.org/image/b970510b-0754-4887-9a25-5566833766e3",
    provider: "Flickr",
  },
  "solutions/human-services.jpg": {
    width: 1024,
    height: 678,
    title: "20111031-FNS-LSC-0313",
    creator: "USDAgov",
    creatorUrl: "https://www.flickr.com/photos/41284017@N08",
    licenseLabel: "CC BY 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    sourceUrl: "https://www.flickr.com/photos/41284017@N08/6764107675",
    openverseUrl: "https://openverse.org/image/3d7dd4ef-4942-4de7-8462-304545d550c8",
    provider: "Flickr",
  },
  "solutions/community-development.jpg": {
    width: 948,
    height: 1024,
    title: "20170405-AMS-LSC-2037",
    creator: "USDAgov",
    creatorUrl: "https://www.flickr.com/photos/41284017@N08",
    licenseLabel: "Public Domain Mark 1.0",
    licenseUrl: "https://creativecommons.org/publicdomain/mark/1.0/",
    sourceUrl: "https://www.flickr.com/photos/41284017@N08/33049917214",
    openverseUrl: "https://openverse.org/image/dd2bd05e-3e19-4d87-81f8-1c460fbc55a3",
    provider: "Flickr",
  },
};
