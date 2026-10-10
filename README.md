# LOAS Laundry

Book LOAS laundry slots from your terminal, without clicking through the LOAS website.

```bash
laundry list                              # see which slots are free today
laundry today both:18h30-19h30            # book both washing machines, 18:30–19:30
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

Copy this into the terminal and press Enter:

```bash
npm install -g github:cnyegun/loas-laundry
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
├───────┼───────────────────┼───────────────────┼─────────┤
│ 18:30 │ Book              │ Book              │ Booked  │
│ 19:00 │ Yours             │ Yours             │ Book    │
└───────┴───────────────────┴───────────────────┴─────────┘
```

- **Book**: free, you can book it
- **Yours**: you already booked it
- **Booked**: someone else has it
- **Past**: already over

### Book slots

Say **when** (`today` or `tomorrow`), then **what** and **what time**:

```bash
laundry today both:18h30-19h30
```

This books both washing machines from 18:30 to 19:30.

What you can book:

- `both`: washing machines 1 and 2
- `dryer`: the dryer

You can book several things at once. A typical wash, then dry:

```bash
laundry tomorrow both:18h30-19h30 dryer:19h30-20h30
```

Rules for times:

- Use the 24-hour clock: `18h30` means 18:30 (6:30 pm).
- Times must be on the hour or half hour (`18h00` or `18h30`, not `18h15`).

## Something went wrong?

| You see | What to do |
|---|---|
| `npm: command not found` | Node.js isn't installed. Do step 1, then close and reopen the terminal. |
| `EACCES` or `permission denied` during install | On Mac/Linux, run the step 3 command with `sudo` in front: `sudo npm install -g github:cnyegun/loas-laundry` (it asks for your computer password). |
| `laundry: command not found` | Close and reopen the terminal. If it still happens, redo step 3. |
| `Not set up yet` | Run `laundry setup`. |
| `Still on login page after login` | Your email or password is wrong. Run `laundry setup` again. |
| `... is not bookable` | Someone else took that slot, or it's in the past. Check `laundry list`. |

**Changed your password?** Run `laundry setup` again. Press Enter to keep the URL and email it shows you.

**Update to the latest version:** run the step 3 command again.

**Uninstall:** `npm uninstall -g loas-laundry`

**Where is my password stored?** Only on your computer, in `~/.config/loas-laundry/config.json`, which only your user account can read. It's only ever sent to LOAS.
