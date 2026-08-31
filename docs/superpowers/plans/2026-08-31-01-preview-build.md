# Preview Build Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a `Spine-Contour Preview` installer that installs and runs alongside the existing `Spine-Contour` release without touching it.

**Architecture:** A standalone `electron-builder.preview.yml` and a separate GitHub Actions workflow. The existing `build` block in `package.json` and the existing `windows.yml` are never edited, so the path that produces the working installer stays byte-identical. Isolation is achieved on six axes: `appId`, `productName`, artifact name, release tag, concurrency group, and `userData` directory.

**Tech Stack:** Electron 44, electron-builder 26, NSIS, GitHub Actions.

## Global Constraints

- No bundler, no framework, no npm runtime dependencies. Vanilla ES modules only. `package.json` `dependencies` stays empty; `devDependencies` stays exactly `electron` and `electron-builder`.
- The CSP in `index.html` must not be loosened. No CDN, no Google Fonts, no remote anything.
- Fonts are self-hosted from `assets/fonts/`. Source Sans 3 and Chivo Mono, both SIL OFL.
- Never display a fabricated measurement. Absent values render the em dash `—`, never `0`, never `N/A`, never a guess.
- Never label a value with a name it isn't.
- Node's built-in test runner only (`node --test`). No Jest, Vitest, or Mocha.
- Every `<script>` is `type="module"`. No global scope leakage.
- Target Electron 44 / Chromium — modern syntax is fine. No transpilation.
- Commit after every task. Conventional commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## ⚠️ Standing warning for every later plan

`electron-builder.preview.yml` contains its **own copy** of the `files` allowlist. When
a later plan adds a new top-level directory (`styles/`, `renderer/`, `test/`), it must
be added to **both** `package.json` `build.files` **and** `electron-builder.preview.yml`
`files`. A missing entry does not fail the build — it produces an installer that
launches to a blank window. Plan 02 has an explicit task for this.

---

### Task 1: Preview electron-builder configuration

