#!/usr/bin/env node
'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { CookieJar } = require('tough-cookie');
const fetchCookieModule = require('fetch-cookie');
const fetchCookie = fetchCookieModule.default || fetchCookieModule;

const DEFAULT_SESSION_FILE = '.auth/loas-session.json';

class UsageError extends Error {}

function usage() {
  for (const line of [
    'Usage:',
    '  laundry list',
    '  laundry list tomorrow',
    '  laundry today both:18h30-19h30 dryer:19h30-20h30',
    '  laundry tomorrow both:18h30-19h30 dryer:19h30-20h30',
  ]) console.error(line);
}

function die(message, showUsage = false) {
  console.error(`Error: ${message}`);
  if (showUsage) usage();
  process.exit(1);
}

function failUsage(message) {
  throw new UsageError(message);
}

function config(name, fallback = '') {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function parseCommand(argv) {
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
  const offsetDays = dateToken === 'tomorrow' ? 1 : 0;
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Helsinki',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
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
  constructor(baseUrl, cookieFile) {
    if (typeof globalThis.fetch !== 'function') throw new Error('Node.js 18.17+ is required.');

    this.baseUrl = baseUrl;
    this.cookieFile = path.resolve(cookieFile);
    this.jar = loadCookieJar(this.cookieFile);
    this.fetch = fetchCookie(globalThis.fetch, this.jar);
  }

  async request(url, options = {}) {
    const response = await this.fetch(new URL(url, this.baseUrl).toString(), {
      ...options,
      headers: {
        'User-Agent': 'LOAS laundry helper',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(options.headers || {}),
      },
    });
    saveCookieJar(this.jar, this.cookieFile);
    return response;
  }

  async text(url, options = {}) {
    const response = await this.request(url, options);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || new URL(url, this.baseUrl).toString(),
      text: await response.text(),
    };
  }

  get(url) {
    return this.text(url);
  }

  postForm(url, fields, headers = {}) {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null) params.set(name, String(value));
    }
    return this.text(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...headers },
      body: params.toString(),
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
  let action = '';
  $('form').each((_, form) => {
    if (action) return;
    const $form = $(form);
    const candidate = $form.attr('action') || '';
    if (candidate.includes('/customers/sign_in') || $form.find('input[type="password"]').length) action = candidate;
  });
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
  if (!email || !password) throw new Error('LOAS_EMAIL and LOAS_PASSWORD are required when the saved session expires.');

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
  if (isLoginPage($, page.url)) throw new Error('Still on login page after login. Check credentials.');
  return page;
}

function text($, element) {
  return $(element).text().replace(/Pyykkitupa/gi, '').replace(/\s+/g, ' ').trim();
}

function inputValue($form, name) {
  return $form.find(`input[name="${name}"]`).first().attr('value') || '';
}

function reservationAction(action) {
  return String(action || '').includes('time_slot_products/') && String(action || '').includes('/time_slot_reservations');
}

function reservationForm($, form) {
  const $form = $(form);
  const method = String(inputValue($form, '_method')).toLowerCase();
  return reservationAction($form.attr('action')) && method !== 'delete' && !text($, form).toLowerCase().includes('cancel');
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

function tableTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && [0, 30].includes(minute) ? formatTime(hour * 60 + minute) : '';
}

function machineFromHeader(header) {
  const value = String(header || '').replace(/Pyykkitupa/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (value === 'washing machine 1') return 'washing1';
  if (value === 'washing machine 2') return 'washing2';
  if (value === 'dryer 1') return 'dryer';
  return '';
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
    const machine = index === 0 ? '' : machineFromHeader(header);
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
  const roomsUrl = config('LOAS_ROOMS_URL');
  if (!roomsUrl) throw new Error('LOAS_ROOMS_URL is required. Set it in .env.');

  const baseUrl = new URL(roomsUrl).origin;
  const date = helsinkiDate(command.dateToken);
  const selectedRoomsUrl = roomsUrlForDate(roomsUrl, date);
  const session = new Session(baseUrl, config('LOAS_SESSION_FILE', DEFAULT_SESSION_FILE));
  const page = await ensureLoggedIn(session, selectedRoomsUrl, config('LOAS_EMAIL'), config('LOAS_PASSWORD'));
  const table = extractTable(page.text, page.url || selectedRoomsUrl);

  if (command.action === 'list') return printAvailability(table, date);

  const slots = resolveSlots(table, command.requests);
  await bookSlots(session, slots, page.text, {
    date,
    housingComplexId: inferHousingComplexId(roomsUrl),
    referer: page.url || selectedRoomsUrl,
  });
  console.log(`Booked ${slots.length} reservations.`);
}

main().catch((error) => die(error.message || String(error), error instanceof UsageError));
