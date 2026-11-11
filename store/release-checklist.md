# Google Play release checklist

Package: `io.github.av.sand`. Listing copy and upload images are in [listing.md](listing.md).

## Account

- Finish the developer account identity review.
- Declare trader status in Play Console.
- Verify access to a physical Android device using the Play Console app.
- Verify the contact phone number after Google approves the identity documents.
- Create the app after Play Console enables **Create app**.

The account was still blocked at **Create app** on 11 November 2026. Identity documents had already been submitted. No app or release had been created by this publishing attempt.

## Monetization

The Android app currently uses Google's test AdMob app and ad-unit IDs. They are suitable for testing, and must be replaced before a public release.

On 11 November 2026, reactivation of the existing AdMob account stopped with “This product is no longer available in your account's country or territory.” Resolve the existing account's country/closure status with Google before registering a replacement. Google permits only one AdMob account per publisher: [account issues FAQ](https://support.google.com/admob/answer/9686306?hl=en-GB).

- Create/link the Android app and its banner and rewarded ad units in AdMob.
- Replace `admobAppId` in `android/gradle.properties` and both `UNITS` in `src/app.js`.
- Configure and publish the required consent messages in AdMob Privacy & messaging.
- Publish the AdMob-provided `app-ads.txt` line on the developer website.
- Set up Google Play merchant/payments requirements for in-app purchases.
- Create and activate the non-consumable one-time product `sand_pro`. The proposed listing uses US$2.99. Confirm the final price before activation.
- Test an actual Play test purchase, restore after reinstall, pending purchase completion, and cancellation. Mocked tests do not verify Google Play billing.
- Test real ad/consent configuration on test devices. Never click live ads for testing.

## Listing and declarations

- Verify that the public [privacy policy](https://av.github.io/safe-sand/privacy.html) returns HTTP 200 after the Android changes deploy to GitHub Pages.
- Upload the icon, feature graphic and phone screenshots from this folder.
- Enter the descriptions and developer support contact.
- Complete ads, app access, target audience, content rating, Data safety and the remaining Play declarations based on the final build. The answers in `listing.md` are a draft, not submitted declarations.
- Keep the website fully free and ad-free. The Android launch retains advertising and the existing optional Sand Pro implementation. Confirm the final Pro price before activating the product.

## Build and test

```sh
npm ci
npm test
npm run sync
cd android
./gradlew assembleDebug bundleRelease lintDebug testDebugUnitTest
```

The release bundle is unsigned unless the signing environment variables described in `app/build.gradle` are supplied. GitHub tag builds use the existing repository signing secrets. A signed bundle from older source must not be substituted for a freshly built release.

Test tilt, shake, touch, audio, background/resume, and sustained frame rate on a physical Android device before release. The simulator requires WebGL2 with float render-target support, in addition to the manifest's OpenGL ES 3.0 requirement.

## Submit

- Upload a signed `.aab` to an internal/closed testing track after account verification.
- New personal accounts need at least 12 closed-test participants opted in continuously for 14 days before applying for production access. See [Google's testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465).
- Apply for production access, address any review feedback, and then submit the public release.

The optional `PLAY_SERVICE_ACCOUNT_JSON` GitHub secret enables automated internal-track uploads after the app exists in Play Console. Manual Console upload does not require that secret.
