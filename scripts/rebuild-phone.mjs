// The native-loop command for the phone dev workflow: re-syncs the native
// project with ODIN_DEV_SERVER_URL baked in, then builds and installs on a
// device via `cap run`. Needed only after installing/removing a Capacitor
// plugin or changing capacitor.config.ts; ordinary web-code changes reach
// the phone through Vite HMR (`npm run dev:phone`) with no rebuild.
//
// Usage: node scripts/rebuild-phone.mjs [android|ios] [device-serial] [--sync-only]
//   platform       defaults to ios on macOS, android elsewhere
//   device-serial  deploy target (see `adb devices`); skips the picker when a
//                  phone and an emulator are both visible. A bare serial works
//                  because npm swallows `--target` unless you remember the
//                  extra `--` (npm run rebuild:phone -- --target <serial>).
//   --sync-only    skip the build/install step (just re-bake the config)
//   other --flags  passed through to `cap run`
// ODIN_DEV_SERVER_URL overrides the auto-detected dev server URL.
import { spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';

const args = process.argv.slice(2);
let requestedPlatform;
let syncOnly = false;
const passthrough = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === 'android' || arg === 'ios') {
    requestedPlatform = arg;
  } else if (arg === '--sync-only') {
    syncOnly = true;
  } else if (arg === '--target') {
    const value = args[++i];
    if (!value) {
      fail('--target needs a value; run `adb devices` for serials');
    }
    passthrough.push('--target', value);
  } else if (arg.startsWith('--')) {
    passthrough.push(arg);
  } else {
    passthrough.push('--target', arg);
  }
}

const platform = requestedPlatform ?? (process.platform === 'darwin' ? 'ios' : 'android');
const devServerUrl = await resolveDevServerUrl(platform);

console.log(`[rebuild:phone] platform: ${platform}`);
console.log(`[rebuild:phone] dev server URL baked into the app: ${devServerUrl}`);
if (platform === 'android') {
  console.log(
    '[rebuild:phone] phone must be on the same network; allow Node through the firewall on first run.',
  );
}

// `cap sync` refuses to run without the web assets directory, even though
// the copied assets are unused while server.url points at the dev server.
if (!existsSync('dist')) {
  console.log('[rebuild:phone] no dist/ yet; building web assets once for cap sync...');
  run('npx vite build');
}

run(`npx cap sync ${platform}`);

if (syncOnly) {
  console.log(`[rebuild:phone] sync done. Install manually or run: npx cap run ${platform}`);
} else {
  run(['npx cap run', platform, ...passthrough].join(' '));
}

async function resolveDevServerUrl(targetPlatform) {
  if (process.env.ODIN_DEV_SERVER_URL) {
    return process.env.ODIN_DEV_SERVER_URL;
  }
  // The iOS Simulator shares the Mac's network namespace, so localhost
  // reaches the Mac's own Vite server directly.
  if (targetPlatform === 'ios') {
    return 'http://localhost:5173';
  }
  const lanAddress = (await findOutboundAddress()) ?? findLanAddressByInterfaceName();
  if (!lanAddress) {
    fail(
      'could not detect a LAN IPv4 address; set ODIN_DEV_SERVER_URL, e.g. http://192.168.1.20:5173',
    );
  }
  return `http://${lanAddress}:5173`;
}

// Asks the OS routing table which local address outbound traffic uses, by
// connect()ing a UDP socket to a public IP. No packet is ever sent. This
// skips virtual adapters (VirtualBox/WSL/Hyper-V) that a plain
// os.networkInterfaces() scan happily returns.
function findOutboundAddress() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', () => resolve(undefined));
    socket.connect(53, '8.8.8.8', () => {
      const localAddress = socket.address().address;
      socket.close();
      resolve(localAddress);
    });
  });
}

// Fallback when there is no default route (offline dev): pick a non-internal
// IPv4, skipping adapters whose names identify them as virtual. A wrong pick
// is visible in the printed URL and overridable via ODIN_DEV_SERVER_URL.
function findLanAddressByInterfaceName() {
  const virtualNamePattern = /virtual|vethernet|vmware|wsl|hyper-v|loopback|tailscale|vpn/i;
  const candidates = Object.entries(os.networkInterfaces())
    .filter(([name]) => !virtualNamePattern.test(name))
    .flatMap(([, nets]) => nets ?? [])
    .filter((net) => net.family === 'IPv4' && !net.internal);
  return candidates[0]?.address;
}

function run(command) {
  console.log(`[rebuild:phone] ${command}`);
  const result = spawnSync(command, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ODIN_DEV_SERVER_URL: devServerUrl,
      // Caps adb's emulator port scan (default 5585). Anything else
      // listening in that range (a daemon squatting on 5563 on the first
      // dev PC) becomes a phantom offline "emulator-55xx" that breaks
      // native-run's device listing, so cap run can't see real phones.
      // Only affects an adb server STARTED by this command; a running
      // uncapped server needs one `adb kill-server` first.
      ADB_LOCAL_TRANSPORT_MAX_PORT: process.env.ADB_LOCAL_TRANSPORT_MAX_PORT ?? '5560',
    },
    // One pre-built command string (never user input), because Windows can
    // only run npx.cmd through a shell and Node deprecated args+shell.
    shell: true,
  });
  if (result.status !== 0) {
    fail(`"${command}" exited with ${result.status ?? 'a signal'}`);
  }
}

function fail(message) {
  console.error(`[rebuild:phone] ${message}`);
  process.exit(1);
}
