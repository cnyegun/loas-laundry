# LOAS Laundry

Book LOAS laundry slots from your terminal, without clicking through the LOAS website.

```bash
laundry list                              # see which slots are free today
laundry today washer1:18h30-19h30         # book washing machine 1, 18:30–19:30
laundry cancel today washer1:18h30-19h30  # cancel it again
```

## Use with Claude Code

If you use [Claude Code](https://claude.com/claude-code), you can just ask Claude in plain words: *"what laundry slots are free tomorrow evening?"* or *"book the washers today 18:30 to 19:30, then the dryer"*.

Type this in Claude Code:

```
/plugin install loas-laundry --marketplace cnyegun/loas-laundry
```

On Claude Code older than 2.1.275, use two commands instead:

```
/plugin marketplace add cnyegun/loas-laundry
/plugin install loas-laundry@loas-laundry
```

Then ask Claude about laundry. The first time, Claude offers to install the `laundry` tool for you (you need [Node.js](https://nodejs.org) installed). Then it asks you to run `laundry setup` once in your own terminal (see [step 4](#4-connect-it-to-your-loas-account)), so your password never goes through the chat.

Claude checks which slots are free before booking, and asks you to confirm unless you already gave the exact day, machines and times.

## Install (about 5 minutes)

If you don't already know what you are doing, I highly recommend to [install the agent's skill version](#use-with-claude-code).

### 1. Install Node.js

Download the **LTS** version from [nodejs.org](https://nodejs.org) and install it like any other program.

### 2. Open a terminal

- **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
- **Windows:** press the Windows key, type `PowerShell`, press Enter.
- **Linux:** you probably know already.

### 3. Install the laundry tool

**Mac or Linux:** copy this into the terminal and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/cnyegun/loas-laundry/main/install.sh | sh
```

It installs into your home folder, so it doesn't need your computer password. If it tells you to, close the terminal and open a new one.

**Windows:** copy this into PowerShell and press Enter:

```bash
npm install -g https://codeload.github.com/cnyegun/loas-laundry/tar.gz/refs/tags/v0.2.1
```

### 4. Connect it to your LOAS account

```bash
laundry setup
```

It asks three things:

1. **Laundry room URL.** Log in to LOAS in your browser, open the laundry room booking page, and copy the address from the address bar. It looks like `https://intra.loas.fi/complexes/123/leases/456/rooms`.
2. **Your LOAS email.**
3. **Your LOAS password.** Nothing is gonna appear on your screen when you are typing, just type your password it and press Enter.

Done! Try `laundry list`.

## How to use

### See free slots

```bash
laundry list            # today
laundry list tomorrow   # tomorrow
```

You get a table like this:

```
┌───────┬───────────────────┬───────────────────┬─────────┐
│ Time  │ Washing machine 1 │ Washing machine 2 │ Dryer 1 │
│       │ washer1           │ washer2           │ dryer1  │
├───────┼───────────────────┼───────────────────┼─────────┤
│ 18:30 │ Book              │ Book              │ Booked  │
│ 19:00 │ Yours             │ Yours             │ Book    │
└───────┴───────────────────┴───────────────────┴─────────┘
```

- **Book**: free, you can book it
- **Yours**: you already booked it
- **Booked**: someone else has it
- **Past**: already over

The second header line is the machine's short name (`washer1`, `dryer1`, ...). You type it when you book or cancel. Your laundry room may have more or fewer machines than this example. `laundry list` always shows the ones in your room.

### Book slots

Say **when** (`today` or `tomorrow`), then **what** and **what time**:

```bash
laundry today washer1:18h30-19h30
```

This books washing machine 1 from 18:30 to 19:30.

What you can book:

- One machine by its short name from `laundry list`: `washer1`, `washer2`, `dryer1`, ...
- `washers` (or `both`): every washing machine in your room
- `dryers`: every dryer
- `washer` or `dryer`: the only washer or dryer, if your room has just one

You can book several things at once. A typical wash, then dry:

```bash
laundry tomorrow washers:18h30-19h30 dryer:19h30-20h30
```

It's all or nothing. If one of the slots can't be booked (say someone took it a second ago), the slots it already booked in that command are cancelled again. If your internet connection drops in the middle, it can't do that, so it tells you to check `laundry list`.

Rules for times:

- Use the 24-hour clock: `18h30` means 18:30 (6:30 pm).
- Times must be on the hour or half hour (`18h00` or `18h30`, not `18h15`).

### Cancel slots

Put `cancel` in front, and use the same day, machines and times as when you booked:

```bash
laundry cancel today washer1:18h30-19h30
laundry cancel tomorrow washers:18h30-19h30 dryer:19h30-20h30
```

You can only cancel your own bookings (**Yours** in `laundry list`).

### Your laundry room looks different?

The tool reads the machines from your room's booking table, so any number of washers and dryers should work. If something looks wrong, run:

```bash
laundry debug > room.html
```

This saves your room's booking table (without your login details) to `room.html`. Open an issue on GitHub and attach it. Have a quick look at the file first and remove any names you don't want to share.

## Something went wrong?

| You see | What to do |
|---|---|
| `npm: command not found` | Node.js isn't installed. Do step 1, then close and reopen the terminal. |
| `EACCES` or `permission denied` during install | You probably used `npm install -g` on Mac/Linux. Use the `curl` command from step 3 instead. |
| `laundry: command not found` | Close and reopen the terminal. If it still happens, redo step 3. |
| `Not set up yet` | Run `laundry setup`. |
| `The laundry room URL must start with https://intra.loas.fi/` | Run `laundry setup` and paste the laundry room page address from your browser. |
| `Still on login page after login` | Your email or password is wrong. Run `laundry setup` again. |
| `... is not bookable` | Someone else took that slot, or it's in the past. Check `laundry list`. |
| `Unknown machine "..."` | Your room has different machines. Use one of the names it lists, or check `laundry list`. |
| `This room has 2 dryers` | Pick one (`dryer1`), or use `dryers` for all of them. |
| `... is not your booking` | You can only cancel slots that show **Yours** in `laundry list`. |
| `... Undid N slots, nothing is booked` | One slot couldn't be booked, so the others were cancelled again. Check `laundry list` and try other times. |

**Changed your password?** Run `laundry setup` again. Press Enter to keep the URL and email it shows you.

**Update to the latest version:** run the step 3 command again. `laundry --version` shows which version you have.

**Uninstall:** on Mac/Linux run `npm uninstall -g --prefix ~/.local loas-laundry`, on Windows run `npm uninstall -g loas-laundry`. To also delete your saved login, delete the `~/.config/loas-laundry` folder.

**Where is my password stored?** Only on your computer, in `~/.config/loas-laundry/config.json`, which only your user account can read. It's only ever sent to LOAS: the tool refuses to log in anywhere other than `https://intra.loas.fi`.

## License

Copyright Chi Nguyen. Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

You can use, change and share this tool for personal and other noncommercial purposes. Commercial use needs written permission. Contact me via [GitHub](https://github.com/cnyegun).
