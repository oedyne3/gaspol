/**
 * GASPOL v10.0.0 - Framework bot Telegram lengkap untuk Google Apps Script (runtime V8)
 *
 * MIT License - Copyright (c) 2026 Oedyne Gwibroed
 * Tidak berafiliasi dengan Telegram. Teks lengkap lisensi: lihat file LICENSE.
 *
 * CAKUPAN
 *  - SEMUA method Bot API (daftar dari spesifikasi Bot API 10.3, 185 method):
 *      api.sendMessage(...)  atau  api.call('namaMethod', {...})
 *  - SEMUA jenis update (27 jenis): bot.on('inline_query' | 'edited_message' |
 *      'my_chat_member' | 'chat_join_request' | 'pre_checkout_query' | 'message_reaction' | ...)
 *  - Isi pesan: bot.on('photo' | 'document' | 'new_chat_members' | 'successful_payment' | ...)
 *
 * FITUR RAMAH PENGGUNA
 *  - bot.start / help / cmd / hears / action / on / state (form bertahap) / use (middleware)
 *  - ctx.reply, replyTo, replyWithPhoto/Video/..., send (method apa pun), react, forward, copy
 *  - ctx.download() unduh file kiriman pengguna, api.downloadFile(fileId)
 *  - Session otomatis, anti balasan dobel di webhook, retry otomatis, kirim teks panjang
 *  - bot.poll() untuk mode polling (tanpa webhook), bot.broadcast(), bot.setCommands()
 *  - Middleware siap pakai: usePrivateOnly, useGroupOnly, useAllowed, useRateLimit
 *  - Debug opsional: gaspol.DEBUG = true; gaspol.verbose = true;
 */

var GASPOL_VERSION = { active: '10.0.0', full: 'GASPOL v10.0.1 (Bot API 10.3) MIT' };

// Variabel yang disediakan library (bisa dibaca/diatur: gaspol.DEBUG, gaspol.verbose, gaspol.version)
var DEBUG = false;    // true -> catat update masuk & panggilan API
var verbose = false;  // true -> log debug berisi data lengkap (tanpa dipotong)
var version = GASPOL_VERSION.active;

// Semua jenis update (isi untuk allowed_updates): bot.setWebhook(url, {allowed_updates: gaspol.GASPOL_UPDATES})
var GASPOL_UPDATES = [
  'message', 'edited_message', 'channel_post', 'edited_channel_post', 'business_connection',
  'business_message', 'edited_business_message', 'deleted_business_messages', 'guest_message',
  'message_reaction', 'message_reaction_count', 'inline_query', 'chosen_inline_result',
  'callback_query', 'shipping_query', 'pre_checkout_query', 'purchased_paid_media', 'poll',
  'poll_answer', 'my_chat_member', 'chat_member', 'chat_join_request', 'chat_boost',
  'removed_chat_boost', 'managed_bot', 'subscription', 'stopped_message_generation'
];

/* ------------------------------------------------------------------ */
/* Util                                                                */
/* ------------------------------------------------------------------ */

function _gaspolMerge() {
  var out = {};
  for (var i = 0; i < arguments.length; i++) {
    var src = arguments[i];
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(function (k) { if (src[k] !== undefined) out[k] = src[k]; });
    }
  }
  return out;
}

function _gaspolIsBlob(v) {
  return !!v && typeof v === 'object' && typeof v.getBytes === 'function';
}

function _gaspolList(x) { return Array.isArray(x) ? x : [x]; }

function _gaspolChunk(arr, n) {
  var out = [];
  for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Pecah teks panjang di batas baris supaya tag HTML tidak sering terpotong
function _gaspolSplit(text, max) {
  var out = [];
  while (text.length > max) {
    var cut = text.lastIndexOf('\n', max);
    if (cut < max / 2) cut = max;
    out.push(text.substring(0, cut));
    text = text.substring(cut).replace(/^\n/, '');
  }
  out.push(text);
  return out;
}

// Ringkas objek untuk log debug (verbose = tanpa dipotong)
function _gaspolShort(v, full) {
  var t;
  try { t = JSON.stringify(v); } catch (e) { t = String(v); }
  t = String(t);
  return (!full && t.length > 500) ? t.substring(0, 500) + '...(' + t.length + ' karakter)' : t;
}

// Saklar debug global (berlaku untuk semua bot di eksekusi yang sama).
//   DEBUG = true;  verbose = true;    -> kalau Gaspol.gs ditempel sebagai file di project
//   gaspol.DEBUG = true;              -> mode Library
//   gaspolDebug(true, true);          -> berlaku untuk semua cara
var _gaspolFlags = { debug: false, verbose: false };
function gaspolDebug(debug, verbose) {
  _gaspolFlags.debug = debug !== false;
  _gaspolFlags.verbose = !!verbose;
}

// Cocokkan teks dengan daftar trigger (string = substring tanpa peduli huruf besar, RegExp = match)
function _gaspolMatch(triggers, text, exact) {
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    if (t instanceof RegExp) {
      var m = String(text).match(t);
      if (m) return m;
    } else if (typeof t === 'string') {
      if (exact ? text === t : String(text).toLowerCase().indexOf(t.toLowerCase()) !== -1) return [t];
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ApiWrapper                                                          */
/* ------------------------------------------------------------------ */

function ApiWrapper(token) {
  if (!token) throw new Error('GASPOL: token bot kosong. Isi token atau set Script Property BOT_TOKEN.');
  this._token = token;
  this.debug = false;   // diatur lewat opsi { debug: true } pada bot
  this.verbose = false; // diatur lewat opsi { verbose: true } pada bot
  this._base = 'https://api.telegram.org/bot' + token + '/';
}

// Panggil method Bot API apa pun: api.call('getChatMemberCount', {chat_id: 1})
ApiWrapper.prototype.call = function (method, params) { return this._call(method, params); };

ApiWrapper.prototype._dbg = function () {
  return !!(this.debug || _gaspolFlags.debug || (typeof DEBUG !== 'undefined' && DEBUG === true));
};
ApiWrapper.prototype._verbose = function () {
  return !!(this.verbose || _gaspolFlags.verbose || (typeof verbose !== 'undefined' && verbose === true));
};

ApiWrapper.prototype._call = function (method, params) {
  params = params || {};
  var hasBlob = Object.keys(params).some(function (k) { return _gaspolIsBlob(params[k]); });
  var opts = { method: 'post', muteHttpExceptions: true };

  if (hasBlob) {
    // multipart: nilai objek (mis. reply_markup) HARUS di-stringify
    var form = {};
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null) return;
      form[k] = (_gaspolIsBlob(v) || typeof v !== 'object') ? v : JSON.stringify(v);
    });
    opts.payload = form;
  } else {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(params);
  }

  var result = { ok: false, description: 'no response' };
  for (var attempt = 0; attempt < 4; attempt++) {
    try {
      var res = UrlFetchApp.fetch(this._base + method, opts);
      var code = res.getResponseCode();
      try { result = JSON.parse(res.getContentText()); }
      catch (e) { result = { ok: false, error_code: code, description: 'respons bukan JSON' }; }

      if (result.error_code === 429 && attempt < 3) {
        var wait = (result.parameters && result.parameters.retry_after) ? result.parameters.retry_after * 1000 : 1500;
        Utilities.sleep(Math.min(wait, 10000));
        continue;
      }
      if (code >= 500 && attempt < 3) { Utilities.sleep(500 * (attempt + 1)); continue; }
    } catch (err) {
      result = { ok: false, description: String(err) };
      if (attempt < 3) { Utilities.sleep(500 * (attempt + 1)); continue; }
    }
    break;
  }
  if (this._dbg()) {
    var full = this._verbose();
    Logger.log('GASPOL >> ' + method + ' ' + _gaspolShort(params, full) + ' << ' + _gaspolShort(result, full));
  }
  if (!result.ok) Logger.log('GASPOL: ' + method + ' gagal -> ' + result.description);
  return result;
};

