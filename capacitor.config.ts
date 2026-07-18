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
  plugins: {
    // Brand the OS notification within Android's limits (the shade is
    // system-drawn, so this is icon + accent, not the app's theme):
    // ic_stat_odin is the twin-raven silhouette (res/drawable), and
    // iconColor tints it + the app-name line in the shade. The color is
    // the odin-dark accent (--raw-red); native config is baked at build
    // time and cannot follow the runtime theme swap, so a single brand
    // accent is the accepted trade until a theme-following per-notification
    // color earns the polish. iOS gets none of this (system-styled).
    LocalNotifications: {
      smallIcon: 'ic_stat_odin',
      iconColor: '#ff5050',
    },
  },
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
