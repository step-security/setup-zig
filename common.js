const os = require('os');
const fs = require('fs');
const path = require('path');
const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

const VERSIONS_JSON = 'https://ziglang.org/download/index.json';
const MACH_VERSIONS_JSON = 'https://pkg.machengine.org/zig/index.json';
const CACHE_PREFIX = "setup-zig-global-cache-";

// The following regexes pull specific values out of ZON.
// This is bad and should be replaced with an actual parser -- see #50.

// Mach uses `mach_zig_version` in `build.zig.zon` to signify Mach nominated versions.
// See: https://github.com/marler8997/anyzig?tab=readme-ov-file#mach-versions-and-download-mirror
const MACH_ZIG_VERSION_REGEX = /\.\s*mach_zig_version\s*=\s*"(.*?)"/;
const MINIMUM_ZIG_VERSION_REGEX = /\.\s*minimum_zig_version\s*=\s*"(.*?)"/;
// This is tied quite precisely to the output of `zig env`. It's just a temporary workaround until
// I get around to implementing a ZON parser here.
const ZIG_ENV_CACHE_DIR_REGEX = /^\s*\.global_cache_dir = "(.*)",$/m;

let _cached_version = null;
async function getVersion() {
  if (_cached_version != null) {
    return _cached_version;
  }

  let raw = core.getInput('version');
  if (raw === '') {
    try {
      const zon = await fs.promises.readFile('build.zig.zon', 'utf8');

      // Look for `mach_zig_version` first
      let match = MACH_ZIG_VERSION_REGEX.exec(zon);
      if (match !== null) {
        _cached_version = await getMachVersion(match[1]);
        return _cached_version;
      }

      // Else, look for `minimum_zig_version`
      match = MINIMUM_ZIG_VERSION_REGEX.exec(zon);
      if (match !== null) {
        _cached_version = match[1];
        return _cached_version;
      }

      core.info('Failed to find `mach_zig_version` or `minimum_zig_version` in build.zig.zon (using latest)');
    } catch (e) {
      core.info(`Failed to read build.zig.zon (using latest): ${e}`);
    }

    raw = 'latest';
  }

  if (raw === 'master') {
    _cached_version = await getMasterVersion();
  } else if (raw === 'latest') {
    _cached_version = await getLatestVersion();
  } else if (raw.includes("mach")) {
    _cached_version = await getMachVersion(raw);
  } else {
    _cached_version = raw;
  }

  return _cached_version;
}

async function getMachVersion(raw) {
  const resp = await fetch(MACH_VERSIONS_JSON);
  const versions = await resp.json();
  if (!(raw in versions)) {
    throw new Error(`Mach nominated version '${raw}' not found`);
  }
  return versions[raw].version;
}
async function getMasterVersion() {
  const resp = await fetch(VERSIONS_JSON);
  const versions = await resp.json();
  return versions['master'].version;
}
async function getLatestVersion() {
  const resp = await fetch(VERSIONS_JSON);
  const versions = await resp.json();
  let latest = null;
  let latest_major;
  let latest_minor;
  let latest_patch;
  for (const version in versions) {
    if (version === 'master') continue;
    const [major_str, minor_str, patch_str] = version.split('.')
    const major = Number(major_str);
    const minor = Number(minor_str);
    const patch = Number(patch_str);
    if (latest === null) {
      latest = version;
      latest_major = major;
      latest_minor = minor;
      latest_patch = patch;
      continue;
    }
    if (major > latest_major ||
        (major == latest_major && minor > latest_minor) ||
        (major == latest_major && minor == latest_minor && patch > latest_patch))
    {
      latest = version;
      latest_major = major;
      latest_minor = minor;
      latest_patch = patch;
    }
  }
  return latest;
}

