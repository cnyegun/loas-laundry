#!/usr/bin/env node
'use strict';

// A .env in the current directory still works, and overrides the saved config.
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const fetchCookieModule = require('fetch-cookie');
const fetchCookie = fetchCookieModule.default || fetchCookieModule;

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'loas-laundry');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const DEFAULT_SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

class UsageError extends Error {}

const USAGE = `Usage:
  laundry setup
  laundry list [today|tomorrow]
  laundry today washer1:18h30-19h30
  laundry tomorrow washers:18h30-19h30 dryer:19h30-20h30
  laundry cancel today washer1:18h30-19h30
  laundry debug [today|tomorrow]
  laundry --version

Machines are named as shown under the headers in laundry list (washer1, dryer1, ...).
washers or both means every washer, dryers means every dryer.`;

function failUsage(message) {
  throw new UsageError(message);
}

// Writes a file only the current user can read. The mode options only apply when creating,
// so chmod as well to fix files and folders made by older versions.
function writePrivateFile(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (dir === CONFIG_DIR) fs.chmodSync(dir, 0o700);
  fs.writeFileSync(file, content, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function readSavedConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

const savedConfig = readSavedConfig();

function config(name, fallback = '') {
  const value = String(process.env[name] || savedConfig[name] || '').trim();
  return value || fallback;
}

async function setup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Read through the iterator because it buffers lines, so piped input is not lost.
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question, current = '', hidden = false) => {
    rl.setPrompt(current ? `${question} [${current}]: ` : `${question}: `);
    rl.prompt();
    if (hidden) rl._writeToOutput = () => {};
    const { value = '' } = await lines.next();
    return value.trim() || current;
  };

  console.log('Open the LOAS laundry room page in your browser and copy its URL.');
  const roomsUrl = await ask('Laundry room URL', savedConfig.LOAS_ROOMS_URL);
  inferHousingComplexId(roomsUrl);
  const email = await ask('LOAS email', savedConfig.LOAS_EMAIL);
  const password = await ask('LOAS password', '', true);
  rl.close();
  process.stdout.write('\n');
  if (!roomsUrl || !email || !password) throw new Error('URL, email and password are all required.');

  writePrivateFile(CONFIG_FILE, JSON.stringify({ LOAS_ROOMS_URL: roomsUrl, LOAS_EMAIL: email, LOAS_PASSWORD: password }, null, 2));
  // Credentials may have changed, so log in fresh next time.
  fs.rmSync(DEFAULT_SESSION_FILE, { force: true });
  console.log(`Saved to ${CONFIG_FILE}. Try: laundry list`);
}

const isDay = (token) => token === 'today' || token === 'tomorrow';

function parseCommand(argv) {
  const [first, second] = argv;
  if (!argv.length || ['help', '--help', '-h'].includes(first)) return { action: 'help' };
  if (argv.length === 1 && ['--version', '-v'].includes(first)) return { action: 'version' };
  if (argv.length === 1 && first === 'setup') return { action: 'setup' };
  if ((first === 'list' || first === 'debug') && (argv.length === 1 || (argv.length === 2 && isDay(second)))) {
    return { action: first, dateToken: second || 'today' };
  }
  if (isDay(first) && argv.length > 1) return { action: 'book', dateToken: first, requests: parseRanges(argv.slice(1)) };
  if (first === 'cancel' && isDay(second) && argv.length > 2) {
    return { action: 'cancel', dateToken: second, requests: parseRanges(argv.slice(2)) };
  }
  failUsage('Unsupported command.');
}

// Machine names are only checked for shape here. They are matched against the room's table after it loads.
function parseRanges(tokens) {
  const requests = [];
  for (const token of tokens) {
    const separator = token.indexOf(':');
    if (separator === -1 || separator !== token.lastIndexOf(':')) failUsage(`Invalid range "${token}". Use washer1:18h30-19h30.`);

    const machine = token.slice(0, separator).toLowerCase();
    if (!/^[a-z]+\d*$/.test(machine)) failUsage(`Invalid machine in "${token}". Use a name like washer1, washers or dryer.`);
    const parts = token.slice(separator + 1).split('-');
    if (parts.length !== 2) failUsage(`Invalid range "${token}". Use washer1:18h30-19h30.`);

    const start = parseUserTime(parts[0], token);
    const end = parseUserTime(parts[1], token);
    if (end <= start || (end - start) % 30 !== 0) failUsage(`Invalid range "${token}". End must be after start in 30-minute steps.`);

    for (let time = start; time < end; time += 30) requests.push({ machine, time: formatTime(time) });
  }
  return requests;
}

