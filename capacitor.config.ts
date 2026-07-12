import type { CapacitorConfig } from '@capacitor/cli';

// appId is provisional until Task 2 runs `cap add`, which bakes it into the
// native projects as the Android package name / iOS bundle id.
const config: CapacitorConfig = {
  appId: 'com.lifeforce.odin',
  appName: 'Odin',
  webDir: 'dist',
};

export default config;