// Method yang bisa dipanggil posisional ATAU dengan objek:
//   api.sendMessage(chatId, 'halo', {parse_mode:'HTML'})
//   api.sendMessage({chat_id: chatId, text: 'halo'})
// Argumen terakhir (setelah yang bernama) = parameter tambahan.
var _GASPOL_POSITIONAL = {
  sendMessage: ['chat_id', 'text'],
  sendPhoto: ['chat_id', 'photo'],
  sendDocument: ['chat_id', 'document'],
  sendVideo: ['chat_id', 'video'],
  sendAudio: ['chat_id', 'audio'],
  sendVoice: ['chat_id', 'voice'],
  sendAnimation: ['chat_id', 'animation'],
  sendVideoNote: ['chat_id', 'video_note'],
  sendSticker: ['chat_id', 'sticker'],
  sendLocation: ['chat_id', 'latitude', 'longitude'],
  sendVenue: ['chat_id', 'latitude', 'longitude', 'title', 'address'],
  sendContact: ['chat_id', 'phone_number', 'first_name'],
  sendPoll: ['chat_id', 'question', 'options'],
  sendDice: ['chat_id'],
  sendChatAction: ['chat_id', 'action'],
  sendInvoice: ['chat_id', 'title', 'description', 'payload', 'currency', 'prices'],
  forwardMessage: ['chat_id', 'from_chat_id', 'message_id'],
  forwardMessages: ['chat_id', 'from_chat_id', 'message_ids'],
  copyMessage: ['chat_id', 'from_chat_id', 'message_id'],
  copyMessages: ['chat_id', 'from_chat_id', 'message_ids'],
  deleteMessage: ['chat_id', 'message_id'],
  deleteMessages: ['chat_id', 'message_ids'],
  editMessageText: ['chat_id', 'message_id', 'text'],
  editMessageCaption: ['chat_id', 'message_id', 'caption'],
  editMessageReplyMarkup: ['chat_id', 'message_id', 'reply_markup'],
  setMessageReaction: ['chat_id', 'message_id', 'reaction'],
  stopPoll: ['chat_id', 'message_id'],
  pinChatMessage: ['chat_id', 'message_id'],
  unpinChatMessage: ['chat_id'],
  unpinAllChatMessages: ['chat_id'],
  banChatMember: ['chat_id', 'user_id'],
  unbanChatMember: ['chat_id', 'user_id'],
  restrictChatMember: ['chat_id', 'user_id', 'permissions'],
  promoteChatMember: ['chat_id', 'user_id'],
  approveChatJoinRequest: ['chat_id', 'user_id'],
  declineChatJoinRequest: ['chat_id', 'user_id'],
  createChatInviteLink: ['chat_id'],
  exportChatInviteLink: ['chat_id'],
  setChatTitle: ['chat_id', 'title'],
  setChatDescription: ['chat_id', 'description'],
  leaveChat: ['chat_id'],
  getChat: ['chat_id'],
  getChatMember: ['chat_id', 'user_id'],
  getChatMemberCount: ['chat_id'],
  getChatAdministrators: ['chat_id'],
  getUserProfilePhotos: ['user_id'],
  getFile: ['file_id'],
  createForumTopic: ['chat_id', 'name'],
  closeForumTopic: ['chat_id', 'message_thread_id'],
  reopenForumTopic: ['chat_id', 'message_thread_id'],
  deleteForumTopic: ['chat_id', 'message_thread_id'],
  setMyCommands: ['commands'],
  answerCallbackQuery: ['callback_query_id', 'text'],
  answerInlineQuery: ['inline_query_id', 'results'],
  answerPreCheckoutQuery: ['pre_checkout_query_id', 'ok'],
  answerShippingQuery: ['shipping_query_id', 'ok']
};

