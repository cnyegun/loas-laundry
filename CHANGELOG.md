# Changelog

## 0.2.1 (2026-10-12)

- Installing no longer needs git. `install.sh` and the Windows command install a pinned release tarball, and npm errors are shown instead of hidden.
- `install.sh` supports fish, doesn't hide `~/.profile` on macOS bash, and warns if an older `laundry` elsewhere would run instead.
- Security: a `.env` file in the current folder is no longer read, and the tool refuses to send your login anywhere other than `https://intra.loas.fi`. You can still set `LOAS_*` environment variables yourself.
- Requests time out after 20 seconds. If the connection drops during a booking, the error says some slots may be booked.
- A slot that got booked despite an error response is no longer undone.
- Column names containing "laundry" are no longer taken for dryers.
- Saved files are written atomically.
- The Claude skill checks the CLI version and offers to update an old one.

## 0.2.0 (2026-10-12)

- Book a single machine: `laundry today washer2:18h30-19h30`. `washers` books every washer, `dryers` every dryer.
- Works with laundry rooms that have any number of washers and dryers. Machine names come from your room's table and show under the headers in `laundry list`.
- Cancel your bookings: `laundry cancel today washer1:18h30-19h30`.
- Booking is all or nothing: if one slot fails, the slots just booked are cancelled again.
- `laundry debug` prints your room's booking table, without login tokens, for bug reports.
- `laundry --help`, `laundry --version`, and `laundry list today`.
- A clear error when LOAS can't be reached.
- The saved login session is now readable only by you, like the saved password.
- `both` and `dryer` still work. In a room with several dryers, `dryer` now asks you to pick one.

## 0.1.0 (2026-10-11)

- First version: `laundry setup`, `laundry list`, and booking both washers or the dryer.
