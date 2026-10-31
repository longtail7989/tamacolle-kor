import {createExtensionUpdater} from '../extension-release.mjs';
import {test} from 'node:test';

const equal = (actual, expected, message = '값이 다릅니다.') => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}\nactual: ${JSON.stringify(actual)}\nexpected: ${JSON.stringify(expected)}`);
};
async function rejects(action, pattern) {
  try { await action(); } catch (error) { if (pattern && !pattern.test(error.message)) throw error; return error; }
  throw new Error('오류로 거부되어야 합니다.');
}
const API = 'https://api.github.com/repos/longtail7989/tamacolle-kor/releases/latest';
const TAG = 'resource-v1.0.2';
const ZIP = `tamacolle-kor-0.1.2-extension.zip`;
const DOWNLOAD = `https://github.com/longtail7989/tamacolle-kor/releases/download/${TAG}/${ZIP}`;
const release = () => ({
  draft: false, prerelease: false, tag_name: TAG,
  html_url: `https://github.com/longtail7989/tamacolle-kor/releases/tag/${TAG}`,
  assets: [{name: 'tamacolle-kor-resources.json', browser_download_url: 'https://github.com/longtail7989/tamacolle-kor/releases/download/resource-v1.0.2/tamacolle-kor-resources.json', size: 10}, {name: ZIP, browser_download_url: DOWNLOAD, size: 1024}]
});
function server(value, {status = 200, url} = {}) {
  return async (requested) => {
    equal(requested, API, '릴리스 API만 요청해야 합니다.');
    const response = new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
    if (url) Object.defineProperty(response, 'url', {value: url});
    return response;
  };
}
const tests = [
  ['reports a newer published extension ZIP with its official URL', async () => {
    const result = await createExtensionUpdater({fetchImpl: server(release()), currentVersion: '0.1.1'}).check();
    equal(result, {status: 'available', latest: '0.1.2', url: DOWNLOAD, releaseUrl: `https://github.com/longtail7989/tamacolle-kor/releases/tag/${TAG}`});
  }],
  ['does not notify for the same or an older extension version', async () => {
    for (const currentVersion of ['0.1.2', '0.2.0']) {
      equal((await createExtensionUpdater({fetchImpl: server(release()), currentVersion}).check()).status, 'current');
    }
    const older = release(); older.assets[1].name = 'tamacolle-kor-0.1.0-extension.zip';
    older.assets[1].browser_download_url = `https://github.com/longtail7989/tamacolle-kor/releases/download/${TAG}/tamacolle-kor-0.1.0-extension.zip`;
    equal((await createExtensionUpdater({fetchImpl: server(older), currentVersion: '0.1.1'}).check()).status, 'current');
  }],
  ['unpublished release and missing ZIP stay silent', async () => {
    const unpublished=await createExtensionUpdater({fetchImpl: server({}, {status: 404}), currentVersion: '0.1.1'}).check();equal(unpublished.status,'unpublished');equal(unpublished.latest,'');
    const noZip = release(); noZip.assets = [noZip.assets[0]];
    const missing=await createExtensionUpdater({fetchImpl: server(noZip), currentVersion: '0.1.1'}).check();equal(missing.status,'unpublished');equal(missing.latest,'');
    for (const field of ['draft', 'prerelease']) {
      const hidden = release(); hidden[field] = true;
      equal((await createExtensionUpdater({fetchImpl: server(hidden), currentVersion: '0.1.1'}).check()).status, 'unpublished');
    }
  }],
  ['wrong tag, wrong release URL and wrong asset host fail closed', async () => {
    for (const change of [
      value => { value.tag_name = 'v1.0.2'; },
      value => { value.html_url = 'https://evil.example/release'; }, value => { value.assets[1].browser_download_url = 'https://evil.example/zip'; }
    ]) {
      const value = release(); change(value);
      await rejects(() => createExtensionUpdater({fetchImpl: server(value), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    }
    await rejects(() => createExtensionUpdater({fetchImpl: server(release(), {url: 'https://evil.example/api'}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
  }],
  ['oversized, malformed and failed responses fail closed', async () => {
    const huge = release(); huge.assets[1].size = 64 * 1024 * 1024 + 1;
    await rejects(() => createExtensionUpdater({fetchImpl: server(huge), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    await rejects(() => createExtensionUpdater({fetchImpl: async () => new Response('{', {status: 200}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    await rejects(() => createExtensionUpdater({fetchImpl: server(release(), {status: 500}), currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
    await rejects(() => createExtensionUpdater({fetchImpl: async () => { throw new Error('offline'); }, currentVersion: '0.1.1'}).check(), /^확장 업데이트:/);
  }],
  ['concurrent checks share one request', async () => {
    let calls = 0;
    const updater = createExtensionUpdater({fetchImpl: async requested => { calls++; equal(requested, API); return new Response(JSON.stringify(release()), {status: 200}); }, currentVersion: '0.1.1'});
    const [a, b] = await Promise.all([updater.check(), updater.check()]);
    equal(calls, 1);
    equal(a.status, 'available'); equal(b.status, 'available');
  }]
];

for (const [name, action] of tests) await test(name, action);
