import { join } from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3000),
  host: env.HOST ?? '0.0.0.0',
  /** public path prefix, e.g. /hub (no trailing slash) */
  basePath: (env.BASE_PATH ?? '/hub').replace(/\/+$/, ''),
  dataDir: env.DATA_DIR ?? join(process.cwd(), 'data'),
  /** directory with the built SPA (apps/web/dist) */
  webDir: env.WEB_DIR ?? join(process.cwd(), '..', 'web', 'dist'),
  sessionDays: Number(env.SESSION_DAYS ?? 30),
  /**
   * Which proxies may set X-Forwarded-For (Fastify `trustProxy`): a hop count, `true`/`false` or IPs/CIDRs (comma
   * separated). `true` would take the client's own header and let it pick the IP the login limit counts.
   */
  trustProxy: trustProxyOf(env.TRUST_PROXY ?? '1'),
  secureCookies: (env.SECURE_COOKIES ?? (env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  bodyLimit: Number(env.BODY_LIMIT_MB ?? 8) * 1024 * 1024,
  /** Pasted pages are kept this long for reparsing after parser fixes; the synced data itself stays. */
  rawRetentionDays: Number(env.RAW_RETENTION_DAYS ?? 14),
  adminBootstrap: {
    username: env.ADMIN_BOOTSTRAP_USER ?? '',
    password: env.ADMIN_BOOTSTRAP_PASSWORD ?? '',
  },
  /** Web push: contact of the hub's operator for the push services (`mailto:` or `https:`); without it push is off. */
  pushContact: env.PUSH_CONTACT ?? '',
  /** Public origin of the hub (e.g. https://hub.example.org) for links in Discord messages; without it they have none. */
  publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
  /** Base URL of the pr0game tools (with trailing slash) for links from the hub; defaults to the root of the hub's origin. */
  toolsUrl: toolsUrlOf(env.TOOLS_URL, env.PUBLIC_URL),
  /** Background archiving of battle hall reports from the public report pages. */
  crawler: {
    enabled: (env.CRAWLER_ENABLED ?? 'true') !== 'false',
    intervalMs: Number(env.CRAWLER_INTERVAL_MS ?? 5000),
    // stop after the game was unreachable this long (resume with the admin button)
    giveUpHours: Number(env.CRAWLER_GIVE_UP_HOURS ?? 6),
  },
};

function toolsUrlOf(tools?: string, publicUrl?: string): string {
  const base = (tools || publicUrl || '').replace(/\/+$/, '');
  return `${base}/`;
}

function trustProxyOf(v: string): boolean | number | string[] {
  if (v === 'true' || v === 'false') return v === 'true';
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export interface UniverseSettings {
  galaxies: number;
  systems: number;
  positions: number;
  /** wrap-around for galaxy / system distance (uni_type / galaxy_type == 1) */
  circularGalaxies: boolean;
  circularSystems: boolean;
  galaxyDistanceFactor: number;
  systemDistanceFactor: number;
  systemDistance: number;
  planetDistanceFactor: number;
  planetDistance: number;
  /** game config fleet_speed (2500 = 1x) */
  fleetSpeed: number;
  /** game config building_speed (2500 = 1x) for build times; 0 unknown (derived from a synced buildings page) */
  buildingSpeed: number;
  /** game config research_speed (2500 = 1x) for research times; 0 unknown (derived from a synced research page) */
  researchSpeed: number;
  /** game config factor_university: research time −% per TechnoDome level (game default 8) */
  universityFactor: number;
  timezone: string;
  /** game base URL incl. universe path, e.g. https://pr0game.com/uni8/ (for simulator links) */
  gameUrl: string;
}

export const UNIVERSE_DEFAULTS: UniverseSettings = {
  galaxies: 4,
  systems: 400,
  positions: 15,
  circularGalaxies: true,
  circularSystems: true,
  galaxyDistanceFactor: 20000,
  systemDistanceFactor: 95,
  systemDistance: 2700,
  planetDistanceFactor: 5,
  planetDistance: 1000,
  fleetSpeed: 2500,
  buildingSpeed: 0,
  researchSpeed: 0,
  universityFactor: 8,
  timezone: 'Europe/Berlin',
  gameUrl: '',
};