function parseUserTime(value, context) {
  const match = /^(\d{1,2})h(\d{2})$/.exec(String(value || ''));
  if (!match) failUsage(`Invalid time in "${context}". Use 18h30 syntax.`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || ![0, 30].includes(minute)) {
    failUsage(`Invalid time in "${context}". LOAS slots are 30-minute slots only.`);
  }
  return hour * 60 + minute;
}

function formatTime(totalMinutes) {
  if (totalMinutes < 0 || totalMinutes >= 24 * 60) failUsage('Booking range crosses outside the selected day.');
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function helsinkiDate(dateToken) {
  // The sv-SE locale formats dates as YYYY-MM-DD.
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Helsinki' });
  if (dateToken !== 'tomorrow') return today;
  // Add the day on the calendar date, not as 24 hours, so DST changes cannot skip or repeat a day.
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function roomsUrlForDate(roomsUrl, date) {
  const url = new URL(roomsUrl);
  url.searchParams.set('selected_date', date);
  return url.toString();
}

function inferHousingComplexId(roomsUrl) {
  const parts = new URL(roomsUrl).pathname.split('/');
  const index = parts.indexOf('complexes');
  if (index === -1 || !parts[index + 1]) throw new Error('Could not infer housing complex id from LOAS_ROOMS_URL.');
  return parts[index + 1];
}

function loadCookieJar(file) {
  try {
    if (fs.existsSync(file)) return CookieJar.fromJSON(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (_) {}
  return new CookieJar();
}

function saveCookieJar(jar, file) {
  writePrivateFile(file, JSON.stringify(jar.toJSON(), null, 2));
}

class Session {
  constructor(cookieFile) {
    this.cookieFile = path.resolve(cookieFile);
    this.jar = loadCookieJar(this.cookieFile);
    this.fetch = fetchCookie(fetch, this.jar);
  }

  async request(url, options = {}) {
    let response;
    try {
      response = await this.fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'LOAS laundry helper',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...options.headers,
        },
      });
    } catch (error) {
      throw new Error(`Could not reach LOAS (${error.cause?.code || error.message}). Check your internet connection.`);
    }
    saveCookieJar(this.jar, this.cookieFile);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || url,
      text: await response.text(),
    };
  }

  get(url) {
    return this.request(url);
  }

  postForm(url, fields, headers = {}) {
    return this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  }
}

function csrfToken($) {
  const token = $('meta[name="csrf-token"]').attr('content') || $('input[name="authenticity_token"]').first().attr('value');
  if (!token) throw new Error('Could not find LOAS CSRF token.');
  return token;
}

function isLoginPage($, url = '') {
  return String(url).includes('/customers/sign_in') || $('input[type="password"], input[name="customer[password]"]').length > 0;
}

function loginAction($, currentUrl) {
  const action = $('form[action*="/customers/sign_in"], form:has(input[type="password"])').first().attr('action');
  return new URL(action || '/customers/sign_in', currentUrl).toString();
}

function selectedRoomsPage(currentUrl, roomsUrl) {
  const current = new URL(currentUrl);
  const wanted = new URL(roomsUrl);
  return current.pathname === wanted.pathname && current.searchParams.get('selected_date') === wanted.searchParams.get('selected_date');
}

async function ensureLoggedIn(session, roomsUrl, email, password) {
  let page = await session.get(roomsUrl);
  let $ = cheerio.load(page.text);
  if (!isLoginPage($, page.url)) return page;
  if (!email || !password) throw new Error('Email and password are missing. Run: laundry setup');

  const action = loginAction($, page.url);
  page = await session.postForm(action, {
    authenticity_token: csrfToken($),
    'customer[email]': email,
    'customer[password]': password,
    'customer[remember_me]': '1',
  }, {
    Origin: new URL(action).origin,
    Referer: page.url,
  });

  if (!selectedRoomsPage(page.url, roomsUrl)) page = await session.get(roomsUrl);
  $ = cheerio.load(page.text);
  if (isLoginPage($, page.url)) throw new Error('Still on login page after login. Check your email and password with: laundry setup');
  return page;
}

