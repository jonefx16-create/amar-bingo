'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const mobile = fs.readFileSync(path.join(root, 'public', 'mobile-ops.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.ok(admin.indexOf('Winners History (All Time)') !== -1, 'winner history nav is on the main panel');
assert.ok(admin.indexOf('id="tab-history"') !== -1);
assert.ok(admin.indexOf('id="game-history-body"') !== -1);
assert.ok(admin.indexOf('Bot Database & Settings') === -1, 'bot database nav stays off the main panel');
assert.ok(admin.indexOf('id="tab-bots-db"') === -1);
assert.ok(admin.indexOf('id="tab-schedules"') === -1, 'schedules leave the main panel');
assert.ok(admin.indexOf('id="seven-slot-rows"') === -1);
assert.ok(admin.indexOf('id="scheduled-posts-body"') === -1);
assert.ok(admin.indexOf('Financial History') !== -1);
assert.ok(admin.indexOf('id="game-details-select"') !== -1, 'players tab still has its game picker');
assert.ok(admin.indexOf("tabId === 'tab-players'") !== -1);
assert.ok(admin.indexOf('localStorage.getItem(\'bingo_admin_pass\')') !== -1);
assert.ok(admin.indexOf('/api/admin/bot-master-update-v2') !== -1);

assert.ok(server.indexOf("app.get('/amarbingo/papi2204'") !== -1);
assert.ok(server.indexOf('public\', \'mobile-ops.html') !== -1);
assert.ok(server.indexOf("app.get('/Babi2204'") !== -1);
assert.ok(server.indexOf("app.get('/papi2204'") !== -1);

assert.ok(mobile.indexOf('id="bot-master-toggle"') !== -1);
assert.ok(mobile.indexOf('id="search-history"') !== -1);
assert.ok(mobile.indexOf('id="game-history-body"') !== -1);
assert.ok(mobile.indexOf('id="bots-body"') !== -1);
assert.ok(mobile.indexOf('bingo_admin_pass') !== -1);
assert.ok(mobile.indexOf('/api/admin/bots-list') !== -1);
assert.ok(mobile.indexOf('/api/admin/history') !== -1);
assert.ok(mobile.indexOf('/api/admin/bot-master-update-v2') !== -1);
assert.ok(mobile.indexOf('/api/admin/history-detail') !== -1);
assert.ok(mobile.indexOf('/api/admin/inject-live-bots') !== -1);
assert.ok(mobile.indexOf('id="tab-schedules"') !== -1);
assert.ok(mobile.indexOf('id="seven-slot-rows"') !== -1);
assert.ok(mobile.indexOf('id="sched-post-text"') !== -1);
assert.ok(mobile.indexOf('id="bot-ramp-minutes"') !== -1);
assert.ok(mobile.indexOf("slots['botSchedule' + i]") !== -1, 'saving from this page keeps the 7 schedule slots');
assert.ok(mobile.indexOf('viewport') !== -1);
assert.ok(mobile.indexOf('class="sidebar"') !== -1);
assert.ok(mobile.indexOf('id="tab-bots-db"') !== -1);
assert.ok(mobile.indexOf('id="tab-history"') !== -1);
assert.ok(mobile.indexOf('Master Bot Controls') !== -1);
assert.ok(mobile.indexOf('Winners History Action') !== -1);
const schedBtn = mobile.indexOf('🗓️ Schedules');
const botBtn = mobile.indexOf('Bot Database & Settings');
const histBtn = mobile.indexOf('Winners History (All Time)');
assert.ok(schedBtn !== -1 && schedBtn < botBtn, 'schedules sit above bot database, as on the original panel');
assert.ok(botBtn !== -1 && histBtn !== -1 && botBtn < histBtn, 'winner history sits under the bot database button');

const historyHtml = mobile.slice(mobile.indexOf('<!-- HISTORY -->'), mobile.indexOf('id="edit-bot-modal"'));
assert.ok(historyHtml.indexOf('id="btn-hist-user"') === -1, 'phone winner history has no User filter button');
assert.ok(mobile.indexOf("winners: 'user'") === -1);
assert.ok(mobile.indexOf('🤖 Bot (${p})') !== -1, 'phone winner history still labels bot phones');
const adminHistFn = admin.slice(admin.indexOf('async function loadHistoryPage'), admin.indexOf('async function loadTxPage'));
assert.ok(adminHistFn.indexOf('🤖 Bot') === -1, 'main winner history does not label a phone as Bot');
assert.ok(adminHistFn.indexOf('fetchAndShowUserInfo') !== -1, 'main winner phones use the same link as users');

const routeAt = server.indexOf("app.get('/amarbingo/papi2204'");
const catchAll = server.indexOf("app.get('*'");
assert.ok(routeAt !== -1 && catchAll !== -1 && routeAt < catchAll);

console.log('mobile ops panel structure ok');
