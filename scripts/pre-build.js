#!/usr/bin/env node
/**
 * Pre-build script for electron-builder
 * Ensures local ffmpeg binary is ready for packaging
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const ffmpegSource = path.join(projectRoot, 'ffmpeg');

console.log('🔧 Running pre-build checks...');

// Verify ffmpeg exists in project root
if (!fs.existsSync(ffmpegSource)) {
  console.error('❌ FFmpeg not found in project root:', ffmpegSource);
  process.exit(1);
}

const stats = fs.statSync(ffmpegSource);
if (!stats.isFile()) {
  console.error('❌ FFmpeg path is not a file:', ffmpegSource);
  process.exit(1);
}

// Check if executable
const isExecutable = (stats.mode & 0o111) !== 0;
if (!isExecutable) {
  console.log('⚠️  FFmpeg is not executable, fixing permissions...');
  try {
    fs.chmodSync(ffmpegSource, 0o755);
    console.log('✅ Fixed ffmpeg permissions');
  } catch (err) {
    console.error('❌ Failed to fix ffmpeg permissions:', err.message);
    process.exit(1);
  }
}

console.log('✅ FFmpeg is ready for packaging:');
console.log(`   Path: ${ffmpegSource}`);
console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);

// electron-builder will copy ffmpeg via extraResources config
console.log('📦 FFmpeg will be copied to app package by electron-builder');
console.log('✅ Pre-build checks complete!');
process.exit(0);
