// Minimal preload. The renderer talks to the local backend over HTTP, so no
// privileged bridge is required; we only expose a harmless desktop flag.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("oryaresDesktop", {
  isDesktop: true,
  platform: process.platform,
});