function text($, element) {
  return $(element).text().replace(/Pyykkitupa/gi, '').replace(/\s+/g, ' ').trim();
}

function inputValue($form, name) {
  return $form.find(`input[name="${name}"]`).first().attr('value') || '';
}

function formDetails($, form, pageUrl) {
  const $form = $(form);
  const fields = {};
  $form.find('input[name]').each((_, input) => { fields[$(input).attr('name')] = $(input).attr('value') || ''; });
  return {
    action: new URL($form.attr('action') || '', pageUrl).toString(),
    fields,
    remote: $form.attr('data-remote') === 'true',
  };
}

// A free slot has a "Book" form. Your own booking has a "Cancel" form, which Rails marks with _method=delete.
function slotForms($, cell, pageUrl) {
  const forms = { book: null, cancel: null };
  $(cell).find('form').each((_, form) => {
    const $form = $(form);
    if (!($form.attr('action') || '').includes('/time_slot_reservations')) return;
    const cancel = inputValue($form, '_method').toLowerCase() === 'delete' || text($, form).toLowerCase().includes('cancel');
    const kind = cancel ? 'cancel' : 'book';
    if (!forms[kind]) forms[kind] = formDetails($, form, pageUrl);
  });
  return forms;
}

function extractTable(html, pageUrl) {
  const $ = cheerio.load(html);
  const $table = $('table.booking-table').first();
  if (!$table.length) return { headers: [], rows: [] };

  const headers = [];
  $table.find('thead tr').last().find('th, td').each((_, cell) => headers.push(text($, cell)));

  const rows = [];
  $table.find('tbody tr').each((_, row) => {
    const cells = [];
    $(row).children('th, td').each((__, cell) => cells.push({ text: text($, cell), ...slotForms($, cell, pageUrl) }));
    if (cells.some((cell) => cell.text || cell.book || cell.cancel)) rows.push({ cells });
  });
  return { headers, rows };
}

// Prints only the booking table, with CSRF tokens removed, so it is safe to share for debugging.
function debugTable(html) {
  const $ = cheerio.load(html);
  const $table = $('table.booking-table').first();
  if (!$table.length) return 'No booking table found.';
  $table.find('input[name="authenticity_token"]').attr('value', 'REDACTED');
  return $.html($table);
}