Object.keys(_GASPOL_POSITIONAL).forEach(function (method) {
  var names = _GASPOL_POSITIONAL[method];
  ApiWrapper.prototype[method] = function () {
    var a = arguments;
    if (a[0] && typeof a[0] === 'object' && !Array.isArray(a[0])) return this._call(method, a[0]);
    var p = {};
    for (var i = 0; i < names.length; i++) if (a[i] !== undefined) p[names[i]] = a[i];
    return this._call(method, _gaspolMerge(p, a[names.length]));
  };
});

// Album: item boleh berisi Blob di `media`/`thumbnail`; otomatis dijadikan lampiran (attach://)
function _gaspolAttach(media, params) {
  return (media || []).map(function (m, i) {
    var o = _gaspolMerge(m);
    if (_gaspolIsBlob(o.media)) { params['file' + i] = o.media; o.media = 'attach://file' + i; }
    if (_gaspolIsBlob(o.thumbnail)) { params['thumb' + i] = o.thumbnail; o.thumbnail = 'attach://thumb' + i; }
    return o;
  });
}
ApiWrapper.prototype.sendMediaGroup = function (a, b, c) {
  var p = (a && typeof a === 'object' && !Array.isArray(a)) ? _gaspolMerge(a) : _gaspolMerge({ chat_id: a, media: b }, c);
  p.media = _gaspolAttach(p.media, p);
  return this._call('sendMediaGroup', p);
};

// Unduh file kiriman pengguna -> Blob (batas unduhan Bot API: 20 MB). Mengembalikan null kalau gagal.
ApiWrapper.prototype.downloadFile = function (fileId) {
  var f = this._call('getFile', { file_id: fileId });
  if (!f.ok || !f.result || !f.result.file_path) return null;
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/file/bot' + this._token + '/' + f.result.file_path, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    var blob = res.getBlob();
    blob.setName(f.result.file_path.split('/').pop());
    return blob;
  } catch (e) { Logger.log('GASPOL: downloadFile gagal -> ' + e); return null; }
};

// SEMUA method Bot API (spesifikasi Bot API 10.3). Yang belum punya bentuk posisional
// tetap bisa dipanggil dengan objek: api.setChatPermissions({chat_id: 1, permissions: {...}})
var ALL_METHODS = [
  'addStickerToSet', 'answerCallbackQuery', 'answerChatJoinRequestQuery', 'answerGuestQuery',
  'answerInlineQuery', 'answerPreCheckoutQuery', 'answerShippingQuery', 'answerWebAppQuery',
  'approveChatJoinRequest', 'approveSuggestedPost', 'banChatMember', 'banChatSenderChat', 'close',
  'closeForumTopic', 'closeGeneralForumTopic', 'convertGiftToStars', 'copyMessage', 'copyMessages',
  'createChatInviteLink', 'createChatSubscriptionInviteLink', 'createForumTopic',
  'createInvoiceLink', 'createNewStickerSet', 'declineChatJoinRequest', 'declineSuggestedPost',
  'deleteAllMessageReactions', 'deleteBusinessMessages', 'deleteChatPhoto', 'deleteChatStickerSet',
  'deleteEphemeralMessage', 'deleteForumTopic', 'deleteMessage', 'deleteMessageReaction',
  'deleteMessages', 'deleteMyCommands', 'deleteStickerFromSet', 'deleteStickerSet', 'deleteStory',
  'deleteWebhook', 'editChatInviteLink', 'editChatSubscriptionInviteLink',
  'editEphemeralMessageCaption', 'editEphemeralMessageMedia', 'editEphemeralMessageReplyMarkup',
  'editEphemeralMessageText', 'editForumTopic', 'editGeneralForumTopic', 'editMessageCaption',
  'editMessageChecklist', 'editMessageLiveLocation', 'editMessageMedia', 'editMessageReplyMarkup',
  'editMessageText', 'editStory', 'editUserStarSubscription', 'exportChatInviteLink',
  'forwardMessage', 'forwardMessages', 'getAvailableGifts', 'getBusinessAccountGifts',
  'getBusinessAccountStarBalance', 'getBusinessConnection', 'getChat', 'getChatAdministrators',
  'getChatGifts', 'getChatMember', 'getChatMemberCount', 'getChatMenuButton',
  'getCustomEmojiStickers', 'getFile', 'getForumTopicIconStickers', 'getGameHighScores',
  'getManagedBotAccessSettings', 'getManagedBotToken', 'getMe', 'getMyCommands',
  'getMyDefaultAdministratorRights', 'getMyDescription', 'getMyName', 'getMyShortDescription',
  'getMyStarBalance', 'getStarTransactions', 'getStickerSet', 'getUpdates', 'getUserChatBoosts',
  'getUserGifts', 'getUserPersonalChatMessages', 'getUserProfileAudios', 'getUserProfilePhotos',
  'getWebhookInfo', 'giftPremiumSubscription', 'hideGeneralForumTopic', 'leaveChat', 'logOut',
  'pinChatMessage', 'postStory', 'promoteChatMember', 'readBusinessMessage', 'refundStarPayment',
  'removeBusinessAccountProfilePhoto', 'removeChatVerification', 'removeMyProfilePhoto',
  'removeUserVerification', 'reopenForumTopic', 'reopenGeneralForumTopic',
  'replaceManagedBotToken', 'replaceStickerInSet', 'repostStory', 'restrictChatMember',
  'revokeChatInviteLink', 'savePreparedInlineMessage', 'savePreparedKeyboardButton',
  'sendAnimation', 'sendAudio', 'sendChatAction', 'sendChatJoinRequestWebApp', 'sendChecklist',
  'sendContact', 'sendDice', 'sendDocument', 'sendGame', 'sendGift', 'sendInvoice',
  'sendLivePhoto', 'sendLocation', 'sendMediaGroup', 'sendMessage', 'sendMessageDraft',
  'sendPaidMedia', 'sendPhoto', 'sendPoll', 'sendRichMessage', 'sendRichMessageDraft',
  'sendSticker', 'sendVenue', 'sendVideo', 'sendVideoNote', 'sendVoice', 'setBusinessAccountBio',
  'setBusinessAccountGiftSettings', 'setBusinessAccountName', 'setBusinessAccountProfilePhoto',
  'setBusinessAccountUsername', 'setChatAdministratorCustomTitle', 'setChatDescription',
  'setChatMemberTag', 'setChatMenuButton', 'setChatPermissions', 'setChatPhoto',
  'setChatStickerSet', 'setChatTitle', 'setCustomEmojiStickerSetThumbnail', 'setGameScore',
  'setManagedBotAccessSettings', 'setMessageReaction', 'setMyCommands',
  'setMyDefaultAdministratorRights', 'setMyDescription', 'setMyName', 'setMyProfilePhoto',
  'setMyShortDescription', 'setPassportDataErrors', 'setStickerEmojiList', 'setStickerKeywords',
  'setStickerMaskPosition', 'setStickerPositionInSet', 'setStickerSetThumbnail',
  'setStickerSetTitle', 'setUserEmojiStatus', 'setWebhook', 'stopMessageLiveLocation', 'stopPoll',
  'transferBusinessAccountStars', 'transferGift', 'unbanChatMember', 'unbanChatSenderChat',
  'unhideGeneralForumTopic', 'unpinAllChatMessages', 'unpinAllForumTopicMessages',
  'unpinAllGeneralForumTopicMessages', 'unpinChatMessage', 'upgradeGift', 'uploadStickerFile',
  'verifyChat', 'verifyUser'
];
ALL_METHODS.forEach(function (m) {
  if (!ApiWrapper.prototype[m]) ApiWrapper.prototype[m] = function (p) { return this._call(m, p || {}); };
});

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

