# LOAS laundry CLI

Tiny browserless CLI for the only supported workflow:

```bash
laundry list
laundry list tomorrow
laundry today both:18h30-19h30 dryer:19h30-20h30
laundry tomorrow both:18h30-19h30 dryer:19h30-20h30
```

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```env
LOAS_EMAIL=you@example.com
LOAS_PASSWORD=your-password
LOAS_ROOMS_URL=https://intra.loas.fi/complexes/123/leases/456/rooms
```

Set `LOAS_ROOMS_URL` to your own LOAS laundry rooms URL. It includes your complex and lease IDs.

Requires Node.js 18.17+.

## List

```bash
laundry list
laundry list tomorrow
```

The table colors are:

- `Book` = sky blue
- `Yours` = green
- `Booked` / `Past` = gray

## Book

```bash
laundry today both:18h30-19h30 dryer:19h30-20h30
```

That reserves both washing machines from 18:30 to 19:30, then the dryer from 19:30 to 20:30.

Supported dates are only `today` and `tomorrow`.
Supported machines are only `both` and `dryer`.
Ranges are start-inclusive/end-exclusive and must use 30-minute LOAS slots.
