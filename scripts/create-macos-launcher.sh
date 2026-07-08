#!/bin/zsh
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "$0")/.." && pwd)"
app_name="Hermes Desktop Agent Launcher"
app_dir="$repo_root/release-build/$app_name.app"
contents_dir="$app_dir/Contents"
macos_dir="$contents_dir/MacOS"
resources_dir="$contents_dir/Resources"

mkdir -p "$macos_dir" "$resources_dir"

cat > "$contents_dir/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>HermesDesktopLauncher</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.hermes.desktop-agent.launcher</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Hermes Desktop Agent</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.1</string>
  <key>CFBundleVersion</key>
  <string>0.1.1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
PLIST

cat > "$macos_dir/HermesDesktopLauncher" <<LAUNCHER
#!/bin/zsh
set -euo pipefail

repo_root="$repo_root"
cd -- "\$repo_root"

if [ -x "./start-hermes-desktop.command" ]; then
  exec "./start-hermes-desktop.command"
fi

exec /bin/zsh "./start-hermes-desktop.command"
LAUNCHER

chmod +x "$macos_dir/HermesDesktopLauncher"
chmod +x "$repo_root/start-hermes-desktop.command"
chmod +x "$repo_root/setup-hermes-environment.command"

if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1 && [ -f "$repo_root/assets/icon.png" ]; then
  iconset="$resources_dir/AppIcon.iconset"
  rm -rf "$iconset"
  mkdir -p "$iconset"
  sips -z 16 16 "$repo_root/assets/icon.png" --out "$iconset/icon_16x16.png" >/dev/null
  sips -z 32 32 "$repo_root/assets/icon.png" --out "$iconset/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$repo_root/assets/icon.png" --out "$iconset/icon_32x32.png" >/dev/null
  sips -z 64 64 "$repo_root/assets/icon.png" --out "$iconset/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$repo_root/assets/icon.png" --out "$iconset/icon_128x128.png" >/dev/null
  sips -z 256 256 "$repo_root/assets/icon.png" --out "$iconset/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$repo_root/assets/icon.png" --out "$iconset/icon_256x256.png" >/dev/null
  sips -z 512 512 "$repo_root/assets/icon.png" --out "$iconset/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$repo_root/assets/icon.png" --out "$iconset/icon_512x512.png" >/dev/null
  cp "$repo_root/assets/icon.png" "$iconset/icon_512x512@2x.png"
  if ! iconutil -c icns "$iconset" -o "$resources_dir/AppIcon.icns"; then
    echo "Icon generation skipped: assets/icon.png is not large enough for a full macOS iconset."
    rm -f "$resources_dir/AppIcon.icns"
  fi
  rm -rf "$iconset"
fi

echo "Created: $app_dir"
echo "Double-click the app to launch Hermes Desktop Agent."
