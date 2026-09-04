import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished EMBERLINE game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>EMBERLINE — Civilian Orbital Freight<\/title>/i);
  assert.match(html, /Begin a new shift/);
  assert.match(html, /Newtonian flight/i);
  assert.match(html, /Physical freight/i);
  assert.match(html, /og:image/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the game systems modular and browser-native", async () => {
  const [game, flight, data, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/game/EmberlineGame.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/game/flight.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/game/data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(game, /requestAnimationFrame/);
  assert.match(game, /localStorage\.setItem/);
  assert.match(game, /AudioContext/);
  assert.match(game, /cargoMass/);
  assert.match(game, /drawMinimap/);
  // The gravity law and the solid bodies live in one module now, read both by
  // the contact solver and by the track projected ahead of the ship. A warning
  // built on a second copy of either would eventually stop matching the game.
  assert.match(flight, /body\.gravity/);
  assert.match(flight, /export function solidsNear/);
  assert.match(flight, /export function projectTrack/);
  assert.match(data, /export const SYSTEMS/);
  assert.match(data, /export const SHIPS/);
  assert.match(data, /export function systemById/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.hazard-strip/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
