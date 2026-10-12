# Changelog

## 0.2.0

- Book a single machine: `laundry today washer2:18h30-19h30`. `washers` books every washer, `dryers` every dryer.
- Works with laundry rooms that have any number of washers and dryers. Machine names come from your room's table and show under the headers in `laundry list`.
- Cancel your bookings: `laundry cancel today washer1:18h30-19h30`.
- Booking is all or nothing: if one slot fails, the slots just booked are cancelled again.
- `laundry debug` prints your room's booking table, without login tokens, for bug reports.
- `laundry --help`, `laundry --version`, and `laundry list today`.
- A clear error when LOAS can't be reached.
- The saved login session is now readable only by you, like the saved password.
- `both` and `dryer` still work. In a room with several dryers, `dryer` now asks you to pick one.

## 0.1.0

- First version: `laundry setup`, `laundry list`, and booking both washers or the dryer.
