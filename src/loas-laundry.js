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
  laundry list
  laundry list tomorrow
  laundry today both:18h30-19h30 dryer:19h30-20h30
  laundry tomorrow both:18h30-19h30 dryer:19h30-20h30`;

function failUsage(message) {
  throw new UsageError(message);
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

  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ LOAS_ROOMS_URL: roomsUrl, LOAS_EMAIL: email, LOAS_PASSWORD: password }, null, 2), { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
  // Credentials may have changed, so log in fresh next time.
  fs.rmSync(DEFAULT_SESSION_FILE, { force: true });
  console.log(`Saved to ${CONFIG_FILE}. Try: laundry list`);
}

function parseCommand(argv) {
  if (argv.length === 1 && argv[0] === 'setup') return { action: 'setup' };
  if (argv.length === 1 && argv[0] === 'list') return { action: 'list', dateToken: 'today' };
  if (argv.length === 2 && argv[0] === 'list' && argv[1] === 'tomorrow') return { action: 'list', dateToken: 'tomorrow' };
  if ((argv[0] === 'today' || argv[0] === 'tomorrow') && argv.length > 1) {
    return { action: 'book', dateToken: argv[0], requests: parseRanges(argv.slice(1)) };
  }
  failUsage('Unsupported command.');
}

function parseRanges(tokens) {
  const requests = [];
  for (const token of tokens) {
    const separator = token.indexOf(':');
    if (separator === -1 || separator !== token.lastIndexOf(':')) failUsage(`Invalid range "${token}". Use both:18h30-19h30.`);

    const machines = expandMachine(token.slice(0, separator));
    const parts = token.slice(separator + 1).split('-');
    if (parts.length !== 2) failUsage(`Invalid range "${token}". Use both:18h30-19h30.`);

    const start = parseUserTime(parts[0], token);
    const end = parseUserTime(parts[1], token);
    if (end <= start || (end - start) % 30 !== 0) failUsage(`Invalid range "${token}". End must be after start in 30-minute steps.`);

    for (const machine of machines) {
      for (let time = start; time < end; time += 30) requests.push({ machine, time: formatTime(time) });
    }
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

function expandMachine(machine) {
  if (machine === 'both') return ['washing1', 'washing2'];
  if (machine === 'dryer') return ['dryer'];
  failUsage(`Unsupported machine "${machine}". Use both or dryer.`);
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(jar.toJSON(), null, 2), 'utf8');
}

class Session {
  constructor(cookieFile) {
    this.cookieFile = path.resolve(cookieFile);
    this.jar = loadCookieJar(this.cookieFile);
    this.fetch = fetchCookie(fetch, this.jar);
  }

  async request(url, options = {}) {
    const response = await this.fetch(url, {
      ...options,
      headers: {
        'User-Agent': 'LOAS laundry helper',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...options.headers,
      },
    });
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

function reservationForm($, form) {
  const $form = $(form);
  const action = $form.attr('action') || '';
  return action.includes('time_slot_products/') && action.includes('/time_slot_reservations')
    && inputValue($form, '_method').toLowerCase() !== 'delete'
    && !text($, form).toLowerCase().includes('cancel');
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
    $(row).children('th, td').each((__, cell) => {
      const $form = $(cell).find('form').filter((___, form) => reservationForm($, form)).first();
      const action = $form.attr('action') || '';
      cells.push({
        text: text($, cell),
        form: $form.length ? {
          action: new URL(action, pageUrl).toString(),
          date: inputValue($form, 'date'),
          housingComplexId: inputValue($form, 'housing_complex_id'),
          index: inputValue($form, 'index'),
        } : null,
      });
    });
    if (cells.some((cell) => cell.text || cell.form)) rows.push({ cells });
  });
  return { headers, rows };
}

// Normalizes "8:00" to "08:00" so rows can be matched against requested times.
function tableTime(value = '') {
  const match = /^(\d{1,2}):(00|30)$/.exec(value);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

const MACHINE_HEADERS = {
  'washing machine 1': 'washing1',
  'washing machine 2': 'washing2',
  'dryer 1': 'dryer',
};

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
  if (cell?.form) return color('Book', '96');
  const value = cell?.text || '';
  const lower = value.toLowerCase();
  if (lower.includes('your reservation') || lower.includes('cancel')) return color('Yours', '1;32');
  if (lower.includes('booked')) return color('Booked', '90');
  if (lower.includes('past')) return color('Past', '90');
  return value || '-';
}

function printAvailability(table, date) {
  console.log(`Date: ${date}`);
  if (!table.headers.length || !table.rows.length) return console.log('No booking table found.');

  const headers = ['Time', ...table.headers.slice(1)];
  const rows = table.rows.map((row) => {
    const time = tableTime(row.cells[0]?.text);
    return time ? headers.map((_, index) => (index === 0 ? time : cellLabel(row.cells[index]))) : null;
  }).filter(Boolean);
  const widths = headers.map((header, index) => Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] || ''))));
  const border = (left, middle, right) => left + widths.map((width) => '─'.repeat(width + 2)).join(middle) + right;
  const line = (row) => '│ ' + row.map((cell, index) => padVisible(cell, widths[index])).join(' │ ') + ' │';

  console.log(border('┌', '┬', '┐'));
  console.log(line(headers));
  console.log(border('├', '┼', '┤'));
  for (const row of rows) console.log(line(row));
  console.log(border('└', '┴', '┘'));
}

function resolveSlots(table, requests) {
  const columns = new Map();
  const rows = new Map();
  table.headers.forEach((header, index) => {
    const machine = index === 0 ? '' : MACHINE_HEADERS[header.toLowerCase()];
    if (machine && !columns.has(machine)) columns.set(machine, index);
  });
  table.rows.forEach((row) => {
    const time = tableTime(row.cells[0]?.text);
    if (time) rows.set(time, row);
  });

  return requests.map((request) => {
    const column = columns.get(request.machine);
    if (column === undefined) throw new Error(`Could not find ${request.machine} in the LOAS table.`);

    const row = rows.get(request.time);
    if (!row) throw new Error(`Could not find ${request.time} in the LOAS table.`);

    const cell = row.cells[column];
    if (!cell?.form) throw new Error(`${request.machine} at ${request.time} is not bookable.`);
    if (!cell.form.index) throw new Error(`${request.machine} at ${request.time} is missing a reservation index.`);
    return { machine: request.machine, time: request.time, ...cell.form };
  });
}

async function bookSlots(session, slots, pageHtml, defaults) {
  const token = csrfToken(cheerio.load(pageHtml));
  for (const slot of slots) {
    const response = await session.postForm(slot.action, {
      authenticity_token: token,
      date: slot.date || defaults.date,
      housing_complex_id: slot.housingComplexId || defaults.housingComplexId,
      index: slot.index,
    }, {
      Accept: '*/*;q=0.5, text/javascript, application/javascript, application/ecmascript, application/x-ecmascript',
      'X-CSRF-Token': token,
      'X-Requested-With': 'XMLHttpRequest',
      Origin: new URL(slot.action).origin,
      Referer: defaults.referer,
    });
    if (!response.ok) throw new Error(`Booking failed with HTTP ${response.status} ${response.statusText}`);
  }
}

async function main() {
  const command = parseCommand(process.argv.slice(2));
  if (command.action === 'setup') return setup();
  const roomsUrl = config('LOAS_ROOMS_URL');
  if (!roomsUrl) throw new Error('Not set up yet. Run: laundry setup');

  const date = helsinkiDate(command.dateToken);
  const selectedRoomsUrl = roomsUrlForDate(roomsUrl, date);
  const session = new Session(config('LOAS_SESSION_FILE', DEFAULT_SESSION_FILE));
  const page = await ensureLoggedIn(session, selectedRoomsUrl, config('LOAS_EMAIL'), config('LOAS_PASSWORD'));
  const table = extractTable(page.text, page.url);

  if (command.action === 'list') return printAvailability(table, date);

  const slots = resolveSlots(table, command.requests);
  await bookSlots(session, slots, page.text, {
    date,
    housingComplexId: inferHousingComplexId(roomsUrl),
    referer: page.url,
  });
  console.log(`Booked ${slots.length} reservations.`);
}

main().catch((error) => {
  console.error(`Error: ${error.message || error}`);
  if (error instanceof UsageError) console.error(USAGE);
  process.exit(1);
});
