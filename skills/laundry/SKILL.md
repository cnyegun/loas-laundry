---
name: laundry
description: "Check free slots, book and cancel LOAS laundry (washing machines and dryers) with the `laundry` CLI. Use when the user asks about laundry, the laundry room, washing machines, the dryer, or booking or cancelling a wash/laundry slot at LOAS, for today or tomorrow."
---

# LOAS laundry

The `laundry` command lists and books slots in the user's LOAS laundry room. All times are Finnish time (Europe/Helsinki), on a 24-hour clock, in 30-minute slots.

## Before the first use

1. Run `laundry list`. If that says `command not found`, try `~/.local/bin/laundry list`. If that works, use `~/.local/bin/laundry` in place of `laundry` everywhere below.
2. If neither is found, the CLI isn't installed. Ask the user whether to install it, then run:
   - Mac/Linux: `curl -fsSL https://raw.githubusercontent.com/cnyegun/loas-laundry/main/install.sh | sh`. This installs into `~/.local` without sudo. Your shell won't pick up the PATH change, so use `~/.local/bin/laundry` for the rest of the session.
   - Windows: `npm install -g github:cnyegun/loas-laundry`

   Don't use `sudo`. If npm itself is missing, tell the user to install Node.js LTS from https://nodejs.org first.
3. If the output says `Not set up yet` or `Still on login page after login`, the user must run `laundry setup` **in their own terminal window**. It asks for the laundry room URL, LOAS email and password, and hides the password while it's typed. Tell them to do this and wait.
   - Never ask for the LOAS password in chat, and never write it into a file or command yourself.
   - Don't try running `laundry setup` yourself, because it waits for typed input.

## See free slots

```bash
laundry list            # today
laundry list tomorrow   # tomorrow
```

In the table, **Book** means free, **Yours** means the user already has it, **Booked** means someone else has it, and **Past** means it's over. Summarize the free times in plain words rather than pasting the whole table, unless the user wants it.

The second header line gives each machine's short name (`washer1`, `washer2`, `dryer1`, ...). Rooms differ, so read the names from this output. Don't assume two washers and one dryer.

## Book slots

```bash
laundry <today|tomorrow> <machine>:<start>-<end> [<machine>:<start>-<end> ...]
```

- `<machine>` is one of:
  - a single machine's short name from `laundry list`, like `washer1` or `dryer1`
  - `washers` (or the older `both`) for every washer, or `dryers` for every dryer
  - `washer` or `dryer` for the only one of that kind. This fails if the room has several, so name one instead.
- If the user says "a washer" without picking one, choose a free one yourself. If they say "the washers", use `washers`.
- `<start>` and `<end>` use the `18h30` format and must be on `h00` or `h30`. The end time is when the last slot finishes.
- Only `today` and `tomorrow` work. Other days can't be booked from the CLI.

Examples:

| User says | Command |
|---|---|
| "book the washers tomorrow 6 to 7 pm" | `laundry tomorrow washers:18h00-19h00` |
| "a washer at 18:30 for an hour, then dry" | `laundry today washer1:18h30-19h30 dryer:19h30-20h30` (with washer1 free) |
| "washing machine 2 tonight from 9 for half an hour" | `laundry today washer2:21h00-21h30` |

How to book:

1. Run `laundry list` (or `laundry list tomorrow`) first, and check that every requested slot shows **Book**.
2. If the request is vague ("this evening", "after work"), suggest specific free slots and let the user pick.
3. Booking acts on the user's real LOAS account. Unless the user already named the exact day, machines and times, show the command you'll run and get a yes first.
4. Run the command. On success it prints `Booked N reservations.` Then run `laundry list` again to confirm the slots now show **Yours**.

Booking is all or nothing. If any slot fails, the CLI cancels the slots it already booked in that command, and the error ends with `Undid N slots, nothing is booked.` Offer other free times. If the error says `Undoing failed, these are still booked: ...`, tell the user exactly which slots they still have.

## Cancel slots

```bash
laundry cancel <today|tomorrow> <machine>:<start>-<end> [<machine>:<start>-<end> ...]
```

Machines and times work the same as for booking.

1. Run `laundry list` (or `laundry list tomorrow`) and check that every slot to cancel shows **Yours**.
2. Cancelling can't be undone, and the slot may be taken by someone else right after. Show the command and get a yes first, unless the user already named the exact day, machines and times.
3. On success it prints `Cancelled N reservations.` Run `laundry list` again to confirm.

## Errors

| Output | Meaning |
|---|---|
| `... is not bookable` | Someone else has that slot, or it's in the past. Offer nearby free slots. |
| `... is already yours` | The user already booked it. Nothing to do for that slot. |
| `... is not your booking` | Only **Yours** slots can be cancelled. Re-check `laundry list`. |
| `Unknown machine "..."` / `This room has N dryers` | Use one of the machine names listed in the error. |
| `Could not find HH:MM in the LOAS table` | That time isn't on the booking table (outside opening hours). |
| `Invalid range` / `Invalid time` | The command was formatted wrong. Fix it and retry. |
| `Not set up yet` / `Still on login page after login` | The user needs to run `laundry setup` in their own terminal. |
