import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import axe from 'axe-core';
import { chromium } from 'playwright';

import { probePort } from './helpers/port.mjs';

const outputDir = path.resolve('browser-output');
fs.mkdirSync(outputDir, { recursive: true });

async function startApp() {
  const port = await probePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/dist/server/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), PUBLIC_ORIGIN: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode !== null) throw new Error(`browser server exited:\n${log}`);
    try {
      if ((await fetch(`${url}/health`)).ok) return { child, url, getLog: () => log };
    } catch {
      // Retry until the bounded startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`browser server health timeout:\n${log}`);
}

async function stopApp(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function gameState(page) {
  return page.evaluate(() => JSON.parse(window.render_game_to_text()));
}

async function waitForState(page, predicate, label, timeout = 15_000) {
  const startedAt = Date.now();
  let state = null;
  while (Date.now() - startedAt < timeout) {
    state = await gameState(page).catch(() => null);
    if (state && predicate(state)) return state;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label}: timed out; state=${JSON.stringify(state)}`);
}

async function audit(page, label) {
  const result = await page.evaluate(async () => window.axe.run(document, {
    resultTypes: ['violations'],
  }));
  const blocking = result.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact),
  );
  fs.writeFileSync(
    path.join(outputDir, `axe-${label}.json`),
    JSON.stringify(result.violations, null, 2),
  );
  assert.deepEqual(
    blocking.map((violation) => ({ id: violation.id, impact: violation.impact })),
    [],
    `${label} has serious or critical accessibility violations`,
  );
}

async function screenshot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

async function setEnglish(context) {
  await context.addInitScript({ content: axe.source });
  await context.addInitScript(() => localStorage.setItem('matah.lang', 'en'));
}

async function checkResponsiveHome(browser, url) {
  const sizes = [
    [320, 568],
    [390, 844],
    [768, 1024],
    [1366, 768],
    [1920, 1080],
  ];
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
    await setEnglish(context);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await waitForState(page, (state) => state.connected === true, `${width}x${height} home connected`);
    await screenshot(page, `home-${width}x${height}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `${width}x${height} should not horizontally overflow`);
    if (width === 390) await audit(page, 'home-en');
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ar' });
  await context.addInitScript({ content: axe.source });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('select.lang-native').selectOption('ar');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
  await audit(page, 'home-ar');
  await screenshot(page, 'home-ar-390x844');
  await context.close();
}

async function checkAccessibilityPreferences(browser, url) {
  const keyboardContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setEnglish(keyboardContext);
  const keyboardPage = await keyboardContext.newPage();
  await keyboardPage.goto(url, { waitUntil: 'networkidle' });
  const joinButton = keyboardPage.getByRole('button', { name: /join a room/i });
  await joinButton.focus();
  await keyboardPage.keyboard.press('Enter');
  await keyboardPage.getByLabel(/room code/i).fill('ABCD');
  await keyboardPage.getByLabel(/your name/i).fill('Keyboard Player');
  const radios = keyboardPage.getByRole('radio');
  await radios.first().focus();
  await keyboardPage.keyboard.press('ArrowRight');
  assert.equal(await radios.nth(1).isChecked(), true, 'avatar radios support arrow-key selection');
  await keyboardContext.close();

  const reducedContext = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  await setEnglish(reducedContext);
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(url, { waitUntil: 'networkidle' });
  const activeAnimations = await reducedPage.locator('*').evaluateAll((elements) =>
    elements.filter((element) => getComputedStyle(element).animationName !== 'none').length,
  );
  assert.equal(activeAnimations, 0, 'reduced-motion disables continuous animation');
  await reducedPage.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const zoomOverflow = await reducedPage.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  assert.equal(zoomOverflow, false, 'home reflows without horizontal overflow at 200% zoom');
  await reducedContext.close();

  const expiredContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setEnglish(expiredContext);
  await expiredContext.addInitScript(() => {
    sessionStorage.setItem('matah.session', JSON.stringify({
      role: 'player',
      code: 'DEAD',
      playerId: 'public-id-is-not-a-credential',
      resumeToken: 'expired-resume-token',
      audience: false,
    }));
  });
  const expiredPage = await expiredContext.newPage();
  await expiredPage.goto(url, { waitUntil: 'networkidle' });
  await expiredPage.getByRole('status').filter({ hasText: /session expired/i }).waitFor();
  const expiredState = await waitForState(expiredPage, (state) => state.role === 'home', 'expired session home');
  assert.equal(expiredState.restoring, false);
  await expiredContext.close();
}

async function joinPlayer(browser, url, code, name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  await setEnglish(context);
  const page = await context.newPage();
  await page.goto(`${url}/?code=${code}`, { waitUntil: 'networkidle' });
  await page.getByLabel(/your name/i).fill(name);
  await page.getByRole('button', { name: /^join$/i }).click();
  await waitForState(page, (state) => state.role === 'player', `${name} joined`);
  return { context, page };
}

async function answerTrivia(players) {
  for (const { page } of players) {
    await page.locator('button.trivia-opt').first().click();
  }
}

