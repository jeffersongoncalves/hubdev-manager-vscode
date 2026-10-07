import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { Env, defaultName, findSiteByPath, hubdevExecutable, normalizePath, parseSites, readSites, siteUrl } from '../src/core/hubdev';

const sample = `
sites:
    - name: app-state
      domain: app-state.test
      path: C:\\PROJETOS\\Anteloope\\app-state
      doc_root: C:\\PROJETOS\\Anteloope\\app-state\\public
      driver: laravel
      php_version: "8.4"
      database: app_state
      active: true
      mode: traditional
    - name: filakit
      domain: filakit.test
      path: C:\\PROJETOS\\startkit\\filakit
      doc_root: C:\\PROJETOS\\startkit\\filakit\\public
      driver: laravel
      php_version: "8.3"
      database: filakit
      active: false
      mode: docker
`;

function fakeEnv(platform: NodeJS.Platform, files: Record<string, string>, pathEnv = ''): Env {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const all = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  return {
    platform,
    home: platform === 'win32' ? 'C:\\Users\\dev' : '/home/dev',
    programFiles: 'C:\\Program Files',
    pathEnv,
    exists: (p) => all.has(norm(p)),
    read: (p) => all.get(norm(p)) ?? '',
  };
}

describe('sites.yml', () => {
  it('maps every field of every site', () => {
    const sites = parseSites(sample);
    assert.equal(sites.length, 2);
    assert.deepEqual(sites[0], {
      name: 'app-state',
      domain: 'app-state.test',
      path: 'C:\\PROJETOS\\Anteloope\\app-state',
      docRoot: 'C:\\PROJETOS\\Anteloope\\app-state\\public',
      driver: 'laravel',
      phpVersion: '8.4',
      database: 'app_state',
      active: true,
      mode: 'traditional',
    });
    assert.equal(sites[1].active, false);
    assert.equal(sites[1].mode, 'docker');
  });

  it('returns no sites for blank, malformed or keyless input', () => {
    assert.deepEqual(parseSites(''), []);
    assert.deepEqual(parseSites('other: value'), []);
    assert.deepEqual(parseSites('sites: [ : ]: :'), []);
  });

  it('finds the project site regardless of slashes, case and trailing separators', () => {
    const sites = parseSites(sample);
    assert.equal(findSiteByPath(sites, 'c:/projetos/startkit/filakit/')?.name, 'filakit');
    assert.equal(findSiteByPath(sites, 'C:\\other'), undefined);
    assert.equal(normalizePath('C:\\PROJETOS\\App\\'), normalizePath('c:/projetos/app'));
  });

  it('builds names and URLs', () => {
    assert.equal(defaultName('My Project Name'), 'my-project-name');
    assert.equal(defaultName('my_app.v2'), 'my-app-v2');
    assert.equal(siteUrl(parseSites(sample)[0]), 'https://app-state.test');
  });

  it('reads the central sites file from ~/.devhub', () => {
    const env = fakeEnv('linux', { '/home/dev/.devhub/config/sites.yml': sample });
    assert.equal(readSites(env).length, 2);
    assert.deepEqual(readSites(fakeEnv('linux', {})), []);
  });
});

describe('HubDev detection', () => {
  it('finds the Windows install (devhub.exe), then hubdev/devhub on PATH', () => {
    assert.equal(hubdevExecutable(fakeEnv('win32', { 'C:\\Program Files\\HubDev\\HubDev\\devhub.exe': '' })), 'C:\\Program Files\\HubDev\\HubDev\\devhub.exe');
    assert.equal(hubdevExecutable(fakeEnv('win32', { 'D:\\bin\\devhub.exe': '' }, 'D:\\bin')), 'D:\\bin\\devhub.exe');
    assert.equal(hubdevExecutable(fakeEnv('linux', { '/home/dev/.devhub/bin/hubdev': '' })), '/home/dev/.devhub/bin/hubdev');
    assert.equal(hubdevExecutable(fakeEnv('darwin', {})), undefined);
  });
});
