import type { CapacitorConfig } from '@capacitor/cli';

// Set by scripts/rebuild-phone.mjs for the phone dev loop: points the
// installed app at a dev machine's Vite server instead of bundled assets.
// A plain `npx cap sync` leaves it unset, so a production sync can never
// bake a LAN URL into the shipped app.
const devServerUrl = process.env.ODIN_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: 'com.lifeforce.odin',
  appName: 'Odin',
  webDir: 'dist',
  ...(devServerUrl
    ? {
        server: {
          url: devServerUrl,
          // Android blocks plain-HTTP (cleartext) page loads by default;
          // the dev server is plain HTTP on the LAN.
          cleartext: true,
        },
      }
    : {}),
};

export default config;