// Jenis update -> `ctx.updateType`; isinya -> `ctx.event`.
// ctx.message hanya terisi untuk update yang isinya pesan (message, edited_message, channel_post, ...).
function Context(update, api, options) {
  this.update = update;
  this.api = api;
  this._options = options || {};
  this._answered = false;

  var type = null;
  for (var k in update) { if (k !== 'update_id') { type = k; break; } }
  this.updateType = type;
  var ev = type ? update[type] : null;
  var isObj = !!ev && typeof ev === 'object';
  this.event = ev;
  var msgLike = ['message', 'edited_message', 'channel_post', 'edited_channel_post', 'business_message', 'edited_business_message', 'guest_message'];
  this.message = (isObj && ev.chat && (ev.message_id !== undefined || msgLike.indexOf(type) !== -1)) ? ev : null;
  this.callbackQuery = update.callback_query || null;
  this.inlineQuery = update.inline_query || null;

  this.chat = isObj ? (ev.chat || (ev.message && ev.message.chat) || null) : null;
  this.from = isObj ? (ev.from || ev.user || null) : null; // callback: yang menekan tombol

  this.text = this.message ? (this.message.text || this.message.caption || '') : '';
  this.data = this.callbackQuery ? (this.callbackQuery.data || '') : '';
  this.query = this.inlineQuery ? (this.inlineQuery.query || '') : '';
  this.args = [];      // /cmd a b c  -> ['a','b','c']
  this.payload = '';   // /cmd a b c  -> 'a b c'
  this.match = null;   // hasil match hears/action
  this.session = {};
}

Context.prototype._chatId = function () { return this.chat ? this.chat.id : null; };
Context.prototype.isPrivate = function () { return !!this.chat && this.chat.type === 'private'; };
Context.prototype.isGroup = function () { return !!this.chat && (this.chat.type === 'group' || this.chat.type === 'supergroup'); };
Context.prototype.isChannel = function () { return !!this.chat && this.chat.type === 'channel'; };

// Parameter dasar untuk balasan: chat_id (+ topik forum & koneksi bisnis kalau ada)
Context.prototype._base = function () {
  var b = { chat_id: this._chatId() };
  var m = this.message || (this.callbackQuery && this.callbackQuery.message) || null;
  if (m) {
    if (m.is_topic_message && m.message_thread_id) b.message_thread_id = m.message_thread_id;
    if (m.business_connection_id) b.business_connection_id = m.business_connection_id;
  }
  return b;
};

Context.prototype._prep = function (text, extra) {
  extra = _gaspolMerge(extra);
  if (!extra.parse_mode && this._options.parse_mode) {
    extra.parse_mode = this._options.parse_mode;
  } else if (!extra.parse_mode && this._options.smart_parse && /<(b|i|u|s|code|pre)>|<a\s+href=/i.test(text)) {
    extra.parse_mode = 'HTML';
  }
  return extra;
};

// Kirim method send* apa pun ke chat ini: ctx.send('sendInvoice', {...})
Context.prototype.send = function (method, params) {
  if (this._chatId() === null) { Logger.log('GASPOL: ' + method + ' tanpa chat (jenis update: ' + this.updateType + ')'); return null; }
  return this.api._call(method, _gaspolMerge(this._base(), params));
};

