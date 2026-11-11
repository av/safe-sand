const UNITS = {
  banner: 'ca-app-pub-3940256099942544/9214589741',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};
const PRODUCT = 'sand_pro';
const FREE = ['river', 'beach'];
const PASS_MS = 24 * 3600 * 1000;
const TEST_ADS = UNITS.banner.startsWith('ca-app-pub-3940256099942544/');

const cap = window.Capacitor;
const native = !!cap?.isNativePlatform?.();
const P = cap?.Plugins || {};
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sand.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sand.' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  pro: store.get('pro', false) === true,
  passUntil: Number(store.get('passUntil', 0)) || 0,
  ads: false,
  privacy: false,
  product: null,
  banner: 'none',
  pending: null,
};
let adsInitialized = false;

const unlocked = () => state.pro || Date.now() < state.passUntil;
const locked = (k) => !FREE.includes(k) && !unlocked();

if (native && locked(store.get('preset', 'river'))) store.set('preset', 'river');

const css = `
  .swatch.locked i { position: relative; }
  .swatch.locked i::after { content: ''; position: absolute; right: -4px; bottom: -4px; width: 16px; height: 16px; border-radius: 50%; background: #f4efe7 no-repeat center/10px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%231c1a18' d='M7 10V7a5 5 0 0 1 10 0v3h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h6V7a3 3 0 0 0-6 0v3z'/%3E%3C/svg%3E"); box-shadow: 0 1px 3px rgba(0,0,0,.4); }
  #pro { display: none; margin: -4px 0 16px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,.07); }
  #pro.show { display: block; }
  #pro p { margin: 0 2px 10px; font-size: 13px; color: rgba(255,255,255,.75); }
  #pro .row { margin: 0; }
  #pro .btn { flex: 1 1 100%; }
  #pro .btn[hidden] { display: none; }
  #policyDialog { width: min(680px, calc(100vw - 32px)); height: min(720px, calc(100dvh - 32px)); padding: 0; border: 0; border-radius: 18px; background: #f6f2ea; }
  #policyDialog::backdrop { background: rgba(0,0,0,.6); }
  #policyDialog button { display: block; margin: 12px 12px 0 auto; color: #24211e; background: #e7e0d5; }
  #policyDialog iframe { width: 100%; height: calc(100% - 60px); border: 0; }
`;

function mount() {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  document.querySelector('#intro p').textContent = 'Push grains with your finger, tilt your phone to make them slide, or shake to scatter them.';
  const box = document.createElement('div');
  box.id = 'pro';
  box.innerHTML = '<p>Desert, Volcanic and Coral come with Sand Pro.</p><div class="row"><button class="btn primary" id="buyPro" hidden></button><button class="btn" id="watchAd" hidden>Watch an ad to try them for 24 hours</button></div>';
  $('sands').after(box);
  const privacy = document.createElement('button');
  privacy.className = 'btn';
  privacy.id = 'privacy';
  privacy.textContent = 'Privacy choices';
  privacy.hidden = true;
  $('pour').parentElement.appendChild(privacy);
  const policy = document.createElement('button');
  policy.className = 'btn';
  policy.textContent = 'Privacy policy';
  $('pour').parentElement.appendChild(policy);
  const policyDialog = document.createElement('dialog');
  policyDialog.id = 'policyDialog';
  policyDialog.setAttribute('aria-label', 'Privacy policy');
  policyDialog.innerHTML = '<button class="btn" type="button">Close</button><iframe title="Privacy policy" src="privacy.html"></iframe>';
  document.body.appendChild(policyDialog);
  policy.onclick = () => policyDialog.showModal();
  policyDialog.querySelector('button').onclick = () => policyDialog.close();

  for (const id of ['sands', 'introSands']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('.swatch');
      if (!b || !locked(b.dataset.sand)) return;
      e.stopPropagation();
      state.pending = b.dataset.sand;
      $('menu').classList.add('open');
      offer(true);
    }, true);
  }
  $('buyPro').onclick = buy;
  $('watchAd').onclick = watch;
  privacy.onclick = async () => {
    try { await P.AdMob.showPrivacyOptionsForm(); await ads(); } catch {}
  };

  new MutationObserver(() => { if (!$('menu').classList.contains('open')) offer(false); syncBanner(); })
    .observe($('menu'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(syncBanner).observe($('intro'), { attributes: true, attributeFilter: ['class'] });

  P.App?.addListener('backButton', () => {
    if (policyDialog.open) policyDialog.close();
    else if ($('menu').classList.contains('open')) $('menu').classList.remove('open');
    else P.App.minimizeApp();
  });
  P.App?.addListener('resume', () => {
    billing().catch(() => {}).finally(() => ads().catch(() => {}));
  });
  render();
}

function render() {
  for (const id of ['sands', 'introSands']) {
    for (const b of $(id).children) b.classList.toggle('locked', locked(b.dataset.sand));
  }
  const buy = $('buyPro'), watch = $('watchAd');
  buy.hidden = !state.product || state.pro;
  if (state.product) buy.textContent = `Get Sand Pro · ${state.product.priceString} · no ads`;
  watch.hidden = !state.ads || state.pro;
  $('privacy').hidden = !state.privacy;
  if (unlocked()) offer(false);
}

function offer(show) {
  const box = $('pro');
  if (show && $('buyPro').hidden && $('watchAd').hidden) {
    toast('Sand Pro is not available right now. Check your connection and try again.');
    return;
  }
  box.classList.toggle('show', show);
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 4200);
}

