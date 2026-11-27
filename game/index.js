'use strict';

const eligibility = require('./eligibility');
const cardGeneration = require('./cardGeneration');
const roundPacing = require('./roundPacing');
const winValidation = require('./winValidation');
const commission = require('./commission');
const roundRegistry = require('./roundRegistry');
const eatTime = require('./eatTime');
const ticketLock = require('./ticketLock');
const depositBonus = require('./depositBonus');
const botTraffic = require('./botTraffic');
const gameHistoryQuery = require('./gameHistoryQuery');
const weeklyLeaderboard = require('./weeklyLeaderboard');
const cardShuffle = require('./cardShuffle');
const cardBoard = require('./cardBoard');
const roundCards = require('./roundCards');
const scheduledPosts = require('./scheduledPosts');
const depositReceipt = require('./depositReceipt');
const referralCap = require('./referralCap');
const roundIds = require('./roundIds');
const botController = require('./botController');
const vaultTransfer = require('./vaultTransfer');

module.exports = Object.assign({}, eligibility, cardGeneration, roundPacing, winValidation, commission, roundRegistry, eatTime, ticketLock, depositBonus, botTraffic, gameHistoryQuery, weeklyLeaderboard, cardShuffle, cardBoard, roundCards, scheduledPosts, depositReceipt, referralCap, roundIds, botController, vaultTransfer);