Context.prototype.reply = function (text, extra) {
  if (this._chatId() === null) { Logger.log('GASPOL: reply() tanpa chat (jenis update: ' + this.updateType + ')'); return null; }
  text = String(text === undefined || text === null ? '' : text);
  extra = this._prep(text, extra);
  if (this._options.auto_typing) {
    try { this.api._call('sendChatAction', _gaspolMerge(this._base(), { action: 'typing' })); } catch (e) { }
  }
  var chunks = this._options.auto_split === false ? [text] : _gaspolSplit(text, 4096);
  var last;
  for (var i = 0; i < chunks.length; i++) {
    var isLast = i === chunks.length - 1;
    var ex = _gaspolMerge(extra);
    if (!isLast) delete ex.reply_markup; // keyboard hanya di potongan terakhir
    last = this.api.sendMessage(_gaspolMerge(this._base(), { text: chunks[i] }, ex));
    if (!isLast) Utilities.sleep(250);
  }
  return last;
};
Context.prototype.replyIt = Context.prototype.reply;
Context.prototype.replyWithHTML = function (t, e) { e = _gaspolMerge(e); e.parse_mode = 'HTML'; return this.reply(t, e); };
Context.prototype.replyTo = function (text, extra) {
  var mid = this.message ? this.message.message_id : null;
  return this.reply(text, mid ? _gaspolMerge({ reply_parameters: { message_id: mid } }, extra) : extra);
};

// ctx.replyWithPhoto(foto, {caption}) dst: foto = file_id, URL, atau Blob
var _GASPOL_REPLY_FILE = {
  replyWithPhoto: ['sendPhoto', 'photo'], replyWithDocument: ['sendDocument', 'document'],
  replyWithVideo: ['sendVideo', 'video'], replyWithAudio: ['sendAudio', 'audio'],
  replyWithVoice: ['sendVoice', 'voice'], replyWithAnimation: ['sendAnimation', 'animation'],
  replyWithSticker: ['sendSticker', 'sticker'], replyWithVideoNote: ['sendVideoNote', 'video_note']
};
Object.keys(_GASPOL_REPLY_FILE).forEach(function (name) {
  var method = _GASPOL_REPLY_FILE[name][0], field = _GASPOL_REPLY_FILE[name][1];
  Context.prototype[name] = function (file, extra) {
    var p = {}; p[field] = file;
    return this.send(method, _gaspolMerge(p, this._prep(extra && extra.caption || '', extra)));
  };
});
Context.prototype.replyWithLocation = function (lat, lon, extra) { return this.send('sendLocation', _gaspolMerge({ latitude: lat, longitude: lon }, extra)); };
Context.prototype.replyWithContact = function (phone, firstName, extra) { return this.send('sendContact', _gaspolMerge({ phone_number: phone, first_name: firstName }, extra)); };
Context.prototype.replyWithPoll = function (question, options, extra) { return this.send('sendPoll', _gaspolMerge({ question: question, options: options }, extra)); };
Context.prototype.replyWithDice = function (extra) { return this.send('sendDice', extra); };
Context.prototype.replyWithMediaGroup = function (media, extra) {
  var p = _gaspolMerge(this._base(), { media: media }, extra);
  p.media = _gaspolAttach(p.media, p);
  return this.api._call('sendMediaGroup', p);
};
Context.prototype.sendTyping = function () { return this.send('sendChatAction', { action: 'typing' }); };

// Edit pesan: untuk callback -> pesan yang ada tombolnya; untuk pesan biasa -> pesan itu sendiri
Context.prototype.editText = function (text, extra) {
  text = String(text);
  var p = _gaspolMerge({ text: text }, this._prep(text, extra));
  if (this.callbackQuery && this.callbackQuery.inline_message_id) {
    p.inline_message_id = this.callbackQuery.inline_message_id;
  } else {
    var m = this.callbackQuery ? this.callbackQuery.message : this.message;
    if (!m) return null;
    p.chat_id = m.chat.id; p.message_id = m.message_id;
  }
  return this.api.editMessageText(p);
};

Context.prototype.deleteMessage = function () {
  var m = this.callbackQuery ? this.callbackQuery.message : this.message;
  return m ? this.api.deleteMessage(m.chat.id, m.message_id) : null;
};

Context.prototype.answerCbQuery = function (text, showAlert, extra) {
  if (!this.callbackQuery) return null;
  this._answered = true;
  return this.api._call('answerCallbackQuery', _gaspolMerge({
    callback_query_id: this.callbackQuery.id, text: text, show_alert: !!showAlert
  }, extra));
};

Context.prototype.react = function (emoji) { // ctx.react('👍')
  if (!this.message) return null;
  return this.api.setMessageReaction({
    chat_id: this.message.chat.id, message_id: this.message.message_id,
    reaction: emoji ? [{ type: 'emoji', emoji: emoji }] : []
  });
};
Context.prototype.forward = function (toChatId, extra) {
  if (!this.message) return null;
  return this.api.forwardMessage(toChatId, this.message.chat.id, this.message.message_id, extra);
};
Context.prototype.copy = function (toChatId, extra) {
  if (!this.message) return null;
  return this.api.copyMessage(toChatId, this.message.chat.id, this.message.message_id, extra);
};

// file_id dari pesan (foto terbesar / dokumen / video / audio / voice / animasi / video note / stiker)
Context.prototype.fileId = function () {
  var m = this.message;
  if (!m) return null;
  if (m.photo && m.photo.length) return m.photo[m.photo.length - 1].file_id;
  var keys = ['document', 'video', 'audio', 'voice', 'animation', 'video_note', 'sticker'];
  for (var i = 0; i < keys.length; i++) if (m[keys[i]]) return m[keys[i]].file_id;
  return null;
};
Context.prototype.download = function (fileId) { // -> Blob atau null
  fileId = fileId || this.fileId();
  return fileId ? this.api.downloadFile(fileId) : null;
};

Context.prototype.isAdmin = function (userId) {
  var uid = userId || (this.from && this.from.id);
  if (!this.chat || !uid) return false;
  var r = this.api.getChatMember(this.chat.id, uid);
  return !!(r && r.ok && (r.result.status === 'administrator' || r.result.status === 'creator'));
};

