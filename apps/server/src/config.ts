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
  secureCookies: (env.SECURE_COOKIES ?? (env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  bodyLimit: Number(env.BODY_LIMIT_MB ?? 8) * 1024 * 1024,
  /** Pasted pages are kept this long for reparsing after parser fixes; the synced data itself stays. */
  rawRetentionDays: Number(env.RAW_RETENTION_DAYS ?? 14),
  adminBootstrap: {
    username: env.ADMIN_BOOTSTRAP_USER ?? '',
    password: env.ADMIN_BOOTSTRAP_PASSWORD ?? '',
  },
  /** Background archiving of battle hall reports from the public report pages. */
  crawler: {
    enabled: (env.CRAWLER_ENABLED ?? 'true') !== 'false',
    intervalMs: Number(env.CRAWLER_INTERVAL_MS ?? 5000),
    // stop after the game was unreachable this long (resume with the admin button)
    giveUpHours: Number(env.CRAWLER_GIVE_UP_HOURS ?? 6),
  },
};

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
  timezone: 'Europe/Berlin',
  gameUrl: '',
};
