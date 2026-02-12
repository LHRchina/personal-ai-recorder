## Learnings from fix-ffmpeg-enotdir

### 2026-02-12 - FFmpeg ENOTDIR Bug Fix

**Root Cause Pattern Identified:**
When an Electron app is packaged:
1. `__dirname` points to `.../app.asar` (the asar archive itself)
2. `path.join(__dirname, 'binary')` resolves to `.../app.asar/binary`
3. `fs.existsSync()` returns TRUE because Electron patches fs to read asar contents
4. `spawn('.../app.asar/binary')` fails with ENOTDIR because OS can't traverse asar as directory

**Solution Pattern:**
Add asar path filtering to any binary resolution logic:
```javascript
if (!p.includes('.asar') && fs.existsSync(p)) {
  // Only real filesystem paths
}
```

**Build Configuration Pattern:**
To prevent double-packaging (asar + extraResources):
- Add `"!binaryname"` to `build.files` array
- Keep `extraResources` config unchanged — it correctly copies to Resources/

**Verification Pattern:**
1. Code: `grep "\.asar" main.js` shows filter
2. Config: `node -e "const p=require('./package.json');console.log(p.build.files)"` shows exclusion
3. Build: `npx asar list <asar> | grep binary` shows no output (binary not in asar)
4. Build: `ls <resources>/binary` shows file exists (binary in Resources/)

**Potential Similar Issues:**
- `transcribe.py` may have same issue in packaged app (not in asar, not in extraResources)
- Any binary spawning from `__dirname` relative paths

**Commit:** 7a1d6ca — fix: prevent ENOTDIR by skipping asar paths in ffmpeg resolution and excluding ffmpeg from asar