// Inline query, pembayaran, permintaan bergabung
Context.prototype.answerInlineQuery = function (results, extra) {
  if (!this.inlineQuery) return null;
  return this.api.answerInlineQuery(_gaspolMerge({ inline_query_id: this.inlineQuery.id, results: results }, extra));
};
Context.prototype.answerPreCheckout = function (ok, errorMessage) {
  var q = this.update.pre_checkout_query;
  return q ? this.api.answerPreCheckoutQuery(_gaspolMerge({ pre_checkout_query_id: q.id, ok: !!ok, error_message: errorMessage })) : null;
};
Context.prototype.answerShipping = function (ok, shippingOptions, errorMessage) {
  var q = this.update.shipping_query;
  return q ? this.api.answerShippingQuery(_gaspolMerge({ shipping_query_id: q.id, ok: !!ok, shipping_options: shippingOptions, error_message: errorMessage })) : null;
};
Context.prototype.approveJoinRequest = function () {
  var r = this.update.chat_join_request;
  return r ? this.api.approveChatJoinRequest(r.chat.id, r.from.id) : null;
};
Context.prototype.declineJoinRequest = function () {
  var r = this.update.chat_join_request;
  return r ? this.api.declineChatJoinRequest(r.chat.id, r.from.id) : null;
};

// Percakapan bertahap (form): ctx.setState('nama') lalu pesan berikutnya ditangani bot.state('nama', fn)
Context.prototype.setState = function (name) { this.session._state = name; return this; };
Context.prototype.getState = function () { return this.session._state || null; };
Context.prototype.clearState = function () { delete this.session._state; return this; };

/* ------------------------------------------------------------------ */
/* Markup, Button, Helper                                              */
/* ------------------------------------------------------------------ */

var Markup = {
  inlineKeyboard: function (btns, col) {
    var rows = Array.isArray(btns[0]) ? btns : (col ? _gaspolChunk(btns, col) : [btns]);
    rows = rows.map(function (r) {
      return r.map(function (b) { var nb = _gaspolMerge({}, b); delete nb._hidden; return nb; });
    });
    return { inline_keyboard: rows };
  },
  keyboard: function (btns, col, opts) {
    var rows = Array.isArray(btns[0]) ? btns : (col ? _gaspolChunk(btns, col) : [btns]);
    return _gaspolMerge({ keyboard: rows, resize_keyboard: true }, opts);
  },
  removeKeyboard: function () { return { remove_keyboard: true }; },
  forceReply: function (placeholder) { return { force_reply: true, input_field_placeholder: placeholder }; }
};

var Button = {
  callback: function (l, d, h) { return { text: l, callback_data: String(d), _hidden: !!h }; },
  url: function (l, u, h) { return { text: l, url: u, _hidden: !!h }; },
  webApp: function (l, u) { return { text: l, web_app: { url: u } }; },
  copy: function (l, text) { return { text: l, copy_text: { text: text } }; },
  login: function (l, url) { return { text: l, login_url: { url: url } }; },
  pay: function (l) { return { text: l, pay: true }; },
  switchInline: function (l, q) { return { text: l, switch_inline_query: q || '' }; },
  switchInlineCurrent: function (l, q) { return { text: l, switch_inline_query_current_chat: q || '' }; },
  requestContact: function (l) { return { text: l, request_contact: true }; },   // untuk Markup.keyboard
  requestLocation: function (l) { return { text: l, request_location: true }; }  // untuk Markup.keyboard
};

var Helper = {
  escapeHTML: function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
  escapeMarkdownV2: function (t) { return String(t).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1'); },
  bold: function (t) { return '<b>' + t + '</b>'; },
  italic: function (t) { return '<i>' + t + '</i>'; },
  code: function (t) { return '<code>' + Helper.escapeHTML(t) + '</code>'; },
  pre: function (t) { return '<pre>' + Helper.escapeHTML(t) + '</pre>'; },
  link: function (t, url) { return '<a href="' + String(url).replace(/"/g, '&quot;') + '">' + t + '</a>'; },
  mention: function (user) {
    return '<a href="tg://user?id=' + user.id + '">' + Helper.escapeHTML(user.first_name || 'user') + '</a>';
  }
};
Helper.clearHTML = Helper.escapeHTML; // kompatibel dengan v1.0

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

function SessionManager() { this.prefix = 'sess_'; }

SessionManager.prototype.get = function (id) {
  var key = this.prefix + id;
  try { var v = CacheService.getScriptCache().get(key); if (v) return JSON.parse(v); } catch (e) { }
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(key);
    if (raw) return JSON.parse(raw);
  } catch (e) { }
  return {};
};

// before = JSON session sebelum handler jalan; kalau tidak berubah, tidak menulis apa-apa
SessionManager.prototype.set = function (id, data, before, persist) {
  var json = JSON.stringify(data || {});
  if (json === before) return false;
  data._ts = Date.now();
  json = JSON.stringify(data);
  var key = this.prefix + id;
  try { CacheService.getScriptCache().put(key, json, 21600); } catch (e) { }
  if (persist !== false && json.length < 8000) { // batas Properties 9KB per nilai
    try { PropertiesService.getScriptProperties().setProperty(key, json); } catch (e) { }
  }
  return true;
};

// Hapus session yang tidak aktif > maxAgeDays hari. Pasang di time-driven trigger.
SessionManager.prototype.cleanup = function (maxAgeDays) {
  var limit = Date.now() - (maxAgeDays || 30) * 86400000;
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties(), removed = 0, prefix = this.prefix;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(prefix) !== 0) return;
    var s; try { s = JSON.parse(all[k]); } catch (e) { s = null; }
    if (!s || !s._ts || s._ts < limit) { props.deleteProperty(k); removed++; }
  });
  return removed;
};

var sessionManager = new SessionManager();

/* ------------------------------------------------------------------ */
/* FrameWork                                                           */
/* ------------------------------------------------------------------ */

