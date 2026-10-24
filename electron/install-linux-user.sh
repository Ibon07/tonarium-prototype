#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-$root/electron/build/package-linux/linux-unpacked}"
[[ -x "$source_dir/tonarium-electron" && -f "$source_dir/resources/app.asar" ]] || { echo 'Build with npm --prefix electron run build:linux first.' >&2; exit 1; }
base="$HOME/.local/opt/tonarium-electron"
version="$(python3 - "$root/electron/package.json" <<'PY'
import json, sys
print(json.load(open(sys.argv[1]))['version'])
PY
)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]] || { echo 'Invalid package version' >&2; exit 1; }
destination="$base/$version-$(date +%Y%m%d-%H%M%S)"
[[ ! -e "$destination" ]] || { echo "Already installed: $destination" >&2; exit 1; }
mkdir -p "$base" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
cp -a "$source_dir" "$destination"
ln -s "$destination" "$base/.current-$$"
mv -Tf "$base/.current-$$" "$base/current"
ln -sfn "$base/current/tonarium-electron" "$HOME/.local/bin/tonarium-electron"
install -m644 "$destination/resources/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/tonarium-electron.png"
python3 - "$HOME/.local/share/applications/tonarium-electron.desktop" "$base/current/tonarium-electron" <<'PY'
import pathlib, sys
executable = sys.argv[2].replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
pathlib.Path(sys.argv[1]).write_text(f'''[Desktop Entry]
Type=Application
Name=Tonarium Electron
Comment=Tonarium Web desktop client
Exec="{executable}" %U
Icon=tonarium-electron
Terminal=false
Categories=Network;
StartupWMClass=tonarium-electron
''')
PY
if command -v update-desktop-database >/dev/null; then update-desktop-database "$HOME/.local/share/applications"; fi
printf 'Installed: %s\nLaunch: %s\n' "$destination" "$HOME/.local/bin/tonarium-electron"