async function playTrivia(host, players) {
  await host.getByRole('button', { name: /trivia/i }).click();
  const questions = host.getByRole('group', { name: /questions/i });
  for (let index = 0; index < 3; index += 1) {
    await questions.getByRole('button', { name: '−' }).click();
  }
  await host.getByRole('button', { name: /start game/i }).click();

  for (let question = 0; question < 3; question += 1) {
    await waitForState(host, (state) => state.phase === 'answering', `trivia question ${question + 1}`);
    await answerTrivia(players);
    await waitForState(host, (state) => state.phase === 'results', `trivia result ${question + 1}`);
    if (question === 0) {
      await audit(host, 'trivia-results');
      await screenshot(host, 'trivia-results-1366x768');
    }
  }
  const scoreboard = await waitForState(host, (state) => state.phase === 'scoreboard', 'trivia scoreboard', 12_000);
  assert.equal(scoreboard.players.length, 3);
  await audit(host, 'scoreboard');
  await screenshot(host, 'scoreboard-1366x768');
}

async function playQuiplash(host, players) {
  await host.getByRole('button', { name: /back to menu/i }).click();
  await waitForState(host, (state) => state.phase === 'lobby', 'settings lobby');
  const rounds = host.getByRole('group', { name: /rounds/i });
  for (let index = 0; index < 2; index += 1) {
    await rounds.getByRole('button', { name: '−' }).click();
  }
  await host.getByRole('button', { name: /start game/i }).click();
  await waitForState(host, (state) => state.phase === 'answering' && state.gameType === 'quiplash', 'quiplash answering');

  for (const [playerIndex, { page }] of players.entries()) {
    await page.waitForSelector('textarea.answer-input');
    let remaining = await page.locator('textarea.answer-input').count();
    let answerIndex = 0;
    while (remaining > 0) {
      await page.locator('textarea.answer-input').first().fill(`Browser quip ${playerIndex + 1}-${answerIndex + 1}`);
      await page.getByRole('button', { name: /^send$/i }).first().click();
      answerIndex += 1;
      remaining -= 1;
      await page.waitForFunction(
        (expected) => document.querySelectorAll('textarea.answer-input').length === expected,
        remaining,
      );
    }
  }
  await waitForState(host, (state) => state.phase === 'voting', 'quiplash voting');
  await audit(host, 'quiplash-voting');
  await screenshot(host, 'quiplash-voting-1366x768');

  while ((await gameState(host)).phase === 'voting') {
    const state = await gameState(host);
    const matchupId = state.activeMatchup.id;
    // There are three players and two authors per matchup. Probe each page;
    // only the non-author exposes vote buttons.
    let voted = false;
    for (const { page } of players) {
      const button = page.locator('button.vote-btn').first();
      if (await button.count()) {
        await button.click();
        voted = true;
        break;
      }
    }
    assert.equal(voted, true, `a voter should be available for ${matchupId}`);
    await waitForState(
      host,
      (next) => next.phase !== 'voting' || next.activeMatchup?.id !== matchupId,
      'next quiplash matchup',
      8_000,
    );
  }
  await waitForState(host, (state) => state.phase === 'results', 'quiplash results');
  await host.getByRole('button', { name: /continue/i }).click();
  const scoreboard = await waitForState(host, (state) => state.phase === 'scoreboard', 'quiplash scoreboard');
  assert.equal(scoreboard.players.length, 3);
  await screenshot(host, 'quiplash-scoreboard-1366x768');

  await host.getByRole('button', { name: /play again/i }).click();
  const rematch = await waitForState(
    host,
    (state) => state.phase === 'answering' && state.gameType === 'quiplash',
    'quiplash rematch',
  );
  assert.equal(rematch.totalRounds, 1);
}

const app = await startApp();
const browser = await chromium.launch({ headless: true });
const contexts = [];
const consoleErrors = [];
try {
  await checkResponsiveHome(browser, app.url);
  await checkAccessibilityPreferences(browser, app.url);

  const hostContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-US' });
  contexts.push(hostContext);
  await setEnglish(hostContext);
  const host = await hostContext.newPage();
  host.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await host.goto(app.url, { waitUntil: 'networkidle' });
  await host.getByRole('button', { name: /start new game/i }).click();
  const created = await waitForState(host, (state) => state.role === 'host' && state.code, 'host room');

  const players = [];
  for (const name of ['Ada', 'Bora', 'Can']) {
    const player = await joinPlayer(browser, app.url, created.code, name);
    contexts.push(player.context);
    players.push(player);
  }
  await waitForState(host, (state) => state.players.length === 3, 'three-player lobby');
  await audit(host, 'lobby');
  await screenshot(host, 'lobby-1366x768');
  await screenshot(players[0].page, 'lobby-player-390x844');

  await players[0].context.setOffline(true);
  await waitForState(players[0].page, (state) => state.connected === false, 'player offline');
  await players[0].page.getByRole('alert').filter({ hasText: /reconnecting/i }).waitFor();
  await players[0].context.setOffline(false);
  await waitForState(
    players[0].page,
    (state) => state.connected === true && state.role === 'player',
    'player reconnected',
  );

  await playTrivia(host, players);
  await playQuiplash(host, players);

  assert.deepEqual(consoleErrors, [], 'host page emitted console errors');
  assert.equal(app.getLog().includes('socket event failed'), false, app.getLog());
  console.log('Browser multiplayer, responsive, RTL, rematch, and axe checks passed.');
} finally {
  for (const context of contexts.reverse()) await context.close().catch(() => {});
  await browser.close();
  await stopApp(app.child);
}
