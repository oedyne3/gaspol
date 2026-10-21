# GASPOL v10.0.0

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bot API](https://img.shields.io/badge/Bot%20API-10.3-blue)](https://core.telegram.org/bots/api)
[![GAS](https://img.shields.io/badge/Google%20Apps%20Script-V8-4285F4)](https://script.google.com)

Complete Telegram Bot Framework for Google Apps Script (V8). 185 Bot API methods, 27 update types, auto session, anti double webhook.

## Installation

**Library ID:** `1TTRstkb24b80hwMoPDFRHUFs8TfA544f6XJjTsk54abb5svaCA7zQ0t-`

1. In your Apps Script project: Left sidebar -> **Libraries -> Add a library**
2. Paste the ID above
3. Select Version: `10.0.0`, Identifier: `gaspol` -> Add

## Quick Start

const bot = new gaspol.init(BOT_TOKEN);

bot.start(ctx => ctx.reply('GASPOL v10.0.0 running!'));

bot.cmd('echo', ctx => ctx.reply(ctx.payload || 'Usage: /echo text'));

bot.hears('hello', ctx => ctx.reply(`Hello ${ctx.from.first_name}!`));

function doPost(e){ return bot.doPost(e); }