async function getTarballName() {
  const version = await getVersion();

  let arch = {
    arm:      'armv7a',
    arm64:    'aarch64',
    loong64:  'loongarch64',
    mips:     'mips',
    mipsel:   'mipsel',
    mips64:   'mips64',
    mips64el: 'mips64el',
    ppc64:    'powerpc64',
    riscv64:  'riscv64',
    s390x:    's390x',
    ia32:     'x86',
    x64:      'x86_64',
  }[os.arch()];

  // For some incomprehensible reason, Node.js's brain-damaged build system explicitly throws away
  // the knowledge that it is building for ppc64le, so os.arch() will identify it as ppc64 even on
  // little endian.
  if (arch === 'powerpc64' && os.endianness() === 'LE') {
    arch = 'powerpc64le';
  }

  const platform = {
    aix:     'aix',
    android: 'android',
    freebsd: 'freebsd',
    linux:   'linux',
    darwin:  'macos',
    openbsd: 'openbsd',
    sunos:   'solaris',
    win32:   'windows',
  }[os.platform()];

  if (useLegacyTarballName(version)) {
    return `zig-${platform}-${arch}-${version}`;
  } else {
    return `zig-${arch}-${platform}-${version}`;
  }
}
// Before version 0.14.1 / dev version 0.15.0-dev.631+9a3540d61, Zig tarballs were named like:
//   `zig-linux-x86_64-0.14.0`
// After that version, they are named like:
//   `zig-x86_64-linux-0.14.0`
// So, the architecture and OS fields were flipped to align with how target triples work.
function useLegacyTarballName(version) {
  // We are looking for full versions above
  const parts = version.split('.');
  if (parts.length == 3) {
    // We have a full version like '0.14.0'
    if (parts[0] !== "0") return false; // 1.x.x or greater
    if (parts[1] === "14" && parts[2] !== "0") return false; // 0.14.1 or greater
    const minor = parseInt(parts[1]);
    if (!Number.isFinite(minor)) return false; // malformed minor version
    if (minor >= 15) return false; // 0.15.x or greater
    return true; // 0.14.1
  } else if (parts.length == 4) {
    // We have a dev version like '0.15.0-dev.631+9a3540d61'
    if (parts[0] !== "0") return false; // 1.x.x or greater
    if (parts[1] === "15" && parts[2] == "0-dev") {
      const dev_version = parseInt(parts[3].split('+')[0]); // this is the '631' part in the example above
      if (!Number.isFinite(dev_version)) return false; // malformed dev version
      if (dev_version >= 631) return false; // 0.15.0-dev.631+9a3540d61 or greater
      return true; // 0.15.0-dev before the change
    }
    const minor = parseInt(parts[1]);
    if (!Number.isFinite(minor)) return false; // malformed minor version
    if (minor >= 15) return false; // 0.15.1-dev or greater (in practice this is 0.16.0-dev or greater)
    return true; // We caught 0.15.0-dev above, so this must be 0.14.x-dev or below.
  } else {
    // Malformed version
    return false;
  }
}

async function getTarballExt() {
  return {
    linux:  '.tar.xz',
    darwin: '.tar.xz',
    win32:  '.zip',
  }[os.platform()];
}

async function getCachePrefix() {
  const tarball_name = await getTarballName();
  const job_name = github.context.job.replaceAll(/[^\w]/g, "_");
  const user_key = core.getInput('cache-key');

  return `setup-zig-cache-${job_name}-${tarball_name}-${user_key}-`;
}

async function getZigCachePath() {
  const env_zon = (await exec.getExecOutput('zig', ['env'])).stdout;
  if (env_zon[0] !== '.') {
    // JSON (legacy)
    return JSON.parse(env_zon)['global_cache_dir'];
  }
  const match = ZIG_ENV_CACHE_DIR_REGEX.exec(env_zon);
  if (!match) throw new Error("Failed to parse cache directory from 'zig env' output");
  return parseZigString(match[1]);
}
function parseZigString(raw) {
  // This function is neither complete (Unicode codepoint literals), nor correct (byte-escapes
  // aren't really compatible with JS "strings"). It's just a temporary best-effort implementation
  // which can hopefully handle any real-world directory path we encounter.
  let result = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] != '\\') {
      result += raw[i];
      i += 1;
      continue;
    }
    i += 2;
    switch (raw[i - 1]) {
      case 'n': result += '\n'; break;
      case 'r': result += '\r'; break;
      case '\\': result += '\\'; break;
      case 't': result += '\t'; break;
      case '\'': result += '\''; break;
      case '"': result += '"'; break;
      case 'x': {
        const byte_val = parseInt(raw.slice(i, i + 2), 16);
        result += String.fromCharCode(byte_val);
        i += 2;
        break;
      }
      case 'u': throw new Error("unsupported Unicode codepoint literal in string");
      default: throw new Error("invalid escape code in string");
    }
  }
  return result;
}

async function getTarballCachePath() {
  return path.join(process.env['RUNNER_TEMP'], await getTarballName());
}

module.exports = {
  getVersion,
  getTarballName,
  getTarballExt,
  getCachePrefix,
  getZigCachePath,
  getTarballCachePath,
};
