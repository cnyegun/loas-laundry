#!/bin/sh
# Installs the `laundry` command into ~/.local, so no sudo is needed.
# Usage: curl -fsSL https://raw.githubusercontent.com/cnyegun/loas-laundry/main/install.sh | sh
#
# Everything runs inside main, called on the last line, so a download cut off halfway runs nothing.
set -eu

VERSION=0.2.1

main() {
  PREFIX="${LAUNDRY_PREFIX:-$HOME/.local}"
  BIN="$PREFIX/bin"
  # A release tarball installs without git. Tests set LAUNDRY_SOURCE to a packed .tgz of the checkout.
  SOURCE="${LAUNDRY_SOURCE:-https://codeload.github.com/cnyegun/loas-laundry/tar.gz/refs/tags/v$VERSION}"

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm was not found. Install Node.js (LTS) from https://nodejs.org, then run this again." >&2
    exit 1
  fi

  echo "Installing laundry $VERSION into $PREFIX ..."
  if ! npm install -g --prefix "$PREFIX" --no-fund --no-audit --loglevel=error "$SOURCE"; then
    echo "Installing failed. The npm error above says why. Check your internet connection and try again." >&2
    exit 1
  fi

  ON_PATH=0
  case ":$PATH:" in
    *":$BIN:"*) ON_PATH=1 ;;
  esac
  if [ "$ON_PATH" = 0 ]; then
    add_to_path
  fi

  # An older copy installed elsewhere (for example with sudo) would win over this one.
  FOUND="$(command -v laundry 2>/dev/null || true)"
  if [ -n "$FOUND" ] && [ "$FOUND" != "$BIN/laundry" ]; then
    echo
    echo "Note: another laundry is installed at $FOUND and may run instead of this one."
    echo "Remove it, or run $BIN/laundry directly."
  fi

  echo
  echo "Done! Next steps:"
  if [ "$ON_PATH" = 0 ]; then
    echo "  1. Close this terminal and open a new one."
    echo "  2. Run: laundry setup"
  else
    echo "  Run: laundry setup"
  fi
}

# Adds the bin directory to PATH in the user's shell startup file, once.
add_to_path() {
  LINE="export PATH=\"$BIN:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh) RC="$HOME/.zshrc" ;;
    fish)
      RC="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/laundry.fish"
      LINE="fish_add_path \"$BIN\""
      mkdir -p "$(dirname "$RC")"
      ;;
    bash)
      if [ "$(uname)" != Darwin ]; then
        RC="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        RC="$HOME/.bash_profile"
      else
        # Creating ~/.bash_profile would stop bash from reading ~/.profile.
        RC="$HOME/.profile"
      fi
      ;;
    *) RC="$HOME/.profile" ;;
  esac
  if ! grep -qsF "$LINE" "$RC"; then
    printf '\n# Added by the laundry installer\n%s\n' "$LINE" >> "$RC"
    echo "Added $BIN to your PATH in $RC."
  fi
}

main "$@"