function FrameWork(token, opts) {
  if (!(this instanceof FrameWork)) return new FrameWork(token, opts); // boleh dipanggil tanpa `new`
  token = token || PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  this._api = new ApiWrapper(token);
  this.api = this._api;
  this.options = _gaspolMerge({
    auto_typing: false,     // kirim 'typing' sebelum reply (menambah 1 request per balasan)
    smart_parse: true,      // otomatis HTML kalau teks mengandung <b>, <i>, <code>, dst
    auto_split: true,       // pecah teks > 4096 karakter
    dedupe: true,           // doPost mengabaikan update_id yang sama (retry webhook)
    persist_session: true,  // simpan session ke Script Properties (selain cache)
    auto_answer_cb: true,   // otomatis answerCallbackQuery kalau handler lupa
    auto_session: true      // false = ctx.session selalu kosong & tidak disimpan
    // parse_mode: 'HTML'   -> default parse_mode untuk semua reply
    // log_id: 123456       -> chat id admin yang menerima laporan error
    // debug: true          -> catat tiap update masuk & tiap panggilan API (default: mati)
    // verbose: true        -> log debug berisi data lengkap (tanpa dipotong)
    // allowed_updates: gaspol.GASPOL_UPDATES -> dipakai setWebhook() dan poll()
  }, opts);
  this._api.debug = !!this.options.debug;
  this._api.verbose = !!this.options.verbose;
  this._handlers = [];
  this._middlewares = [];
  this._states = {};
  this._onError = null;
}

