---
name: laundry
description: "Check free slots and book LOAS laundry (washing machines and dryer) with the `laundry` CLI. Use when the user asks about laundry, the laundry room, washing machines, the dryer, or booking a wash/laundry slot at LOAS, for today or tomorrow."
---

# LOAS laundry

The `laundry` command lists and books slots in the user's LOAS laundry room. All times are Finnish time (Europe/Helsinki), on a 24-hour clock, in 30-minute slots.

## Before the first use

1. Run `laundry list`.
2. If the output says `command not found`, the CLI isn't installed. Ask the user whether to install it, then run:
   ```bash
   npm install -g github:cnyegun/loas-laundry
   ```
   If npm itself is missing, tell the user to install Node.js LTS from https://nodejs.org first.
3. If the output says `Not set up yet` or `Still on login page after login`, the user must run `laundry setup` **in their own terminal window**. It asks for the laundry room URL, LOAS email and password, and hides the password while it's typed. Tell them to do this and wait.
   - Never ask for the LOAS password in chat, and never write it into a file or command yourself.
   - Don't try running `laundry setup` yourself, because it waits for typed input.

## See free slots

```bash
laundry list            # today
laundry list tomorrow   # tomorrow
```

In the table, **Book** means free, **Yours** means the user already has it, **Booked** means someone else has it, and **Past** means it's over. Summarize the free times in plain words rather than pasting the whole table, unless the user wants it.

## Book slots

```bash
laundry <today|tomorrow> <machine>:<start>-<end> [<machine>:<start>-<end> ...]
```

- `<machine>` is `both` (washing machines 1 and 2 together) or `dryer` (dryer 1). Booking a single washing machine isn't supported.
- `<start>` and `<end>` use the `18h30` format and must be on `h00` or `h30`. The end time is when the last slot finishes.
- Only `today` and `tomorrow` work. Other days can't be booked from the CLI.

Examples:

| User says | Command |
|---|---|
| "book the washers tomorrow 6 to 7 pm" | `laundry tomorrow both:18h00-19h00` |
| "wash at 18:30 for an hour then dry" | `laundry today both:18h30-19h30 dryer:19h30-20h30` |
| "dryer tonight from 9 for half an hour" | `laundry today dryer:21h00-21h30` |

How to book:

1. Run `laundry list` (or `laundry list tomorrow`) first, and check that every requested slot shows **Book**.
2. If the request is vague ("this evening", "after work"), suggest specific free slots and let the user pick.
3. Booking acts on the user's real LOAS account. Unless the user already named the exact day, machines and times, show the command you'll run and get a yes first.
4. Run the command. On success it prints `Booked N reservations.` Then run `laundry list` again to confirm the slots now show **Yours**.

Bookings stop at the first slot that fails, and slots booked before it stay booked. If a booking fails partway, run `laundry list` and tell the user which slots they got.

Cancelling isn't supported by the CLI. Tell the user to cancel on the LOAS website.

## Errors

| Output | Meaning |
|---|---|
| `... is not bookable` | Someone else has that slot, or it's in the past. Offer nearby free slots. |
| `Could not find HH:MM in the LOAS table` | That time isn't on the booking table (outside opening hours). |
| `Invalid range` / `Invalid time` | The command was formatted wrong. Fix it and retry. |
| `Not set up yet` / `Still on login page after login` | The user needs to run `laundry setup` in their own terminal. |
