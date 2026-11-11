import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const source = await readFile(process.env.SAND_APP_SOURCE || new URL('../src/app.js', import.meta.url), 'utf8');
const sands = ['river', 'beach', 'desert', 'volcanic', 'coral'];
const flush = async () => { for (let i = 0; i < 5; i++) await setImmediate(); };

async function app(t, { consentError = false, canRequestAds = true, rewarded = false, native = true } = {}) {
  const swatches = sands.map((k) => `<button class="swatch" data-sand="${k}">${k}</button>`).join('');
  const dom = new JSDOM(`<body><div id="intro"><p>Intro</p><div id="introSands">${swatches}</div></div>
    <div id="menu"><div id="sands">${swatches}</div><div><button id="pour">Pour</button></div></div>
    <div id="toast"></div></body>`, { url: 'https://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  t.after(() => w.close());
  await flush();
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const callbacks = new Map();
  const appCallbacks = new Map();
  const calls = { initialize: 0, banner: 0, hide: 0, remove: 0, privacy: 0, selected: [], minimized: 0 };
  let purchases = [];
  const consent = () => ({ status: 'OBTAINED', canRequestAds, privacyOptionsRequirementStatus: 'REQUIRED' });
  const emit = (event) => callbacks.get(event)?.();
  const AdMob = {
    async requestConsentInfo() { if (consentError) throw new Error('Consent network failure'); return consent(); },
    async initialize() { calls.initialize++; },
    async showBanner() { calls.banner++; },
    async hideBanner() { calls.hide++; },
    async removeBanner() { calls.remove++; },
    async resumeBanner() {},
    async showPrivacyOptionsForm() { calls.privacy++; },
    async addListener(event, callback) { callbacks.set(event, callback); return { remove: async () => callbacks.delete(event) }; },
    async prepareRewardVideoAd() {},
    showRewardVideoAd() {
      queueMicrotask(() => {
        if (rewarded) emit('onRewardedVideoAdReward');
        emit('onRewardedVideoAdDismissed');
      });
      // The Android plugin does not resolve a show call when a user dismisses early.
      return new Promise(() => {});
    },
  };
  w.Capacitor = {
    isNativePlatform: () => native,
    Plugins: {
      AdMob,
      NativePurchases: {
        async addListener() { return { remove() {} }; },
        async getProducts() { return { products: [{ identifier: 'sand_pro', priceString: '$2.99' }] }; },
        async getPurchases() { return { purchases }; },
      },
      App: {
        addListener(event, callback) { appCallbacks.set(event, callback); },
        minimizeApp() { calls.minimized++; },
      },
    },
  };
  for (const button of w.document.querySelectorAll('.swatch')) {
    button.onclick = () => calls.selected.push(button.dataset.sand);
  }
  w.eval(source);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  await flush();
  return {
    w, calls, callbacks, appCallbacks, AdMob,
    setCanRequestAds(value) { canRequestAds = value; },
    setPurchases(value) { purchases = value; },
    $(id) { return w.document.getElementById(id); },
  };
}

test('a consent error never initializes ads or requests a banner', async (t) => {
  const a = await app(t, { consentError: true });
  assert.equal(a.calls.initialize, 0);
  assert.equal(a.calls.banner, 0);
  assert.equal(a.$('watchAd').hidden, true);
});

test('privacy changes refresh permission before enabling ads, and initialize only once', async (t) => {
  const a = await app(t, { canRequestAds: false });
  assert.equal(a.calls.initialize, 0);
  assert.equal(a.calls.banner, 0);
  assert.equal(a.$('privacy').hidden, false);
  a.setCanRequestAds(true);
  await a.$('privacy').onclick();
  await a.$('privacy').onclick();
  assert.equal(a.calls.privacy, 2);
  assert.equal(a.calls.initialize, 1);
  assert.equal(a.$('watchAd').hidden, false);
});

test('paid sands are gated on both the start card and menu', async (t) => {
  const a = await app(t);
  for (const id of ['sands', 'introSands']) {
    const button = a.$(id).querySelector('[data-sand="desert"]');
    assert.equal(button.classList.contains('locked'), true);
    button.click();
    assert.equal(a.calls.selected.length, 0);
  }
  assert.equal(a.$('menu').classList.contains('open'), true);
  assert.equal(a.$('pro').classList.contains('show'), true);
  a.$('introSands').querySelector('[data-sand="river"]').click();
  assert.deepEqual(a.calls.selected, ['river']);
});

test('dismissing a rewarded ad resets the button and does not unlock sands', { timeout: 1500 }, async (t) => {
  const a = await app(t);
  await a.$('watchAd').onclick();
  assert.equal(a.$('watchAd').disabled, false);
  assert.equal(a.w.localStorage.getItem('sand.passUntil'), null);
  assert.equal(a.callbacks.size, 0);
  await a.$('watchAd').onclick();
  assert.equal(a.$('watchAd').disabled, false);
});

test('an earned reward unlocks both pickers and selects the requested sand', async (t) => {
  const a = await app(t, { rewarded: true });
  a.$('introSands').querySelector('[data-sand="desert"]').click();
  await a.$('watchAd').onclick();
  assert.ok(Number(a.w.localStorage.getItem('sand.passUntil')) > Date.now());
  assert.equal(a.w.document.querySelectorAll('.swatch.locked').length, 0);
  assert.deepEqual(a.calls.selected, ['desert']);
  assert.equal(a.callbacks.size, 0);
});

test('returning from Google Play refreshes ownership for a completed pending purchase', async (t) => {
  const a = await app(t);
  a.setPurchases([{ productIdentifier: 'sand_pro', purchaseState: '1' }]);
  a.appCallbacks.get('resume')();
  await flush();
  assert.equal(a.w.localStorage.getItem('sand.pro'), 'true');
  assert.equal(a.w.document.querySelectorAll('.swatch.locked').length, 0);
  assert.equal(a.$('watchAd').hidden, true);
  assert.equal(a.$('privacy').hidden, false);
});

test('the bundled privacy policy opens offline and Back closes it first', async (t) => {
  const a = await app(t);
  const policy = [...a.w.document.querySelectorAll('button')].find((b) => b.textContent === 'Privacy policy');
  policy.click();
  assert.equal(a.$('policyDialog').open, true);
  assert.equal(a.$('policyDialog').querySelector('iframe').getAttribute('src'), 'privacy.html');
  a.appCallbacks.get('backButton')();
  assert.equal(a.$('policyDialog').open, false);
  assert.equal(a.calls.minimized, 0);
});

test('the website does not mount native ads, purchases or policy UI', async (t) => {
  const a = await app(t, { native: false });
  assert.equal(a.$('pro'), null);
  assert.equal(a.$('policyDialog'), null);
  assert.equal(a.calls.initialize, 0);
});
