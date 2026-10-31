import {compareVersions} from './resource-pack.mjs';
import {fetchLatestGitHubRelease} from './github-release.mjs';

const RELEASES = 'https://github.com/longtail7989/tamacolle-kor/releases';
const ASSET = /^tamacolle-kor-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-extension\.zip$/;
const problem = message => new Error(`확장 업데이트: ${message}`);

// ZIP/unpacked installs cannot replace their own files. Offer only the official
// download link; never describe a downloaded ZIP as an installed update.
export function createExtensionUpdater({fetchImpl = globalThis.fetch, currentVersion} = {}) {
  if (typeof fetchImpl !== 'function' || typeof currentVersion !== 'string') throw problem('초기화 정보가 없습니다.');
  compareVersions(currentVersion, currentVersion);
  let inFlight = null;
  async function check() {
    try {
      const release = await fetchLatestGitHubRelease(fetchImpl);
      if (!release || release.draft === true || release.prerelease === true) return {status: 'unpublished', latest: '', url: null};
      if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !/^resource-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(release.tag_name)) throw problem('릴리스 태그가 올바르지 않습니다.');
      const releaseUrl = `${RELEASES}/tag/${release.tag_name}`;
      if (release.html_url !== releaseUrl) throw problem('공식 저장소의 릴리스 주소가 아닙니다.');
      if (!Array.isArray(release.assets)) throw problem('릴리스 파일 목록이 없습니다.');
      let best = null;
      for (const asset of release.assets) {
        const match = asset && ASSET.exec(asset.name);
        if (!match) continue;
        const version = match[1];
        const expected = `${RELEASES}/download/${release.tag_name}/${asset.name}`;
        if (asset.browser_download_url !== expected) throw problem('공식 저장소의 확장 다운로드 주소가 아닙니다.');
        if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 64 * 1024 * 1024) throw problem('확장 ZIP 크기가 제한을 초과했습니다.');
        if (!best || compareVersions(version, best.version) > 0) best = {version, url: expected};
      }
      if (!best) return {status: 'unpublished', latest: '', url: null};
      const order = compareVersions(best.version, currentVersion);
      return order > 0 ? {status: 'available', latest: best.version, url: best.url, releaseUrl} : {status: 'current', latest: best.version, url: null, releaseUrl};
    } catch (error) {
      if (error?.message?.startsWith('확장 업데이트:')) throw error;
      throw problem(`확인하지 못했습니다. (${error?.message || '알 수 없는 오류'})`);
    }
  }
  return {
    check() {
      if (!inFlight) {
        const task = check();
        inFlight = task;
        task.then(() => { if (inFlight === task) inFlight = null; }, () => { if (inFlight === task) inFlight = null; });
      }
      return inFlight;
    }
  };
}