**Files:**
- Create: `electron-builder.preview.yml`
- Modify: `package.json:8-11` (the `scripts` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run package:windows:preview` — builds `dist/Spine-Contour-Preview-Windows.exe`. Injects `buildChannel: "preview"` into the packaged `package.json`, which Task 2 reads.

- [ ] **Step 1: Record the current build config so the diff can be proven empty later**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "console.log(JSON.stringify(require('./package.json').build, null, 2))" > /tmp/build-before.json
cat /tmp/build-before.json
```

Expected: prints the `build` block containing `appId: org.spinecontour.app`.

- [ ] **Step 2: Create the preview config**

Create `electron-builder.preview.yml`:

```yaml
# Preview build. Deliberately isolated from the production config in
# package.json on every axis that Windows or GitHub uses as an identity:
#   appId       -> separate uninstall registry entry (NOT an upgrade)
#   productName -> separate install dir, shortcuts, and %APPDATA% folder
#   artifactName-> separate installer filename
# Do not reuse any value from package.json "build" here.
appId: org.spinecontour.app.preview
productName: Spine-Contour Preview

# MUST stay in sync with package.json "build.files". A missing entry does not
# fail the build; it ships an installer that opens a blank window.
files:
  - assets/**/*
  - index.html
  - main.js
  - preload.js
  - renderer.js
  - package.json

extraResources:
  - from: backend-dist/spine-contour-backend
    to: backend-runtime
    filter:
      - "**/*"

# Injected into the packaged package.json. main.js reads this to decide
# whether to brand the window as a preview build.
extraMetadata:
  buildChannel: preview

win:
  target: nsis
  icon: assets/branding/spinecontour-mark-dark.png
  artifactName: Spine-Contour-Preview-Windows.${ext}

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

- [ ] **Step 3: Add the npm script**

In `package.json`, the `scripts` block becomes exactly:

```json
  "scripts": {
    "dev": "electron .",
    "start": "npm run dev",
    "test": "node --test test/*.test.js",
    "package:windows": "electron-builder --win nsis --x64 --publish never",
    "package:windows:preview": "electron-builder --config electron-builder.preview.yml --win nsis --x64 --publish never"
  },
```

- [ ] **Step 4: Verify the production build block is untouched**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "console.log(JSON.stringify(require('./package.json').build, null, 2))" > /tmp/build-after.json
diff /tmp/build-before.json /tmp/build-after.json && echo "UNCHANGED"
```

Expected: prints `UNCHANGED` with no diff output. If `diff` prints anything, the
production build config was modified — revert it before continuing.

- [ ] **Step 5: Verify the preview config parses and resolves distinct identities**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "
const fs = require('fs');
const text = fs.readFileSync('electron-builder.preview.yml', 'utf8');
const pick = k => (text.match(new RegExp('^' + k + ': (.+)\$', 'm')) || [])[1];
const prod = require('./package.json').build;
const appId = pick('appId'), product = pick('productName');
console.log('preview appId     :', appId);
console.log('prod    appId     :', prod.appId);
console.log('preview product   :', product);
console.log('prod    product   :', prod.productName);
if (appId === prod.appId) throw new Error('appId COLLIDES — installer would overwrite production');
if (product === prod.productName) throw new Error('productName COLLIDES — shared userData');
console.log('OK: identities are distinct');
"
```

Expected: prints the four values then `OK: identities are distinct`.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git add electron-builder.preview.yml package.json
git commit -m "chore: add isolated preview build configuration"
```

---

### Task 2: Brand the preview build at runtime

**Files:**
- Modify: `main.js:1-10` (add the channel constant), `main.js:77` (the window title)

**Interfaces:**
- Consumes: `buildChannel` from `extraMetadata` in Task 1.
- Produces: `IS_PREVIEW` (boolean) and `APP_TITLE` (string) module constants in `main.js`. Plan 02's Landing screen and sidebar footer read the channel over IPC; this task only sets the window title.

Without this, two installed copies show identical window titles and taskbar entries,
and there is no way to tell which one you are looking at.

- [ ] **Step 1: Add the build-channel constants**

In `main.js`, immediately after the existing `require` block at the top of the file,
add:

```js
// buildChannel is injected by electron-builder.preview.yml via extraMetadata.
// It is absent in development and in production builds, so both fall through
// to the plain title.
const pkg = require('./package.json');
const IS_PREVIEW = pkg.buildChannel === 'preview';
const APP_TITLE = IS_PREVIEW ? 'Spine-Contour Preview' : 'Spine-Contour';
```

- [ ] **Step 2: Use it for the window title**

In `main.js`, replace line 77:

```js
    title: 'Spine-Contour',
```

with:

```js
    title: APP_TITLE,
```

- [ ] **Step 3: Verify the development path still reports the production title**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "
const pkg = require('./package.json');
const IS_PREVIEW = pkg.buildChannel === 'preview';
const APP_TITLE = IS_PREVIEW ? 'Spine-Contour Preview' : 'Spine-Contour';
console.log('buildChannel:', pkg.buildChannel);
console.log('title       :', APP_TITLE);
if (APP_TITLE !== 'Spine-Contour') throw new Error('dev build must not be branded preview');
console.log('OK');
"
```

Expected:

```
buildChannel: undefined
title       : Spine-Contour
OK
```

- [ ] **Step 4: Verify the preview path resolves to the preview title**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
node -e "
const pkg = { ...require('./package.json'), buildChannel: 'preview' };
const IS_PREVIEW = pkg.buildChannel === 'preview';
const APP_TITLE = IS_PREVIEW ? 'Spine-Contour Preview' : 'Spine-Contour';
if (APP_TITLE !== 'Spine-Contour Preview') throw new Error('preview branding did not apply');
console.log('OK:', APP_TITLE);
"
```

Expected: `OK: Spine-Contour Preview`

- [ ] **Step 5: Launch the app to confirm nothing regressed**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
npm run dev
```

MANUAL VERIFICATION — this cannot be unit tested, the window title is an OS-level property:
1. The window opens with title bar reading exactly `Spine-Contour` (no "Preview").
2. The existing UI renders as before — logo, four controls, `Measure radiograph` button.
3. Close the window.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git add main.js
git commit -m "feat: brand preview builds in the window title"
```

---

### Task 3: Preview build workflow

**Files:**
- Create: `.github/workflows/windows-preview.yml`

**Interfaces:**
- Consumes: `npm run package:windows:preview` from Task 1.
- Produces: a `preview-windows` GitHub release carrying `Spine-Contour-Preview-Windows.exe`.

The existing `.github/workflows/windows.yml` is **not modified**. Read it for reference
but change nothing in it.

- [ ] **Step 1: Confirm the production workflow's identity values, which must not be reused**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
grep -n "group:\|branches:\|latest-windows\|artifactName\|name: Spine" .github/workflows/windows.yml
```

Expected: shows `branches: [main]`, `group: latest-windows`, and three `latest-windows`
references in the publish step. The preview workflow must reuse none of these.

- [ ] **Step 2: Create the preview workflow**

Create `.github/workflows/windows-preview.yml`:

```yaml
name: Windows preview installer

# Deliberately NOT [main]. This workflow must never run on the production
# branch, and must never touch the latest-windows release.
on:
  push:
    branches: [ui-redesign-cw]
  workflow_dispatch:

permissions:
  contents: write

# Separate group. Sharing latest-windows would cancel in-flight production builds.
concurrency:
  group: preview-windows
  cancel-in-progress: true

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v7
        with:
          lfs: true

      - name: Download model weights
        run: git lfs pull

      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: backend/requirements.txt

      - uses: actions/setup-node@v7
        with:
          node-version: "22"

      - name: Install backend
        run: |
          python -m pip install --upgrade pip
          python -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
          python -m pip install -r backend/requirements.txt pyinstaller==6.22.2

      - name: Test backend
        run: python -m pytest backend/tests -q

      - name: Test renderer
        # Directory form is broken on Node 24 (treats it as a CJS entry point).
        # Glob form is the one verified to work. See the architecture contract.
        run: node --test test/*.test.js
        continue-on-error: true

      - name: Bundle backend
        run: >-
          python -m PyInstaller
          --noconfirm
          --clean
          --onedir
          --name spine-contour-backend
          --distpath backend-dist
          --workpath build/pyinstaller
          --paths .
          --collect-all segmentation_models_pytorch
          --collect-all timm
          --collect-all torchvision
          --collect-all uvicorn
          --add-data "backend/weights;backend/weights"
          backend/standalone.py

      - name: Verify bundled backend
        shell: pwsh
        run: |
          $backend = Start-Process "backend-dist/spine-contour-backend/spine-contour-backend.exe" -ArgumentList "--host", "127.0.0.1", "--port", "8765" -PassThru
          try {
            $ready = $false
            for ($attempt = 0; $attempt -lt 120; $attempt++) {
              try {
                $response = Invoke-RestMethod "http://127.0.0.1:8765/health"
                if ($response.status -eq "ok") { $ready = $true; break }
              } catch {
                Start-Sleep -Seconds 1
              }
            }
            if (-not $ready) { throw "The bundled backend did not become ready." }
          } finally {
            Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
          }

      - name: Install desktop dependencies
        run: npm install --no-audit --no-fund

      - name: Build Windows preview installer
        run: npm run package:windows:preview
        env:
          CSC_IDENTITY_AUTO_DISCOVERY: "false"

      - name: Assert the production installer was not produced
        shell: pwsh
        run: |
          if (Test-Path "dist/Spine-Contour-Windows.exe") {
            throw "Production artifact was built by the preview workflow. The preview config is wrong."
          }
          if (-not (Test-Path "dist/Spine-Contour-Preview-Windows.exe")) {
            throw "Preview artifact missing."
          }
          Write-Host "OK: only the preview artifact exists"

      - uses: actions/upload-artifact@v7
        with:
          name: Spine-Contour-Preview-Windows
          path: dist/Spine-Contour-Preview-Windows.exe
          compression-level: 0

      - name: Publish preview installer
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          $asset = "dist/Spine-Contour-Preview-Windows.exe"
          $notes = "PREVIEW BUILD — not the production release. Built from commit $env:GITHUB_SHA on branch $env:GITHUB_REF_NAME."
          if (gh release view preview-windows 2>$null) {
            gh release upload preview-windows $asset --clobber
            gh release edit preview-windows --title "Preview build" --notes $notes --prerelease
          } else {
            gh release create preview-windows $asset --target $env:GITHUB_SHA --title "Preview build" --notes $notes --prerelease
          }
```

Note the deliberate differences from `windows.yml`: `--prerelease` instead of
`--latest`, the `preview-windows` tag, the `preview-windows` concurrency group, the
branch trigger, and the guard step that fails the build if the production artifact
name ever appears.

- [ ] **Step 3: Verify the workflow never references production identities**

The greps below read a comment-stripped copy, because the workflow's own comments
legitimately mention `latest-windows` when explaining what it must not touch.

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
sed 's/#.*//' .github/workflows/windows-preview.yml > /tmp/preview-nocomments.yml
if grep -n "latest-windows" /tmp/preview-nocomments.yml; then
  echo "FAIL: preview workflow references the production release tag"
  exit 1
fi
if grep -nE "branches: \[main\]" /tmp/preview-nocomments.yml; then
  echo "FAIL: preview workflow triggers on main"
  exit 1
fi
if grep -n -- "--latest" /tmp/preview-nocomments.yml; then
  echo "FAIL: preview would be marked as the latest release"
  exit 1
fi
echo "PASS: no production identifiers present"
```

Expected: `PASS: no production identifiers present`

- [ ] **Step 4: Verify the production workflow is byte-identical to HEAD**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git diff --exit-code .github/workflows/windows.yml && echo "PASS: production workflow untouched"
```

Expected: `PASS: production workflow untouched`

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git add .github/workflows/windows-preview.yml
git commit -m "ci: add isolated preview installer workflow"
```

---

### Task 4: Prove side-by-side installation

**Files:** none — this task is verification only.

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: confidence that the redesign cannot damage the working release. Every later plan depends on this having passed.

This is the task that actually answers the project's central risk. Do not skip it and
do not mark it complete on a partial check.

- [ ] **Step 1: Enable Actions on the fork**

Open `https://github.com/Feches/Spine-Contour/actions` in a browser. If a banner reads
"Workflows aren't being run on this forked repository", click
**I understand my workflows, go ahead and enable them**. Without this the workflow
never runs and the remaining steps have nothing to test.

- [ ] **Step 2: Push the branch to trigger the build**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git push fork ui-redesign-cw
```

- [ ] **Step 3: Confirm the production workflow did NOT run**

Open `https://github.com/Feches/Spine-Contour/actions`.

Expected: exactly one run appears, named **Windows preview installer**. There must be
**no** run named "Windows installer". If the production workflow ran, stop and fix the
branch trigger before continuing — it means production builds can be triggered from
this branch.

- [ ] **Step 4: Wait for the build and download the installer**

The build takes roughly 15–25 minutes, dominated by the PyInstaller torch bundle.
When it completes, open `https://github.com/Feches/Spine-Contour/releases/tag/preview-windows`
and download `Spine-Contour-Preview-Windows.exe`.

Expected: the release is tagged `preview-windows`, badged **Pre-release**, and is
**not** marked "Latest".

- [ ] **Step 5: Confirm the production release is untouched**

Open `https://github.com/mjayasur/Spine-Contour/releases`.

Expected: `latest-windows` still carries `Spine-Contour-Windows.exe`, its "Latest"
badge, and its original publish date. Nothing on Michael's repository changed.

- [ ] **Step 6: Install the preview alongside the production app**

MANUAL VERIFICATION — this is the real test and cannot be automated:

1. Confirm the production `Spine-Contour` is currently installed (Start Menu shows it).
2. Run `Spine-Contour-Preview-Windows.exe` and complete the installer.
3. Open **Settings → Apps → Installed apps** and search "Spine".

Expected: **two** separate entries, `Spine-Contour` and `Spine-Contour Preview`, each
with its own uninstaller.

4. Open the Start Menu and search "Spine".

Expected: two distinct shortcuts.

5. Launch **Spine-Contour Preview**.

Expected: the window title bar reads `Spine-Contour Preview`.

6. Launch **Spine-Contour** (the production one).

Expected: it launches normally, title bar reads `Spine-Contour`, and choosing a
radiograph and pressing **Measure radiograph** still works exactly as before.

7. Check the app data directories:

```bash
ls "$APPDATA/Spine-Contour" "$APPDATA/Spine-Contour Preview"
```

Expected: two separate directories exist.

- [ ] **Step 7: Confirm uninstalling the preview leaves production intact**

MANUAL VERIFICATION:

1. **Settings → Apps → Installed apps → Spine-Contour Preview → Uninstall.**
2. Search "Spine" again.

Expected: `Spine-Contour` remains, with its shortcut and installation intact.

3. Launch `Spine-Contour` and measure a radiograph.

Expected: works normally.

4. Reinstall the preview for continued development.

- [ ] **Step 8: Record the result**

```bash
cd "C:/Users/codyj/spine contour/.claude/worktrees/ui-redesign"
git commit --allow-empty -m "chore: verify preview installs alongside production release

Confirmed two independent uninstall entries, separate userData
directories, separate Start Menu shortcuts, and that uninstalling the
preview leaves the production install working."
```

---

## Definition of done

- [ ] `Spine-Contour Preview` and `Spine-Contour` are both installed and both launch.
- [ ] Their window titles differ.
- [ ] `%APPDATA%\Spine-Contour` and `%APPDATA%\Spine-Contour Preview` are separate.
- [ ] The `preview-windows` release exists and is marked pre-release, not latest.
- [ ] `mjayasur/Spine-Contour`'s `latest-windows` release is unchanged.
- [ ] `git diff HEAD~4 -- package.json` shows only an added `scripts` entry, no `build` changes.
- [ ] `.github/workflows/windows.yml` has no diff against its state before this plan.
