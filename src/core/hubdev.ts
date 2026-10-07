import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

/** One site from HubDev's central ~/.devhub/config/sites.yml. */
export interface HubDevSite {
  name: string;
  domain: string;
  path: string;
  docRoot: string;
  driver: string;
  phpVersion: string;
  database: string;
  active: boolean;
  mode: string;
}

/** Platform/home are injectable so the lookups can be tested on any OS. */
export interface Env {
  platform: NodeJS.Platform;
  home: string;
  programFiles: string;
  pathEnv: string;
  exists: (p: string) => boolean;
  read: (p: string) => string;
}

export function nodeEnv(): Env {
  return {
    platform: process.platform,
    home: os.homedir(),
    programFiles: process.env.ProgramFiles ?? 'C:\\Program Files',
    pathEnv: process.env.PATH ?? '',
    exists: (p) => fs.existsSync(p),
    read: (p) => fs.readFileSync(p, 'utf8'),
  };
}

export function parseSites(content: string): HubDevSite[] {
  try {
    const sites = (parse(content) as { sites?: unknown } | null)?.sites;
    if (!Array.isArray(sites)) {
      return [];
    }
    return sites
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        name: str(s.name),
        domain: str(s.domain),
        path: str(s.path),
        docRoot: str(s.doc_root),
        driver: str(s.driver, 'laravel'),
        phpVersion: str(s.php_version, '8.4'),
        database: str(s.database),
        active: typeof s.active === 'boolean' ? s.active : true,
        mode: str(s.mode, 'traditional'),
      }));
  } catch {
    return [];
  }
}

/** Case/slash/trailing-separator insensitive path key, like the JetBrains plugin. */
export function normalizePath(p: string): string {
  return p.trim().replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
}

export function findSiteByPath(sites: HubDevSite[], projectPath: string | undefined): HubDevSite | undefined {
  if (!projectPath) {
    return undefined;
  }
  const target = normalizePath(projectPath);
  return sites.find((s) => normalizePath(s.path) === target);
}

/** Kebab-cased default site name for a folder. */
export function defaultName(folder: string): string {
  return folder.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
}

export function siteUrl(site: HubDevSite): string {
  // HubDev fronts every site with Caddy + automatic TLS.
  return `https://${site.domain}`;
}

export function sitesFile(env: Env): string {
  return join(env, env.home, '.devhub', 'config', 'sites.yml');
}

export function readSites(env: Env): HubDevSite[] {
  const file = sitesFile(env);
  return env.exists(file) ? parseSites(env.read(file)) : [];
}

/** `hubdev` is the new brand name; Windows installs still ship `devhub.exe`. */
export function hubdevExecutable(env: Env): string | undefined {
  const candidates =
    env.platform === 'win32'
      ? [join(env, env.programFiles, 'HubDev', 'HubDev', 'devhub.exe')]
      : env.platform === 'darwin'
        ? ['/opt/homebrew/bin/hubdev', '/usr/local/bin/hubdev', '/opt/homebrew/bin/devhub', '/usr/local/bin/devhub', join(env, env.home, '.devhub', 'bin', 'hubdev'), join(env, env.home, '.devhub', 'bin', 'devhub')]
        : [join(env, env.home, '.devhub', 'bin', 'hubdev'), join(env, env.home, '.devhub', 'bin', 'devhub'), '/usr/local/bin/hubdev', '/usr/local/bin/devhub'];

  return candidates.find(env.exists) ?? findInPath(env, 'hubdev') ?? findInPath(env, 'devhub');
}

function findInPath(env: Env, command: string): string | undefined {
  const win = env.platform === 'win32';
  for (const dir of env.pathEnv.split(win ? ';' : ':').filter(Boolean)) {
    for (const ext of win ? ['.exe', '.bat', '.cmd', ''] : ['']) {
      const candidate = join(env, dir, command + ext);
      if (env.exists(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function join(env: Env, ...parts: string[]): string {
  return (env.platform === 'win32' ? path.win32 : path.posix).join(...parts);
}

function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}