function choosePending() {
  const k = state.pending;
  state.pending = null;
  render();
  if (k) $('sands').querySelector(`[data-sand="${k}"]`)?.click();
}

function grantPro() {
  state.pro = true;
  store.set('pro', true);
  if (state.banner !== 'none') P.AdMob.removeBanner().catch(() => {});
  state.banner = 'none';
  choosePending();
}

async function syncBanner() {
  const want = state.ads && !state.pro && ($('menu').classList.contains('open') || !$('intro').classList.contains('hide'));
  if (want && state.banner === 'none') {
    state.banner = 'shown';
    await P.AdMob.showBanner({ adId: UNITS.banner, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', isTesting: TEST_ADS, immersiveMode: true }).catch(() => { state.banner = 'none'; });
  } else if (want && state.banner === 'hidden') {
    state.banner = 'shown';
    await P.AdMob.resumeBanner().catch(() => {});
  } else if (!want && state.banner === 'shown') {
    state.banner = 'hidden';
    await P.AdMob.hideBanner().catch(() => {});
  }
}

async function watch() {
  const btn = $('watchAd');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Loading ad…';
  let rewarded = false;
  let failed = false;
  const handles = [];
  let close;
  const closed = new Promise((resolve) => { close = resolve; });
  try {
    handles.push(await P.AdMob.addListener('onRewardedVideoAdReward', () => { rewarded = true; }));
    handles.push(await P.AdMob.addListener('onRewardedVideoAdDismissed', close));
    handles.push(await P.AdMob.addListener('onRewardedVideoAdFailedToShow', () => { failed = true; close(); }));
    await P.AdMob.prepareRewardVideoAd({ adId: UNITS.rewarded, isTesting: TEST_ADS, immersiveMode: true });
    // Android resolves this call only when a reward is earned, not on an early dismissal.
    P.AdMob.showRewardVideoAd().catch(() => { failed = true; close(); });
    await closed;
    if (failed) throw new Error('Rewarded ad could not be shown');
  } catch {
    toast('No ad is available right now. Try again in a minute.');
  } finally {
    await Promise.all(handles.map((handle) => handle.remove()));
    btn.disabled = false;
    btn.textContent = label;
  }
  if (rewarded) {
    state.passUntil = Date.now() + PASS_MS;
    store.set('passUntil', state.passUntil);
    choosePending();
    toast('All sands unlocked for 24 hours.');
  }
}

const owned = (t) => t.productIdentifier === PRODUCT && String(t.purchaseState) === '1';

async function buy() {
  try {
    const t = await P.NativePurchases.purchaseProduct({ productIdentifier: PRODUCT, productType: 'inapp', isConsumable: false });
    if (owned(t)) { grantPro(); toast('Thank you! Sand Pro is yours: every sand, no ads.'); }
    else toast('Your purchase is pending. Sand Pro unlocks as soon as it completes.');
  } catch (err) {
    if (!/cancel/i.test(String(err?.message || err))) toast('The purchase did not go through. Please try again.');
  }
}

async function billing() {
  const NP = P.NativePurchases;
  if (!NP) return;
  NP.addListener('transactionUpdated', (t) => { if (owned(t) && !state.pro) grantPro(); });
  const { products } = await NP.getProducts({ productIdentifiers: [PRODUCT], productType: 'inapp' });
  state.product = products?.[0] || null;
  const { purchases } = await NP.getPurchases({ productType: 'inapp' });
  const has = (purchases || []).some(owned);
  if (has !== state.pro) {
    state.pro = has;
    store.set('pro', has);
  }
  render();
}

async function ads() {
  const A = P.AdMob;
  if (!A) return;
  let info;
  try {
    info = await A.requestConsentInfo(TEST_ADS ? { debugGeography: 1 } : {});
    if (!state.pro && info.status === 'REQUIRED' && info.isConsentFormAvailable) info = await A.showConsentForm();
  } catch {
    state.ads = false;
    render();
    await syncBanner();
    return;
  }
  state.ads = info.canRequestAds === true && !state.pro;
  state.privacy = info?.privacyOptionsRequirementStatus === 'REQUIRED';
  if (state.ads && !adsInitialized) {
    await A.initialize({ initializeForTesting: TEST_ADS, maxAdContentRating: 'General', tagForChildDirectedTreatment: false });
    adsInitialized = true;
  }
  render();
  await syncBanner();
}

if (native) {
  document.addEventListener('DOMContentLoaded', () => {
    mount();
    billing().catch(() => {}).finally(() => ads().catch(() => {}));
  });
}
