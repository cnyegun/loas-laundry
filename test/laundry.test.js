'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseCommand, extractTable, debugTable, discoverMachines, resolveSlots, bookAll, cancelAll, writePrivateFile,
} = require('../src/loas-laundry');

const PAGE_URL = 'https://intra.loas.fi/complexes/123/leases/456/rooms?selected_date=2026-10-13';

// A real LOAS table (tomorrow, dryer booked at 21:00, first row turned into Past), with tokens removed.
const realTable = () => extractTable(fs.readFileSync(path.join(__dirname, 'fixtures/room.html'), 'utf8'), PAGE_URL);

// Renders a table shaped like the real LOAS markup. Each machine column's product id is its column number.
function renderRoom({ headers, times = ['20:00', '20:30', '21:00'], yours = new Set(), past = new Set() }) {
  const head = ['<th></th>', ...headers.map((label) => `<th class="align-center"><p>Pyykkitupa ${label}</p></th>`)].join('');
  const body = times.map((time, index) => {
    const cells = headers.map((_, i) => {
      const column = i + 1;
      const base = `/time_slot_products/${column}/time_slot_reservations`;
      if (past.has(time)) return '<td>Past</td>';
      if (yours.has(`${column} ${time}`)) {
        return `<td><form method="post" action="${base}/${column * 100 + index}"><input type="hidden" name="_method" value="delete"><button>Cancel</button><input type="hidden" name="authenticity_token" value="t"></form></td>`;
      }
      return `<td><form method="post" action="${base}" data-remote="true"><button>Book</button><input type="hidden" name="authenticity_token" value="t"><input type="hidden" name="date" value="2026-10-13"><input type="hidden" name="housing_complex_id" value="123"><input type="hidden" name="index" value="${index}"></form></td>`;
    });
    return `<tr><td>${time}</td>${cells.join('')}</tr>`;
  }).join('');
  return `<meta name="csrf-token" content="t"><table class="booking-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// A pretend LOAS server that keeps the user's bookings in memory.
function fakeLoas(headers, { failBooking = () => false, failCancel = () => false } = {}) {
  const times = ['20:00', '20:30', '21:00'];
  const yours = new Set();
  const posts = [];
  const page = () => ({ ok: true, status: 200, url: PAGE_URL, text: renderRoom({ headers, times, yours }) });
  return {
    yours,
    posts,
    async get() {
      return page();
    },
    async postForm(action, fields, requestHeaders) {
      const column = Number(/time_slot_products\/(\d+)/.exec(action)[1]);
      const cancel = fields._method === 'delete';
      const time = cancel ? times[Number(/\/(\d+)$/.exec(action)[1]) % 100] : times[Number(fields.index)];
      const key = `${column} ${time}`;
      posts.push({ kind: cancel ? 'cancel' : 'book', key, xhr: requestHeaders['X-Requested-With'] === 'XMLHttpRequest' });
      if ((cancel ? failCancel : failBooking)(key)) return { ok: false, status: 422, statusText: 'Unprocessable Entity', url: action, text: '' };
      if (cancel) yours.delete(key);
      else yours.add(key);
      return page();
    },
  };
}

const requests = (command) => parseCommand(command.split(' ')).requests;
const ids = (machines) => machines.map((machine) => machine.id);

test('parses book and cancel commands, keeping the old syntax', () => {
  assert.deepEqual(parseCommand(['today', 'both:18h30-19h30']).requests, [
    { machine: 'both', time: '18:30' },
    { machine: 'both', time: '19:00' },
  ]);
  const cancel = parseCommand(['cancel', 'tomorrow', 'Washer2:08h00-08h30']);
  assert.equal(cancel.action, 'cancel');
  assert.equal(cancel.dateToken, 'tomorrow');
  assert.deepEqual(cancel.requests, [{ machine: 'washer2', time: '08:00' }]);
});

test('parses list, debug, help and version', () => {
  assert.deepEqual(parseCommand(['list']), { action: 'list', dateToken: 'today' });
  assert.deepEqual(parseCommand(['list', 'today']), { action: 'list', dateToken: 'today' });
  assert.deepEqual(parseCommand(['debug', 'tomorrow']), { action: 'debug', dateToken: 'tomorrow' });
  assert.equal(parseCommand([]).action, 'help');
  assert.equal(parseCommand(['--help']).action, 'help');
  assert.equal(parseCommand(['--version']).action, 'version');
  assert.throws(() => parseCommand(['list', 'monday']), /Unsupported command/);
});

test('rejects malformed commands', () => {
  assert.throws(() => parseCommand(['today', 'washer1:18h15-19h00']), /30-minute/);
  assert.throws(() => parseCommand(['today', 'washer1:19h00-18h00']), /End must be after start/);
  assert.throws(() => parseCommand(['today', 'washer1:1830-1900']), /18h30 syntax/);
  assert.throws(() => parseCommand(['today', 'wash-er:18h30-19h00']), /Invalid machine/);
  assert.throws(() => parseCommand(['cancel', 'today']), /Unsupported command/);
});

test('reads the real LOAS table', () => {
  const table = realTable();
  assert.deepEqual(ids(discoverMachines(table.headers)), ['washer1', 'washer2', 'dryer1']);

  const booking = resolveSlots(table, requests('today both:20h30-21h00'), 'book');
  assert.deepEqual(booking.map((slot) => `${slot.machine} ${slot.time}`), ['washer1 20:30', 'washer2 20:30']);
  assert.equal(booking[0].form.remote, true);
  assert.equal(booking[0].form.fields.index, '27');
  assert.equal(booking[0].form.fields.date, '2026-10-13');

  const [cancel] = resolveSlots(table, requests('today dryer:21h00-21h30'), 'cancel');
  assert.match(cancel.form.action, /time_slot_products\/103\/time_slot_reservations\/1000001$/);
  assert.equal(cancel.form.fields._method, 'delete');
  assert.equal(cancel.form.remote, false);
});

test('refuses slots that are taken, past or not yours', () => {
  const table = realTable();
  assert.throws(() => resolveSlots(table, requests('today dryer:21h00-21h30'), 'book'), /dryer1 at 21:00 is already yours/);
  assert.throws(() => resolveSlots(table, requests('today washer1:07h00-07h30'), 'book'), /washer1 at 07:00 is not bookable/);
  assert.throws(() => resolveSlots(table, requests('today washer1:21h00-21h30'), 'cancel'), /washer1 at 21:00 is not your booking/);
  assert.throws(() => resolveSlots(table, requests('today washer1:23h00-23h30'), 'book'), /Could not find 23:00/);
});

test('handles a bigger room with Finnish headers', () => {
  const headers = ['Pesukone 1', 'Pesukone 2', 'Pesukone 3', 'Kuivausrumpu 1', 'Kuivauskaappi'];
  const table = extractTable(renderRoom({ headers }), PAGE_URL);
  assert.deepEqual(ids(discoverMachines(table.headers)), ['washer1', 'washer2', 'washer3', 'dryer1', 'dryer2']);
  assert.equal(resolveSlots(table, requests('today washers:20h00-20h30'), 'book').length, 3);
  assert.equal(resolveSlots(table, requests('today dryers:20h00-20h30'), 'book').length, 2);
  assert.equal(resolveSlots(table, requests('today washer3:20h00-20h30'), 'book')[0].column, 3);
  assert.throws(() => resolveSlots(table, requests('today dryer:20h00-20h30'), 'book'), /2 dryers: dryer1, dryer2\. Pick one, or use dryers/);
});

test('explains missing machines', () => {
  const table = extractTable(renderRoom({ headers: ['Washing machine 1'] }), PAGE_URL);
  assert.throws(() => resolveSlots(table, requests('today dryer:20h00-20h30'), 'book'), /no dryer\. It has: washer1/);
  assert.throws(() => resolveSlots(table, requests('today washer2:20h00-20h30'), 'book'), /Unknown machine "washer2"\. This room has: washer1/);
});

test('numbers unnumbered and repeated headers', () => {
  assert.deepEqual(ids(discoverMachines(['', 'Washing machine', 'Dryer', 'Dryer 1', 'Ironing board'])), ['washer1', 'dryer2', 'dryer1', 'machine1']);
});

test('books every slot when all succeed', async () => {
  const loas = fakeLoas(['Washing machine 1', 'Washing machine 2']);
  const page = await loas.get();
  const slots = resolveSlots(extractTable(page.text, page.url), requests('today both:20h00-21h00'), 'book');
  await bookAll(loas, PAGE_URL, page, slots);
  assert.equal(loas.yours.size, 4);
  assert.ok(loas.posts.every((post) => post.kind === 'book' && post.xhr));
});

test('undoes the slots it booked when a later one fails', async () => {
  const loas = fakeLoas(['Washing machine 1', 'Dryer 1'], { failBooking: (key) => key === '2 20:00' });
  const page = await loas.get();
  const slots = resolveSlots(extractTable(page.text, page.url), requests('today washer1:20h00-21h00 dryer:20h00-20h30'), 'book');
  await assert.rejects(bookAll(loas, PAGE_URL, page, slots), /dryer1 at 20:00 could not be booked \(HTTP 422.*Undid 2 slots, nothing is booked/);
  assert.equal(loas.yours.size, 0);
  assert.deepEqual(loas.posts.filter((post) => post.kind === 'cancel').map((post) => post.key), ['1 20:00', '1 20:30']);
  assert.ok(loas.posts.filter((post) => post.kind === 'cancel').every((post) => !post.xhr));
});

test('says which slots stay booked when the undo fails too', async () => {
  const loas = fakeLoas(['Washing machine 1'], { failBooking: (key) => key === '1 20:30', failCancel: () => true });
  const page = await loas.get();
  const slots = resolveSlots(extractTable(page.text, page.url), requests('today washer1:20h00-21h00'), 'book');
  await assert.rejects(bookAll(loas, PAGE_URL, page, slots), /Undoing failed, these are still booked: washer1 at 20:00\./);
});

test('cancels bookings and reports any that remain', async () => {
  const loas = fakeLoas(['Washing machine 1', 'Washing machine 2']);
  for (const key of ['1 20:00', '2 20:00', '1 20:30']) loas.yours.add(key);
  let page = await loas.get();
  let slots = resolveSlots(extractTable(page.text, page.url), requests('today washers:20h00-20h30'), 'cancel');
  await cancelAll(loas, PAGE_URL, page, slots);
  assert.deepEqual([...loas.yours], ['1 20:30']);

  const stuck = fakeLoas(['Washing machine 1'], { failCancel: () => true });
  stuck.yours.add('1 20:30');
  page = await stuck.get();
  slots = resolveSlots(extractTable(page.text, page.url), requests('today washer1:20h30-21h00'), 'cancel');
  await assert.rejects(cancelAll(stuck, PAGE_URL, page, slots), /could not be cancelled \(HTTP 422.*Still booked: washer1 at 20:30/);
});

test('debug output hides CSRF tokens', () => {
  const html = debugTable(renderRoom({ headers: ['Dryer 1'] }).replace(/value="t"/g, 'value="secret-token"'));
  assert.doesNotMatch(html, /secret-token/);
  assert.match(html, /REDACTED/);
});

test('saved files are private to the user', { skip: process.platform === 'win32' && 'Windows has no POSIX modes' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'laundry-test-'));
  const file = path.join(dir, 'nested', 'session.json');
  writePrivateFile(file, '{}');
  fs.chmodSync(file, 0o644);
  writePrivateFile(file, '{"a":1}');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}');
  fs.rmSync(dir, { recursive: true, force: true });
});
