import {MAX_PACK_BYTES, compareVersions, validatePack} from './resource-pack.mjs';

const API = 'https://api.github.com/repos/longtail7989/tamacolle-kor/releases/latest';
const RELEASES = 'https://github.com/longtail7989/tamacolle-kor/releases/';
const ASSET = 'tamacolle-kor-resources.json';
const encoder = new TextEncoder();
const problem = message => new Error(`업데이트: ${message}`);
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

async function withDeadline(milliseconds, task) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(problem('서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.')); }, milliseconds);
  });
  try { return await Promise.race([task(controller.signal), deadline]); }
  finally { clearTimeout(timer); controller.abort(); }
}
async function boundedBytes(response, limit, signal, expectedSize) {
  const header = response.headers?.get('content-length');
  if (header !== null && header !== undefined && (!/^\d+$/.test(header) || Number(header) > limit || (expectedSize !== undefined && Number(header) !== expectedSize))) throw problem('다운로드 파일 크기가 올바르지 않습니다.');
  if (!response.body?.getReader) throw problem('안전한 스트리밍 다운로드를 사용할 수 없습니다.');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      if (signal.aborted) throw problem('다운로드가 취소되었습니다.');
      const {done, value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw problem('잘못된 다운로드 데이터입니다.');
      size += value.byteLength;
      if (size > limit || (expectedSize !== undefined && size > expectedSize)) throw problem('다운로드 파일 크기 제한을 초과했습니다.');
      chunks.push(value);
    }
    if (expectedSize !== undefined && size !== expectedSize) throw problem('파일 다운로드가 완성되지 않았습니다.');
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}
function assetURL(value, tag) {
  const expected = `${RELEASES}download/${tag}/${ASSET}`;
  if (typeof value !== 'string' || value !== expected) throw problem('공식 저장소의 리소스 다운로드 주소가 아닙니다.');
  return expected;
}
function checkFinalURL(response, requested, asset = false) {
  // GitHub's public release endpoint redirects to its signed asset CDN. Never
  // request an API-provided arbitrary URL, and never send credentials to either.
  if (!response.url || response.url === requested) return;
  const url = new URL(response.url);
  if (!asset || url.protocol !== 'https:' || url.hostname !== 'release-assets.githubusercontent.com' || url.port || url.username || url.password) throw problem('예상하지 않은 다운로드 리디렉션입니다.');
}

export function fetchLatestGitHubRelease(fetchImpl = globalThis.fetch) {
  return withDeadline(30000, async signal => {
    const response = await fetchImpl(API, {credentials: 'omit', redirect: 'error', cache: 'no-store', headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}, signal});
    checkFinalURL(response, API);
    if (response.status === 404) return null;
    if (!response.ok) throw problem(`GitHub 릴리스를 확인하지 못했습니다 (HTTP ${response.status}).`);
    const bytes = await boundedBytes(response, 2 * 1024 * 1024, signal);
    try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
    catch { throw problem('GitHub 릴리스 응답이 올바른 JSON이 아닙니다.'); }
  });
}

