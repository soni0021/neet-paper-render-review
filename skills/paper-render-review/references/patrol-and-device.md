# Patrol and the device profile

## 1. Versions (checked 2026-10-07 on pub.dev)

| Piece | Version | Why |
|---|---|---|
| `patrol_cli` (global) | **4.8.0** (latest) | Required for `$.takeNativeScreenshot` and screenshot pull-back. |
| `patrol` (harness `dev_dependencies`) | **^4.10.0** (latest) | Adds `$.takeNativeScreenshot('tag')` on Android; needs Flutter >= 3.32, Dart >= 3.8. |
| Flutter | the MentorBox CI pin (`flutter-version` in `.github/workflows/flutter.yml`; 3.44.1 on 2026-10-07) | The harness compiles the app's code; use the same toolchain the app ships with. |
| Compatibility rule | patrol 4.9.0+ needs patrol_cli 4.7.0+; patrol 4.10.0 features need 4.8.0 | [patrol.leancode.co compatibility table](https://patrol.leancode.co/documentation/compatibility-table) |

Re-check the table before bumping either side (source-driven-development).

## 2. Install patrol_cli

```bash
dart pub global activate patrol_cli 4.8.0        # or: flutter pub global activate patrol_cli 4.8.0
export PATH="$PATH:$HOME/.pub-cache/bin"           # Windows: %LOCALAPPDATA%\Pub\Cache\bin
patrol --version                                   # patrol_cli v4.8.0
patrol doctor
```

After switching Flutter versions the first `patrol` call prints `Can't load Kernel binary: Invalid SDK hash` and recompiles itself; run it again.

## 3. Android wiring for the harness app

These are the settings that already work for MentorBox Patrol runs (perf branches), adapted to the harness app (package `ai.mentorbox.qa.render`).

`pubspec.yaml`:
```yaml
dev_dependencies:
  patrol: ^4.10.0
patrol:
  app_name: MentorBox Render QA
  test_directory: patrol_test
  android:
    package_name: ai.mentorbox.qa.render
```

`android/app/build.gradle.kts`, inside `android { defaultConfig { ... } }`:
```kotlin
testInstrumentationRunner = "pl.leancode.patrol.PatrolJUnitRunner"
testInstrumentationRunnerArguments["clearPackageData"] = "true"
```
and in `android { }`:
```kotlin
testOptions { execution = "ANDROIDX_TEST_ORCHESTRATOR" }
// `patrol test --profile` asks for assemble<Flavor>ProfileAndroidTest; AGP builds the
// androidTest APK for one build type only, so follow the request.
val requestedTasks = gradle.startParameter.taskNames.joinToString(" ")
testBuildType = when {
    requestedTasks.contains("ProfileAndroidTest") -> "profile"
    requestedTasks.contains("ReleaseAndroidTest") -> "release"
    else -> "debug"
}
```
and `dependencies { androidTestUtil("androidx.test:orchestrator:1.5.1") }`.

`android/app/src/androidTest/java/ai/mentorbox/qa/render/MainActivityTest.java`:
```java
package ai.mentorbox.qa.render;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.junit.runners.Parameterized;
import org.junit.runners.Parameterized.Parameters;
import pl.leancode.patrol.PatrolJUnitRunner;

@RunWith(Parameterized.class)
public class MainActivityTest {
    @Parameters(name = "{0}")
    public static Object[] testCases() {
        PatrolJUnitRunner instrumentation = (PatrolJUnitRunner) InstrumentationRegistry.getInstrumentation();
        instrumentation.setUp(MainActivity.class);
        instrumentation.waitForPatrolAppService();
        return instrumentation.listDartTests();
    }
    public MainActivityTest(String dartTestName) { this.dartTestName = dartTestName; }
    private final String dartTestName;
    @Test
    public void runDartTest() {
        PatrolJUnitRunner instrumentation = (PatrolJUnitRunner) InstrumentationRegistry.getInstrumentation();
        instrumentation.runDartTest(dartTestName);
    }
}
```

The harness's `minSdk`, `compileSdk`, Java 17 and core-library desugaring must match the MentorBox app's `android/app/build.gradle.kts` at the pin, because the app's plugins come in through the path dependency.

## 4. The render-every-question test (shape)

```dart
void main() {
  patrolTest('render every question of the paper', config: const PatrolTesterConfig(
      settlePolicy: SettlePolicy.noSettle, printLogs: true),       // aura animations never settle
      timeout: const Timeout(Duration(minutes: 60)), ($) async {
    final paper = await loadPaper();                                // assets/paper/current.json
    final probe = await rootBundle.loadString('assets/probe.js');   // the skill's assets/probe.js
    final jsErrors = captureDebugPrint('QuestionWebView JS error: ');
    for (final q in paper.questions) {                              // one test, all questions: an app
      await $.pumpWidget(PaperHostApp(question: q));                // restart per question is 10x slower
      final web = await waitForWebView($, q);                       // find.byType(WebViewWidget)
      // WebViewWidget does not expose its WebViewController; its platform
      // params do (webview_flutter 4.9 / platform_interface 2.15).
      final controller = $.tester.widget<WebViewWidget>(web).platform.params.controller;
      await controller.runJavaScript(probe);
      final ready = await pollUntilStable(controller);              // ready().key x3, 100 ms, 10 s cap
      final result = decodeJsResult(await controller.runJavaScriptReturningResult(
          'JSON.stringify(window.__mbqa.probe(${jsonEncode(opts(q))}))'));
      await $.takeNativeScreenshot('q${q.number.toString().padLeft(3, '0')}');
      print('MBQA_RESULT ${jsonEncode({...result, 'n': q.number, 'qid': q.qid,
          'jsErrors': jsErrors.drain(), 'height': reportedHeight(q), 'ready': ready})}');
    }
  });
}
```

- `opts(q)`: `{expectOptions: 4, bankType: q.bankType, maxPhysicalHeight: 8000}`.
- `decodeJsResult`: on Android `runJavaScriptReturningResult` returns the JSON text JSON-encoded once more; decode twice when the first decode yields a `String`.
- `captureDebugPrint`: wrap `debugPrint` for the test, forward everything, and keep lines that start with the prefix (that is how `QuestionWebView` reports `JsError`).
- `reportedHeight`: read the `QuestionWebView`'s rendered `SizedBox` height via the widget tree (`$.tester.getSize(web).height`); `<= 1` after readiness is `H-NO-HEIGHT`. The text "Couldn't load this question" on screen is `H-LOAD-FAILED`.
- `--shard k/n` (`--dart-define=MBQA_SHARD=k/n`) splits long papers across emulators; results merge by question number.

Run:
```bash
patrol test -t patrol_test/render_paper_test.dart --device emulator-5554 \
  --dart-define=MBQA_PROFILE=android-360dp-api35 --screenshots-output-dir ../runs/<paper>/<run>/shots
```
Screenshots are written on the device to `/sdcard/Download/screenshots/<class>/<method>/<millis>_<tag>.png` and pulled to the host. Rename them by tag (`q017.png`) and record their sha256; the millisecond prefix is not part of any id.

## 5. Device profile `android-360dp-api35`

| Setting | Value | How |
|---|---|---|
| AVD | `mbqa_api35`, `system-images;android-35;google_apis;<arm64-v8a or x86_64>`, device `pixel_6`, 8 GB data | `avdmanager create avd ...` (local-stack install reference in the MentorBox repo) |
| Screen | 1080 x 2400 px at 480 dpi = **360 x 800 dp** | `adb shell wm size 1080x2400 && adb shell wm density 480` (reset after: `wm size reset`, `wm density reset`) |
| Fonts | scale 1.0 | `adb shell settings put system font_scale 1.0` |
| Animations | off | `settings put global window_animation_scale 0` (also `transition_animation_scale`, `animator_duration_scale`) |
| Awake | on while plugged | `settings put global stay_on_while_plugged_in 3`; unlock the keyguard first |
| Locale | en-IN | `adb shell cmd locale set-app-locales ai.mentorbox.qa.render --locales en-IN` |
| WebView | record `versionName` | `adb shell dumpsys package com.google.android.webview \| grep versionName` |

360 dp is the narrow end of students' phones and finds clipping first. A second profile at 411 dp (density 420) is optional. A real mid-range phone (USB, `adb reverse` not needed: the harness has no backend) is the best final check for blockers; record it as its own profile.

## 6. Gotchas seen on MentorBox devices

- A PIN keyguard means no frames: every question times out. Unlock first.
- `patrol test` uninstalls the app before and after; nothing persists between runs, which is what we want.
- Type into fields with `$(finder).enterText`, never raw `tester.enterText` (leaves OTP boxes empty). The harness has no login, so this only matters if you reuse app screens.
- Quiet `adb logcat` pipes are buffered; parse `patrol test` stdout (`printLogs: true`) for `MBQA_RESULT` lines instead.
- A proctored practice screen sets `FLAG_SECURE`: screenshots come out black. The harness host must never use `SecureWindow`.
- In zsh, `status` is read-only and `PIPESTATUS` is empty: check exit codes explicitly in run scripts.
- A small AVD data partition fails installs with `INSTALL_FAILED_INSUFFICIENT_STORAGE`: give the AVD 8 GB or `-wipe-data`.
- Emulator GPU and WebView timing on Apple Silicon is not a student's phone: use the emulator for rendering correctness, never for performance numbers.
