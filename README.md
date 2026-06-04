# LOAS Laundry

Small CLI for listing and booking LOAS laundry slots.

## Setup

Requires Node.js 18.17+.

```bash
git clone https://github.com/cnyegun/loas-laundry.git
cd loas-laundry
npm install
cp .env.example .env
```

Edit `.env`:

```env
LOAS_EMAIL=you@example.com
LOAS_PASSWORD=your-password
LOAS_ROOMS_URL=https://intra.loas.fi/complexes/123/leases/456/rooms
```

Use your own `LOAS_ROOMS_URL`. Open the LOAS laundry room page in your browser and copy the URL.

## Usage

List slots:

```bash
laundry list
laundry list tomorrow
```

Book slots:

```bash
laundry today both:18h30-19h30 dryer:19h30-20h30
laundry tomorrow both:18h30-19h30 dryer:19h30-20h30
```

`both` books washing machines 1 and 2. `dryer` books dryer 1.

Times must use 30-minute slots, like `18h30-19h30`.