export function createGitHubUpdater({fetchImpl = globalThis.fetch, getCurrent, apply, extensionVersion = '0.1.0'} = {}) {
  if (typeof fetchImpl !== 'function' || typeof getCurrent !== 'function' || typeof apply !== 'function') throw problem('업데이트 초기화 정보가 없습니다.');
  compareVersions(extensionVersion, extensionVersion);
  let inFlight = null, latestVersion;
  async function check() {
    latestVersion = undefined;
    try {
      const current = await getCurrent();
      if (!current || typeof current.version !== 'string') throw problem('현재 리소스 버전을 읽지 못했습니다.');
      compareVersions(current.version, current.version);
      const release = await fetchLatestGitHubRelease(fetchImpl);
      if (!release || release.draft === true || release.prerelease === true) { latestVersion = ''; return {status: 'unpublished', version: current.version}; }
      if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^resource-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tag_name)) throw problem('리소스 릴리스 태그가 올바르지 않습니다.');
      const version = release.tag_name.slice('resource-v'.length), releaseUrl = `${RELEASES}tag/${release.tag_name}`;
      if (release.html_url !== releaseUrl) throw problem('공식 저장소의 릴리스 주소가 아닙니다.');
      const order = compareVersions(version, current.version);
      if (!Array.isArray(release.assets)) throw problem('리소스 릴리스 파일 목록이 없습니다.');
      const matches = release.assets.filter(asset => asset && asset.name === ASSET);
      if (matches.length !== 1) throw problem('리소스 릴리스 파일이 없거나 중복되었습니다.');
      const asset = matches[0], url = assetURL(asset.browser_download_url, release.tag_name);
      if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_PACK_BYTES) throw problem('리소스 릴리스 파일 크기가 제한을 초과했습니다.');
      if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw problem('GitHub SHA256 무결성 정보가 없습니다.');
      const expectedHash = asset.digest.slice(7);
      latestVersion = version;
      if (order < 0) throw problem('현재보다 이전 버전으로 되돌릴 수 없습니다.');
      if (order === 0) {
        // The release builder emits exactly this canonical representation. Detect
        // an unchanged release before downloading the large text/PNG bundle.
        const currentBytes = encoder.encode(JSON.stringify(current) + '\n');
        if (currentBytes.byteLength !== asset.size || await sha256(currentBytes) !== expectedHash) throw problem('같은 버전의 리소스 내용이 변경되었습니다. 게시자가 버전을 올려야 합니다.');
        return {status: 'current', version, releaseUrl};
      }
      const bytes = await withDeadline(60000, async signal => {
        const response = await fetchImpl(url, {credentials: 'omit', redirect: 'follow', cache: 'no-store', signal});
        checkFinalURL(response, url, true);
        if (!response.ok) throw problem(`리소스 파일을 다운로드하지 못했습니다 (HTTP ${response.status}).`);
        return boundedBytes(response, MAX_PACK_BYTES, signal, asset.size);
      });
      if (await sha256(bytes) !== expectedHash) throw problem('리소스 SHA256이 GitHub 무결성 정보와 다릅니다.');
      let pack;
      try { pack = await validatePack(bytes, {extensionVersion}); }
      catch (error) {
        if (error?.code === 'REQUIRES_EXTENSION') {
          if (error.version !== version) throw problem('리소스 버전과 릴리스 태그가 일치하지 않습니다.');
          return {status: 'requires-extension', version, minimumExtensionVersion: error.minimumExtensionVersion, releaseUrl};
        }
        throw error;
      }
      if (pack.version !== version) throw problem('리소스 버전과 릴리스 태그가 일치하지 않습니다.');
      // Recheck after I/O, so a concurrent activation cannot be overwritten by an
      // older release. apply owns the durable commit and live activation barrier.
      const latest = await getCurrent();
      const latestOrder = compareVersions(pack.version, latest.version);
      if (latestOrder < 0) throw problem('확인 중 더 새로운 리소스가 적용되어 이전 버전을 적용하지 않았습니다.');
      if (latestOrder === 0) {
        if (await sha256(encoder.encode(JSON.stringify(latest) + '\n')) !== expectedHash) throw problem('같은 버전의 리소스 내용이 변경되었습니다.');
        return {status: 'current', version, releaseUrl};
      }
      await apply(pack);
      return {status: 'updated', version, releaseUrl};
    } catch (error) {
      if (error?.message?.startsWith('업데이트:') || error?.message?.startsWith('리소스 파일:')) throw error;
      throw problem(`네트워크 또는 저장 중 오류가 발생했습니다. 기존 리소스를 유지합니다. (${error?.message || '알 수 없는 오류'})`);
    }
  }
  return {
    get latestVersion() { return latestVersion; },
    checkAndUpdate() {
      if (!inFlight) {
        const task = check();
        inFlight = task;
        task.then(() => { if (inFlight === task) inFlight = null; }, () => { if (inFlight === task) inFlight = null; });
      }
      return inFlight;
    }
  };
}
