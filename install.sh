#!/bin/sh
# Installs the `laundry` command into ~/.local, so no sudo is needed.
# Usage: curl -fsSL https://raw.githubusercontent.com/cnyegun/loas-laundry/main/install.sh | sh
set -eu

PREFIX="${LAUNDRY_PREFIX:-$HOME/.local}"
# What to install. Tests set this to a packed .tgz of the current checkout.
SOURCE="${LAUNDRY_SOURCE:-github:cnyegun/loas-laundry}"
BIN="$PREFIX/bin"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js (LTS) from https://nodejs.org, then run this again." >&2
  exit 1
fi

echo "Installing laundry into $PREFIX ..."
npm install -g --prefix "$PREFIX" --silent "$SOURCE"

# Add the bin directory to PATH in the user's shell startup file, once.
case ":$PATH:" in
  *":$BIN:"*) ON_PATH=1 ;;
  *) ON_PATH=0 ;;
esac

if [ "$ON_PATH" = 0 ]; then
  case "$(basename "${SHELL:-sh}")" in
    zsh) RC="$HOME/.zshrc" ;;
    bash) if [ "$(uname)" = Darwin ]; then RC="$HOME/.bash_profile"; else RC="$HOME/.bashrc"; fi ;;
    *) RC="$HOME/.profile" ;;
  esac
  LINE="export PATH=\"$BIN:\$PATH\""
  if ! grep -qsF "$LINE" "$RC"; then
    printf '\n# Added by the laundry installer\n%s\n' "$LINE" >> "$RC"
    echo "Added $BIN to your PATH in $RC."
  fi
fi

echo
echo "Done! Next steps:"
if [ "$ON_PATH" = 0 ]; then
  echo "  1. Close this terminal and open a new one."
  echo "  2. Run: laundry setup"
else
  echo "  Run: laundry setup"
fi