// Normalizes "8:00" to "08:00" so rows can be matched against requested times.
function tableTime(value = '') {
  const match = /^(\d{1,2}):(00|30)$/.exec(value);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

function rowsByTime(table) {
  const rows = new Map();
  for (const row of table.rows) {
    const time = tableTime(row.cells[0]?.text);
    if (time) rows.set(time, row);
  }
  return rows;
}

const MACHINE_KINDS = [
  ['washer', /wash|pesu|tvätt/i],
  ['dryer', /dry|kuiva|tork/i],
];

// Names each machine column by its kind and number, e.g. "Washing machine 2" becomes washer2.
function discoverMachines(headers) {
  const machines = headers.slice(1).map((label, index) => ({
    label,
    column: index + 1,
    kind: (MACHINE_KINDS.find(([, pattern]) => pattern.test(label)) || ['machine'])[0],
    number: Number(/(\d+)\s*$/.exec(label)?.[1]) || 0,
  }));

  // Numbered headers keep their number first. Unnumbered or repeated ones then take the next free number.
  const used = new Set();
  for (const machine of machines) {
    const id = `${machine.kind}${machine.number}`;
    if (machine.number && !used.has(id)) {
      machine.id = id;
      used.add(id);
    }
  }
  for (const machine of machines.filter((m) => !m.id)) {
    let number = 1;
    while (used.has(`${machine.kind}${number}`)) number += 1;
    machine.id = `${machine.kind}${number}`;
    used.add(machine.id);
  }
  return machines.map(({ id, kind, label, column }) => ({ id, kind, label, column }));
}

const MACHINE_GROUPS = { washers: 'washer', both: 'washer', dryers: 'dryer' };

function expandMachine(name, machines) {
  const exact = machines.find((machine) => machine.id === name);
  if (exact) return [exact];

  const ids = machines.map((machine) => machine.id).join(', ') || 'no machines';
  const kind = MACHINE_GROUPS[name] || (name === 'washer' || name === 'dryer' ? name : '');
  if (!kind) throw new Error(`Unknown machine "${name}". This room has: ${ids}.`);

  const matches = machines.filter((machine) => machine.kind === kind);
  if (!matches.length) throw new Error(`This room has no ${kind}. It has: ${ids}.`);
  if (MACHINE_GROUPS[name] || matches.length === 1) return matches;
  throw new Error(`This room has ${matches.length} ${kind}s: ${matches.map((machine) => machine.id).join(', ')}. Pick one, or use ${kind}s for all of them.`);
}

function color(text, code) {
  if (process.env.NO_COLOR || (!process.stdout.isTTY && !process.env.FORCE_COLOR)) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function visibleLength(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padVisible(text, width) {
  const value = String(text || '');
  return value + ' '.repeat(Math.max(0, width - visibleLength(value)));
}

function cellLabel(cell) {
  if (cell?.book) return color('Book', '96');
  if (cell?.cancel) return color('Yours', '1;32');
  const value = cell?.text || '';
  const lower = value.toLowerCase();
  if (lower.includes('your reservation')) return color('Yours', '1;32');
  if (lower.includes('booked')) return color('Booked', '90');
  if (lower.includes('past')) return color('Past', '90');
  return value || '-';
}

function printAvailability(table, date) {
  console.log(`Date: ${date}`);
  if (!table.headers.length || !table.rows.length) return console.log('No booking table found.');

  const machines = discoverMachines(table.headers);
  const headers = ['Time', ...machines.map((machine) => machine.label)];
  const ids = ['', ...machines.map((machine) => machine.id)];
  const rows = table.rows.map((row) => {
    const time = tableTime(row.cells[0]?.text);
    return time ? [time, ...machines.map((machine) => cellLabel(row.cells[machine.column]))] : null;
  }).filter(Boolean);
  const widths = headers.map((header, index) => Math.max(visibleLength(header), visibleLength(ids[index]), ...rows.map((row) => visibleLength(row[index] || ''))));
  const border = (left, middle, right) => left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right;
  const line = (row) => '│ ' + row.map((cell, index) => padVisible(cell, widths[index])).join(' │ ') + ' │';

  console.log(border('┌', '┬', '┐'));
  console.log(line(headers));
  console.log(line(ids.map((id) => (id ? color(id, '1') : id))));
  console.log(border('├', '┼', '┤'));
  for (const row of rows) console.log(line(row));
  console.log(border('└', '┴', '┘'));
}

// Matches requests to table cells. Booking needs free cells, cancelling needs the user's own.
function resolveSlots(table, requests, mode) {
  const machines = discoverMachines(table.headers);
  const rows = rowsByTime(table);
  const slots = new Map();

  for (const request of requests) {
    const matched = expandMachine(request.machine, machines);
    const row = rows.get(request.time);
    if (!row) throw new Error(`Could not find ${request.time} in the LOAS table.`);

    for (const machine of matched) {
      const slot = { machine: machine.id, column: machine.column, time: request.time };
      const label = slotLabel(slot);
      if (slots.has(label)) continue;
      const cell = row.cells[machine.column];
      if (mode === 'cancel' && !cell?.cancel) throw new Error(`${label} is not your booking.`);
      if (mode === 'book' && !cell?.book) throw new Error(`${label} ${cell?.cancel ? 'is already yours' : 'is not bookable'}.`);
      slots.set(label, { ...slot, form: mode === 'cancel' ? cell.cancel : cell.book });
    }
  }
  return [...slots.values()];
}

function slotLabel(slot) {
  return `${slot.machine} at ${slot.time}`;
}

// Returns the slots that are the user's bookings in this table, each with its current cancel form.
function yoursNow(table, slots) {
  const rows = rowsByTime(table);
  return slots.flatMap((slot) => {
    const cancel = rows.get(slot.time)?.cells[slot.column]?.cancel;
    return cancel ? [{ ...slot, form: cancel }] : [];
  });
}

async function loadTable(session, roomsUrl) {
  const page = await session.get(roomsUrl);
  const table = extractTable(page.text, page.url);
  if (!table.headers.length) throw new Error('Could not reload the LOAS table to check the result. Run: laundry list');
  return { page, table };
}

// Submits each slot's own form like the browser does. Stops at the first failure and returns it
// instead of throwing, so the caller can reload the table and see what actually happened.
async function postSlots(session, slots, page) {
  const token = csrfToken(cheerio.load(page.text));
  for (const slot of slots) {
    const { action, fields, remote } = slot.form;
    const headers = { Origin: new URL(action).origin, Referer: page.url };
    if (remote) {
      Object.assign(headers, {
        Accept: '*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript',
        'X-CSRF-Token': token,
        'X-Requested-With': 'XMLHttpRequest',
      });
    }
    try {
      const response = await session.postForm(action, { ...fields, authenticity_token: token }, headers);
      if (!response.ok) return { slot, error: `HTTP ${response.status} ${response.statusText}` };
    } catch (error) {
      return { slot, error: error.message || String(error) };
    }
  }
  return null;
}

// Books every slot or none: if any slot fails, the ones this run booked are cancelled again.
async function bookAll(session, roomsUrl, page, slots) {
  const failure = await postSlots(session, slots, page);
  let after = await loadTable(session, roomsUrl);
  const booked = yoursNow(after.table, slots);
  if (!failure && booked.length === slots.length) return;

  const missing = slots.filter((slot) => !booked.some((done) => done.column === slot.column && done.time === slot.time));
  const reason = failure
    ? `${slotLabel(failure.slot)} could not be booked (${failure.error})`
    : `${missing.map(slotLabel).join(', ')} did not get booked`;
  if (!booked.length) throw new Error(`${reason}. Nothing was booked.`);

  await postSlots(session, booked, after.page);
  after = await loadTable(session, roomsUrl);
  const stuck = yoursNow(after.table, booked);
  if (stuck.length) throw new Error(`${reason}. Undoing failed, these are still booked: ${stuck.map(slotLabel).join(', ')}.`);
  throw new Error(`${reason}. Undid ${booked.length} slots, nothing is booked.`);
}

async function cancelAll(session, roomsUrl, page, slots) {
  const failure = await postSlots(session, slots, page);
  const { table } = await loadTable(session, roomsUrl);
  const left = yoursNow(table, slots);
  if (!left.length) return;
  const reason = failure ? `${slotLabel(failure.slot)} could not be cancelled (${failure.error}). ` : '';
  throw new Error(`${reason}Still booked: ${left.map(slotLabel).join(', ')}.`);
}

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.action === 'help') return console.log(USAGE);
  if (command.action === 'version') return console.log(require('../package.json').version);
  if (command.action === 'setup') return setup();
  const roomsUrl = config('LOAS_ROOMS_URL');
  if (!roomsUrl) throw new Error('Not set up yet. Run: laundry setup');

  const date = helsinkiDate(command.dateToken);
  const selectedRoomsUrl = roomsUrlForDate(roomsUrl, date);
  const session = new Session(config('LOAS_SESSION_FILE', DEFAULT_SESSION_FILE));
  const page = await ensureLoggedIn(session, selectedRoomsUrl, config('LOAS_EMAIL'), config('LOAS_PASSWORD'));
  if (command.action === 'debug') return console.log(debugTable(page.text));
  const table = extractTable(page.text, page.url);

  if (command.action === 'list') return printAvailability(table, date);

  const slots = resolveSlots(table, command.requests, command.action);
  if (command.action === 'cancel') {
    await cancelAll(session, selectedRoomsUrl, page, slots);
    return console.log(`Cancelled ${slots.length} reservations.`);
  }
  await bookAll(session, selectedRoomsUrl, page, slots);
  console.log(`Booked ${slots.length} reservations.`);
}

module.exports = {
  parseCommand, extractTable, debugTable, discoverMachines, expandMachine, resolveSlots, bookAll, cancelAll, writePrivateFile,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Error: ${error.message || error}`);
    if (error instanceof UsageError) console.error(USAGE);
    process.exit(1);
  });
}