FrameWork.prototype.cmd = function (c, fn) {
  var list = _gaspolList(c).map(function (s) { return String(s).replace(/^\//, '').toLowerCase(); });
  this._handlers.push({ type: 'command', trigger: list, fn: fn });
  return this;
};
FrameWork.prototype.command = FrameWork.prototype.cmd;

// Jalan pintas gaya GasBot: bot.start(fn) = bot.cmd('start', fn)
FrameWork.prototype.start = function (fn) { return this.cmd('start', fn); };
FrameWork.prototype.help = function (fn) { return this.cmd('help', fn); };

FrameWork.prototype.hears = function (t, fn) { this._handlers.push({ type: 'hears', trigger: _gaspolList(t), fn: fn }); return this; };
FrameWork.prototype.action = function (t, fn) { this._handlers.push({ type: 'action', trigger: _gaspolList(t), fn: fn }); return this; };

// bot.on(jenis, fn). Jenis bisa:
//   jenis update : 'edited_message' 'channel_post' 'inline_query' 'chosen_inline_result' 'pre_checkout_query'
//                  'shipping_query' 'my_chat_member' 'chat_member' 'chat_join_request' 'message_reaction'
//                  'poll_answer' 'chat_boost' 'business_message' ... (semua di gaspol.GASPOL_UPDATES)
//   isi pesan    : 'text' 'photo' 'document' 'video' 'audio' 'voice' 'sticker' 'location' 'contact' 'poll'
//                  'new_chat_members' 'left_chat_member' 'successful_payment' 'web_app_data' ...
//   'any'        : semua update
FrameWork.prototype.on = function (type, fn) { this._handlers.push({ type: 'on', trigger: _gaspolList(type), fn: fn }); return this; };

// Percakapan bertahap: bot.state('tanya_nama', fn); di handler lain: ctx.setState('tanya_nama')
FrameWork.prototype.state = function (name, fn) { this._states[name] = fn; return this; };

// Middleware: function(ctx, next){ ...; next(); }  (tidak panggil next() = hentikan proses)
FrameWork.prototype.use = function (mw) { this._middlewares.push(mw); return this; };
FrameWork.prototype.onError = function (fn) { this._onError = fn; return this; };

// Middleware siap pakai
FrameWork.prototype.usePrivateOnly = function () { // grup/channel diabaikan (update tanpa chat tetap lewat)
  return this.use(function (ctx, next) { if (!ctx.chat || ctx.chat.type === 'private') next(); });
};
FrameWork.prototype.useGroupOnly = function () {
  return this.use(function (ctx, next) { if (ctx.isGroup()) next(); });
};
FrameWork.prototype.useAllowed = function (userIds, onDenied) { // hanya user id tertentu
  return this.use(function (ctx, next) {
    if (ctx.from && userIds.indexOf(ctx.from.id) !== -1) next();
    else if (onDenied) onDenied(ctx);
  });
};
FrameWork.prototype.useRateLimit = function (max, seconds, onLimit) { // maks `max` update per `seconds` detik per user
  return this.use(function (ctx, next) {
    var uid = ctx.from ? ctx.from.id : (ctx.chat ? ctx.chat.id : 0);
    var key = 'rl_' + uid, c = CacheService.getScriptCache(), n = Number(c.get(key)) || 0;
    if (n >= max) { if (onLimit) onLimit(ctx); return; }
    c.put(key, String(n + 1), Math.max(1, seconds || 10));
    next();
  });
};

FrameWork.prototype._runMiddleware = function (ctx, last) {
  var mws = this._middlewares, i = -1;
  function next() { i++; if (i < mws.length) return mws[i](ctx, next); return last(); }
  next();
};

function _gaspolOnMatch(ctx, t) {
  if (t === 'any') return true;
  if (t === 'text') return !!(ctx.message && ctx.message.text);
  if (ctx.update[t] !== undefined && t !== 'update_id') return true;   // jenis update
  return !!(ctx.message && ctx.message[t]);                             // isi pesan
}

FrameWork.prototype._dispatch = function (ctx) {
  var type = ctx.updateType, isMsg = type === 'message';
  var text = ctx.text, cmd = null, h, m, i, j;

  if (isMsg && text.charAt(0) === '/') {
    var parts = text.split(/\s+/);
    cmd = parts[0].substring(1).split('@')[0].toLowerCase();
    ctx.args = parts.slice(1).filter(Boolean);
    ctx.payload = text.substring(parts[0].length).trim();
  }

  // Percakapan bertahap (bot.state): hanya pesan biasa, bukan command
  var st = ctx.session && ctx.session._state;
  if (isMsg && cmd === null && st && this._states[st]) return this._states[st](ctx);

  for (i = 0; i < this._handlers.length; i++) {
    h = this._handlers[i];
    if (h.type === 'command') {
      if (isMsg && cmd !== null && h.trigger.indexOf(cmd) !== -1) return h.fn(ctx);
    } else if (h.type === 'hears') {
      if (isMsg && text && (m = _gaspolMatch(h.trigger, text, false))) { ctx.match = m; return h.fn(ctx); }
    } else if (h.type === 'action') {
      if (type === 'callback_query' && (m = _gaspolMatch(h.trigger, ctx.data, true))) { ctx.match = m; return h.fn(ctx); }
    } else if (h.type === 'on') {
      for (j = 0; j < h.trigger.length; j++) if (_gaspolOnMatch(ctx, h.trigger[j])) return h.fn(ctx);
    }
  }
};

FrameWork.prototype._isDuplicate = function (id) {
  try {
    var c = CacheService.getScriptCache(), k = 'upd_' + id;
    if (c.get(k)) return true;
    c.put(k, '1', 600);
  } catch (e) { }
  return false;
};

FrameWork.prototype.handleUpdate = function (update) {
  if (!update) return; // handleUpdate selalu memproses; anti-duplikat ada di doPost
  if (this._api._dbg()) Logger.log('GASPOL update: ' + _gaspolShort(update, this._api._verbose()));

  var ctx = new Context(update, this._api, this.options);
  if (!ctx.updateType) return;

  // kunci session: chat; update tanpa chat (inline_query, dll) memakai id user
  var sid = ctx.chat ? ctx.chat.id : (ctx.from ? ctx.from.id : null);
  var useSession = this.options.auto_session !== false && sid !== null;
  var self = this;
  ctx.session = useSession ? sessionManager.get(sid) : {};
  var snapshot = JSON.stringify(ctx.session);

  try {
    this._runMiddleware(ctx, function () { self._dispatch(ctx); });
    if (ctx.callbackQuery && this.options.auto_answer_cb && !ctx._answered) ctx.answerCbQuery();
  } catch (e) {
    if (this._onError) { try { this._onError(e, ctx); } catch (e2) { Logger.log(e2); } }
    else Logger.log('GASPOL error: ' + ((e && e.stack) || e));
    if (this.options.log_id) {
      try { this._api.sendMessage(this.options.log_id, 'GASPOL error: ' + String((e && e.message) || e)); } catch (e3) { }
    }
  }

  if (useSession) sessionManager.set(sid, ctx.session, snapshot, this.options.persist_session);
};

FrameWork.prototype.doPost = function (e) {
  try {
    var update = JSON.parse(e.postData.contents);
    // Telegram mengirim ulang update kalau respons lambat -> abaikan update_id yang sama
    if (!(this.options.dedupe && update.update_id !== undefined && this._isDuplicate(update.update_id))) {
      this.handleUpdate(update);
    }
  }
  catch (err) { Logger.log('GASPOL doPost: ' + err); }
  return ContentService.createTextOutput('ok');
};

// Mode polling (tanpa webhook): jalankan bot.poll() dari trigger waktu (mis. tiap 1 menit).
// Webhook harus dimatikan dulu: bot.deleteWebhook(). Mengembalikan jumlah update yang diproses.
FrameWork.prototype.poll = function (limit) {
  var props = PropertiesService.getScriptProperties(), key = 'gaspol_offset';
  var offset = Number(props.getProperty(key)) || 0;
  var r = this._api.getUpdates(_gaspolMerge({
    offset: offset || undefined, limit: limit || 100, timeout: 0, allowed_updates: this.options.allowed_updates
  }));
  if (!r || !r.ok || !r.result) return 0;
  var n = 0;
  for (var i = 0; i < r.result.length; i++) {
    var u = r.result[i];
    this.handleUpdate(u);
    offset = u.update_id + 1;
    n++;
  }
  if (n) props.setProperty(key, String(offset));
  return n;
};

// Helper operasional
FrameWork.prototype.setDebug = function (on, verbose) {
  this.options.debug = on !== false;
  this.options.verbose = !!verbose;
  this._api.debug = this.options.debug;
  this._api.verbose = this.options.verbose;
  return this;
};
FrameWork.prototype.setWebhook = function (url, extra) {
  return this._api.setWebhook(_gaspolMerge({
    url: url, drop_pending_updates: true, allowed_updates: this.options.allowed_updates
  }, extra));
};
FrameWork.prototype.deleteWebhook = function (dropPending) {
  return this._api.deleteWebhook({ drop_pending_updates: !!dropPending });
};
FrameWork.prototype.setCommands = function (list, extra) { // [{command:'start', description:'Mulai'}]
  return this._api.setMyCommands(_gaspolMerge({ commands: list }, extra));
};
FrameWork.prototype.broadcast = function (chatIds, text, extra) {
  var sent = 0;
  chatIds.forEach(function (id) {
    if (this._api.sendMessage(id, text, extra).ok) sent++;
    Utilities.sleep(40); // aman terhadap limit ~30 pesan/detik
  }, this);
  return sent;
};

// Entry point paling aman, terutama kalau dipakai sebagai Library:
//   var tg = gaspol.createBot(TOKEN);   // identifier library = "gaspol"
function createBot(token, opts) { return new FrameWork(token, opts); }

// Gaya GasBot: new gaspol.init(token, opts)  atau  gaspol.init(token, opts)
function init(token, opts) { return new FrameWork(token, opts); }
FrameWork.init = FrameWork;         // gaspol.init(...) dengan/tanpa new, kalau file ditempel ke project
FrameWork.createBot = createBot;    // gaspol.createBot(...) di mode file (di mode Library sudah ada)
var Gaspol = FrameWork;
var gaspol = FrameWork;
var GASPOL = FrameWork;